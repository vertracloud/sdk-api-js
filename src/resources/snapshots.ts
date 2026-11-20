import type { VertraClient } from "../client.js";
import { SNAPSHOT_TIMEOUT_MS, deferredPathSegment } from "../client.js";
import { type DownloadedFile, writeStreamToFile } from "../download.js";
import { SnapshotJobError, VertraAPIError, WaitTimeoutError } from "../errors.js";
import type { APIGroupedResourceSnapshots, APIResourceSnapshot, APISnapshotJob, APISnapshotRestoreAccepted, SnapshotCreateResult, SnapshotJobKind, SnapshotScope } from "../types.js";
import { sleep } from "../wait.js";

/**
 * `scope`: `applications` = app snapshots, `databases` = database snapshots. Required on every `snapshots.*` call.
 * `timeoutMs` is the limit of each request.
 */
export interface SnapshotOptions {
	scope: SnapshotScope;
	/** The workspace the resource belongs to (sent as `workspace_id` on every call of the domain). Omit for a resource of your own account. */
	workspaceId?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/** Options of `snapshots.download`. `timeoutMs` is the wait for the response headers; the body has no total deadline, only `inactivityTimeoutMs`. */
export interface SnapshotDownloadOptions extends SnapshotOptions {
	/** The download fails with a `TimeoutError` when no byte arrives for this many ms; the clock restarts at every chunk. Default `60000`. */
	inactivityTimeoutMs?: number;
}

/** How `snapshots.createAndWait` follows the job. `timeoutMs` stays the limit of each request. */
export interface SnapshotCreateAndWaitOptions extends SnapshotOptions {
	/** Poll interval in ms while the job runs. Default `2000`. */
	intervalMs?: number;
	/** Total wait in ms before `WaitTimeoutError` (the snapshot keeps being taken). Default `1800000` (30 min). */
	waitTimeoutMs?: number;
	/** Called with the job on every poll while it has not ended: `job.status`, and `job.progress` while `running`. */
	onProgress?: (job: APISnapshotJob) => void;
}

export interface SnapshotRestoreOptions extends SnapshotOptions {
	/**
	 * Application on a custom Docker image: also go back to the image version it ran when the snapshot was taken, if that
	 * version still exists. Absent = data only (the API default). When the version is gone, the response has `warning`.
	 */
	restoreImageVersion?: boolean;
}

/**
 * `snapshots.*` — one method per route under the `snapshots:*` scopes. Resources here are
 * identified by the **resource** id (an app or a database id), not a user id, despite the `:id`
 * path segment. `workspaceId` (optional) is sent as `workspace_id` on every call, including the ones `createAndWait` and `apps.download*` make.
 * @see https://docs.vertracloud.app/api-reference
 */
export class SnapshotsResource {
	constructor(private readonly client: VertraClient) {}

	/** `GET /v1/users/snapshots` — scope `snapshots:read`. All snapshots, grouped by resource. */
	listAll(options: SnapshotOptions): Promise<APIGroupedResourceSnapshots[]> {
		return this.client.request({ method: "GET", path: "/v1/users/snapshots", query: { scope: options.scope }, signal: options.signal, timeoutMs: options.timeoutMs });
	}

	/** `GET /v1/users/:id/snapshots` — scope `snapshots:read`. `id` = the app/database resource id. @see https://docs.vertracloud.app/api-reference/endpoint/apps/snapshots/getall */
	list(resourceId: string, options: SnapshotOptions): Promise<APIResourceSnapshot[]> {
		return this.client.request({ method: "GET", path: `/v1/users/${deferredPathSegment(resourceId)}/snapshots`, query: { scope: options.scope, workspace_id: options.workspaceId }, signal: options.signal, timeoutMs: options.timeoutMs });
	}

	/**
	 * `GET /v1/users/:id/snapshots/:snapshot_id/download` — scope `snapshots:read`. Resolves with the snapshot's zip as an `ArrayBuffer`, whatever its size:
	 * there is no total deadline, only `inactivityTimeoutMs` (60 s without a single byte; the clock restarts at every chunk) and `timeoutMs` for the headers
	 * (default 120 s). `signal` cancels at any time. A snapshot of a deleted resource can still be downloaded. Not available for a snapshot of a closed template.
	 *
	 * The whole file is held in memory (and briefly twice): for a snapshot that can be large, use `downloadToFile` (writes to disk as the bytes arrive) or
	 * `downloadStream`.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/snapshots/download
	 */
	download(resourceId: string, snapshotId: string, options: SnapshotDownloadOptions): Promise<ArrayBuffer> {
		return this.client.requestBinary(this.downloadConfig(resourceId, snapshotId, options));
	}

	/**
	 * Same download as `download`, as a `ReadableStream<Uint8Array>` that hands over the bytes as they arrive: memory does not grow with the file. The stream errors
	 * with a `TimeoutError` after `inactivityTimeoutMs` without a byte (while you are waiting to read) and with the `signal`'s reason when it aborts; cancel the
	 * stream to stop the download. Works in any runtime with `fetch`.
	 */
	downloadStream(resourceId: string, snapshotId: string, options: SnapshotDownloadOptions): Promise<ReadableStream<Uint8Array>> {
		return this.client.requestStream(this.downloadConfig(resourceId, snapshotId, options));
	}

	/**
	 * Same download as `download`, written to `path` as the bytes arrive: memory stays constant, whatever the size (a snapshot of 8 GB is fine). The bytes go to a
	 * temporary file next to `path` that is renamed to `path` only when the download ends; on failure, `inactivityTimeoutMs` or `signal` the temporary file is
	 * removed, and `path` never holds a partial file. An existing `path` is replaced at the end. Node.js only. Resolves with `{ path, bytes }`.
	 */
	async downloadToFile(resourceId: string, snapshotId: string, path: string, options: SnapshotDownloadOptions): Promise<DownloadedFile> {
		return writeStreamToFile(await this.downloadStream(resourceId, snapshotId, options), path);
	}

	private downloadConfig(resourceId: string, snapshotId: string, options: SnapshotDownloadOptions) {
		return {
			method: "GET" as const,
			path: `/v1/users/${deferredPathSegment(resourceId)}/snapshots/${deferredPathSegment(snapshotId)}/download`,
			query: { scope: options.scope, workspace_id: options.workspaceId },
			signal: options.signal,
			timeoutMs: options.timeoutMs ?? SNAPSHOT_TIMEOUT_MS,
			inactivityTimeoutMs: options.inactivityTimeoutMs,
		};
	}

	/**
	 * `POST /v1/users/:id/snapshots` — scope `snapshots:write`. One request: resolves with `{ status: "ready", snapshot }` when the snapshot was taken within
	 * about 90 s, or with `{ status: "accepted", job_id }` when the API answered `202` and is still taking it. Follow `job_id` with
	 * `client.snapshotJobs.wait`, or use `createAndWait` to do both.
	 * Limits (`429 SNAPSHOT_RATE_LIMITED`, see `snapshotRateLimited(error)`): the plan's snapshot quota per account and an interval per resource
	 * (see the knowledge base); faster requests get a plain `429` with `retryAfter`. Waits up to 120 s per request unless `timeoutMs` says otherwise.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/snapshots/create
	 */
	async create(resourceId: string, options: SnapshotOptions): Promise<SnapshotCreateResult> {
		const { status, json } = await this.client.requestWithStatus({
			method: "POST",
			path: `/v1/users/${deferredPathSegment(resourceId)}/snapshots`,
			query: { scope: options.scope, workspace_id: options.workspaceId },
			signal: options.signal,
			timeoutMs: options.timeoutMs ?? SNAPSHOT_TIMEOUT_MS,
		});
		if (status !== 202) return { status: "ready", snapshot: json.response as APIResourceSnapshot };
		const jobId = (json.response as { job_id?: unknown } | undefined)?.job_id;
		if (typeof jobId !== "string" || jobId === "") throw new VertraAPIError(202, { code: "SNAPSHOT_FAILED", message: "The snapshot is still being taken but no job_id came back" });
		return { status: "accepted", job_id: jobId };
	}

	/**
	 * `create` and, when the API answered `202`, `snapshotJobs.wait` for the job (every `intervalMs`, up to `waitTimeoutMs`). Resolves with the snapshot.
	 * Throws `SnapshotJobError` (`reason`, `details`, `job`) when the job ends `failed` or `skipped`, and `WaitTimeoutError` when the wait runs out
	 * (the snapshot keeps being taken: `error.job.id` follows it). `timeoutMs` is the limit of each request, `waitTimeoutMs` the total wait.
	 */
	async createAndWait(resourceId: string, options: SnapshotCreateAndWaitOptions): Promise<APIResourceSnapshot> {
		const { scope, workspaceId, signal, intervalMs, waitTimeoutMs, onProgress } = options;
		const created = await this.create(resourceId, options);
		if (created.status === "ready") return created.snapshot;
		const job = await new SnapshotJobsResource(this.client).wait(resourceId, created.job_id, { scope, workspaceId, signal, timeoutMs: options.timeoutMs, intervalMs, waitTimeoutMs, onProgress });
		const found = job.snapshot_id ? (await this.list(resourceId, { scope, workspaceId, signal })).find((snapshot) => snapshot.id === job.snapshot_id) : undefined;
		if (found) return found;
		throw new VertraAPIError(404, { code: "SNAPSHOT_NOT_FOUND", message: `Snapshot job ${created.job_id} is ready but its snapshot is not in the list` });
	}

	/**
	 * `POST /v1/users/:id/snapshots/:snapshot_id/restore` — scope `snapshots:write`. The restore runs as a job: the call resolves in seconds
	 * (HTTP 202) with `{ job_id, warning? }` and the resource is **not** restored yet. Follow it with `client.snapshotJobs.wait(resourceId, job_id)`
	 * until the job is `ready` (it throws `SnapshotJobError`, with `reason` and `details`, when the job ends `failed` or `skipped`). While it runs, every write to the resource fails with `409 RESTORE_IN_PROGRESS`.
	 *
	 * The restore replaces the current content of the resource and starts right away: take a snapshot first (`create`) if you may need that content again.
	 * Refusals before the job starts: `400 SNAPSHOT_EXCEEDS_STORAGE` (`snapshotExceedsStorage(error)`), `409 APP_BUILDING`, `409 RESTORE_IN_PROGRESS`
	 * and `429 RESTORE_COOLDOWN` (the wait between restores; `restoreCooldownRetryAfter(error)`).
	 * For database snapshots the job can end with `SNAPSHOT_VERSION_NEWER`, `SNAPSHOT_ENGINE_MISMATCH` or `SNAPSHOT_IMPORT_FAILED`.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/snapshots/restore
	 */
	restore(resourceId: string, snapshotId: string, options: SnapshotRestoreOptions): Promise<APISnapshotRestoreAccepted> {
		const body = options.restoreImageVersion === undefined ? undefined : { restore_image_version: options.restoreImageVersion };
		return this.client.request({
			method: "POST",
			path: `/v1/users/${deferredPathSegment(resourceId)}/snapshots/${deferredPathSegment(snapshotId)}/restore`,
			query: { scope: options.scope, workspace_id: options.workspaceId },
			body,
			signal: options.signal,
			timeoutMs: options.timeoutMs,
		});
	}
}

export interface SnapshotJobListOptions extends SnapshotOptions {
	/** Only jobs of this kind. Default: both. */
	kind?: SnapshotJobKind;
	/** At most this many jobs, most recent first. 1 to 50 (another value is a `400 VALIDATION_ERROR`). Default 10. */
	limit?: number;
}

/** Options of `snapshotJobs.get`: `scope` is optional because the job id already identifies it. */
export interface SnapshotJobGetOptions {
	scope?: SnapshotScope;
	/** The workspace the resource belongs to. */
	workspaceId?: string;
	signal?: AbortSignal;
	/** Limit of the request, in ms. */
	timeoutMs?: number;
}

export interface SnapshotJobWaitOptions extends SnapshotJobGetOptions {
	/** Total wait in ms before `WaitTimeoutError` (the job keeps running). Default `1800000` (30 min). */
	waitTimeoutMs?: number;
	/** Poll interval in ms. Default `2000`. */
	intervalMs?: number;
	/** Called with the job on every poll while it has not ended: `job.status`, and `job.progress` while `running`. */
	onProgress?: (job: APISnapshotJob) => void;
}

/** Default total wait of a job: 30 minutes. */
export const DEFAULT_WAIT_TIMEOUT_MS = 1_800_000;

/**
 * `snapshotJobs.*` — the snapshot and restore jobs of a resource (scope `snapshots:read`). `resourceId` is the app or database the job acts on.
 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/snapshots/jobs/list
 */
export class SnapshotJobsResource {
	constructor(private readonly client: VertraClient) {}

	/** `GET /v1/users/:id/snapshots/jobs` — jobs of one resource, most recent first. `scope` is required; `limit` goes from 1 to 50. */
	list(resourceId: string, options: SnapshotJobListOptions): Promise<APISnapshotJob[]> {
		return this.client.request({
			method: "GET",
			path: `/v1/users/${deferredPathSegment(resourceId)}/snapshots/jobs`,
			query: { scope: options.scope, kind: options.kind, limit: options.limit, workspace_id: options.workspaceId },
			signal: options.signal,
			timeoutMs: options.timeoutMs,
		});
	}

	/**
	 * `GET /v1/users/:id/snapshots/jobs/:job_id` — one job. `scope` is optional. `status` is `queued`, `running`, `ready`, `skipped` or `failed`
	 * (`reason` is the error code). A job of another resource or account, or one that does not exist, is `404 SNAPSHOT_NOT_FOUND`.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/snapshots/jobs/get
	 */
	get(resourceId: string, jobId: string, options?: SnapshotJobGetOptions): Promise<APISnapshotJob> {
		return this.client.request({
			method: "GET",
			path: `/v1/users/${deferredPathSegment(resourceId)}/snapshots/jobs/${deferredPathSegment(jobId)}`,
			query: { scope: options?.scope, workspace_id: options?.workspaceId },
			signal: options?.signal,
			timeoutMs: options?.timeoutMs,
		});
	}

	/**
	 * Polls the job until it ends. Resolves with the job when it is `ready`; throws `SnapshotJobError` (`status`, `reason`, `details`, `job`) when it ends
	 * `failed` or `skipped`, and `WaitTimeoutError` (with the last `job`) after `waitTimeoutMs`, the total wait (the job keeps running). `timeoutMs` is the
	 * limit of each poll. Errors of the polling itself propagate unchanged. `onProgress` is called on every poll while the job has not ended.
	 */
	async wait(resourceId: string, jobId: string, options: SnapshotJobWaitOptions = {}): Promise<APISnapshotJob> {
		const { waitTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS, intervalMs = 2_000, signal, scope, workspaceId, timeoutMs, onProgress } = options;
		const deadline = Date.now() + waitTimeoutMs;
		for (;;) {
			const job = await this.get(resourceId, jobId, { scope, workspaceId, signal, timeoutMs });
			if (job.status === "ready") return job;
			if (job.status === "failed" || job.status === "skipped") throw new SnapshotJobError({ ...job, status: job.status });
			onProgress?.(job);
			if (Date.now() + intervalMs > deadline) throw new WaitTimeoutError(`Snapshot job ${jobId} did not finish within ${waitTimeoutMs} ms`, waitTimeoutMs, job);
			await sleep(intervalMs, signal);
		}
	}
}

import type { VertraClient } from "../client.js";
import { deferredPathSegment } from "../client.js";
import type { DownloadedFile } from "../download.js";
import { AppBuildFailedError, AppBuildTimeoutError, VertraAPIError } from "../errors.js";
import type { SseEvent } from "../sse.js";
import type {
	APIApplication,
	APIApplicationAnalyticsErrors,
	APIApplicationAnalyticsPerformance,
	APIApplicationAnalyticsRequest,
	APIApplicationAnalyticsRequestList,
	APIApplicationAnalyticsTraffic,
	APIApplicationDeployment,
	APIApplicationDomain,
	APIApplicationDomainConnect,
	APIApplicationDomainDnsRecord,
	APIApplicationEnvironment,
	APIApplicationFile,
	APIApplicationFileContent,
	APIApplicationFileTree,
	APIApplicationFileUpload,
	APIApplicationMetric,
	APIApplicationOperationResponse,
	APIApplicationRelease,
	APIApplicationReleaseLog,
	APIApplicationRollbackPreview,
	APIApplicationRuntimes,
	APIApplicationStatus,
	APIApplicationStatusShort,
	APIApplicationSubdomain,
	APIApplicationWebPublish,
	APIApplicationWebhook,
	APIApplicationWebhookUrl,
	APISnapshotJob,
	ApplicationAnalyticsDimension,
	ApplicationLanguage,
	FileContentQuery,
	FileListQuery,
	PaginationMeta,
	RESTDeleteAPIApplicationFileBody,
	RESTGetAPIApplicationAnalyticsErrorsQuery,
	RESTGetAPIApplicationAnalyticsPerformanceQuery,
	RESTGetAPIApplicationAnalyticsQuery,
	RESTGetAPIApplicationAnalyticsRequestsQuery,
	RESTPatchAPIApplicationDomainBody,
	RESTPatchAPIApplicationFileMoveBody,
	RESTPatchAPIApplicationUpdateConfigBody,
	RESTPostAPIApplicationDomainBody,
	RESTPostAPIApplicationEnvironmentBody,
	RESTPostAPIApplicationImageBody,
	RESTPostAPIApplicationRestartBody,
	RESTPostAPIApplicationRollbackBody,
	RESTPostAPIApplicationWebPublishBody,
	RESTPostAPIApplicationWebhookCreateBody,
	RESTPutAPIApplicationFileBody,
	RequestOptions,
	WithRestoreJob,
} from "../types.js";

/**
 * Options of `apps.download`. The key needs `snapshots:write` (to take the snapshot) and `snapshots:read` (to download it). `timeoutMs` is the limit of
 * each request (the download itself has no total deadline, see `inactivityTimeoutMs`); `waitTimeoutMs` is the total wait for the snapshot.
 */
export interface DownloadOptions extends RequestOptions {
	/** Poll interval in ms while the snapshot is taken. Default `2000`. */
	intervalMs?: number;
	/** Total wait in ms for the snapshot before `WaitTimeoutError` (it keeps being taken and shows in the snapshot list). Default `1800000` (30 min). */
	waitTimeoutMs?: number;
	/** The download fails with a `TimeoutError` when no byte arrives for this many ms; the clock restarts at every chunk. Default `60000`. */
	inactivityTimeoutMs?: number;
	/** Called with the snapshot job on every poll while it has not ended. */
	onProgress?: (job: APISnapshotJob) => void;
}

export interface CreateAppOptions extends RequestOptions {
	/** Zip of the application. Mutually exclusive with `snapshotId`. */
	file?: Blob;
	/** Creates the app from an existing snapshot instead of a zip. Mutually exclusive with `file`. */
	snapshotId?: string;
	name: string;
	description?: string | null;
	/** RAM in MB. Required unless `snapshotId` is set. */
	memory?: number;
	main?: string;
	version?: string;
	/** Forces the language; without it the platform detects it from the project manifest. */
	language?: ApplicationLanguage;
	start?: string;
	build?: string;
	subdomain?: string;
	envs?: { key: string; value: string; note?: string }[];
}

export interface WaitUntilReadyOptions extends RequestOptions {
	/** Give up after this many ms (the build keeps running). Default `600000`. */
	timeoutMs?: number;
	/** Poll interval in ms. Default `2000`. */
	intervalMs?: number;
}

/** Filters, window and options of an analytics call: the query of the route (without `workspace_id`, which is `options.workspaceId`). */
type AnalyticsQuery<T> = Omit<T, "workspace_id">;

/** Query of `analytics.traffic`: `breakdowns` also takes a list of dimensions (sent comma-separated; `[]` = none, `breakdowns=`). */
type AnalyticsTrafficQuery = Omit<AnalyticsQuery<RESTGetAPIApplicationAnalyticsQuery>, "breakdowns"> & {
	breakdowns?: RESTGetAPIApplicationAnalyticsQuery["breakdowns"] | readonly ApplicationAnalyticsDimension[];
};

function withWorkspace(options?: RequestOptions): Record<string, string | undefined> {
	return { workspace_id: options?.workspaceId };
}

/**
 * `apps.*` — one method per route under the `apps:*` scopes.
 * @see https://docs.vertracloud.app/api-reference
 */
export class AppsResource {
	constructor(private readonly client: VertraClient) {}

	/** `GET /v1/apps/:id` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/get */
	get(id: string, options?: RequestOptions): Promise<APIApplication> {
		return this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/apps/:id/status` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/status */
	status(id: string, options?: RequestOptions): Promise<APIApplicationStatus> {
		return this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/status`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/apps/status` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/allstatus */
	statusAll(options?: RequestOptions): Promise<APIApplicationStatusShort[]> {
		return this.client.request({ method: "GET", path: "/v1/apps/status", query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/apps/runtimes` — scope `apps:read`. Catalog of supported languages/runtimes for app creation. */
	runtimes(options?: RequestOptions): Promise<APIApplicationRuntimes> {
		return this.client.request({ method: "GET", path: "/v1/apps/runtimes", signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `GET /v1/apps/:id/realtime` — scope `apps:read`. Server-Sent Events stream of live logs and
	 * system notes. `since` is a cursor timestamp to resume from.
	 */
	realtime(id: string, options?: RequestOptions & { since?: number; idleTimeoutMs?: number }): AsyncGenerator<SseEvent, void, unknown> {
		return this.client.requestSse({
			method: "GET",
			path: `/v1/apps/${deferredPathSegment(id)}/realtime`,
			query: { workspace_id: options?.workspaceId, since: options?.since },
			signal: options?.signal,
			timeoutMs: options?.timeoutMs,
			idleTimeoutMs: options?.idleTimeoutMs,
		});
	}

	/** `GET /v1/apps/:id/metrics` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/metrics */
	metrics(id: string, options?: RequestOptions & { range?: "10m" | "30m" | "24h"; since?: number }): Promise<APIApplicationMetric[]> {
		return this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/metrics`, query: { workspace_id: options?.workspaceId, range: options?.range, since: options?.since }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/apps/:id/logs` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/logs */
	logs(id: string, options?: RequestOptions): Promise<string> {
		return this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/logs`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * Downloads the whole app as a zip (`ArrayBuffer`), whatever its size. There is no route of its own: it takes a manual snapshot
	 * (`POST /v1/users/:id/snapshots?scope=applications`, scope `snapshots:write`), follows the job when the API answers `202`, and downloads that snapshot
	 * (`GET /v1/users/:id/snapshots/:snapshot_id/download`, scope `snapshots:read`): the API key needs both scopes. The snapshot is a manual one and stays in
	 * the snapshot list. Limits: `429 SNAPSHOT_RATE_LIMITED` (`snapshotRateLimited(error)`); an account without a plan cannot take a snapshot (`403 PLAN_NOT_ALLOWED`),
	 * but can download the ones it already has with `snapshots.download`. Throws `SnapshotJobError` when the job fails and `WaitTimeoutError` after `waitTimeoutMs`.
	 * The zip has no total deadline: it fails only after `inactivityTimeoutMs` without a byte, or when `signal` aborts.
	 * The whole zip is held in memory (and briefly twice): for an app that can be large, use `downloadToFile` (writes to disk as the bytes arrive) or `downloadStream`.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/snapshots/create
	 */
	async download(id: string, options: DownloadOptions = {}): Promise<ArrayBuffer> {
		const snapshotId = await this.snapshotForDownload(id, options);
		const { signal, timeoutMs, inactivityTimeoutMs, workspaceId } = options;
		return this.client.snapshots.download(id, snapshotId, { scope: "applications", workspaceId, signal, timeoutMs, inactivityTimeoutMs });
	}

	/**
	 * Same as `download` (takes the manual snapshot, follows the job, downloads it) but resolves with a `ReadableStream<Uint8Array>` that hands over the zip as
	 * it arrives: memory does not grow with the app. Same scopes, limits and errors as `download`.
	 */
	async downloadStream(id: string, options: DownloadOptions = {}): Promise<ReadableStream<Uint8Array>> {
		const snapshotId = await this.snapshotForDownload(id, options);
		const { signal, timeoutMs, inactivityTimeoutMs, workspaceId } = options;
		return this.client.snapshots.downloadStream(id, snapshotId, { scope: "applications", workspaceId, signal, timeoutMs, inactivityTimeoutMs });
	}

	/**
	 * Same as `download`, written to `path` as the bytes arrive: memory stays constant, whatever the size of the app. The zip goes to a temporary file next to
	 * `path`, renamed to `path` only when the download ends; on failure, `inactivityTimeoutMs` or `signal` the temporary file is removed, and `path` never holds a
	 * partial file. Node.js only. Resolves with `{ path, bytes }`. Same scopes, limits and errors as `download`.
	 */
	async downloadToFile(id: string, path: string, options: DownloadOptions = {}): Promise<DownloadedFile> {
		const snapshotId = await this.snapshotForDownload(id, options);
		const { signal, timeoutMs, inactivityTimeoutMs, workspaceId } = options;
		return this.client.snapshots.downloadToFile(id, snapshotId, path, { scope: "applications", workspaceId, signal, timeoutMs, inactivityTimeoutMs });
	}

	private async snapshotForDownload(id: string, options: DownloadOptions): Promise<string> {
		const { signal, timeoutMs, intervalMs, waitTimeoutMs, onProgress, workspaceId } = options;
		const scope = "applications";
		const created = await this.client.snapshots.create(id, { scope, workspaceId, signal, timeoutMs });
		let snapshotId: string | undefined;
		if (created.status === "ready") snapshotId = created.snapshot.id;
		else {
			const job = await this.client.snapshotJobs.wait(id, created.job_id, { scope, workspaceId, signal, timeoutMs, intervalMs, waitTimeoutMs, onProgress });
			snapshotId = job.snapshot_id;
		}
		if (!snapshotId) throw new VertraAPIError(404, { code: "SNAPSHOT_NOT_FOUND", message: `The snapshot of app ${id} is ready but its id did not come back` });
		return snapshotId;
	}

	/**
	 * `POST /v1/apps` — scope `apps:write`. `multipart/form-data`. Exactly one of `file`/`snapshotId`
	 * must be given. Asynchronous: resolves in seconds with the app in `status: "building"` (HTTP 202);
	 * use `waitUntilReady` to follow it to `up`/`down`.
	 *
	 * With `snapshotId` the answer is `202` and carries `restore_job_id`: the app exists, and its files come back in the background. Follow the
	 * job with `client.snapshotJobs.wait(app.id, app.restore_job_id)`. If the restore fails, an app of code is deleted by
	 * the API; an app on a custom Docker image is kept as it is (empty or as it was), so check the job's `status`. `warning` is
	 * `IMAGE_VERSION_NOT_FOUND` when the image version recorded in the snapshot is gone. Can fail with `400 SNAPSHOT_EXCEEDS_STORAGE`
	 * (`snapshotExceedsStorage(error)`). @see https://docs.vertracloud.app/api-reference/endpoint/apps/create
	 */
	create(options: CreateAppOptions): Promise<WithRestoreJob<APIApplication>> {
		const form = new FormData();
		if (options.file) form.set("file", options.file, "app.zip");
		if (options.snapshotId) form.set("snapshot_id", options.snapshotId);
		form.set("name", options.name);
		if (options.description !== undefined) form.set("description", options.description ?? "");
		if (options.memory !== undefined) form.set("memory", String(options.memory));
		if (options.main !== undefined) form.set("main", options.main);
		if (options.version !== undefined) form.set("version", options.version);
		if (options.language !== undefined) form.set("language", options.language);
		if (options.start !== undefined) form.set("start", options.start);
		if (options.build !== undefined) form.set("build", options.build);
		if (options.subdomain !== undefined) form.set("subdomain", options.subdomain);
		if (options.workspaceId !== undefined) form.set("workspace_id", options.workspaceId);
		if (options.envs !== undefined) form.set("envs", JSON.stringify(options.envs));
		return this.client.request({ method: "POST", path: "/v1/apps", form, signal: options.signal, timeoutMs: options.timeoutMs ?? 60_000 });
	}

	/**
	 * `POST /v1/apps/image` — scope `apps:write`. Creates an app from a custom image (see `client.images`).
	 * Asynchronous like `create`: returns with `status: "building"` (HTTP 202); follow it with `waitUntilReady`.
	 * The workspace, when there is one, goes in `body.workspace_id`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/create-from-image
	 */
	createFromImage(body: RESTPostAPIApplicationImageBody, options?: Omit<RequestOptions, "workspaceId">): Promise<APIApplication> {
		return this.client.request({ method: "POST", path: "/v1/apps/image", body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * Polls `GET /v1/apps/:id` until the build ends. Resolves with the app when `up`; throws
	 * `AppBuildFailedError` when it ends `down` and `AppBuildTimeoutError` after `timeoutMs`.
	 * `options.timeoutMs` is the total wait, not the per-request timeout.
	 */
	async waitUntilReady(id: string, options: WaitUntilReadyOptions = {}): Promise<APIApplication> {
		const { timeoutMs = 600_000, intervalMs = 2_000, signal, workspaceId } = options;
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const app = await this.get(id, { workspaceId, signal });
			if (app.status === "up") return app;
			if (app.status === "down") throw new AppBuildFailedError(app);
			if (Date.now() + intervalMs > deadline) throw new AppBuildTimeoutError(id, timeoutMs);
			await new Promise<void>((resolve, reject) => {
				const t = setTimeout(resolve, intervalMs);
				signal?.addEventListener(
					"abort",
					() => {
						clearTimeout(t);
						reject(signal.reason);
					},
					{ once: true },
				);
			});
		}
	}

	/** `POST /v1/apps/:id/start` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/start */
	start(id: string, options?: RequestOptions): Promise<APIApplicationOperationResponse> {
		return this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(id)}/start`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/apps/:id/stop` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/stop */
	stop(id: string, options?: RequestOptions): Promise<APIApplicationOperationResponse> {
		return this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(id)}/stop`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/apps/:id/restart` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/restart */
	restart(id: string, body?: RESTPostAPIApplicationRestartBody, options?: RequestOptions): Promise<APIApplicationOperationResponse> {
		return this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(id)}/restart`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `PATCH /v1/apps/:id/config` — scope `apps:write`. `deploy` sets zero downtime, automatic rollback
	 * and the health check path (`null` clears it). Plan-gated: `zero_downtime: "on"` fails with 403
	 * `PLAN_DOES_NOT_SUPPORT_ZERO_DOWNTIME` and `auto_rollback: true` with 403
	 * `PLAN_DOES_NOT_SUPPORT_AUTO_ROLLBACK`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/updateconfig */
	updateConfig(id: string, body: RESTPatchAPIApplicationUpdateConfigBody, options?: RequestOptions): Promise<string> {
		return this.client.request({ method: "PATCH", path: `/v1/apps/${deferredPathSegment(id)}/config`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `DELETE /v1/apps/:id` — scope `apps:delete`. Deletes the app right away. It is permanent: take a snapshot first (`snapshots.create`)
	 * if you may need the data again.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/delete
	 */
	delete(id: string, options?: RequestOptions): Promise<void> {
		return this.client.request({ method: "DELETE", path: `/v1/apps/${deferredPathSegment(id)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	private async *analyticsRequestsAll(id: string, query: AnalyticsQuery<RESTGetAPIApplicationAnalyticsRequestsQuery> = {}, options?: RequestOptions): AsyncGenerator<APIApplicationAnalyticsRequest, void, unknown> {
		const end = query.end ?? new Date().toISOString();
		const start = query.start ?? new Date(Date.parse(end) - 24 * 3_600_000).toISOString();
		let cursor = query.cursor;
		for (;;) {
			const page = await this.analytics.requests(id, { ...query, start, end, cursor }, options);
			yield* page.requests;
			if (!page.cursor) return;
			cursor = page.cursor;
		}
	}

	readonly analytics = {
		/**
		 * `GET /v1/apps/:id/analytics` — scope `apps:read`. Traffic of the site: summary, series, previous period and breakdowns.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/analytics/traffic
		 */
		traffic: (id: string, query?: AnalyticsTrafficQuery, options?: RequestOptions): Promise<APIApplicationAnalyticsTraffic> =>
			this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/analytics`, query: { ...query, breakdowns: typeof query?.breakdowns === "object" ? query.breakdowns.join(",") : query?.breakdowns, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `GET /v1/apps/:id/analytics/errors` — scope `apps:read`. Errors of the site: totals, series, paths and status distribution.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/analytics/errors
		 */
		errors: (id: string, query?: AnalyticsQuery<RESTGetAPIApplicationAnalyticsErrorsQuery>, options?: RequestOptions): Promise<APIApplicationAnalyticsErrors> =>
			this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/analytics/errors`, query: { ...query, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `GET /v1/apps/:id/analytics/performance` — scope `apps:read`. Response times of the site; needs a plan with web analytics performance.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/analytics/performance
		 */
		performance: (id: string, query?: AnalyticsQuery<RESTGetAPIApplicationAnalyticsPerformanceQuery>, options?: RequestOptions): Promise<APIApplicationAnalyticsPerformance> =>
			this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/analytics/performance`, query: { ...query, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `GET /v1/apps/:id/analytics/requests` — scope `apps:read`. One page of the request log; pass the returned `cursor` to get the next. To walk every page use `requestsAll`.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/analytics/requests
		 */
		requests: (id: string, query?: AnalyticsQuery<RESTGetAPIApplicationAnalyticsRequestsQuery>, options?: RequestOptions): Promise<APIApplicationAnalyticsRequestList> =>
			this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/analytics/requests`, query: { ...query, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * Walks the request log page after page, yielding each request. Pins the window (`start`/`end`, default 24 h ending now, resolved once)
		 * so every page reads the same one. `query.cursor` starts from that page; `query.limit` is the page size.
		 */
		requestsAll: (id: string, query?: AnalyticsQuery<RESTGetAPIApplicationAnalyticsRequestsQuery>, options?: RequestOptions): AsyncGenerator<APIApplicationAnalyticsRequest, void, unknown> => this.analyticsRequestsAll(id, query, options),
	};

	readonly deploys = {
		/** `GET /v1/apps/:id/deploys` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/deployments */
		list: (id: string, options?: RequestOptions): Promise<APIApplicationDeployment[]> => this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/deploys`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		webhook: {
			/** `GET /v1/apps/:id/deploys/webhook` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/webhook */
			get: (id: string, options?: RequestOptions): Promise<APIApplicationWebhook> => this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/deploys/webhook`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

			/** `POST /v1/apps/:id/deploys/webhook` — scope `apps:write`. */
			create: (id: string, body: RESTPostAPIApplicationWebhookCreateBody, options?: RequestOptions): Promise<APIApplicationWebhookUrl> =>
				this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(id)}/deploys/webhook`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

			/** `DELETE /v1/apps/:id/deploys/webhook` — scope `apps:write`. */
			delete: (id: string, options?: RequestOptions): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/apps/${deferredPathSegment(id)}/deploys/webhook`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
		},
	};

	readonly releases = {
		/** `GET /v1/apps/:id/releases` — scope `apps:read`. Newest first; `limit` defaults to 20, maximum 50. @see https://docs.vertracloud.app/api-reference/endpoint/apps/releases/list */
		list: (id: string, options?: RequestOptions & { page?: number; limit?: number }): Promise<PaginationMeta<APIApplicationRelease>> =>
			this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/releases`, query: { page: options?.page, limit: options?.limit, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/apps/:id/releases/:release_id/log` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/releases/log */
		log: (id: string, releaseId: string, options?: RequestOptions): Promise<APIApplicationReleaseLog> =>
			this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/releases/${deferredPathSegment(releaseId)}/log`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `GET /v1/apps/:id/releases/:release_id/rollback` — scope `apps:envs`. Previews a rollback and changes nothing.
		 * Returns only environment variable names with their change, never values.
		 * Throws a 403 `PLAN_DOES_NOT_SUPPORT_ROLLBACK` when the plan has no rollback.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/releases/rollback-preview
		 */
		previewRollback: (id: string, releaseId: string, options?: RequestOptions): Promise<APIApplicationRollbackPreview> =>
			this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/releases/${deferredPathSegment(releaseId)}/rollback`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `POST /v1/apps/:id/releases/:release_id/rollback` — scope `apps:write`; `restore_environment: true`
		 * also needs `apps:envs`. Restores the release's code, restarts the app and returns the new release.
		 * Errors: 403 `PLAN_DOES_NOT_SUPPORT_ROLLBACK`, 404 `RELEASE_NOT_FOUND`, 409 `RELEASE_ALREADY_ACTIVE`,
		 * 410 `RELEASE_EXPIRED`, `OPERATION_IN_PROGRESS`, `RESTORE_COOLDOWN` and `DEPLOY_RATE_LIMITED`.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/releases/rollback
		 */
		rollback: (id: string, releaseId: string, body?: RESTPostAPIApplicationRollbackBody, options?: RequestOptions): Promise<APIApplicationRelease> =>
			this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(id)}/releases/${deferredPathSegment(releaseId)}/rollback`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly domains = {
		/** `GET /v1/apps/:id/domains` — scope `apps:read`. */
		list: (id: string, options?: RequestOptions): Promise<APIApplicationDomain[]> => this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/domains`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/apps/:id/domains` — scope `apps:write`. Returns the created domain and its automatic `www`/root companion, when there is one. */
		add: (id: string, body: RESTPostAPIApplicationDomainBody, options?: RequestOptions): Promise<APIApplicationDomain[]> => this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(id)}/domains`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PATCH /v1/apps/:id/domains/:domainId` — scope `apps:write`. Send only what changes; `null` clears `path_prefix` or `redirect_to`. */
		update: (id: string, domainId: string, body: RESTPatchAPIApplicationDomainBody, options?: RequestOptions): Promise<APIApplicationDomain[]> =>
			this.client.request({ method: "PATCH", path: `/v1/apps/${deferredPathSegment(id)}/domains/${deferredPathSegment(domainId)}`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/apps/:id/domains/:domainId` — scope `apps:write`. Removes the automatic companion together. */
		remove: (id: string, domainId: string, options?: RequestOptions): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/apps/${deferredPathSegment(id)}/domains/${deferredPathSegment(domainId)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/apps/:id/domains/:domainId/dns` — scope `apps:read`. */
		dns: (id: string, domainId: string, options?: RequestOptions): Promise<APIApplicationDomainDnsRecord[]> =>
			this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/domains/${deferredPathSegment(domainId)}/dns`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/apps/:id/domains/:domainId/connect` — scope `apps:write`. Fails with `DOMAIN_CONNECT_UNAVAILABLE` (404) when automatic setup is not available. */
		connect: (id: string, domainId: string, options?: RequestOptions): Promise<APIApplicationDomainConnect> =>
			this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(id)}/domains/${deferredPathSegment(domainId)}/connect`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly network = {
		/** `POST /v1/apps/:id/network/purge-cache` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/network/purgecache */
		purgeCache: (id: string, body?: { hostnames?: string[]; paths?: string[] }, options?: RequestOptions): Promise<void> =>
			this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(id)}/network/purge-cache`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PATCH /v1/apps/:id/network/subdomain` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/network/subdomain */
		setSubdomain: (id: string, subdomain: string, options?: RequestOptions): Promise<APIApplicationSubdomain> =>
			this.client.request({ method: "PATCH", path: `/v1/apps/${deferredPathSegment(id)}/network/subdomain`, query: withWorkspace(options), body: { subdomain }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/apps/:id/network/publish` — scope `apps:write`. `subdomain` omitted = platform picks one. `port` (only for an app on a custom image) is the port the image listens on. @see https://docs.vertracloud.app/api-reference/endpoint/apps/network/publish */
		publish: (id: string, body?: RESTPostAPIApplicationWebPublishBody, options?: RequestOptions): Promise<APIApplicationWebPublish> =>
			this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(id)}/network/publish`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/apps/:id/network/publish` — scope `apps:write`. */
		unpublish: (id: string, options?: RequestOptions): Promise<APIApplicationWebPublish> => this.client.request({ method: "DELETE", path: `/v1/apps/${deferredPathSegment(id)}/network/publish`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly envs = {
		/** `GET /v1/apps/:id/envs` — scope `apps:envs`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/enviroments/get */
		list: (id: string, options?: RequestOptions): Promise<APIApplicationEnvironment[]> => this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/envs`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/apps/:id/envs` — scope `apps:envs`. Accepts one env object or an array. @see https://docs.vertracloud.app/api-reference/endpoint/apps/enviroments/update */
		set: (id: string, body: RESTPostAPIApplicationEnvironmentBody, options?: RequestOptions): Promise<APIApplicationEnvironment[]> => this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(id)}/envs`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/apps/:id/envs/:envId` — scope `apps:envs`. */
		delete: (id: string, envId: string, options?: RequestOptions): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/apps/${deferredPathSegment(id)}/envs/${deferredPathSegment(envId)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly files = {
		/** `GET /v1/apps/:id/files` — scope `apps:files`. */
		list: (id: string, query?: FileListQuery, options?: RequestOptions): Promise<APIApplicationFile[]> => this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/files`, query: { ...query, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/apps/:id/files/tree` — scope `apps:files`. */
		tree: (id: string, options?: RequestOptions): Promise<APIApplicationFileTree[]> => this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/files/tree`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/apps/:id/files/content` — scope `apps:files`. Files above 10 MiB are refused with `413 FILE_TOO_LARGE` (`details.max_bytes`). @see https://docs.vertracloud.app/api-reference/endpoint/apps/filemanager/content */
		read: (id: string, query: FileContentQuery, options?: RequestOptions): Promise<APIApplicationFileContent> =>
			this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(id)}/files/content`, query: { ...query, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `PUT /v1/apps/:id/files` — scope `apps:files`. An application that came from an open template stops receiving versions of it when its
		 * code is changed: without `confirm_detach: true` in the body the call fails with `409 TEMPLATE_DETACH_CONFIRMATION_REQUIRED` and changes
		 * nothing (read the action with `templateDetachConfirmation(error)`); with it the change is made and the application is detached. Ignored
		 * for an application that does not come from a template. The same `confirm_detach` exists on `files.move`, `files.delete`,
		 * `deploys.webhook.create` and, as `confirmDetach`, on `files.upload`.
		 * A file above 10 MiB is refused with `413 FILE_TOO_LARGE` (`details.max_bytes`).
		 */
		write: (id: string, body: RESTPutAPIApplicationFileBody, options?: RequestOptions): Promise<void> => this.client.request({ method: "PUT", path: `/v1/apps/${deferredPathSegment(id)}/files`, body: { ...body, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PATCH /v1/apps/:id/files` — scope `apps:files`. Moves/renames a file. */
		move: (id: string, body: RESTPatchAPIApplicationFileMoveBody, options?: RequestOptions): Promise<void> => this.client.request({ method: "PATCH", path: `/v1/apps/${deferredPathSegment(id)}/files`, body: { ...body, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/apps/:id/files` — scope `apps:files`. */
		delete: (id: string, body: RESTDeleteAPIApplicationFileBody, options?: RequestOptions): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/apps/${deferredPathSegment(id)}/files`, body: { ...body, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `POST /v1/apps/:id/files/upload` — scope `apps:files`. `multipart/form-data`, field `file`.
		 * `restart` query is serialized as the string `"true"`/`"false"`.
		 * `options.path` is the destination folder inside the app; omitted or empty means the root.
		 * A ZIP is extracted into that folder; any other file is written to `path/<filename>`.
		 * `options.message` is the commit message shown in the release history (up to 500 characters).
		 * `options.confirmDetach` confirms that the change detaches an application that came from an open template (see `files.write`).
		 */
		upload: (id: string, file: Blob, filename: string, options?: RequestOptions & { restart?: boolean; path?: string; message?: string; confirmDetach?: boolean }): Promise<APIApplicationFileUpload> => {
			const form = new FormData();
			form.set("file", file, filename);
			if (options?.message !== undefined) form.set("message", options.message);
			return this.client.request({
				method: "POST",
				path: `/v1/apps/${deferredPathSegment(id)}/files/upload`,
				query: { restart: options?.restart, path: options?.path, confirm_detach: options?.confirmDetach ? true : undefined, workspace_id: options?.workspaceId },
				form,
				signal: options?.signal,
				timeoutMs: options?.timeoutMs ?? 120_000,
			});
		},
	};
}

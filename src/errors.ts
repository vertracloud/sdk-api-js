import type { APIApplication, APIApplicationAnalyticsRangeExceedsPlanDetails, APITemplateDetachConfirmationDetails, APITemplateUpdateBlocked, APITemplateValidationIssue, DockerfileIssue, DockerfileIssueCode } from "@vertracloud/api-types/v1";
import type { APISnapshotJob, SnapshotExceedsStorageDetails, SnapshotRateLimitScope } from "./types.js";

/**
 * Error envelope shape sent by the Vertra Cloud API on any non-2xx response:
 * `{ code, message?, details?, retry_after? }`. `retry_after` (seconds) may also arrive only via
 * the `retry-after` HTTP header on 429 responses — see `RateLimitError`.
 */
export interface VertraAPIErrorBody {
	code: string;
	message?: string;
	details?: unknown;
	retry_after?: number;
}

/**
 * Base error for any non-2xx response from the Vertra Cloud API.
 *
 * `toString()` and `toJSON()` deliberately never include the request that produced the error
 * (headers, Authorization, API key) — only `status`, `code`, `message` and `details`, which come
 * from the API's own response body and never echo the request's credentials.
 */
export class VertraAPIError extends Error {
	readonly status: number;
	readonly code: string;
	readonly details: unknown;

	constructor(status: number, body: VertraAPIErrorBody) {
		super(body.message || body.code);
		this.name = new.target.name;
		this.status = status;
		this.code = body.code;
		this.details = body.details;
		Object.setPrototypeOf(this, new.target.prototype);
	}

	toJSON(): { name: string; status: number; code: string; message: string; details: unknown } {
		return { name: this.name, status: this.status, code: this.code, message: this.message, details: this.details };
	}

	override toString(): string {
		return `${this.name} [${this.status}] ${this.code}: ${this.message}`;
	}
}

/** 401 — invalid/missing API key or auth token (`API_KEY_INVALID`, `USER_NOT_FOUND`, ...). */
export class AuthenticationError extends VertraAPIError {}

/** 403 — authenticated but not allowed (`API_KEY_SCOPE_DENIED`, `API_KEY_IP_DENIED`, `WEBSITE_ONLY`, bans, ...). */
export class PermissionError extends VertraAPIError {}

/** 404 — resource does not exist (`APP_NOT_FOUND`, `DATABASE_NOT_FOUND`, `SNAPSHOT_NOT_FOUND`, ...). */
export class NotFoundError extends VertraAPIError {}

/** 400/422 — request body/query/params failed validation, or a build/install step failed. */
export class ValidationError extends VertraAPIError {}

/**
 * 400 `DOCKERFILE_REFUSED` on an image build. `issues` lists the findings that blocked it, read from `details.issues`.
 * Tolerant: a body without a readable list gives an empty array, and codes unknown to this SDK are kept as sent.
 */
export class DockerfileRefusedError extends ValidationError {
	readonly issues: DockerfileIssue[];

	constructor(status: number, body: VertraAPIErrorBody) {
		super(status, body);
		this.issues = readDockerfileIssues(body.details);
	}

	override toJSON(): ReturnType<VertraAPIError["toJSON"]> & { issues: DockerfileIssue[] } {
		return { ...super.toJSON(), issues: this.issues };
	}
}

function readDockerfileIssues(details: unknown): DockerfileIssue[] {
	if (typeof details !== "object" || details === null) return [];
	const list = (details as { issues?: unknown }).issues;
	if (!Array.isArray(list)) return [];
	const issues: DockerfileIssue[] = [];
	for (const item of list) {
		if (typeof item !== "object" || item === null) continue;
		const { code, line } = item as { code?: unknown; line?: unknown };
		if (typeof code !== "string") continue;
		issues.push({ code: code as DockerfileIssueCode, line: typeof line === "number" ? line : null });
	}
	return issues;
}

/**
 * 429 — rate limit or daily quota exceeded. `retryAfter` (seconds) is read from `body.retry_after`,
 * then `details.retry_after` (`SNAPSHOT_RATE_LIMITED` sends it there), falling back to the `retry-after` response header.
 */
export class RateLimitError extends VertraAPIError {
	readonly retryAfter: number | undefined;

	constructor(status: number, body: VertraAPIErrorBody, retryAfterHeader?: string | null) {
		super(status, body);
		this.retryAfter = body.retry_after ?? detailNumber(body.details, "retry_after") ?? (retryAfterHeader ? Number(retryAfterHeader) : undefined);
	}

	override toJSON(): ReturnType<VertraAPIError["toJSON"]> & { retryAfter: number | undefined } {
		return { ...super.toJSON(), retryAfter: this.retryAfter };
	}
}

function detailNumber(details: unknown, key: string): number | undefined {
	if (typeof details !== "object" || details === null) return undefined;
	const value = (details as Record<string, unknown>)[key];
	return typeof value === "number" ? value : undefined;
}

/**
 * Builds the right error subclass for an HTTP status. `code` is always accessible on every
 * instance regardless of the subclass chosen.
 */
export function buildAPIError(status: number, body: VertraAPIErrorBody, retryAfterHeader?: string | null): VertraAPIError {
	switch (status) {
		case 401:
			return new AuthenticationError(status, body);
		case 403:
			return new PermissionError(status, body);
		case 404:
			return new NotFoundError(status, body);
		case 400:
			if (body.code === "DOCKERFILE_REFUSED") return new DockerfileRefusedError(status, body);
			return new ValidationError(status, body);
		case 422:
			return new ValidationError(status, body);
		case 429:
			return new RateLimitError(status, body, retryAfterHeader);
		default:
			return new VertraAPIError(status, body);
	}
}

/**
 * Thrown by `apps.waitUntilReady` when the app ended the build as `down`. `code` is the app's
 * `last_build_error` (e.g. `INSTALL_OUT_OF_MEMORY`), or `APP_DOWN` when the API sent none.
 * Read `apps.logs(app.id)` for the detail.
 */
export class AppBuildFailedError extends Error {
	readonly app: Pick<APIApplication, "id" | "status" | "last_build_error">;
	readonly code: string;

	constructor(app: Pick<APIApplication, "id" | "status" | "last_build_error">) {
		super(`App ${app.id} finished the build as "${app.status}"; check apps.logs() for the cause`);
		this.name = "AppBuildFailedError";
		this.app = app;
		this.code = app.last_build_error ?? "APP_DOWN";
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

/** Thrown by `apps.waitUntilReady` when the app is still `building` after `timeoutMs`. The build keeps running server-side. */
export class AppBuildTimeoutError extends Error {
	constructor(
		readonly appId: string,
		readonly timeoutMs: number,
	) {
		super(`App ${appId} was still building after ${timeoutMs} ms`);
		this.name = "AppBuildTimeoutError";
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

// ---------------------------------------------------------------------------
// Readers for the `details` of the template errors
// ---------------------------------------------------------------------------

/** `details` of `error` when it is an API error with the given `code`; `undefined` for anything else. Unreadable details give `{}`. */
function detailsOfCode(error: unknown, code: string): Record<string, unknown> | undefined {
	if (!(error instanceof VertraAPIError || error instanceof SnapshotJobError) || error.code !== code) return undefined;
	return typeof error.details === "object" && error.details !== null ? (error.details as Record<string, unknown>) : {};
}

/**
 * Findings of a `TEMPLATE_MANIFEST_INVALID` error (from `templates.create`, `templates.newVersion`, `templates.fromApp`, ...).
 * `undefined` for any other error; an empty array when the error carries no readable list.
 */
export function templateManifestIssues(error: unknown): APITemplateValidationIssue[] | undefined {
	const details = detailsOfCode(error, "TEMPLATE_MANIFEST_INVALID");
	if (!details) return undefined;
	return Array.isArray(details.issues) ? (details.issues as APITemplateValidationIssue[]) : [];
}

/**
 * Paths of a `TEMPLATE_SECRET_IN_SOURCE` error: the files of the code sent to become a template that hold a secret.
 * `undefined` for any other error.
 */
export function templateSecretFiles(error: unknown): string[] | undefined {
	const details = detailsOfCode(error, "TEMPLATE_SECRET_IN_SOURCE");
	if (!details) return undefined;
	return Array.isArray(details.files) ? details.files.filter((file): file is string => typeof file === "string") : [];
}

/** Reason of a `TEMPLATE_UPDATE_BLOCKED` error (`details.reason`). `undefined` for any other error, or when the reason is missing. */
export function templateUpdateBlockedDetails(error: unknown): APITemplateUpdateBlocked | undefined {
	const details = detailsOfCode(error, "TEMPLATE_UPDATE_BLOCKED");
	if (!details || typeof details.reason !== "string") return undefined;
	return details as unknown as APITemplateUpdateBlocked;
}

/**
 * Action of a `TEMPLATE_DETACH_CONFIRMATION_REQUIRED` error: repeat the call with `confirm_detach: true` (`confirmDetach: true` on
 * `files.upload`) to detach the application from its template. `undefined` for any other error, or when the action is missing.
 */
export function templateDetachConfirmation(error: unknown): APITemplateDetachConfirmationDetails["action"] | undefined {
	const details = detailsOfCode(error, "TEMPLATE_DETACH_CONFIRMATION_REQUIRED");
	if (!details || typeof details.action !== "string") return undefined;
	return details.action as APITemplateDetachConfirmationDetails["action"];
}

/**
 * `details` of an `ANALYTICS_RANGE_EXCEEDS_PLAN` error (400): how many days back the plan reads and the earliest `start` accepted right now.
 * `undefined` for any other error, or when the details are missing.
 */
export function analyticsRangeExceedsPlan(error: unknown): APIApplicationAnalyticsRangeExceedsPlanDetails | undefined {
	const details = detailsOfCode(error, "ANALYTICS_RANGE_EXCEEDS_PLAN");
	if (!details || typeof details.history_days !== "number" || typeof details.earliest !== "string") return undefined;
	return details as unknown as APIApplicationAnalyticsRangeExceedsPlanDetails;
}

/**
 * Seconds to wait after an `ANALYTICS_BUSY` error (503: analytics is under high demand and no earlier answer is available; try again after this many seconds).
 * `undefined` for any other error, or when `retry_after` is missing.
 */
export function analyticsBusyRetryAfter(error: unknown): number | undefined {
	const details = detailsOfCode(error, "ANALYTICS_BUSY");
	return typeof details?.retry_after === "number" ? details.retry_after : undefined;
}

/** Codes of the snapshot routes. Same strings as `error.code`. */
export const SNAPSHOT_ERROR_CODES = {
	DATABASE_NOT_READY: "DATABASE_NOT_READY",
	SNAPSHOT_FAILED: "SNAPSHOT_FAILED",
	SNAPSHOT_TIMEOUT: "SNAPSHOT_TIMEOUT",
	SNAPSHOT_RATE_LIMITED: "SNAPSHOT_RATE_LIMITED",
	SNAPSHOT_TOO_LARGE: "SNAPSHOT_TOO_LARGE",
	/** 409 — a restore is already running on the resource; every write waits for it. */
	RESTORE_IN_PROGRESS: "RESTORE_IN_PROGRESS",
	/** 429 — a restore was done too recently on this resource; `details.retry_after` (seconds), see `restoreCooldownRetryAfter(error)`. */
	RESTORE_COOLDOWN: "RESTORE_COOLDOWN",
	/** 400 — the snapshot does not fit in the target; see `snapshotExceedsStorage(error)`. */
	SNAPSHOT_EXCEEDS_STORAGE: "SNAPSHOT_EXCEEDS_STORAGE",
	SNAPSHOT_CORRUPTED: "SNAPSHOT_CORRUPTED",
	SNAPSHOT_IMPORT_FAILED: "SNAPSHOT_IMPORT_FAILED",
	SNAPSHOT_ENGINE_MISMATCH: "SNAPSHOT_ENGINE_MISMATCH",
	SNAPSHOT_VERSION_NEWER: "SNAPSHOT_VERSION_NEWER",
	/** A member of a stack restore failed, so the jobs of the members after it end `failed` with this code. */
	STACK_RESTORE_MEMBER_FAILED: "STACK_RESTORE_MEMBER_FAILED",
	/** 409 — the app is being deployed; try again when it finishes. */
	APP_BUILDING: "APP_BUILDING",
	/** 409 — another operation (for instance a snapshot of the app) is running; try again shortly. */
	OPERATION_IN_PROGRESS: "OPERATION_IN_PROGRESS",
} as const;

/**
 * `details` of a `SNAPSHOT_EXCEEDS_STORAGE` error (400): bytes the snapshot needs and bytes the target has; for databases,
 * `requiredRamMb` is the smallest memory size that fits it. `undefined` for any other error or when the numbers are missing.
 */
export function snapshotExceedsStorage(error: unknown): SnapshotExceedsStorageDetails | undefined {
	const details = detailsOfCode(error, "SNAPSHOT_EXCEEDS_STORAGE");
	if (!details || typeof details.required_bytes !== "number" || typeof details.available_bytes !== "number") return undefined;
	return {
		requiredBytes: details.required_bytes,
		availableBytes: details.available_bytes,
		requiredRamMb: typeof details.required_ram_mb === "number" ? details.required_ram_mb : undefined,
	};
}

/** Seconds until a restore of the resource is accepted again, from a `RESTORE_COOLDOWN` error (429). `undefined` for any other error, or when `retry_after` is missing. */
export function restoreCooldownRetryAfter(error: unknown): number | undefined {
	const details = detailsOfCode(error, "RESTORE_COOLDOWN");
	return typeof details?.retry_after === "number" ? details.retry_after : undefined;
}

/**
 * Thrown by a wait helper (`snapshotJobs.wait`, `snapshots.createAndWait`, `apps.download`, `stacks.waitFor*`) when its total wait (`waitTimeoutMs`) passes.
 * The operation itself keeps going on the server. `job` is the last state read of a snapshot job, with its `progress` when it was running.
 */
export class WaitTimeoutError extends Error {
	readonly timeoutMs: number;
	readonly job?: APISnapshotJob;

	constructor(message: string, timeoutMs: number, job?: APISnapshotJob) {
		super(message);
		this.name = "WaitTimeoutError";
		this.timeoutMs = timeoutMs;
		this.job = job;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

/**
 * Thrown by `snapshotJobs.wait` (and by what waits on it: `snapshots.createAndWait`, `stacks.snapshots.createAndWait`/`restoreAndWait`) when the job ends
 * `failed` or `skipped`. `reason` is the error code of the job (`SNAPSHOT_FAILED` when the API sent none) and `details` what that code carries on a direct
 * response (read it with `snapshotExceedsStorage(error)`). `code` repeats `reason`, as on `VertraAPIError`.
 */
export class SnapshotJobError extends Error {
	readonly status: "failed" | "skipped";
	readonly reason: string;
	readonly code: string;
	readonly details: unknown;
	readonly job: APISnapshotJob;

	constructor(job: APISnapshotJob & { status: "failed" | "skipped" }) {
		const reason = job.reason ?? "SNAPSHOT_FAILED";
		super(`${reason}: the ${job.kind} job ${job.id} ended ${job.status}`);
		this.name = "SnapshotJobError";
		this.status = job.status;
		this.reason = reason;
		this.code = reason;
		this.details = job.details;
		this.job = job;
		Object.setPrototypeOf(this, new.target.prototype);
	}
}

/**
 * `details` of a `SNAPSHOT_RATE_LIMITED` error (429): which limit was hit (`scope`), seconds to wait (`retryAfter`) and, for the
 * 24-hour account quota, when it frees up (`resetsAt`, ISO date). `undefined` for any other error, or when `scope` is missing.
 */
export function snapshotRateLimited(error: unknown): { scope: SnapshotRateLimitScope; retryAfter: number | undefined; resetsAt: string | undefined } | undefined {
	const details = detailsOfCode(error, "SNAPSHOT_RATE_LIMITED");
	if (!details || (details.scope !== "resource" && details.scope !== "account")) return undefined;
	return {
		scope: details.scope,
		retryAfter: typeof details.retry_after === "number" ? details.retry_after : undefined,
		resetsAt: typeof details.resets_at === "string" ? details.resets_at : undefined,
	};
}

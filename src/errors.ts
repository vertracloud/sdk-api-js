import type { APIApplication } from "@vertracloud/api-types/v1";

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
 * 429 — rate limit or daily quota exceeded. `retryAfter` (seconds) is read from `body.retry_after`
 * first, falling back to the `retry-after` response header.
 */
export class RateLimitError extends VertraAPIError {
	readonly retryAfter: number | undefined;

	constructor(status: number, body: VertraAPIErrorBody, retryAfterHeader?: string | null) {
		super(status, body);
		this.retryAfter = body.retry_after ?? (retryAfterHeader ? Number(retryAfterHeader) : undefined);
	}

	override toJSON(): ReturnType<VertraAPIError["toJSON"]> & { retryAfter: number | undefined } {
		return { ...super.toJSON(), retryAfter: this.retryAfter };
	}
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

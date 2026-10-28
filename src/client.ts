import { type VertraAPIErrorBody, buildAPIError } from "./errors.js";
import { AccountResource } from "./resources/account.js";
import { AppsResource } from "./resources/apps.js";
import { BillingResource } from "./resources/billing.js";
import { DatabasesResource } from "./resources/databases.js";
import { ImagesResource } from "./resources/images.js";
import { SnapshotsResource } from "./resources/snapshots.js";
import { StacksResource } from "./resources/stacks.js";
import { TemplatesResource } from "./resources/templates.js";
import { WorkspacesResource } from "./resources/workspaces.js";
import { type SseEvent, parseSseStream } from "./sse.js";

const PACKAGE_VERSION = "0.3.2"; // x-release-please-version
const DEFAULT_BASE_URL = "https://api.vertracloud.app";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface VertraClientConfig {
	/** Bearer token sent as `Authorization: Bearer <apiKey>`. Required. */
	apiKey: string;
	/** Default `https://api.vertracloud.app`. */
	baseUrl?: string;
	/** Default request timeout in milliseconds. Default `30000`. Overridable per call. */
	timeoutMs?: number;
	/** Default `vertracloud-sdk-js/<version>`. */
	userAgent?: string;
	/** Injectable transport, mainly for tests. Defaults to global `fetch`. */
	fetch?: typeof fetch;
}

export type QueryValue = string | number | boolean | undefined | null;
export type QueryParams = Record<string, QueryValue>;

export interface RequestConfig {
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	path: string;
	query?: QueryParams;
	body?: unknown;
	form?: FormData;
	/** Extra request headers (e.g. `Idempotency-Key`). They never override `Authorization` or `User-Agent`. */
	headers?: Record<string, string>;
	signal?: AbortSignal;
	timeoutMs?: number;
}

function isDotSegment(segment: string): boolean {
	let current = segment;
	for (let i = 0; i < 4; i++) {
		if (current === "" || current === "." || current === "..") return true;
		let decoded: string;
		try {
			decoded = decodeURIComponent(current);
		} catch {
			return false;
		}
		if (decoded === current) return false;
		current = decoded;
	}
	return false;
}

/**
 * Path segments are URL-encoded individually — never interpolate a raw id into a template string elsewhere.
 * Throws a `TypeError` (before any request) for an empty segment, `.` or `..`, also when percent-encoded:
 * `URL` collapses dot-segments, so the call would reach a different route than the one requested.
 */
export function encodePathSegment(segment: string | number): string {
	const value = String(segment);
	if (isDotSegment(value)) throw new TypeError(`Invalid path segment: ${JSON.stringify(value)}`);
	return encodeURIComponent(value);
}

const INVALID_SEGMENT_MARK = "\u0000";

/**
 * Same validation as {@link encodePathSegment}, but defers the `TypeError` to the request so resource methods
 * reject their promise instead of throwing synchronously.
 */
export function deferredPathSegment(segment: string | number): string {
	try {
		return encodePathSegment(segment);
	} catch {
		return `${INVALID_SEGMENT_MARK}${encodeURIComponent(String(segment))}${INVALID_SEGMENT_MARK}`;
	}
}

function assertValidPath(path: string): void {
	const start = path.indexOf(INVALID_SEGMENT_MARK);
	if (start === -1) return;
	const end = path.indexOf(INVALID_SEGMENT_MARK, start + 1);
	throw new TypeError(`Invalid path segment: ${JSON.stringify(decodeURIComponent(path.slice(start + 1, end)))}`);
}

function buildUrl(baseUrl: string, path: string, query?: QueryParams): string {
	const url = new URL(path, baseUrl);
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value === undefined || value === null) continue;
			url.searchParams.set(key, typeof value === "boolean" ? (value ? "true" : "false") : String(value));
		}
	}
	return url.toString();
}

async function parseErrorBody(response: Response): Promise<VertraAPIErrorBody> {
	try {
		const json = (await response.json()) as Partial<VertraAPIErrorBody>;
		if (json && typeof json === "object" && typeof json.code === "string") return json as VertraAPIErrorBody;
		return { code: `HTTP_${response.status}` };
	} catch {
		return { code: `HTTP_${response.status}` };
	}
}

/**
 * HTTP client for the Vertra Cloud public API. Never retries automatically. Every method that
 * hits the network goes through {@link VertraClient.request}.
 */
export class VertraClient {
	readonly baseUrl: string;
	readonly timeoutMs: number;
	readonly userAgent: string;
	readonly #apiKey: string;
	private readonly fetchImpl: typeof fetch;

	/** `apps.*` — see {@link AppsResource}. */
	readonly apps: AppsResource;
	/** `images.*` — see {@link ImagesResource}. */
	readonly images: ImagesResource;
	/** `databases.*` — see {@link DatabasesResource}. */
	readonly databases: DatabasesResource;
	/** `templates.*` — see {@link TemplatesResource}. */
	readonly templates: TemplatesResource;
	/** `stacks.*` — see {@link StacksResource}. */
	readonly stacks: StacksResource;
	/** `snapshots.*` — see {@link SnapshotsResource}. */
	readonly snapshots: SnapshotsResource;
	/** `account.*` — see {@link AccountResource}. */
	readonly account: AccountResource;
	/** `workspaces.*` — see {@link WorkspacesResource}. */
	readonly workspaces: WorkspacesResource;
	/** `billing.*` — see {@link BillingResource}. */
	readonly billing: BillingResource;

	constructor(config: VertraClientConfig) {
		if (!config.apiKey) throw new Error("VertraClient: apiKey is required");
		this.#apiKey = config.apiKey;
		this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
		this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.userAgent = config.userAgent ?? `vertracloud-sdk-js/${PACKAGE_VERSION}`;
		this.fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);

		this.apps = new AppsResource(this);
		this.images = new ImagesResource(this);
		this.databases = new DatabasesResource(this);
		this.templates = new TemplatesResource(this);
		this.stacks = new StacksResource(this);
		this.snapshots = new SnapshotsResource(this);
		this.account = new AccountResource(this);
		this.workspaces = new WorkspacesResource(this);
		this.billing = new BillingResource(this);
	}

	/** Never expose the API key through logging, inspection or serialization of the client. */
	toJSON(): { baseUrl: string; timeoutMs: number; userAgent: string } {
		return { baseUrl: this.baseUrl, timeoutMs: this.timeoutMs, userAgent: this.userAgent };
	}

	toString(): string {
		return `VertraClient(${this.baseUrl})`;
	}

	[Symbol.for("nodejs.util.inspect.custom")](): string {
		return this.toString();
	}

	private headers(extra?: Record<string, string>): Headers {
		const headers = new Headers(extra);
		headers.set("Authorization", `Bearer ${this.#apiKey}`);
		headers.set("User-Agent", this.userAgent);
		return headers;
	}

	private combineSignal(signal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; cleanup: () => void } {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), timeoutMs);
		const onAbort = () => controller.abort(signal?.reason);
		signal?.addEventListener("abort", onAbort);
		const cleanup = () => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
		};
		if (signal?.aborted) controller.abort(signal.reason);
		return { signal: controller.signal, cleanup };
	}

	/** JSON request. Unwraps the `{ response }` success envelope and throws a typed error on failure. */
	async request<T>(config: RequestConfig): Promise<T> {
		const { response, cleanup } = await this.rawRequest(config, config.form ? undefined : "application/json");
		try {
			if (!response.ok) throw buildAPIError(response.status, await parseErrorBody(response), response.headers.get("retry-after"));
			if (response.status === 204) return undefined as T;
			const json = (await response.json()) as { response?: T };
			return json.response as T;
		} finally {
			cleanup();
		}
	}

	/** Same as {@link request}, but returns the raw binary body (e.g. zip/certificate downloads). */
	async requestBinary(config: RequestConfig): Promise<ArrayBuffer> {
		const { response, cleanup } = await this.rawRequest(config);
		try {
			if (!response.ok) throw buildAPIError(response.status, await parseErrorBody(response), response.headers.get("retry-after"));
			return await response.arrayBuffer();
		} finally {
			cleanup();
		}
	}

	/**
	 * `GET /v1/apps/:id/realtime`. Returns an async iterable of {@link SseEvent}; iteration ends
	 * when the stream closes, the consumer breaks out of the loop, `config.signal` aborts, or
	 * `idleTimeoutMs` elapses with no event.
	 */
	async *requestSse(config: RequestConfig & { idleTimeoutMs?: number }): AsyncGenerator<SseEvent, void, unknown> {
		const { response, cleanup } = await this.rawRequest(config, undefined, { Accept: "text/event-stream" });
		try {
			if (!response.ok) throw buildAPIError(response.status, await parseErrorBody(response), response.headers.get("retry-after"));
			if (!response.body) return;
			yield* parseSseStream(response.body, { signal: config.signal, idleTimeoutMs: config.idleTimeoutMs });
		} finally {
			cleanup();
		}
	}

	private async rawRequest(config: RequestConfig, contentType?: string, extraHeaders?: Record<string, string>): Promise<{ response: Response; cleanup: () => void }> {
		assertValidPath(config.path);
		const timeoutMs = config.timeoutMs ?? this.timeoutMs;
		const { signal, cleanup } = this.combineSignal(config.signal, timeoutMs);
		const headers = this.headers({ ...config.headers, ...extraHeaders });
		if (contentType) headers.set("Content-Type", contentType);

		const url = buildUrl(this.baseUrl, config.path, config.query);
		const init: RequestInit = { method: config.method, headers, signal };
		if (config.form) {
			init.body = config.form;
		} else if (config.body !== undefined) {
			init.body = JSON.stringify(config.body);
		}

		try {
			const response = await this.fetchImpl(url, init);
			return { response, cleanup };
		} catch (error) {
			cleanup();
			throw error;
		}
	}
}

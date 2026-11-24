import { type VertraAPIErrorBody, buildAPIError } from "./errors.js";
import { AccountResource } from "./resources/account.js";
import { AppsResource } from "./resources/apps.js";
import { BillingResource } from "./resources/billing.js";
import { DatabasesResource } from "./resources/databases.js";
import { ImagesResource } from "./resources/images.js";
import { PlansResource } from "./resources/plans.js";
import { SnapshotJobsResource, SnapshotsResource } from "./resources/snapshots.js";
import { StacksResource } from "./resources/stacks.js";
import { TemplatesResource } from "./resources/templates.js";
import { WorkspacesResource } from "./resources/workspaces.js";
import { type SseEvent, parseSseStream } from "./sse.js";

const PACKAGE_VERSION = "0.4.4"; // x-release-please-version
const DEFAULT_BASE_URL = "https://api.vertracloud.app";
const DEFAULT_TIMEOUT_MS = 30_000;
/** Default for the routes that may wait on a snapshot of their own (up to ~90 s on the server). */
export const SNAPSHOT_TIMEOUT_MS = 120_000;
/** A download fails when no byte arrives for this long (ms). There is no total deadline: the clock restarts at every chunk. */
export const DEFAULT_DOWNLOAD_INACTIVITY_MS = 60_000;

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
	/** Set to `false` on public routes: the request goes out without the `Authorization` header. Default `true`. */
	auth?: boolean;
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
	/** `snapshotJobs.*` — see {@link SnapshotJobsResource}. */
	readonly snapshotJobs: SnapshotJobsResource;
	/** `account.*` — see {@link AccountResource}. */
	readonly account: AccountResource;
	/** `workspaces.*` — see {@link WorkspacesResource}. */
	readonly workspaces: WorkspacesResource;
	/** `billing.*` — see {@link BillingResource}. */
	readonly billing: BillingResource;
	/** `plans.*` — see {@link PlansResource}. */
	readonly plans: PlansResource;

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
		this.snapshotJobs = new SnapshotJobsResource(this);
		this.account = new AccountResource(this);
		this.workspaces = new WorkspacesResource(this);
		this.billing = new BillingResource(this);
		this.plans = new PlansResource(this);
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

	private headers(extra?: Record<string, string>, auth = true): Headers {
		const headers = new Headers(extra);
		if (auth) headers.set("Authorization", `Bearer ${this.#apiKey}`);
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

	/**
	 * Same as {@link request}, but returns the raw binary body (a zip, for instance) as a stream: bytes are handed over as they arrive, so memory does not
	 * grow with the file. `config.timeoutMs` (default: the client's) is the wait for the response headers, and `inactivityTimeoutMs` (default 60 s) is how
	 * long the body may go without a single byte while the consumer is waiting for one; the clock restarts at every chunk. When it runs out, or when
	 * `config.signal` aborts, the stream errors (`TimeoutError` or the signal's reason). Cancelling the stream cancels the request.
	 */
	async requestStream(config: RequestConfig & { inactivityTimeoutMs?: number }): Promise<ReadableStream<Uint8Array>> {
		assertValidPath(config.path);
		const controller = new AbortController();
		const caller = config.signal;
		const onAbort = () => controller.abort(caller?.reason);
		caller?.addEventListener("abort", onAbort);
		if (caller?.aborted) controller.abort(caller.reason);
		const release = () => caller?.removeEventListener("abort", onAbort);
		const headerTimer = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), config.timeoutMs ?? this.timeoutMs);
		let response: Response;
		try {
			response = await this.fetchImpl(buildUrl(this.baseUrl, config.path, config.query), { method: config.method, headers: this.headers(config.headers, config.auth !== false), signal: controller.signal });
			if (!response.ok) throw buildAPIError(response.status, await parseErrorBody(response), response.headers.get("retry-after"));
		} catch (error) {
			release();
			throw error;
		} finally {
			clearTimeout(headerTimer);
		}
		if (!response.body) {
			release();
			return new ReadableStream<Uint8Array>({ start: (c) => c.close() });
		}
		const inactivityMs = config.inactivityTimeoutMs ?? DEFAULT_DOWNLOAD_INACTIVITY_MS;
		const reader = response.body.getReader();
		return new ReadableStream<Uint8Array>(
			{
				async pull(out) {
					const timer = setTimeout(() => controller.abort(new DOMException(`No data received for ${inactivityMs} ms; the download stalled`, "TimeoutError")), inactivityMs);
					try {
						const { done, value } = await readUnlessAborted(reader, controller.signal);
						if (done) {
							release();
							out.close();
						} else out.enqueue(value);
					} catch (error) {
						void reader.cancel(error).catch(() => undefined);
						release();
						out.error(controller.signal.aborted ? controller.signal.reason : error);
					} finally {
						clearTimeout(timer);
					}
				},
				cancel(reason) {
					release();
					controller.abort(reason);
				},
			},
			{ highWaterMark: 0 },
		);
	}

	/**
	 * Same as {@link requestStream}, but collects the whole body in memory and returns it as an `ArrayBuffer`. Memory grows with the file (the chunks and the final
	 * buffer coexist for a moment): for a file that can be large use {@link requestStream}.
	 */
	async requestBinary(config: RequestConfig & { inactivityTimeoutMs?: number }): Promise<ArrayBuffer> {
		const reader = (await this.requestStream(config)).getReader();
		const chunks: Uint8Array[] = [];
		let length = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
			length += value.byteLength;
		}
		const out = new Uint8Array(length);
		let offset = 0;
		for (const chunk of chunks) {
			out.set(chunk, offset);
			offset += chunk.byteLength;
		}
		return out.buffer;
	}

	/** Like {@link request}, but also returns the HTTP status and the whole JSON body, for routes whose `2xx` answers differ in shape (`201` with a snapshot, `202` with a `job_id`). */
	async requestWithStatus(config: RequestConfig): Promise<{ status: number; json: Record<string, unknown> }> {
		const { response, cleanup } = await this.rawRequest(config, config.form ? undefined : "application/json");
		try {
			if (!response.ok) throw buildAPIError(response.status, await parseErrorBody(response), response.headers.get("retry-after"));
			const json = (await response.json().catch(() => ({}))) as Record<string, unknown> | null;
			return { status: response.status, json: json ?? {} };
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
		const headers = this.headers({ ...config.headers, ...extraHeaders }, config.auth !== false);
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

function readUnlessAborted(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal): Promise<ReadableStreamReadResult<Uint8Array>> {
	return new Promise((resolve, reject) => {
		const fail = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
		if (signal.aborted) return fail();
		signal.addEventListener("abort", fail, { once: true });
		reader.read().then(
			(result) => {
				signal.removeEventListener("abort", fail);
				resolve(result);
			},
			(error) => {
				signal.removeEventListener("abort", fail);
				reject(error);
			},
		);
	});
}

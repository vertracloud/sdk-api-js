import assert from "node:assert/strict";
import { VertraClient } from "../src/index.js";

export const FAKE_KEY = "vc_live_test_0000000000000000000000000000000000";

export interface CapturedCall {
	method: string;
	url: URL;
	init: RequestInit;
}

export interface MockOptions {
	status?: number;
	jsonBody?: unknown;
	textBody?: string;
	arrayBufferBody?: ArrayBuffer;
	headers?: Record<string, string>;
	sseBody?: string;
	/** Never resolves — for timeout tests. */
	hang?: boolean;
}

/** Builds a fake `fetch` that records every call and returns a canned Response. */
export function makeMockFetch(calls: CapturedCall[], options: MockOptions = {}) {
	return async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
		const url = new URL(String(input));
		calls.push({ method: init.method ?? "GET", url, init });

		if (options.hang) {
			await new Promise((_, reject) => {
				init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
			});
		}

		const headers = new Headers(options.headers);
		const status = options.status ?? 200;

		if (options.sseBody !== undefined) {
			const encoder = new TextEncoder();
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode(options.sseBody));
					controller.close();
				},
			});
			return new Response(body, { status, headers });
		}

		if (options.arrayBufferBody !== undefined) {
			return new Response(options.arrayBufferBody, { status, headers });
		}

		if (options.textBody !== undefined) {
			return new Response(options.textBody, { status, headers });
		}

		return new Response(JSON.stringify(options.jsonBody ?? { response: {} }), { status, headers: { "content-type": "application/json", ...options.headers } });
	};
}

export function makeClient(options: MockOptions = {}, calls: CapturedCall[] = []): { client: VertraClient; calls: CapturedCall[] } {
	const client = new VertraClient({ apiKey: FAKE_KEY, fetch: makeMockFetch(calls, options) as typeof fetch });
	return { client, calls };
}

export function assertNoLeak(haystack: string): void {
	assert.equal(haystack.includes(FAKE_KEY), false, "leaked API key found in output");
	assert.equal(haystack.includes("Authorization"), false, "leaked Authorization header name found in output");
}

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { AuthenticationError, NotFoundError, PermissionError, RateLimitError, ValidationError, VertraAPIError, VertraClient } from "../src/index.js";
import { FAKE_KEY, makeClient } from "./helpers.js";

describe("VertraClient — auth header and envelope", () => {
	it("sends Authorization: Bearer <apiKey> and User-Agent", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { id: "1" } } });
		await client.apps.get("app-1");
		assert.equal(calls.length, 1);
		assert.equal(calls[0].init.headers instanceof Headers ? (calls[0].init.headers as Headers).get("Authorization") : undefined, `Bearer ${FAKE_KEY}`);
		assert.match((calls[0].init.headers as Headers).get("User-Agent") ?? "", /^vertracloud-sdk-js\//);
	});

	it("unwraps the { response } success envelope", async () => {
		const { client } = makeClient({ jsonBody: { response: { id: "42", name: "app" } } });
		const app = await client.apps.get("app-1");
		assert.deepEqual(app, { id: "42", name: "app" });
	});

	it("uses the custom userAgent and baseUrl when given", async () => {
		const calls: { url: URL }[] = [];
		const client = new VertraClient({
			apiKey: FAKE_KEY,
			baseUrl: "https://example.test",
			userAgent: "my-agent/9",
			fetch: (async (input: string | URL, init: RequestInit) => {
				calls.push({ url: new URL(String(input)) });
				assert.equal((init.headers as Headers).get("User-Agent"), "my-agent/9");
				return new Response(JSON.stringify({ response: {} }), { status: 200 });
			}) as typeof fetch,
		});
		await client.apps.get("x");
		assert.equal(calls[0].url.origin, "https://example.test");
	});
});

describe("VertraClient — collection response types", () => {
	it("apps.files.tree returns the complete root array without a path query", async () => {
		const tree = [{ type: "directory", name: "src", path: "/src", children: [{ type: "file", name: "main.go", path: "/src/main.go" }] }];
		const { client, calls } = makeClient({ jsonBody: { response: tree } });
		assert.deepEqual(await client.apps.files.tree("app-1"), tree);
		assert.equal(calls[0].url.pathname, "/v1/apps/app-1/files/tree");
		assert.equal(calls[0].url.searchParams.has("path"), false);
	});

	it("apps.statusAll unwraps a list", async () => {
		const { client } = makeClient({ jsonBody: { response: [{ id: "app-1" }, { id: "app-2" }] } });
		assert.deepEqual(await client.apps.statusAll(), [{ id: "app-1" }, { id: "app-2" }]);
	});

	it("databases.statusAll unwraps a list", async () => {
		const { client } = makeClient({ jsonBody: { response: [{ id: "db-1" }, { id: "db-2" }] } });
		assert.deepEqual(await client.databases.statusAll(), [{ id: "db-1" }, { id: "db-2" }]);
	});
});

describe("VertraClient — error classes by status", () => {
	const cases: [number, new (...args: unknown[]) => VertraAPIError][] = [
		[401, AuthenticationError],
		[403, PermissionError],
		[404, NotFoundError],
		[400, ValidationError],
		[422, ValidationError],
		[500, VertraAPIError],
		[502, VertraAPIError],
	];

	for (const [status, ExpectedClass] of cases) {
		it(`maps HTTP ${status} to ${ExpectedClass.name}`, async () => {
			const { client } = makeClient({ status, jsonBody: { code: "SOME_CODE", message: "boom" } });
			await assert.rejects(
				() => client.apps.get("x"),
				(error: unknown) => {
					assert.ok(error instanceof ExpectedClass);
					assert.ok(error instanceof VertraAPIError);
					assert.equal((error as VertraAPIError).status, status);
					assert.equal((error as VertraAPIError).code, "SOME_CODE");
					return true;
				},
			);
		});
	}

	it("falls back to HTTP_<status> when the error body isn't JSON", async () => {
		const { client } = makeClient({ status: 500, textBody: "<html>oops</html>" });
		// Force a non-JSON error body by overriding jsonBody parsing path: use requestText-free flow via request().
		await assert.rejects(
			() => client.apps.get("x"),
			(error: unknown) => {
				assert.ok(error instanceof VertraAPIError);
				assert.equal((error as VertraAPIError).code, "HTTP_500");
				return true;
			},
		);
	});

	it("429 exposes retryAfter from the body", async () => {
		const { client } = makeClient({ status: 429, jsonBody: { code: "RATE_LIMIT_EXCEEDED", retry_after: 12 } });
		await assert.rejects(
			() => client.apps.get("x"),
			(error: unknown) => {
				assert.ok(error instanceof RateLimitError);
				assert.equal((error as RateLimitError).retryAfter, 12);
				return true;
			},
		);
	});

	it("429 falls back to the retry-after header when the body has no retry_after", async () => {
		const { client } = makeClient({ status: 429, jsonBody: { code: "RATE_LIMIT_EXCEEDED" }, headers: { "retry-after": "30" } });
		await assert.rejects(
			() => client.apps.get("x"),
			(error: unknown) => {
				assert.ok(error instanceof RateLimitError);
				assert.equal((error as RateLimitError).retryAfter, 30);
				return true;
			},
		);
	});
});

describe("VertraClient — timeout", () => {
	it("aborts the request when it exceeds timeoutMs", async () => {
		const client = new VertraClient({
			apiKey: FAKE_KEY,
			timeoutMs: 20,
			fetch: (async (_input: string | URL, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener("abort", () => reject(new DOMException("Timeout", "TimeoutError")));
				})) as typeof fetch,
		});
		await assert.rejects(() => client.apps.get("x"), /Timeout|AbortError/);
	});

	it("aborts on the caller's own signal too, whichever fires first", async () => {
		const controller = new AbortController();
		const client = new VertraClient({
			apiKey: FAKE_KEY,
			timeoutMs: 30_000,
			fetch: (async (_input: string | URL, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
				})) as typeof fetch,
		});
		const promise = client.apps.get("x", { signal: controller.signal });
		controller.abort();
		await assert.rejects(() => promise, /AbortError/);
	});
});

describe("VertraClient — path encoding", () => {
	it("URL-encodes each path segment individually", async () => {
		const { client, calls } = makeClient();
		await client.apps.get("weird id/with?special&chars");
		assert.equal(calls[0].url.pathname, "/v1/apps/weird%20id%2Fwith%3Fspecial%26chars");
	});

	it("encodes multiple path params independently (envs.delete)", async () => {
		const { client, calls } = makeClient();
		await client.apps.envs.delete("app/1", "env/2");
		assert.equal(calls[0].url.pathname, "/v1/apps/app%2F1/envs/env%2F2");
	});
});

describe("VertraClient — query params", () => {
	it("omits undefined/null query params", async () => {
		const { client, calls } = makeClient();
		await client.apps.get("x");
		assert.equal(calls[0].url.searchParams.has("workspace_id"), false);
	});

	it("includes defined query params and serializes booleans as strings", async () => {
		const { client, calls } = makeClient();
		await client.apps.files.upload("x", new Blob(["a"]), "a.txt", { restart: true, workspaceId: "ws-1" });
		assert.equal(calls[0].url.searchParams.get("restart"), "true");
		assert.equal(calls[0].url.searchParams.get("workspace_id"), "ws-1");
	});

	it('serializes false as the string "false", not omitted', async () => {
		const { client, calls } = makeClient();
		await client.apps.files.upload("x", new Blob(["a"]), "a.txt", { restart: false });
		assert.equal(calls[0].url.searchParams.get("restart"), "false");
	});
});

describe("VertraClient — multipart", () => {
	it("apps.create sends a multipart form with the file field and text fields", async () => {
		const { client, calls } = makeClient();
		await client.apps.create({ file: new Blob(["zip-bytes"]), name: "my-app", memory: 256, main: "index.js", version: "20" });
		const form = calls[0].init.body as FormData;
		assert.ok(form instanceof FormData);
		assert.equal(form.get("name"), "my-app");
		assert.equal(form.get("memory"), "256");
		assert.equal(form.get("main"), "index.js");
		const file = form.get("file");
		assert.ok(file instanceof Blob);
	});

	it("apps.files.upload sends a multipart form with field 'file'", async () => {
		const { client, calls } = makeClient();
		await client.apps.files.upload("app-1", new Blob(["content"]), "file.txt");
		const form = calls[0].init.body as FormData;
		assert.ok(form instanceof FormData);
		const file = form.get("file");
		assert.ok(file instanceof Blob);
	});

	it("apps.files.upload returns the API upload result", async () => {
		const response = {
			app_id: "app-1",
			updated_at: "2026-09-22T12:00:00.000Z",
			missing_dependencies: ["lodash"],
			removed_directories: [".git"],
		};
		const { client } = makeClient({ jsonBody: { response } });
		assert.deepEqual(await client.apps.files.upload("app-1", new Blob(["content"]), "app.zip"), response);
	});
});

describe("VertraClient — binary responses", () => {
	it("apps.download returns an ArrayBuffer", async () => {
		const bytes = new TextEncoder().encode("zip-content").buffer;
		const { client } = makeClient({ arrayBufferBody: bytes });
		const result = await client.apps.download("app-1");
		assert.ok(result instanceof ArrayBuffer);
		assert.equal(Buffer.from(result).toString(), "zip-content");
	});

	it("snapshots.download returns an ArrayBuffer", async () => {
		const bytes = new TextEncoder().encode("snap-content").buffer;
		const { client } = makeClient({ arrayBufferBody: bytes });
		const result = await client.snapshots.download("app-1", "snap-1", { scope: "applications" });
		assert.ok(result instanceof ArrayBuffer);
	});

	it("databases.credentials.certificate.get returns a JSON string (real API behavior, not binary)", async () => {
		const { client } = makeClient({ jsonBody: { response: "-----BEGIN CERTIFICATE-----..." } });
		const cert = await client.databases.credentials.certificate.get("db-1");
		assert.equal(typeof cert, "string");
		assert.match(cert, /BEGIN CERTIFICATE/);
	});
});

describe("VertraClient — security: never leaks the API key", () => {
	it("VertraClient.toString()/toJSON()/JSON.stringify never include the key", () => {
		const client = new VertraClient({ apiKey: FAKE_KEY });
		const dumped = `${client.toString()} ${JSON.stringify(client)} ${JSON.stringify(client.toJSON())}`;
		assert.equal(dumped.includes(FAKE_KEY), false);
	});

	it("errors never include the key even when constructed from a request that used it", async () => {
		const { client } = makeClient({ status: 401, jsonBody: { code: "API_KEY_INVALID", message: "invalid" } });
		try {
			await client.apps.get("x");
			assert.fail("expected rejection");
		} catch (error) {
			const dumped = `${String(error)} ${JSON.stringify(error)} ${(error as Error).stack}`;
			assert.equal(dumped.includes(FAKE_KEY), false);
		}
	});
});

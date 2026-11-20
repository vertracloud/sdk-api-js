import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { SnapshotJobError, VertraClient, WaitTimeoutError } from "../src/index.js";
import { type CapturedCall, FAKE_KEY } from "./helpers.js";

interface Step {
	status?: number;
	json?: unknown;
	bytes?: ArrayBuffer;
}

function sequence(steps: Step[]): { client: VertraClient; calls: CapturedCall[] } {
	const calls: CapturedCall[] = [];
	let i = 0;
	const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
		calls.push({ method: init.method ?? "GET", url: new URL(String(input)), init });
		const step = steps[Math.min(i++, steps.length - 1)] as Step;
		const status = step.status ?? 200;
		if (step.bytes) return new Response(step.bytes, { status });
		return new Response(JSON.stringify(step.json ?? { response: {} }), { status, headers: { "content-type": "application/json" } });
	};
	return { client: new VertraClient({ apiKey: FAKE_KEY, fetch: fetchImpl as typeof fetch }), calls };
}

const job = (status: string, extra: Record<string, unknown> = {}) => ({ response: { id: "job-1", kind: "snapshot", resource_id: "app-1", status, created_at: "2026-11-18T12:00:00.000Z", ...extra } });
const zip = new Uint8Array([80, 75, 3, 4]).buffer;

describe("apps.download = manual snapshot, then the snapshot download", () => {
	it("201: creates the snapshot and downloads it, never touching /v1/apps/:id/download", async () => {
		const { client, calls } = sequence([{ status: 201, json: { response: { id: "snap-1" } } }, { bytes: zip }]);
		const data = await client.apps.download("app-1");
		assert.equal(data.byteLength, 4);
		assert.equal(calls.length, 2);
		assert.equal(calls[0]?.method, "POST");
		assert.equal(calls[0]?.url.pathname, "/v1/users/app-1/snapshots");
		assert.equal(calls[0]?.url.searchParams.get("scope"), "applications");
		assert.equal(calls[1]?.method, "GET");
		assert.equal(calls[1]?.url.pathname, "/v1/users/app-1/snapshots/snap-1/download");
		assert.equal(calls[1]?.url.searchParams.get("scope"), "applications");
		assert.ok(calls.every((c) => !c.url.pathname.startsWith("/v1/apps/")));
	});

	it("202: follows the job to ready and downloads the snapshot it produced (no list request)", async () => {
		const { client, calls } = sequence([{ status: 202, json: { response: { job_id: "job-1" } } }, { json: job("running") }, { json: job("ready", { snapshot_id: "snap-9" }) }, { bytes: zip }]);
		const seen: string[] = [];
		const data = await client.apps.download("app-1", { intervalMs: 1, onProgress: (j) => seen.push(j.status) });
		assert.equal(data.byteLength, 4);
		assert.deepEqual(seen, ["running"]);
		assert.equal(calls[1]?.url.pathname, "/v1/users/app-1/snapshots/jobs/job-1");
		assert.equal(calls[3]?.url.pathname, "/v1/users/app-1/snapshots/snap-9/download");
		assert.equal(calls.length, 4);
	});

	it("a failed job throws SnapshotJobError and downloads nothing", async () => {
		const { client, calls } = sequence([{ status: 202, json: { response: { job_id: "job-1" } } }, { json: job("failed", { reason: "SNAPSHOT_TIMEOUT" }) }]);
		await assert.rejects(client.apps.download("app-1", { intervalMs: 1 }), (e: unknown) => e instanceof SnapshotJobError && e.reason === "SNAPSHOT_TIMEOUT");
		assert.equal(calls.length, 2);
	});

	it("waitTimeoutMs ends the wait with WaitTimeoutError", async () => {
		const { client } = sequence([{ status: 202, json: { response: { job_id: "job-1" } } }, { json: job("running") }]);
		await assert.rejects(client.apps.download("app-1", { intervalMs: 5, waitTimeoutMs: 20 }), WaitTimeoutError);
	});

	it("a refusal of the snapshot (quota, plan) keeps its code", async () => {
		const { client } = sequence([{ status: 429, json: { code: "SNAPSHOT_RATE_LIMITED", details: { scope: "account", retry_after: 5 } } }]);
		await assert.rejects(client.apps.download("app-1"), (e: unknown) => (e as { code?: string }).code === "SNAPSHOT_RATE_LIMITED");
	});

	it("workspaceId goes on every call of the flow (snapshot, job, download), in all three forms", async () => {
		const ws = "33333333-3333-3333-3333-333333333333";
		const steps = (): Step[] => [{ status: 202, json: { response: { job_id: "job-1" } } }, { json: job("ready", { snapshot_id: "snap-9" }) }, { bytes: zip }];
		for (const form of ["download", "downloadStream", "downloadToFile"] as const) {
			const { client, calls } = sequence(steps());
			const options = { workspaceId: ws, intervalMs: 1 };
			if (form === "download") await client.apps.download("app-1", options);
			else if (form === "downloadStream") await (await client.apps.downloadStream("app-1", options)).cancel();
			else await client.apps.downloadToFile("app-1", join(await mkdtemp(join(tmpdir(), "vertra-ws-")), "a.zip"), options);
			assert.equal(calls.length, 3, form);
			for (const call of calls) assert.equal(call.url.searchParams.get("workspace_id"), ws, `${form}: ${call.url.pathname}`);
		}
	});

	it("without workspaceId no workspace_id is sent", async () => {
		const { client, calls } = sequence([{ status: 201, json: { response: { id: "snap-1" } } }, { bytes: zip }]);
		await client.apps.download("app-1");
		for (const call of calls) assert.equal(call.url.searchParams.has("workspace_id"), false);
	});

	it("the old options are gone: no downloadId, no wait: false", async () => {
		const { client } = sequence([{ status: 201, json: { response: { id: "snap-1" } } }, { bytes: zip }]);
		const data = await client.apps.download("app-1", { wait: false, downloadId: "x" } as never);
		assert.ok(data instanceof ArrayBuffer);
	});
});

/** Fake `fetch` (its body stream errors when the request is aborted, as a real one does) whose body arrives as `chunks` pieces, one every `everyMs`; `stallAfter` stops sending after that many pieces and never ends. */
function slowServer(options: { chunks: number; everyMs: number; stallAfter?: number }): { client: VertraClient } {
	const fetchImpl = async (_input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
		let sent = 0;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				// like a real fetch: aborting the request's signal errors the body stream
				init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
			},
			async pull(controller) {
				if (options.stallAfter !== undefined && sent >= options.stallAfter) return new Promise<void>(() => undefined);
				if (sent >= options.chunks) return controller.close();
				await new Promise((resolve) => setTimeout(resolve, options.everyMs));
				sent++;
				controller.enqueue(new Uint8Array([sent]));
			},
		});
		return new Response(body, { status: 200 });
	};
	return { client: new VertraClient({ apiKey: FAKE_KEY, fetch: fetchImpl as typeof fetch }) };
}

describe("snapshots.download: inactivity deadline, no total deadline", () => {
	it("a slow download that keeps sending outlasts the old total deadline and finishes", async () => {
		const { client } = slowServer({ chunks: 12, everyMs: 100 });
		const started = Date.now();
		const data = await client.snapshots.download("app-1", "snap-1", { scope: "applications", timeoutMs: 400, inactivityTimeoutMs: 300 });
		assert.ok(Date.now() - started > 1_000, "must have taken longer than the old total deadline");
		assert.deepEqual([...new Uint8Array(data)], [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
	});

	it("a download that stops in the middle fails by inactivity with a clear timeout error", async () => {
		const { client } = slowServer({ chunks: 12, everyMs: 20, stallAfter: 3 });
		const started = Date.now();
		const error = await client.snapshots.download("app-1", "snap-1", { scope: "applications", inactivityTimeoutMs: 200 }).catch((e: unknown) => e);
		assert.ok(error instanceof DOMException || error instanceof Error);
		assert.equal((error as Error).name, "TimeoutError");
		assert.match((error as Error).message, /no data|stalled|inactiv/i);
		assert.ok(Date.now() - started < 1_500);
	});

	it("the clock restarts at every chunk: gaps shorter than the deadline never trip it", async () => {
		const { client } = slowServer({ chunks: 6, everyMs: 150 });
		const data = await client.snapshots.download("app-1", "snap-1", { scope: "applications", inactivityTimeoutMs: 250 });
		assert.equal(data.byteLength, 6);
	});

	it("the caller's signal still cancels a download in progress", async () => {
		const { client } = slowServer({ chunks: 100, everyMs: 50 });
		const controller = new AbortController();
		setTimeout(() => controller.abort(new Error("stop")), 100);
		await assert.rejects(client.snapshots.download("app-1", "snap-1", { scope: "applications", signal: controller.signal }), /stop/);
	});

	it("timeoutMs still limits the wait for the headers", async () => {
		const fetchImpl = (_input: string | URL | Request, init: RequestInit = {}): Promise<Response> =>
			new Promise((_, reject) => {
				init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
			});
		const client = new VertraClient({ apiKey: FAKE_KEY, fetch: fetchImpl as typeof fetch });
		const error = await client.snapshots.download("app-1", "snap-1", { scope: "applications", timeoutMs: 30 }).catch((e: unknown) => e);
		assert.equal((error as Error).name, "TimeoutError");
	});

	it("an error answer is still a typed API error", async () => {
		const { client } = sequence([{ status: 404, json: { code: "SNAPSHOT_NOT_FOUND" } }]);
		await assert.rejects(client.snapshots.download("app-1", "nope", { scope: "applications" }), (e: unknown) => (e as { code?: string }).code === "SNAPSHOT_NOT_FOUND");
	});
});

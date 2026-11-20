import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "vitest";
import { VertraClient } from "../src/index.js";
import { FAKE_KEY } from "./helpers.js";

const MB = 1024 * 1024;

interface FakeOptions {
	chunks: number;
	chunkBytes?: number;
	everyMs?: number;
	stallAfter?: number;
	/** Called inside `pull` for each chunk, with its index, before the chunk is handed over. */
	onChunk?: (index: number) => void | Promise<void>;
}

/** Fake `fetch` whose body is generated chunk by chunk (nothing is kept) and whose stream errors when the request is aborted, as a real one does. */
function fakeDownload(options: FakeOptions): { client: VertraClient; sha256: () => string } {
	const hash = createHash("sha256");
	let sent = 0;
	const chunkBytes = options.chunkBytes ?? MB;
	const fetchImpl = async (_input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
		const body = new ReadableStream<Uint8Array>(
			{
				start(controller) {
					init.signal?.addEventListener("abort", () => controller.error(init.signal?.reason));
				},
				async pull(controller) {
					if (options.stallAfter !== undefined && sent >= options.stallAfter) return new Promise<void>(() => undefined);
					if (sent >= options.chunks) return controller.close();
					if (options.everyMs) await new Promise((resolve) => setTimeout(resolve, options.everyMs));
					await options.onChunk?.(sent);
					const chunk = new Uint8Array(chunkBytes).fill(sent % 251);
					hash.update(chunk);
					sent++;
					controller.enqueue(chunk);
				},
			},
			{ highWaterMark: 0 },
		);
		return new Response(body, { status: 200 });
	};
	return { client: new VertraClient({ apiKey: FAKE_KEY, fetch: fetchImpl as typeof fetch }), sha256: () => hash.copy().digest("hex") };
}

async function sha256OfFile(path: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "vertra-sdk-dl-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("snapshots.downloadToFile: streams to disk with constant memory", () => {
	it("400 MB: bytes hit the disk before the response ends, memory does not follow the size, the file is identical", async () => {
		const total = 400;
		const target = join(dir, "snapshot.zip");
		const sizesDuringResponse: number[] = [];
		let peak = 0;
		const base = process.memoryUsage().rss;
		const { client, sha256 } = fakeDownload({
			chunks: total,
			onChunk: async (index) => {
				peak = Math.max(peak, process.memoryUsage().rss - base);
				if (index === 200) {
					const [temp] = (await readdir(dir)).filter((name) => name.endsWith(".part"));
					assert.ok(temp, "a temporary file exists while the response is still coming");
					sizesDuringResponse.push((await stat(join(dir, temp))).size);
					assert.equal((await readdir(dir)).includes("snapshot.zip"), false, "the final name does not exist before the end");
				}
			},
		});
		const result = await client.snapshots.downloadToFile("app-1", "snap-1", target, { scope: "applications" });
		assert.deepEqual(result, { path: target, bytes: total * MB });
		assert.ok((sizesDuringResponse[0] ?? 0) >= 190 * MB, `written so far: ${sizesDuringResponse[0]}`);
		assert.ok(peak < 160 * MB, `RSS grew ${Math.round(peak / MB)} MB for a ${total} MB file`);
		assert.equal((await stat(target)).size, total * MB);
		assert.equal(await sha256OfFile(target), sha256());
		assert.deepEqual(await readdir(dir), ["snapshot.zip"]);
	}, 60_000);

	it("replaces an existing file only at the end", async () => {
		const target = join(dir, "snapshot.zip");
		await writeFile(target, "old");
		const { client } = fakeDownload({
			chunks: 3,
			onChunk: async (index) => {
				if (index === 2) assert.equal((await stat(target)).size, 3);
			},
		});
		await client.snapshots.downloadToFile("app-1", "snap-1", target, { scope: "applications" });
		assert.equal((await stat(target)).size, 3 * MB);
	});

	it("the caller's signal cancels: the temporary file is removed and the final name never appears", async () => {
		const controller = new AbortController();
		const target = join(dir, "snapshot.zip");
		const { client } = fakeDownload({ chunks: 1000, onChunk: (index) => void (index === 5 && controller.abort(new Error("stop"))) });
		await assert.rejects(client.snapshots.downloadToFile("app-1", "snap-1", target, { scope: "applications", signal: controller.signal }), /stop/);
		assert.deepEqual(await readdir(dir), []);
	});

	it("inactivity (no byte for inactivityTimeoutMs) fails with TimeoutError and leaves no file", async () => {
		const target = join(dir, "snapshot.zip");
		const { client } = fakeDownload({ chunks: 50, chunkBytes: 1024, everyMs: 10, stallAfter: 4 });
		const error = await client.snapshots.downloadToFile("app-1", "snap-1", target, { scope: "applications", inactivityTimeoutMs: 150 }).catch((e: unknown) => e);
		assert.equal((error as Error).name, "TimeoutError");
		assert.deepEqual(await readdir(dir), []);
	});

	it("an API error (no body to write) leaves no file", async () => {
		const fetchImpl = async () => new Response(JSON.stringify({ code: "SNAPSHOT_NOT_FOUND", message: "nope" }), { status: 404, headers: { "content-type": "application/json" } });
		const client = new VertraClient({ apiKey: FAKE_KEY, fetch: fetchImpl as unknown as typeof fetch });
		await assert.rejects(client.snapshots.downloadToFile("app-1", "snap-1", join(dir, "x.zip"), { scope: "applications" }), (e: unknown) => (e as { code?: string }).code === "SNAPSHOT_NOT_FOUND");
		assert.deepEqual(await readdir(dir), []);
	});

	it("a slow consumer is not charged as inactivity: the clock only runs while waiting for the network", async () => {
		const { client } = fakeDownload({ chunks: 4, chunkBytes: 1024 });
		const stream = await client.snapshots.downloadStream("app-1", "snap-1", { scope: "applications", inactivityTimeoutMs: 100 });
		const reader = stream.getReader();
		let total = 0;
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, 150));
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
		}
		assert.equal(total, 4096);
	});
});

describe("apps.downloadToFile: snapshot, wait, then the download straight to disk", () => {
	it("takes the snapshot, follows the job and writes the zip", async () => {
		const calls: string[] = [];
		const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
			const url = new URL(String(input));
			calls.push(`${init.method ?? "GET"} ${url.pathname}`);
			if (init.method === "POST") return new Response(JSON.stringify({ response: { job_id: "job-1" } }), { status: 202, headers: { "content-type": "application/json" } });
			if (url.pathname.endsWith("/jobs/job-1")) return new Response(JSON.stringify({ response: { id: "job-1", kind: "snapshot", resource_id: "app-1", status: "ready", snapshot_id: "snap-9", created_at: "2026-11-18T12:00:00.000Z" } }), { status: 200, headers: { "content-type": "application/json" } });
			return new Response(new Uint8Array([80, 75, 3, 4]), { status: 200 });
		};
		const client = new VertraClient({ apiKey: FAKE_KEY, fetch: fetchImpl as typeof fetch });
		const target = join(dir, "app.zip");
		const result = await client.apps.downloadToFile("app-1", target, { intervalMs: 1 });
		assert.equal(result.bytes, 4);
		assert.equal((await stat(target)).size, 4);
		assert.equal(calls.at(-1), "GET /v1/users/app-1/snapshots/snap-9/download");
		assert.deepEqual(await readdir(dir), ["app.zip"]);
	});
});

describe("a body cut before its Content-Length (real server, real fetch)", () => {
	let server: Server;
	let base: string;
	beforeEach(async () => {
		server = createServer((_req, res) => {
			res.writeHead(200, { "content-type": "application/zip", "content-length": String(4 * MB) });
			res.write(Buffer.alloc(2 * MB, 7), () => setTimeout(() => res.socket?.destroy(), 20));
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterEach(async () => {
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});

	it("downloadToFile fails, leaves no file and does not create the destination", async () => {
		const client = new VertraClient({ apiKey: FAKE_KEY, baseUrl: base });
		const target = join(dir, "snapshot.zip");
		await assert.rejects(client.snapshots.downloadToFile("app-1", "snap-1", target, { scope: "applications" }));
		assert.deepEqual(await readdir(dir), []);
	});

	it("downloadToFile does not replace an existing file", async () => {
		const client = new VertraClient({ apiKey: FAKE_KEY, baseUrl: base });
		const target = join(dir, "snapshot.zip");
		await writeFile(target, "old");
		await assert.rejects(client.snapshots.downloadToFile("app-1", "snap-1", target, { scope: "applications" }));
		assert.deepEqual(await readdir(dir), ["snapshot.zip"]);
		assert.equal(await readFile(target, "utf8"), "old");
	});

	it("download and downloadStream reject", async () => {
		const client = new VertraClient({ apiKey: FAKE_KEY, baseUrl: base });
		await assert.rejects(client.snapshots.download("app-1", "snap-1", { scope: "applications" }));
		const stream = await client.snapshots.downloadStream("app-1", "snap-1", { scope: "applications" });
		await assert.rejects(async () => {
			for await (const _ of stream as unknown as AsyncIterable<Uint8Array>) {
				/* drain */
			}
		});
	});
});

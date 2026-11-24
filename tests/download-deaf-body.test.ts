import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "vitest";
import { VertraClient } from "../src/index.js";
import { FAKE_KEY } from "./helpers.js";

function deafBodyClient(): VertraClient {
	const fetchImpl = async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array(10));
			},
			pull: () => new Promise(() => undefined),
		});
		return new Response(body, { status: 200 });
	};
	return new VertraClient({ apiKey: FAKE_KEY, fetch: fetchImpl as unknown as typeof fetch });
}

const settleWithin = <T>(promise: Promise<T>, ms: number) => Promise.race([promise, new Promise<"HUNG">((resolve) => setTimeout(() => resolve("HUNG"), ms))]);

const rejection = (promise: Promise<unknown>) =>
	promise.then(
		() => undefined,
		(error: unknown) => error as Error,
	);

describe("a body that ignores the abort must not leave a read pending", () => {
	it("downloadStream: the caller's signal errors the stream", async () => {
		const controller = new AbortController();
		const stream = await deafBodyClient().snapshots.downloadStream("app-1", "snap-1", { scope: "applications", signal: controller.signal, inactivityTimeoutMs: 5_000 });
		const reader = stream.getReader();
		await reader.read();
		setTimeout(() => controller.abort(new Error("stop")), 100);
		const error = await settleWithin(rejection(reader.read()), 1_500);
		assert.notEqual(error, "HUNG", "the read stayed pending");
		assert.match((error as Error).message, /stop/);
	});

	it("downloadStream: inactivity errors the stream with TimeoutError", async () => {
		const stream = await deafBodyClient().snapshots.downloadStream("app-1", "snap-1", { scope: "applications", inactivityTimeoutMs: 150 });
		const reader = stream.getReader();
		await reader.read();
		const error = await settleWithin(rejection(reader.read()), 1_500);
		assert.notEqual(error, "HUNG", "the read stayed pending");
		assert.equal((error as Error).name, "TimeoutError");
	});

	it("download (in memory): inactivity rejects with TimeoutError", async () => {
		const error = await settleWithin(rejection(deafBodyClient().snapshots.download("app-1", "snap-1", { scope: "applications", inactivityTimeoutMs: 150 })), 1_500);
		assert.notEqual(error, "HUNG", "the download stayed pending");
		assert.equal((error as Error).name, "TimeoutError");
	});

	it("downloadToFile: the caller's signal rejects and leaves no file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "vertra-sdk-deaf-"));
		try {
			const controller = new AbortController();
			setTimeout(() => controller.abort(new Error("stop")), 100);
			const error = await settleWithin(rejection(deafBodyClient().snapshots.downloadToFile("app-1", "snap-1", join(dir, "snapshot.zip"), { scope: "applications", signal: controller.signal, inactivityTimeoutMs: 5_000 })), 1_500);
			assert.notEqual(error, "HUNG", "the download stayed pending");
			assert.match((error as Error).message, /stop/);
			assert.deepEqual(await readdir(dir), []);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});

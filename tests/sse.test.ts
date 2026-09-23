import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SseIdleTimeoutError, parseSseStream } from "../src/sse.js";
import { makeClient } from "./helpers.js";

function streamFromString(text: string): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(text));
			controller.close();
		},
	});
}

describe("parseSseStream", () => {
	it("parses event/data blocks as the real API emits them", async () => {
		const body = streamFromString("event: system\ndata: Connected to realtime log stream\n\nevent: logs\ndata: hello world\n\nevent: heartbeat\ndata: heartbeat\n\n");
		const events = [];
		for await (const event of parseSseStream(body)) events.push(event);
		assert.deepEqual(events, [
			{ event: "system", data: "Connected to realtime log stream" },
			{ event: "logs", data: "hello world" },
			{ event: "heartbeat", data: "heartbeat" },
		]);
	});

	it("tolerates chunked/split reads across the event boundary", async () => {
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode("event: logs\ndata: par"));
				controller.enqueue(encoder.encode("t-two\n\n"));
				controller.close();
			},
		});
		const events = [];
		for await (const event of parseSseStream(body)) events.push(event);
		assert.deepEqual(events, [{ event: "logs", data: "part-two" }]);
	});

	it("cancellation via consumer break stops the reader", async () => {
		let cancelled = false;
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new TextEncoder().encode("event: logs\ndata: one\n\n"));
				controller.enqueue(new TextEncoder().encode("event: logs\ndata: two\n\n"));
			},
			cancel() {
				cancelled = true;
			},
		});
		for await (const event of parseSseStream(body)) {
			assert.equal(event.data, "one");
			break;
		}
		assert.equal(cancelled, true);
	});

	it("cancellation via AbortSignal stops iteration", async () => {
		const controller = new AbortController();
		const body = new ReadableStream<Uint8Array>({
			start() {
				// never enqueues — simulates a hung connection
			},
		});
		const iterator = parseSseStream(body, { signal: controller.signal });
		const next = iterator.next();
		controller.abort();
		await assert.rejects(() => next);
	});

	it("throws SseIdleTimeoutError when no event arrives within idleTimeoutMs", async () => {
		const body = new ReadableStream<Uint8Array>({
			start() {
				// never enqueues
			},
		});
		await assert.rejects(() => parseSseStream(body, { idleTimeoutMs: 20 }).next(), SseIdleTimeoutError);
	});
});

describe("apps.realtime — end to end through the client", () => {
	it("parses events from a mocked realtime response", async () => {
		const { client } = makeClient({ sseBody: "event: system\ndata: Connected to realtime log stream\n\nevent: logs\ndata: app started\n\n" });
		const events = [];
		for await (const event of client.apps.realtime("app-1")) events.push(event);
		assert.deepEqual(events, [
			{ event: "system", data: "Connected to realtime log stream" },
			{ event: "logs", data: "app started" },
		]);
	});
});

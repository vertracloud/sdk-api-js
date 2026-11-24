import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SseIdleTimeoutError, parseLiveMetrics, parseSseStream } from "../src/sse.js";
import { type CapturedCall, makeClient } from "./helpers.js";

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

describe("apps.realtime — metrics", () => {
	const reading = { at: "2026-11-24T12:00:00.000Z", cpu_percent: 12.5, cpu_cores: 0.125, memory_bytes: 1024, memory_limit_bytes: null, net_rx_bps: 1, net_tx_bps: 2, net_rx_bytes: 3, net_tx_bytes: 4 };

	it("sends metrics=true only when asked", async () => {
		const calls: CapturedCall[] = [];
		const { client } = makeClient({ sseBody: "event: heartbeat\ndata: heartbeat\n\n" }, calls);
		await client.apps.realtime("app-1").next();
		await client.apps.realtime("app-1", { metrics: true }).next();
		await client.apps.realtime("app-1", { metrics: false }).next();
		assert.equal(calls[0]?.url.searchParams.has("metrics"), false);
		assert.equal(calls[1]?.url.searchParams.get("metrics"), "true");
		assert.equal(calls[2]?.url.searchParams.get("metrics"), "false");
	});

	it("passes next_logs and metrics events through and parseLiveMetrics reads the reading", async () => {
		const sseBody = `event: next_logs\ndata: new version up\n\nevent: metrics\ndata: ${JSON.stringify(reading)}\n\n`;
		const { client } = makeClient({ sseBody });
		const events = [];
		for await (const event of client.apps.realtime("app-1", { metrics: true })) events.push(event);
		assert.equal(events[0]?.event, "next_logs");
		assert.equal(parseLiveMetrics(events[0] as (typeof events)[number]), null);
		assert.deepEqual(parseLiveMetrics(events[1] as (typeof events)[number]), reading);
	});

	it("parseLiveMetrics returns null for other events and for data that is not a reading", () => {
		assert.equal(parseLiveMetrics({ event: "logs", data: JSON.stringify(reading) }), null);
		assert.equal(parseLiveMetrics({ event: "metrics", data: "not json" }), null);
		assert.equal(parseLiveMetrics({ event: "metrics", data: "null" }), null);
		assert.equal(parseLiveMetrics({ event: "metrics", data: "{}" }), null);
	});
});

describe("metrics — restart events", () => {
	it("apps.metrics and databases.metrics resolve with the events the API sends", async () => {
		const events = [{ at: "2026-11-24T12:00:00.000Z", kind: "crash", out_of_memory: true }];
		const { client } = makeClient({ jsonBody: { response: [{ events }] } });
		const apps = await client.apps.metrics("app-1");
		const databases = await client.databases.metrics("db-1");
		assert.deepEqual(apps[0]?.events, events);
		assert.deepEqual(databases[0]?.events, events);
	});
});

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { APIApplicationAnalyticsRequest, APIApplicationAnalyticsRequestList } from "../src/index.js";
import { PermissionError, ValidationError, VertraAPIError, analyticsBusyRetryAfter, analyticsRangeExceedsPlan } from "../src/index.js";
import { makeClient } from "./helpers.js";

const request = (id: string): APIApplicationAnalyticsRequest => ({
	time: "2026-11-03T12:00:00.000Z",
	request_id: id,
	host: "app.example.com",
	path: "/",
	query: "",
	method: "GET",
	protocol: "HTTP/2",
	status: 200,
	container_status: null,
	edge_time_ms: 12,
	container_time_ms: null,
	ip: "203.0.113.7",
	asn: 64500,
	asn_name: "Example Net",
	country: "BR",
	edge_location: "GRU",
	referer: "(none)",
	referer_url: null,
	device: "desktop",
	os: "Linux",
	browser: "Firefox",
	bot: "(none)",
	content_type: "html",
	cache_status: "hit",
});

describe("apps.analytics", () => {
	it("traffic sends the window, filters and workspace as query params and unwraps the envelope", async () => {
		const body = { start: "a", end: "b", hosts: [], web_published: false, sampled: false, stale: false, generated_at: "c", history_days: 7, interval: "1h", summary: null, series: [], previous: null, breakdowns: {} };
		const { client, calls } = makeClient({ jsonBody: { response: body } });
		const result = await client.apps.analytics.traffic("app-1", { start: "2026-11-02T00:00:00Z", compare: true, breakdowns: "country,path", status: "5xx", referer: "(none)", limit: 5 }, { workspaceId: "ws-1" });
		assert.deepEqual(result, body);
		assert.equal(calls[0]?.method, "GET");
		assert.equal(calls[0]?.url.pathname, "/v1/apps/app-1/analytics");
		const q = calls[0]?.url.searchParams;
		assert.equal(q?.get("start"), "2026-11-02T00:00:00Z");
		assert.equal(q?.get("compare"), "true");
		assert.equal(q?.get("breakdowns"), "country,path");
		assert.equal(q?.get("status"), "5xx");
		assert.equal(q?.get("referer"), "(none)");
		assert.equal(q?.get("limit"), "5");
		assert.equal(q?.get("workspace_id"), "ws-1");
		assert.equal(q?.has("end"), false);
	});

	it("compare_start is serialized on traffic, errors and performance", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: {} } });
		const compareStart = "2026-10-26T00:00:00Z";
		await client.apps.analytics.traffic("a", { compare_start: compareStart });
		await client.apps.analytics.errors("a", { compare_start: compareStart });
		await client.apps.analytics.performance("a", { compare_start: compareStart });
		for (const call of calls) assert.equal(call.url.searchParams.get("compare_start"), compareStart);
		assert.equal(calls.length, 3);
	});

	it("traffic serializes a breakdowns list as CSV and an empty list as `breakdowns=`", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: {} } });
		await client.apps.analytics.traffic("a", { breakdowns: ["country", "path"] });
		await client.apps.analytics.traffic("a", { breakdowns: [] });
		await client.apps.analytics.traffic("a", { breakdowns: "" });
		await client.apps.analytics.traffic("a", {});
		assert.equal(calls[0]?.url.searchParams.get("breakdowns"), "country,path");
		assert.equal(calls[1]?.url.searchParams.get("breakdowns"), "");
		assert.equal(calls[1]?.url.search.includes("breakdowns="), true);
		assert.equal(calls[2]?.url.searchParams.get("breakdowns"), "");
		assert.equal(calls[3]?.url.searchParams.has("breakdowns"), false);
	});

	it("errors, performance and requests hit their own path", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: {} } });
		await client.apps.analytics.errors("a", { include_4xx: true });
		await client.apps.analytics.performance("a", { asn: "28573" });
		await client.apps.analytics.requests("a", { order: "asc", limit: 100, cursor: "abc", path: "/api" });
		assert.deepEqual(
			calls.map((c) => c.url.pathname),
			["/v1/apps/a/analytics/errors", "/v1/apps/a/analytics/performance", "/v1/apps/a/analytics/requests"],
		);
		assert.equal(calls[0]?.url.searchParams.get("include_4xx"), "true");
		assert.equal(calls[1]?.url.searchParams.get("asn"), "28573");
		const q = calls[2]?.url.searchParams;
		assert.equal(q?.get("order"), "asc");
		assert.equal(q?.get("cursor"), "abc");
		assert.equal(q?.get("path"), "/api");
	});

	it("encodes the app id as one path segment", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: {} } });
		await client.apps.analytics.traffic("a b");
		assert.equal(calls[0]?.url.pathname, "/v1/apps/a%20b/analytics");
	});

	it("requestsAll follows the cursor with a pinned window until it is null", async () => {
		const pages: APIApplicationAnalyticsRequestList[] = [
			{ start: "", end: "", hosts: [], web_published: true, sampled: false, stale: false, generated_at: "", history_days: 7, order: "desc", requests: [request("r1"), request("r2")], cursor: "c1" },
			{ start: "", end: "", hosts: [], web_published: true, sampled: false, stale: false, generated_at: "", history_days: 7, order: "desc", requests: [request("r3")], cursor: null },
		];
		const calls: { cursor: string | null; start: string | null; end: string | null }[] = [];
		const { client } = makeClient();
		const fetchImpl = (async (input: string | URL) => {
			const url = new URL(String(input));
			calls.push({ cursor: url.searchParams.get("cursor"), start: url.searchParams.get("start"), end: url.searchParams.get("end") });
			return new Response(JSON.stringify({ response: pages[calls.length - 1] }), { status: 200, headers: { "content-type": "application/json" } });
		}) as typeof fetch;
		const paged = new (client.constructor as typeof import("../src/index.js").VertraClient)({ apiKey: "k", fetch: fetchImpl });
		const ids: string[] = [];
		for await (const r of paged.apps.analytics.requestsAll("a", { limit: 2 })) ids.push(r.request_id);
		assert.deepEqual(ids, ["r1", "r2", "r3"]);
		assert.deepEqual(
			calls.map((c) => c.cursor),
			[null, "c1"],
		);
		assert.ok(calls[0]?.start && calls[0]?.end);
		assert.equal(calls[0]?.start, calls[1]?.start);
		assert.equal(calls[0]?.end, calls[1]?.end);
	});

	it("maps the plan errors to PermissionError with the stable code", async () => {
		const { client } = makeClient({ status: 403, jsonBody: { code: "PLAN_DOES_NOT_SUPPORT_WEB_ANALYTICS_REQUESTS", message: "no" } });
		await assert.rejects(client.apps.analytics.requests("a"), (error) => error instanceof PermissionError && error.code === "PLAN_DOES_NOT_SUPPORT_WEB_ANALYTICS_REQUESTS");
	});

	it("reads the details of ANALYTICS_RANGE_EXCEEDS_PLAN and ANALYTICS_BUSY", async () => {
		const range = makeClient({ status: 400, jsonBody: { code: "ANALYTICS_RANGE_EXCEEDS_PLAN", message: "x", details: { history_days: 7, earliest: "2026-10-27T00:00:00.000Z" } } });
		const error = await range.client.apps.analytics.traffic("a", { start: "2026-01-01T00:00:00Z" }).catch((e: unknown) => e);
		assert.ok(error instanceof ValidationError);
		assert.deepEqual(analyticsRangeExceedsPlan(error), { history_days: 7, earliest: "2026-10-27T00:00:00.000Z" });
		assert.equal(analyticsBusyRetryAfter(error), undefined);

		const busy = makeClient({ status: 503, jsonBody: { code: "ANALYTICS_BUSY", message: "x", details: { retry_after: 60 } } });
		const busyError = await busy.client.apps.analytics.traffic("a").catch((e: unknown) => e);
		assert.ok(busyError instanceof VertraAPIError);
		assert.equal(analyticsBusyRetryAfter(busyError), 60);
		assert.equal(analyticsRangeExceedsPlan(busyError), undefined);
		assert.equal(analyticsRangeExceedsPlan(new Error("x")), undefined);
	});
});

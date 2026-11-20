import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { RateLimitError, SNAPSHOT_ERROR_CODES, restoreCooldownRetryAfter, snapshotRateLimited } from "../src/index.js";
import { makeClient } from "./helpers.js";

const APP = "app-1";
const SNAP = "snap-1";

describe("snapshots.restore — restore_image_version", () => {
	it("sends restore_image_version: true in the JSON body when asked", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { job_id: "job-1" } } });
		await client.snapshots.restore(APP, SNAP, { scope: "applications", restoreImageVersion: true });

		assert.equal(calls[0]?.init.method, "POST");
		assert.equal(calls[0]?.url.pathname, `/v1/users/${APP}/snapshots/${SNAP}/restore`);
		assert.equal(calls[0]?.url.searchParams.get("scope"), "applications");
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { restore_image_version: true });
	});

	it("sends restore_image_version: false when explicitly false", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { job_id: "job-1" } } });
		await client.snapshots.restore(APP, SNAP, { scope: "applications", restoreImageVersion: false });
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { restore_image_version: false });
	});

	it("sends no body when the option is not given (the API default is data only)", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { job_id: "job-1" } } });
		await client.snapshots.restore(APP, SNAP, { scope: "applications" });
		assert.equal(calls[0]?.init.body, undefined);
	});

	it("returns the warning when the image version no longer exists", async () => {
		const { client } = makeClient({ status: 202, jsonBody: { response: { job_id: "job-1", warning: "IMAGE_VERSION_NOT_FOUND" } } });
		const result = await client.snapshots.restore(APP, SNAP, { scope: "applications", restoreImageVersion: true });
		assert.deepEqual(result, { job_id: "job-1", warning: "IMAGE_VERSION_NOT_FOUND" });
		assert.equal(result.warning, "IMAGE_VERSION_NOT_FOUND");
	});
});

describe("delete, reset and restore run right away", () => {
	it("apps.delete sends only the workspace in the query and no body", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: null } });
		const result = await client.apps.delete(APP, { workspaceId: "ws-1" });
		assert.equal(calls[0]?.init.method, "DELETE");
		assert.equal(calls[0]?.url.pathname, `/v1/apps/${APP}`);
		assert.deepEqual([...(calls[0]?.url.searchParams.keys() ?? [])], ["workspace_id"]);
		assert.equal(calls[0]?.init.body, undefined);
		assert.equal(result, null);
	});

	it("databases.delete resolves with the id of the database", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: "db-1" } });
		assert.equal(await client.databases.delete("db-1"), "db-1");
		assert.equal(calls[0]?.init.body, undefined);
		assert.equal(calls[0]?.url.search, "");
	});

	it("databases.reset sends no body and resolves with { status }", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { status: "success" } } });
		const result = await client.databases.reset("db-1");
		assert.equal(calls[0]?.url.pathname, "/v1/databases/db-1/reset");
		assert.equal(calls[0]?.init.body, undefined);
		assert.deepEqual(result, { status: "success" });
	});

	it("snapshots.restore sends only restore_image_version and resolves with the raw response", async () => {
		const { client, calls } = makeClient({ status: 202, jsonBody: { response: { job_id: "job-1" } } });
		const result = await client.snapshots.restore(APP, SNAP, { scope: "applications", restoreImageVersion: true });
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { restore_image_version: true });
		assert.deepEqual(result, { job_id: "job-1" });
	});

	it("a 202 without a job_id is an error, never undefined", async () => {
		const { client } = makeClient({ status: 202, jsonBody: { response: {} } });
		await assert.rejects(client.snapshots.create(APP, { scope: "databases" }), { code: "SNAPSHOT_FAILED" });
	});
});

describe("snapshot errors", () => {
	it("RateLimitError reads retryAfter from details when the header is absent", async () => {
		const { client } = makeClient({ status: 429, jsonBody: { code: "SNAPSHOT_RATE_LIMITED", details: { scope: "resource", retry_after: 42 } } });
		const error = await client.snapshots.create(APP, { scope: "applications" }).catch((e: unknown) => e);
		assert.ok(error instanceof RateLimitError);
		assert.equal(error.retryAfter, 42);
		assert.deepEqual(snapshotRateLimited(error), { scope: "resource", retryAfter: 42, resetsAt: undefined });
	});

	it("RESTORE_COOLDOWN carries retry_after: RateLimitError.retryAfter and restoreCooldownRetryAfter read it", async () => {
		const { client } = makeClient({ status: 429, jsonBody: { code: "RESTORE_COOLDOWN", details: { retry_after: 37 } } });
		const error = await client.snapshots.restore(APP, SNAP, { scope: "applications" }).catch((e: unknown) => e);
		assert.ok(error instanceof RateLimitError);
		assert.equal(error.retryAfter, 37);
		assert.equal(restoreCooldownRetryAfter(error), 37);
		assert.equal(restoreCooldownRetryAfter(new Error("x")), undefined);
	});

	it("RESTORE_COOLDOWN is in SNAPSHOT_ERROR_CODES", () => {
		assert.equal(SNAPSHOT_ERROR_CODES.RESTORE_COOLDOWN, "RESTORE_COOLDOWN");
	});

	it("the Retry-After header is the fallback of retryAfter", async () => {
		const { client } = makeClient({ status: 429, headers: { "retry-after": "9" }, jsonBody: { code: "RESTORE_COOLDOWN" } });
		const error = await client.snapshots.restore(APP, SNAP, { scope: "applications" }).catch((e: unknown) => e);
		assert.ok(error instanceof RateLimitError);
		assert.equal(error.retryAfter, 9);
	});
});

describe("snapshot timeouts", () => {
	it("a per-call timeoutMs overrides the default of the call", async () => {
		const { client } = makeClient({ hang: true });
		const started = Date.now();
		await assert.rejects(client.apps.delete(APP, { timeoutMs: 20 }));
		assert.ok(Date.now() - started < 1_000);
	});
});

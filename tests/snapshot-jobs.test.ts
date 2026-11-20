import assert from "node:assert/strict";
import { describe, it, vi } from "vitest";
import { SnapshotJobError, VertraAPIError, VertraClient, WaitTimeoutError, snapshotExceedsStorage } from "../src/index.js";
import type { APISnapshotJob } from "../src/index.js";
import { type CapturedCall, FAKE_KEY } from "./helpers.js";

interface Step {
	status?: number;
	json?: unknown;
	bytes?: ArrayBuffer;
}

/** Fake `fetch` that answers the calls in order (the last step repeats). */
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

const job = (status: string, extra: Record<string, unknown> = {}) => ({ response: { id: "job-1", kind: "restore", resource_id: "app-1", status, created_at: "2026-11-16T12:00:00.000Z", ...extra } });

describe("snapshotJobs", () => {
	it("list sends scope, kind and limit on the resource's snapshots/jobs route", async () => {
		const { client, calls } = sequence([{ json: { response: [] } }]);
		const jobs = await client.snapshotJobs.list("app-1", { scope: "applications", kind: "restore", limit: 5 });
		assert.deepEqual(jobs, []);
		assert.equal(calls[0]?.url.pathname, "/v1/users/app-1/snapshots/jobs");
		assert.equal(calls[0]?.url.searchParams.get("scope"), "applications");
		assert.equal(calls[0]?.url.searchParams.get("kind"), "restore");
		assert.equal(calls[0]?.url.searchParams.get("limit"), "5");
	});

	it("get reads one job", async () => {
		const { client, calls } = sequence([{ json: job("running") }]);
		const result = await client.snapshotJobs.get("db-1", "job-1", { scope: "databases" });
		assert.equal(result.status, "running");
		assert.equal(calls[0]?.url.pathname, "/v1/users/db-1/snapshots/jobs/job-1");
		assert.equal(calls[0]?.url.searchParams.get("scope"), "databases");
	});

	it("get and wait work without scope: the query has none", async () => {
		const { client, calls } = sequence([{ json: job("running") }, { json: job("ready") }]);
		assert.equal((await client.snapshotJobs.get("app-1", "job-1")).status, "running");
		assert.equal(calls[0]?.url.searchParams.has("scope"), false);
		const done = await client.snapshotJobs.wait("app-1", "job-1", { intervalMs: 1 });
		assert.equal(done.status, "ready");
		assert.equal(calls[1]?.url.searchParams.has("scope"), false);
	});

	it("wait polls until the job is final and resolves with it", async () => {
		const { client, calls } = sequence([{ json: job("queued") }, { json: job("running") }, { json: job("ready") }]);
		const result = await client.snapshotJobs.wait("app-1", "job-1", { scope: "applications", intervalMs: 1 });
		assert.equal(result.status, "ready");
		assert.equal(calls.length, 3);
	});

	it("wait throws SnapshotJobError on a failed job, with reason, details and the job", async () => {
		const details = { required_bytes: 900, available_bytes: 100, required_ram_mb: 512 };
		const { client } = sequence([{ json: job("failed", { reason: "SNAPSHOT_EXCEEDS_STORAGE", details }) }]);
		const error = await client.snapshotJobs.wait("db-1", "job-1", { scope: "databases", intervalMs: 1 }).catch((e: unknown) => e);
		assert.ok(error instanceof SnapshotJobError);
		assert.equal(error.status, "failed");
		assert.equal(error.reason, "SNAPSHOT_EXCEEDS_STORAGE");
		assert.equal(error.code, "SNAPSHOT_EXCEEDS_STORAGE");
		assert.deepEqual(error.details, details);
		assert.equal(error.job.id, "job-1");
		assert.deepEqual(snapshotExceedsStorage(error), { requiredBytes: 900, availableBytes: 100, requiredRamMb: 512 });
	});

	it("wait throws SnapshotJobError on a skipped job, and falls back to SNAPSHOT_FAILED without a reason", async () => {
		const skipped = sequence([{ json: job("skipped", { reason: "DATABASE_NOT_READY" }) }]);
		const skippedError = await skipped.client.snapshotJobs.wait("db-1", "job-1", { scope: "databases", intervalMs: 1 }).catch((e: unknown) => e);
		assert.ok(skippedError instanceof SnapshotJobError);
		assert.equal(skippedError.status, "skipped");
		assert.equal(skippedError.reason, "DATABASE_NOT_READY");
		const bare = sequence([{ json: job("failed") }]);
		const bareError = await bare.client.snapshotJobs.wait("db-1", "job-1", { scope: "databases", intervalMs: 1 }).catch((e: unknown) => e);
		assert.ok(bareError instanceof SnapshotJobError);
		assert.equal(bareError.reason, "SNAPSHOT_FAILED");
	});

	it("wait calls onProgress on every poll that has not ended, with the progress of a running job", async () => {
		const progress = { phase: "copying", percent: 40, done_bytes: 4, total_bytes: 10, eta_seconds: 3 };
		const { client } = sequence([{ json: job("queued") }, { json: job("running", { progress }) }, { json: job("ready") }]);
		const seen: APISnapshotJob[] = [];
		const result = await client.snapshotJobs.wait("app-1", "job-1", { scope: "applications", intervalMs: 1, onProgress: (j) => seen.push(j) });
		assert.equal(result.status, "ready");
		assert.deepEqual(
			seen.map((j) => j.status),
			["queued", "running"],
		);
		assert.deepEqual(seen[1]?.progress, progress);
	});

	it("wait throws WaitTimeoutError at the deadline, carrying the last job", async () => {
		const { client } = sequence([{ json: job("running") }]);
		const error = await client.snapshotJobs.wait("app-1", "job-1", { scope: "applications", intervalMs: 5, waitTimeoutMs: 20 }).catch((e: unknown) => e);
		assert.ok(error instanceof WaitTimeoutError);
		assert.equal(error.job?.status, "running");
		assert.equal(error.timeoutMs, 20);
	});

	it("wait: timeoutMs is the limit of each poll, not the total wait", async () => {
		const spy = vi.spyOn(globalThis, "setTimeout");
		try {
			const { client } = sequence([{ json: job("running") }, { json: job("ready") }]);
			await client.snapshotJobs.wait("app-1", "job-1", { intervalMs: 1, timeoutMs: 7_000, waitTimeoutMs: 60_000 });
			const delays = spy.mock.calls.map((args) => Number(args[1]));
			assert.ok(delays.includes(7_000), `delays: ${delays}`);
			assert.ok(!delays.includes(30_000), `delays: ${delays}`);
		} finally {
			spy.mockRestore();
		}
	});

	it("wait stops when the signal aborts", async () => {
		const { client } = sequence([{ json: job("running") }]);
		const controller = new AbortController();
		const pending = client.snapshotJobs.wait("app-1", "job-1", { scope: "applications", intervalMs: 50, signal: controller.signal });
		setTimeout(() => controller.abort(new Error("stop")), 10);
		await assert.rejects(pending, /stop/);
	});
});

describe("create from a snapshot", () => {
	it("apps.create keeps restore_job_id of the 202", async () => {
		const { client } = sequence([{ status: 202, json: { response: { id: "app-1", status: "down", restore_job_id: "job-9" } } }]);
		const app = await client.apps.create({ name: "x", snapshotId: "snap-1" });
		assert.equal(app.restore_job_id, "job-9");
	});

	it("databases.create keeps restore_job_id of the 202", async () => {
		const { client } = sequence([{ status: 202, json: { response: { id: "db-1", restore_job_id: "job-8" } } }]);
		const db = await client.databases.create({ name: "x", ram: 256, snapshot_id: "snap-1" });
		assert.equal(db.restore_job_id, "job-8");
	});
});

describe("snapshot error readers", () => {
	it("snapshotExceedsStorage reads the numbers and ignores other codes", async () => {
		const { client } = sequence([{ status: 400, json: { code: "SNAPSHOT_EXCEEDS_STORAGE", details: { required_bytes: 900, available_bytes: 100, required_ram_mb: 512 } } }]);
		const error = await client.snapshots.restore("db-1", "snap-1", { scope: "databases" }).catch((e: unknown) => e);
		assert.deepEqual(snapshotExceedsStorage(error), { requiredBytes: 900, availableBytes: 100, requiredRamMb: 512 });
	});
});

describe("stacks.snapshots.create", () => {
	const accepted = {
		status: 202,
		json: {
			response: {
				id: "group-1",
				jobs: [
					{ resource_id: "db-1", resource_type: "database", job_id: "j1" },
					{ resource_id: "app-1", resource_type: "application", job_id: "j2" },
				],
			},
		},
	};

	it("resolves with the stack snapshot id and the jobs on 202, without waiting", async () => {
		const { client, calls } = sequence([accepted]);
		const result = await client.stacks.snapshots.create("stack-1");
		assert.equal(result.id, "group-1");
		assert.equal(result.jobs.length, 2);
		assert.equal(calls[0]?.method, "POST");
		assert.equal(calls[0]?.url.pathname, "/v1/stacks/stack-1/snapshots");
		assert.equal(calls.length, 1);
	});

	it("createAndWait follows every job with the scope of its member and resolves with all of them ready", async () => {
		const { client, calls } = sequence([accepted, { json: job("ready", { kind: "snapshot" }) }, { json: job("ready", { kind: "snapshot" }) }]);
		const result = await client.stacks.snapshots.createAndWait("stack-1", { intervalMs: 1 });
		assert.equal(result.id, "group-1");
		assert.deepEqual(
			result.finished.map((j) => j.status),
			["ready", "ready"],
		);
		assert.equal(calls[1]?.url.searchParams.get("scope"), "databases");
		assert.equal(calls[2]?.url.pathname, "/v1/users/app-1/snapshots/jobs/j2");
		assert.equal(calls[2]?.url.searchParams.get("scope"), "applications");
	});

	it("waitForCreate follows the jobs of an accepted answer", async () => {
		const { client, calls } = sequence([{ json: job("ready", { kind: "snapshot" }) }, { json: job("ready", { kind: "snapshot" }) }]);
		const finished = await client.stacks.snapshots.waitForCreate(accepted.json.response as never, { intervalMs: 1 });
		assert.equal(finished.length, 2);
		assert.equal(calls[0]?.url.searchParams.get("scope"), "databases");
	});

	it("createAndWait throws SnapshotJobError at the first member that fails", async () => {
		const { client } = sequence([accepted, { json: job("ready", { kind: "snapshot" }) }, { json: job("failed", { kind: "snapshot", reason: "SNAPSHOT_FAILED" }) }]);
		const error = await client.stacks.snapshots.createAndWait("stack-1", { intervalMs: 1 }).catch((e: unknown) => e);
		assert.ok(error instanceof SnapshotJobError);
		assert.equal(error.reason, "SNAPSHOT_FAILED");
	});

	it("a refusal before the queue keeps the code of the member", async () => {
		const { client } = sequence([{ status: 429, json: { code: "SNAPSHOT_RATE_LIMITED", details: { scope: "account" } } }]);
		const error = await client.stacks.snapshots.create("stack-1").catch((e: unknown) => e);
		assert.equal((error as { code?: string }).code, "SNAPSHOT_RATE_LIMITED");
	});
});

describe("stacks.snapshots.restore", () => {
	const accepted = {
		status: 202,
		json: {
			response: {
				jobs: [
					{ resource_id: "db-1", resource_type: "database", job_id: "j1" },
					{ resource_id: "app-1", resource_type: "application", job_id: "j2", warning: "IMAGE_VERSION_NOT_FOUND" },
				],
			},
		},
	};

	it("resolves with the jobs (warning per member) on 202, without waiting", async () => {
		const { client, calls } = sequence([accepted]);
		const result = await client.stacks.snapshots.restore("stack-1", "snap-1");
		assert.equal(result.jobs.length, 2);
		assert.equal(result.jobs[0]?.warning, undefined);
		assert.equal(result.jobs[1]?.warning, "IMAGE_VERSION_NOT_FOUND");
		assert.equal("warning" in result, false);
		assert.equal(calls[0]?.url.pathname, "/v1/stacks/stack-1/snapshots/snap-1/restore");
	});

	it("restoreAndWait follows every job with the scope of its member", async () => {
		const { client, calls } = sequence([accepted, { json: job("ready") }, { json: job("ready") }]);
		const result = await client.stacks.snapshots.restoreAndWait("stack-1", "snap-1", undefined, { intervalMs: 1 });
		assert.deepEqual(
			result.finished.map((j) => j.status),
			["ready", "ready"],
		);
		assert.equal(calls[1]?.url.pathname, "/v1/users/db-1/snapshots/jobs/j1");
		assert.equal(calls[1]?.url.searchParams.get("scope"), "databases");
		assert.equal(calls[2]?.url.pathname, "/v1/users/app-1/snapshots/jobs/j2");
		assert.equal(calls[2]?.url.searchParams.get("scope"), "applications");
	});

	it("waitForRestore follows the jobs of an accepted answer under one waitTimeoutMs", async () => {
		const { client, calls } = sequence([{ json: job("ready") }, { json: job("ready") }]);
		const finished = await client.stacks.snapshots.waitForRestore(accepted.json.response as never, { intervalMs: 1 });
		assert.deepEqual(
			finished.map((j) => j.status),
			["ready", "ready"],
		);
		assert.equal(calls[1]?.url.searchParams.get("scope"), "applications");
		const slow = sequence([{ json: job("running") }]);
		await assert.rejects(slow.client.stacks.snapshots.waitForRestore(accepted.json.response as never, { intervalMs: 5, waitTimeoutMs: 20 }), WaitTimeoutError);
	});

	it("restoreAndWait throws SnapshotJobError when a member fails", async () => {
		const { client } = sequence([accepted, { json: job("failed", { reason: "SNAPSHOT_IMPORT_FAILED" }) }]);
		const error = await client.stacks.snapshots.restoreAndWait("stack-1", "snap-1", undefined, { intervalMs: 1 }).catch((e: unknown) => e);
		assert.ok(error instanceof SnapshotJobError);
		assert.equal(error.reason, "SNAPSHOT_IMPORT_FAILED");
	});

	it("a refusal before the queue keeps the code and details of the member", async () => {
		const { client } = sequence([{ status: 400, json: { code: "SNAPSHOT_EXCEEDS_STORAGE", details: { required_bytes: 9, available_bytes: 1 } } }]);
		const error = await client.stacks.snapshots.restore("stack-1", "snap-1").catch((e: unknown) => e);
		assert.deepEqual(snapshotExceedsStorage(error), { requiredBytes: 9, availableBytes: 1, requiredRamMb: undefined });
	});
});

describe("snapshots.create and the 202 with job_id", () => {
	const snap = { id: "snap-1", created_at: "2026-11-16T12:00:00.000Z" };
	const processing = { status: 202, json: { response: { job_id: "job-1" } } };

	it("create resolves with the snapshot on 201 and with the job_id on 202, in one request", async () => {
		const ready = sequence([{ status: 201, json: { response: snap } }]);
		assert.deepEqual(await ready.client.snapshots.create("app-1", { scope: "applications" }), { status: "ready", snapshot: snap });
		const accepted = sequence([processing]);
		assert.deepEqual(await accepted.client.snapshots.create("app-1", { scope: "applications" }), { status: "accepted", job_id: "job-1" });
		assert.equal(accepted.calls.length, 1);
	});

	it("createAndWait resolves with the snapshot on 201", async () => {
		const { client } = sequence([{ status: 201, json: { response: snap } }]);
		assert.deepEqual(await client.snapshots.createAndWait("app-1", { scope: "applications" }), snap);
	});

	it("createAndWait follows the job on 202 and resolves with the snapshot from the list", async () => {
		const { client, calls } = sequence([processing, { json: job("running", { kind: "snapshot" }) }, { json: job("ready", { kind: "snapshot", snapshot_id: "snap-1" }) }, { json: { response: [{ id: "other" }, snap] } }]);
		const seen: string[] = [];
		const result = await client.snapshots.createAndWait("app-1", { scope: "applications", intervalMs: 1, onProgress: (j) => seen.push(j.status) });
		assert.deepEqual(result, snap);
		assert.deepEqual(seen, ["running"]);
		assert.equal(calls[1]?.url.pathname, "/v1/users/app-1/snapshots/jobs/job-1");
		assert.equal(calls[3]?.url.pathname, "/v1/users/app-1/snapshots");
	});

	it("createAndWait throws SnapshotJobError when the job fails or is skipped", async () => {
		const failed = sequence([processing, { json: job("failed", { kind: "snapshot", reason: "SNAPSHOT_TOO_LARGE", details: { max_bytes: 10 } }) }]);
		const error = await failed.client.snapshots.createAndWait("db-1", { scope: "databases", intervalMs: 1 }).catch((e: unknown) => e);
		assert.ok(error instanceof SnapshotJobError);
		assert.equal(error.reason, "SNAPSHOT_TOO_LARGE");
		assert.deepEqual(error.details, { max_bytes: 10 });
		const skipped = sequence([processing, { json: job("skipped", { kind: "snapshot", reason: "DATABASE_NOT_READY" }) }]);
		await assert.rejects(skipped.client.snapshots.createAndWait("db-1", { scope: "databases", intervalMs: 1 }), (e: unknown) => e instanceof SnapshotJobError && e.status === "skipped");
	});

	it("createAndWait throws WaitTimeoutError when the job outlasts waitTimeoutMs", async () => {
		const { client } = sequence([processing, { json: job("running", { kind: "snapshot" }) }]);
		await assert.rejects(client.snapshots.createAndWait("app-1", { scope: "applications", intervalMs: 5, waitTimeoutMs: 20 }), WaitTimeoutError);
	});
});

describe("workspaceId on the snapshot domain", () => {
	const ws = "33333333-3333-3333-3333-333333333333";
	it("every snapshots.* and snapshotJobs.* call sends workspace_id when given", async () => {
		const { client, calls } = sequence([{ json: { response: [] } }]);
		const o = { scope: "applications" as const, workspaceId: ws };
		await client.snapshots.list("app-1", o);
		await client.snapshots.create("app-1", o);
		await client.snapshots.restore("app-1", "snap-1", o);
		await client.snapshots.download("app-1", "snap-1", o).catch(() => undefined);
		await client.snapshotJobs.list("app-1", o);
		await client.snapshotJobs.get("app-1", "job-1", { workspaceId: ws });
		assert.equal(calls.length, 6);
		for (const call of calls) assert.equal(call.url.searchParams.get("workspace_id"), ws, call.url.pathname);
	});

	it("wait and createAndWait carry it on every poll and on the final list", async () => {
		const { client, calls } = sequence([{ status: 202, json: { response: { job_id: "job-1" } } }, { json: job("ready", { kind: "snapshot", snapshot_id: "snap-1" }) }, { json: { response: [{ id: "snap-1" }] } }]);
		await client.snapshots.createAndWait("app-1", { scope: "applications", workspaceId: ws, intervalMs: 1 });
		assert.equal(calls.length, 3);
		for (const call of calls) assert.equal(call.url.searchParams.get("workspace_id"), ws, call.url.pathname);
	});

	it("is omitted when not given", async () => {
		const { client, calls } = sequence([{ json: { response: [] } }]);
		await client.snapshots.list("app-1", { scope: "applications" });
		assert.equal(calls[0]?.url.searchParams.has("workspace_id"), false);
	});
});

describe("stacks: workspaceId reaches the member job polling", () => {
	const ws = "33333333-3333-3333-3333-333333333333";
	const members = {
		jobs: [
			{ resource_id: "db-1", resource_type: "database", job_id: "j1" },
			{ resource_id: "app-1", resource_type: "application", job_id: "j2" },
		],
	};

	it("createAndWait sends it on the start call and on every job poll", async () => {
		const { client, calls } = sequence([{ status: 202, json: { response: { id: "group-1", ...members } } }, { json: job("ready", { kind: "snapshot" }) }, { json: job("ready", { kind: "snapshot" }) }]);
		await client.stacks.snapshots.createAndWait("stack-1", { intervalMs: 1, workspaceId: ws });
		assert.equal(calls.length, 3);
		for (const call of calls) assert.equal(call.url.searchParams.get("workspace_id"), ws, call.url.pathname);
	});

	it("restoreAndWait and waitForRestore do the same", async () => {
		const { client, calls } = sequence([{ status: 202, json: { response: members } }, { json: job("ready") }, { json: job("ready") }]);
		await client.stacks.snapshots.restoreAndWait("stack-1", "snap-1", undefined, { intervalMs: 1, workspaceId: ws });
		for (const call of calls) assert.equal(call.url.searchParams.get("workspace_id"), ws, call.url.pathname);
		const polled = sequence([{ json: job("ready") }, { json: job("ready") }]);
		await polled.client.stacks.snapshots.waitForRestore(members as never, { intervalMs: 1, workspaceId: ws });
		for (const call of polled.calls) assert.equal(call.url.searchParams.get("workspace_id"), ws);
	});
});

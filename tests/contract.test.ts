import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { VertraClient } from "../src/index.js";
import { type CapturedCall, makeClient } from "./helpers.js";

const FAKE = "id-1";
const FAKE2 = "id-2";
const FAKE3 = "id-3";

interface ContractCase {
	name: string;
	call: (client: VertraClient) => Promise<unknown>;
	method: string;
	path: string;
	/** Only the query params expected to be present (with their exact values). Absent keys must be absent from the URL. */
	query?: Record<string, string>;
	/** Exact JSON body expected, or "none" if no body should be sent at all. */
	body?: Record<string, unknown> | "none";
	/** For multipart requests: the exact set of field names expected in the FormData. */
	multipartFields?: string[];
}

const cases: ContractCase[] = [
	{
		name: "workspaces.actionRequests.list — status is an optional query filter",
		call: (c) => c.workspaces.actionRequests.list(FAKE, { status: "pending" }),
		method: "GET",
		path: `/v1/workspaces/${FAKE}/action-requests`,
		query: { status: "pending" },
	},
	{
		name: "workspaces.actionRequests.create — action/resource_id/params in the body",
		call: (c) => c.workspaces.actionRequests.create(FAKE, { action: "snapshot_restore", resource_id: FAKE2, params: { snapshot_id: FAKE3 } }),
		method: "POST",
		path: `/v1/workspaces/${FAKE}/action-requests`,
		body: { action: "snapshot_restore", resource_id: FAKE2, params: { snapshot_id: FAKE3 } },
	},
	{
		name: "apps.deploys.webhook.create — all four body fields required, snake_case",
		call: (c) => c.apps.deploys.webhook.create(FAKE, { owner: "octocat", repo_name: "hello-world", repo_id: "123", account_id: "456" }),
		method: "POST",
		path: `/v1/apps/${FAKE}/deploys/webhook`,
		body: { owner: "octocat", repo_name: "hello-world", repo_id: "123", account_id: "456" },
	},
	{
		name: "snapshots.listAll — scope is a required query param",
		call: (c) => c.snapshots.listAll({ scope: "databases" }),
		method: "GET",
		path: "/v1/users/snapshots",
		query: { scope: "databases" },
	},
	{
		name: "snapshots.list — scope required, no workspace_id (API never reads it here)",
		call: (c) => c.snapshots.list(FAKE, { scope: "applications" }),
		method: "GET",
		path: `/v1/users/${FAKE}/snapshots`,
		query: { scope: "applications" },
	},
	{
		name: "snapshots.create — scope required in query",
		call: (c) => c.snapshots.create(FAKE, { scope: "applications" }),
		method: "POST",
		path: `/v1/users/${FAKE}/snapshots`,
		query: { scope: "applications" },
	},
	{
		name: "snapshots.restore — scope required in query",
		call: (c) => c.snapshots.restore(FAKE, FAKE2, { scope: "databases" }),
		method: "POST",
		path: `/v1/users/${FAKE}/snapshots/${FAKE2}/restore`,
		query: { scope: "databases" },
	},
	{
		name: "snapshots.download — scope required in query",
		call: (c) => c.snapshots.download(FAKE, FAKE2, { scope: "applications" }),
		method: "GET",
		path: `/v1/users/${FAKE}/snapshots/${FAKE2}/download`,
		query: { scope: "applications" },
	},
	{
		name: "databases.create — ram required, no invented engine/plan fields",
		call: (c) => c.databases.create({ name: "meu-db", type: 1, ram: 512 }),
		method: "POST",
		path: "/v1/databases",
		body: { name: "meu-db", type: 1, ram: 512 },
	},
	{
		name: "databases.update — name/description/ram only, no plan field",
		call: (c) => c.databases.update(FAKE, { name: "novo", ram: 256 }),
		method: "PUT",
		path: `/v1/databases/${FAKE}`,
		body: { name: "novo", ram: 256 },
	},
	{
		name: "databases.start — no body",
		call: (c) => c.databases.start(FAKE),
		method: "POST",
		path: `/v1/databases/${FAKE}/start`,
		body: "none",
	},
	{
		name: "databases.stop — no body",
		call: (c) => c.databases.stop(FAKE),
		method: "POST",
		path: `/v1/databases/${FAKE}/stop`,
		body: "none",
	},
	{
		name: "apps.files.write — workspace_id merged into body, not query",
		call: (c) => c.apps.files.write(FAKE, { path: "/a.txt", content: "hi" }, { workspaceId: "ws-1" }),
		method: "PUT",
		path: `/v1/apps/${FAKE}/files`,
		body: { path: "/a.txt", content: "hi", workspace_id: "ws-1" },
	},
	{
		name: "apps.files.move — workspace_id merged into body",
		call: (c) => c.apps.files.move(FAKE, { path: "/a", to: "/b" }, { workspaceId: "ws-1" }),
		method: "PATCH",
		path: `/v1/apps/${FAKE}/files`,
		body: { path: "/a", to: "/b", workspace_id: "ws-1" },
	},
	{
		name: "apps.files.delete — workspace_id merged into body",
		call: (c) => c.apps.files.delete(FAKE, { path: "/a" }, { workspaceId: "ws-1" }),
		method: "DELETE",
		path: `/v1/apps/${FAKE}/files`,
		body: { path: "/a", workspace_id: "ws-1" },
	},
	{
		name: "apps.metrics — since is a supported cursor query param",
		call: (c) => c.apps.metrics(FAKE, { since: 1700000000 }),
		method: "GET",
		path: `/v1/apps/${FAKE}/metrics`,
		query: { since: "1700000000" },
	},
	{
		name: "apps.restart — reinstall_dependencies/force_build body",
		call: (c) => c.apps.restart(FAKE, { reinstall_dependencies: true, force_build: false }),
		method: "POST",
		path: `/v1/apps/${FAKE}/restart`,
		body: { reinstall_dependencies: true, force_build: false },
	},
	{
		name: "apps.envs.set — snake_case env fields",
		call: (c) => c.apps.envs.set(FAKE, { key: "K", value: "V", note: "n" }),
		method: "POST",
		path: `/v1/apps/${FAKE}/envs`,
		body: { key: "K", value: "V", note: "n" },
	},
	{
		name: "workspaces.members.update — role_id/expires_at",
		call: (c) => c.workspaces.members.update(FAKE, FAKE2, { role_id: "role-1", expires_at: null }),
		method: "PUT",
		path: `/v1/workspaces/${FAKE}/members/${FAKE2}`,
		body: { role_id: "role-1", expires_at: null },
	},
	{
		name: "billing.orders.create — snake_case order body",
		call: (c) => c.billing.orders.create({ plan: "pro", months: 1, type: "purchase" }),
		method: "POST",
		path: "/v1/orders",
		body: { plan: "pro", months: 1, type: "purchase" },
	},
	{
		name: "workspaces.folders.addResource — optional position in body",
		call: (c) => c.workspaces.folders.addResource(FAKE, FAKE2, "application", FAKE3, { position: 2 }),
		method: "PUT",
		path: `/v1/workspaces/${FAKE}/folders/${FAKE2}/resources/application/${FAKE3}`,
		body: { position: 2 },
	},
];

function parseBody(init: RequestInit): unknown {
	if (typeof init.body !== "string") return init.body;
	return JSON.parse(init.body);
}

describe("contract — body/query shape per route (not just method+path)", () => {
	for (const c of cases) {
		it(c.name, async () => {
			const calls: CapturedCall[] = [];
			const { client } = makeClient({ jsonBody: { response: {} } }, calls);
			await c.call(client);

			assert.equal(calls.length, 1, "expected exactly one HTTP call");
			const call = calls[0];
			assert.equal(call.init.method ?? "GET", c.method);
			assert.equal(call.url.pathname, c.path);

			if (c.query) {
				for (const [key, value] of Object.entries(c.query)) {
					assert.equal(call.url.searchParams.get(key), value, `query.${key}`);
				}
			}

			if (c.body === "none") {
				assert.equal(call.init.body, undefined, "expected no request body");
			} else if (c.body) {
				assert.deepEqual(parseBody(call.init), c.body);
			}

			if (c.multipartFields) {
				assert.ok(call.init.body instanceof FormData, "expected multipart/form-data body");
				const form = call.init.body as FormData;
				const fields = [...form.keys()].sort();
				assert.deepEqual(fields, [...c.multipartFields].sort());
			}
		});
	}
});

describe("contract — multipart field names", () => {
	it("apps.create — file/name required parts, envs JSON-stringified", async () => {
		const calls: CapturedCall[] = [];
		const { client } = makeClient({ jsonBody: { response: {} } }, calls);
		const blob = new Blob(["zip-bytes"]);
		await client.apps.create({ file: blob, name: "meu-app", memory: 256, envs: [{ key: "K", value: "V" }] });

		const form = calls[0]?.init.body as FormData;
		assert.ok(form instanceof FormData);
		assert.ok(form.has("file"));
		assert.equal(form.get("name"), "meu-app");
		assert.equal(form.get("memory"), "256");
		assert.equal(form.get("envs"), JSON.stringify([{ key: "K", value: "V" }]));
	});

	it("apps.files.upload — field name is exactly `file`, restart serialized as string", async () => {
		const calls: CapturedCall[] = [];
		const { client } = makeClient({ jsonBody: { response: {} } }, calls);
		const blob = new Blob(["content"]);
		await client.apps.files.upload(FAKE, blob, "a.txt", { restart: true });

		const call = calls[0];
		assert.equal(call.url.searchParams.get("restart"), "true");
		const form = call.init.body as FormData;
		assert.ok(form instanceof FormData);
		assert.deepEqual([...form.keys()], ["file"]);
	});
});

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { NotFoundError, VertraAPIError } from "../src/index.js";
import { type CapturedCall, makeClient } from "./helpers.js";

const body = (call: CapturedCall | undefined) => JSON.parse(String(call?.init.body));
const route = (call: CapturedCall | undefined) => `${call?.method} ${call?.url.pathname}`;

describe("stacks — wiring", () => {
	it("client.stacks exposes every method and sub-resource", () => {
		const { client } = makeClient();
		const s = client.stacks as unknown as Record<string, Record<string, unknown> | unknown>;
		for (const m of ["list", "get", "create", "transform", "update", "delete", "connection", "setNetworkMode", "addDatabase", "addDatabaseToApp", "addBlob"]) {
			assert.equal(typeof s[m], "function", m);
		}
		const groups: Record<string, string[]> = { members: ["add", "remove"], bindings: ["list", "create", "update", "delete"], snapshots: ["list", "create", "restore"] };
		for (const [group, methods] of Object.entries(groups)) {
			for (const m of methods) assert.equal(typeof (s[group] as Record<string, unknown>)[m], "function", `${group}.${m}`);
		}
	});
});

describe("stacks — routes", () => {
	it("list/get/update send the workspace as query", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: [] } });
		await client.stacks.list({ workspaceId: "ws-1" });
		await client.stacks.get("st-1", { workspaceId: "ws-1" });
		await client.stacks.update("st-1", { description: null }, { workspaceId: "ws-1" });
		assert.deepEqual(calls.map(route), ["GET /v1/stacks", "GET /v1/stacks/st-1", "PATCH /v1/stacks/st-1"]);
		for (const call of calls) assert.equal(call.url.searchParams.get("workspace_id"), "ws-1");
		assert.deepEqual(body(calls[2]), { description: null });
	});

	it("create puts workspace_id in the body and returns the restart notice", async () => {
		const change = { id: "st-1", restart_required: true, apps_to_restart: ["app-1"] };
		const { client, calls } = makeClient({ status: 201, jsonBody: { response: change } });
		const result = await client.stacks.create({ name: "shop", members: [{ resource_type: "application", resource_id: "app-1" }], workspace_id: "ws-1" });
		assert.deepEqual(result, change);
		assert.equal(calls[0]?.url.searchParams.has("workspace_id"), false);
		assert.equal(body(calls[0]).workspace_id, "ws-1");
	});

	it("delete sends mode, confirm_name and blob in the body", async () => {
		const result = { deleted_apps: ["a"], deleted_databases: [], deleted_blob: false };
		const { client, calls } = makeClient({ jsonBody: { response: result } });
		assert.deepEqual(await client.stacks.delete("st-1", { mode: "delete_all", confirm_name: "shop", blob: "keep" }), result);
		assert.equal(route(calls[0]), "DELETE /v1/stacks/st-1");
		assert.deepEqual(body(calls[0]), { mode: "delete_all", confirm_name: "shop", blob: "keep" });
	});

	it("STACK_NAME_MISMATCH keeps its code", async () => {
		const { client } = makeClient({ status: 400, jsonBody: { code: "STACK_NAME_MISMATCH" } });
		await assert.rejects(client.stacks.delete("st-1", { mode: "dissolve", confirm_name: "x" }), (e: unknown) => e instanceof VertraAPIError && e.code === "STACK_NAME_MISMATCH");
	});

	it("typed not-found for STACK_NOT_FOUND", async () => {
		const { client } = makeClient({ status: 404, jsonBody: { code: "STACK_NOT_FOUND" } });
		await assert.rejects(client.stacks.get("nope"), (e: unknown) => e instanceof NotFoundError && e.code === "STACK_NOT_FOUND");
	});

	it("connection sends app_id and language as query", async () => {
		const { client, calls } = makeClient();
		await client.stacks.connection("st-1", { app_id: "app-1", language: "python" }, { workspaceId: "ws-1" });
		const q = calls[0]?.url.searchParams;
		assert.equal(q?.get("app_id"), "app-1");
		assert.equal(q?.get("language"), "python");
		assert.equal(q?.get("workspace_id"), "ws-1");
	});

	it("setNetworkMode, addDatabase, addDatabaseToApp and addBlob", async () => {
		const { client, calls } = makeClient();
		await client.stacks.setNetworkMode("st-1", "public");
		await client.stacks.addDatabase("st-1", { type: "postgres", name: "db", ram: 256, bindings: [{ app_id: "app-1" }] });
		await client.stacks.addDatabaseToApp("app-1", { type: "redis", name: "cache", ram: 128, stack_name: "shop" });
		await client.stacks.addBlob("st-1");
		assert.deepEqual(calls.map(route), ["POST /v1/stacks/st-1/network-mode", "POST /v1/stacks/st-1/databases", "POST /v1/apps/app-1/stack/databases", "POST /v1/stacks/st-1/blob"]);
		assert.deepEqual(body(calls[0]), { network_mode: "public" });
		assert.equal(body(calls[2]).stack_name, "shop");
		assert.deepEqual(body(calls[3]), {});
	});

	it("members.remove puts the type and id in the path and the choices in the query", async () => {
		const { client, calls } = makeClient();
		await client.stacks.members.remove("st-1", "blob", "b-1", { bindings: "remove_variables", blob: "delete", workspaceId: "ws-1" });
		assert.equal(route(calls[0]), "DELETE /v1/stacks/st-1/members/blob/b-1");
		const q = calls[0]?.url.searchParams;
		assert.equal(q?.get("bindings"), "remove_variables");
		assert.equal(q?.get("blob"), "delete");
		assert.equal(q?.get("workspace_id"), "ws-1");
	});

	it("bindings: update wraps env_map, delete takes variables as query", async () => {
		const { client, calls } = makeClient();
		await client.stacks.bindings.update("st-1", "bd-1", { DATABASE_URL: "url" });
		await client.stacks.bindings.delete("st-1", "bd-1", { variables: "remove_variables" });
		assert.equal(route(calls[0]), "PATCH /v1/stacks/st-1/bindings/bd-1");
		assert.deepEqual(body(calls[0]), { env_map: { DATABASE_URL: "url" } });
		assert.equal(route(calls[1]), "DELETE /v1/stacks/st-1/bindings/bd-1");
		assert.equal(calls[1]?.url.searchParams.get("variables"), "remove_variables");
	});

	it("snapshots: restore sends the choice in the body, {} by default", async () => {
		const { client, calls } = makeClient();
		await client.stacks.snapshots.restore("st-1", "sn-1", { restore_image_version: true });
		await client.stacks.snapshots.restore("st-1", "sn-1");
		await client.stacks.snapshots.create("st-1");
		assert.deepEqual(body(calls[0]), { restore_image_version: true });
		assert.deepEqual(body(calls[1]), {});
		assert.equal(route(calls[1]), "POST /v1/stacks/st-1/snapshots/sn-1/restore");
		assert.equal(calls[2]?.init.body, undefined);
	});
});

describe("database resets — restart notice", () => {
	it("certificate.reset and password.reset return the restart_required fields", async () => {
		const notice = { restart_required: true, apps_to_restart: ["app-1"] };
		const a = makeClient({ jsonBody: { response: { ...notice, ca: "x" } } });
		const cert = await a.client.databases.credentials.certificate.reset("db-1");
		assert.deepEqual(cert.apps_to_restart, ["app-1"]);
		const b = makeClient({ jsonBody: { response: { ...notice, password: "p" } } });
		const pw = await b.client.databases.credentials.password.reset("db-1");
		assert.equal(pw.restart_required, true);
	});
});

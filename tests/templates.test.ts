import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { SseIdleTimeoutError, ValidationError, VertraAPIError, templateDetachConfirmation, templateManifestIssues, templateSecretFiles, templateUpdateBlockedDetails } from "../src/index.js";
import { type CapturedCall, makeClient } from "./helpers.js";

const header = (call: CapturedCall | undefined, name: string) => (call?.init.headers as Headers).get(name);
const body = (call: CapturedCall | undefined) => JSON.parse(String(call?.init.body));

describe("templates — wiring", () => {
	it("client.templates exposes every method and sub-resource", () => {
		const { client } = makeClient();
		const t = client.templates as unknown as Record<string, Record<string, unknown> | unknown>;
		for (const m of ["list", "get", "categories", "versions", "validate", "deploy", "create", "fromApp", "fromStack", "appDraft", "stackDraft", "update", "delete", "newVersion", "linkGitHub", "unlinkGitHub", "reportApp"]) {
			assert.equal(typeof t[m], "function", m);
		}
		const groups: Record<string, string[]> = {
			deploys: ["get", "events"],
			shareLinks: ["create", "list", "revoke"],
			share: ["preview", "deploy", "copy", "report"],
			updates: ["appInfo", "appUpdate", "appDetach", "stackInfo", "stackUpdate", "stackDetach"],
		};
		for (const [group, methods] of Object.entries(groups)) {
			for (const m of methods) assert.equal(typeof (t[group] as Record<string, unknown>)[m], "function", `${group}.${m}`);
		}
	});
});

describe("templates — catalog", () => {
	it("list sends the filters as query, booleans as strings, and returns the page unwrapped", async () => {
		const page = { data: [], total_count: 0, page: 2, limit: 10, total_pages: 0, has_next_page: false, has_previous_page: true };
		const { client, calls } = makeClient({ jsonBody: { response: page } });
		const result = await client.templates.list({ search: "n8n", category: "bots", origin: "private", fits: true, sort: "popular", page: 2, limit: 10 }, { workspaceId: "ws-1" });
		assert.deepEqual(result, page);
		const q = calls[0]?.url.searchParams;
		assert.equal(calls[0]?.url.pathname, "/v1/templates");
		assert.equal(q?.get("search"), "n8n");
		assert.equal(q?.get("category"), "bots");
		assert.equal(q?.get("origin"), "private");
		assert.equal(q?.get("fits"), "true");
		assert.equal(q?.get("sort"), "popular");
		assert.equal(q?.get("page"), "2");
		assert.equal(q?.get("limit"), "10");
		assert.equal(q?.get("workspace_id"), "ws-1");
	});

	it("get accepts the slug and encodes it as one path segment", async () => {
		const { client, calls } = makeClient();
		await client.templates.get("my slug/x", { workspaceId: "ws-1" });
		assert.equal(calls[0]?.url.pathname, "/v1/templates/my%20slug%2Fx");
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), "ws-1");
	});

	it("validate sends any JSON value as the manifest, even a non-object", async () => {
		const { client, calls } = makeClient();
		await client.templates.validate("not an object");
		assert.deepEqual(body(calls[0]), { manifest: "not an object" });
	});
});

describe("templates — deploy and idempotency", () => {
	it("sends the idempotency key only as the Idempotency-Key header, never in the body", async () => {
		const { client, calls } = makeClient({ status: 202, jsonBody: { response: { id: "job-1", status: "queued" } } });
		const job = await client.templates.deploy("n8n", { name: "my n8n", inputs: { admin_email: "me@example.com" }, services: { app: { ram: 512 } } }, { idempotencyKey: "key-1" });
		assert.equal(job.id, "job-1");
		assert.equal(calls[0]?.method, "POST");
		assert.equal(calls[0]?.url.pathname, "/v1/templates/n8n/deploy");
		assert.equal(header(calls[0], "Idempotency-Key"), "key-1");
		assert.equal(header(calls[0], "Content-Type"), "application/json");
		assert.deepEqual(body(calls[0]), { name: "my n8n", inputs: { admin_email: "me@example.com" }, services: { app: { ram: 512 } } });
		assert.equal(String(calls[0]?.init.body).includes("key-1"), false);
	});

	it("sends no Idempotency-Key header when none is given, and keeps the bearer token", async () => {
		const { client, calls } = makeClient();
		await client.templates.deploy("n8n", { name: "x" });
		assert.equal(header(calls[0], "Idempotency-Key"), null);
		assert.ok(header(calls[0], "Authorization")?.startsWith("Bearer "));
	});

	it("share.deploy takes the key as a header too", async () => {
		const { client, calls } = makeClient();
		await client.templates.share.deploy("vtpl_abc", { name: "x" }, { idempotencyKey: "k2" });
		assert.equal(calls[0]?.url.pathname, "/v1/share/templates/vtpl_abc/deploy");
		assert.equal(header(calls[0], "Idempotency-Key"), "k2");
		assert.deepEqual(body(calls[0]), { name: "x" });
	});

	it("IDEMPOTENCY_KEY_CONFLICT is a typed API error with its code", async () => {
		const { client } = makeClient({ status: 409, jsonBody: { code: "IDEMPOTENCY_KEY_CONFLICT" } });
		await assert.rejects(client.templates.deploy("n8n", { name: "x" }, { idempotencyKey: "k" }), (error: unknown) => {
			assert.ok(error instanceof VertraAPIError);
			assert.equal(error.code, "IDEMPOTENCY_KEY_CONFLICT");
			assert.equal(error.status, 409);
			return true;
		});
	});
});

describe("templates — deploy events stream", () => {
	const progress = (status: string) => `event: progress\ndata: ${JSON.stringify({ deploy_id: "job-1", status, current_step: null, steps: [], error: null })}\n\n`;

	it("yields progress events, skips heartbeats and stops at end", async () => {
		const sse = `${progress("queued")}event: heartbeat\ndata: {}\n\n${progress("running")}event: end\ndata: {"deploy_id":"job-1"}\n\n${progress("succeeded")}`;
		const { client, calls } = makeClient({ sseBody: sse });
		const seen: string[] = [];
		for await (const event of client.templates.deploys.events("job-1")) seen.push(event.status);
		assert.deepEqual(seen, ["queued", "running"]);
		assert.equal(calls[0]?.url.pathname, "/v1/template-deploys/job-1/events");
		assert.equal(header(calls[0], "Accept"), "text/event-stream");
	});

	it("ends cleanly when the connection closes without an end event", async () => {
		const { client } = makeClient({ sseBody: progress("running") });
		const seen = [];
		for await (const event of client.templates.deploys.events("job-1")) seen.push(event);
		assert.equal(seen.length, 1);
	});

	it("fails with an error that does not echo the payload when an event is not JSON", async () => {
		const { client } = makeClient({ sseBody: "event: progress\ndata: {oops secret-looking}\n\n" });
		await assert.rejects(
			(async () => {
				for await (const _ of client.templates.deploys.events("job-1")) {
					// drain
				}
			})(),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				assert.equal(error.message.includes("secret-looking"), false);
				return true;
			},
		);
	});

	it("an error status before the stream throws the typed API error", async () => {
		const { client } = makeClient({ status: 404, jsonBody: { code: "TEMPLATE_DEPLOY_NOT_FOUND" } });
		await assert.rejects(client.templates.deploys.events("nope").next(), (error: unknown) => error instanceof VertraAPIError && error.code === "TEMPLATE_DEPLOY_NOT_FOUND");
	});

	it("exposes the idle timeout error of the SSE parser", () => {
		assert.equal(typeof SseIdleTimeoutError, "function");
	});
});

describe("templates — private templates (multipart)", () => {
	it("create sends manifest and changelog as JSON text, workspace_id, and one zip part per service in a stable order", async () => {
		const { client, calls } = makeClient({ status: 201, jsonBody: { response: { id: "t-1" } } });
		const manifest = { id: "my-bot", version: "1.0.0" };
		await client.templates.create({ manifest, changelog: { "pt-br": "primeira" }, workspaceId: "ws-1", sources: { worker: new Blob(["w"]), api: new Blob(["a"]) } });
		const form = calls[0]?.init.body as FormData;
		assert.equal(calls[0]?.method, "POST");
		assert.equal(calls[0]?.url.pathname, "/v1/templates");
		assert.equal(form.get("manifest"), JSON.stringify(manifest));
		assert.equal(form.get("changelog"), JSON.stringify({ "pt-br": "primeira" }));
		assert.equal(form.get("workspace_id"), "ws-1");
		assert.deepEqual([...form.keys()], ["manifest", "changelog", "workspace_id", "sources[api]", "sources[worker]"]);
		assert.equal((form.get("sources[api]") as File).name, "api.zip");
		assert.equal(header(calls[0], "Content-Type"), null);
	});

	it("create accepts a manifest that is already JSON text and sends it untouched", async () => {
		const { client, calls } = makeClient();
		await client.templates.create({ manifest: '{"id":"x"}' });
		assert.equal((calls[0]?.init.body as FormData).get("manifest"), '{"id":"x"}');
		assert.deepEqual([...(calls[0]?.init.body as FormData).keys()], ["manifest"]);
	});

	it("newVersion posts to /versions with the same fields and no workspace_id field", async () => {
		const { client, calls } = makeClient();
		await client.templates.newVersion("t-1", { manifest: { version: "1.1.0" }, sources: { app: new Blob(["z"]) }, workspaceId: "ws-1" });
		const form = calls[0]?.init.body as FormData;
		assert.equal(calls[0]?.url.pathname, "/v1/templates/t-1/versions");
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), "ws-1");
		assert.equal(form.has("workspace_id"), false);
		assert.ok(form.has("sources[app]"));
	});

	it("fromApp and fromStack send JSON; drafts are GETs", async () => {
		const { client, calls } = makeClient();
		await client.templates.fromApp("app-1", { id: "s", name: { "pt-br": "n" }, description: { "pt-br": "d" }, category: "bots", member: { resource_id: "app-1", service_id: "app" } });
		await client.templates.fromStack("st-1", { id: "s", name: { "pt-br": "n" }, description: { "pt-br": "d" }, category: "bots", members: [] });
		await client.templates.appDraft("app-1");
		await client.templates.stackDraft("st-1");
		assert.deepEqual(
			calls.map((c) => `${c.method} ${c.url.pathname}`),
			["POST /v1/templates/from-app/app-1", "POST /v1/templates/from-stack/st-1", "GET /v1/templates/from-app/app-1/draft", "GET /v1/templates/from-stack/st-1/draft"],
		);
	});

	it("linkGitHub omits the branch when not given", async () => {
		const { client, calls } = makeClient();
		await client.templates.linkGitHub("t-1", { repository: "acme/tpl" });
		assert.deepEqual(body(calls[0]), { repository: "acme/tpl" });
	});

	it("share links: create defaults to an empty body, revoke hits the link", async () => {
		const { client, calls } = makeClient();
		await client.templates.shareLinks.create("t-1", { mode: "full_copy", max_uses: 3, expires_in_days: 7 });
		await client.templates.shareLinks.create("t-1");
		await client.templates.shareLinks.revoke("t-1", "l-1");
		assert.deepEqual(body(calls[0]), { mode: "full_copy", max_uses: 3, expires_in_days: 7 });
		assert.deepEqual(body(calls[1]), {});
		assert.equal(`${calls[2]?.method} ${calls[2]?.url.pathname}`, "DELETE /v1/templates/t-1/share-links/l-1");
	});

	it("the share token is encoded as one path segment", async () => {
		const { client, calls } = makeClient();
		await client.templates.share.preview("a/b");
		assert.equal(calls[0]?.url.pathname, "/v1/share/templates/a%2Fb");
	});

	it("updates: update body defaults to {} and detach sends no body", async () => {
		const { client, calls } = makeClient();
		await client.templates.updates.appUpdate("app-1", { inputs: { k: "v" }, ram: { app: 512 } });
		await client.templates.updates.stackUpdate("st-1");
		await client.templates.updates.appDetach("app-1");
		assert.deepEqual(body(calls[0]), { inputs: { k: "v" }, ram: { app: 512 } });
		assert.deepEqual(body(calls[1]), {});
		assert.equal(calls[2]?.init.body, undefined);
	});

	it("delete resolves with the null of { response: null } and hits DELETE", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: null } });
		assert.equal(await client.templates.delete("t-1"), null);
		assert.equal(`${calls[0]?.method} ${calls[0]?.url.pathname}`, "DELETE /v1/templates/t-1");
	});
});

describe("templates — error detail readers", () => {
	const fail = async (code: string, details: unknown, status = 400): Promise<unknown> => {
		const { client } = makeClient({ status, jsonBody: { code, details } });
		try {
			await client.templates.create({ manifest: {} });
		} catch (error) {
			return error;
		}
		return undefined;
	};

	it("templateManifestIssues reads details.issues, tolerates bad details and ignores other errors", async () => {
		const issues = [{ path: "services.app.ram.min", code: "ram_invalid", message: "x" }];
		const error = await fail("TEMPLATE_MANIFEST_INVALID", { issues });
		assert.ok(error instanceof ValidationError);
		assert.deepEqual(templateManifestIssues(error), issues);
		assert.deepEqual(templateManifestIssues(await fail("TEMPLATE_MANIFEST_INVALID", "text")), []);
		assert.deepEqual(templateManifestIssues(await fail("TEMPLATE_MANIFEST_INVALID", { issues: "no" })), []);
		assert.equal(templateManifestIssues(await fail("OTHER", { issues })), undefined);
		assert.equal(templateManifestIssues(new Error("x")), undefined);
		assert.equal(templateManifestIssues(undefined), undefined);
	});

	it("templateSecretFiles keeps only string paths", async () => {
		assert.deepEqual(templateSecretFiles(await fail("TEMPLATE_SECRET_IN_SOURCE", { files: [".env", 3, "a/key.pem"] })), [".env", "a/key.pem"]);
		assert.deepEqual(templateSecretFiles(await fail("TEMPLATE_SECRET_IN_SOURCE", null)), []);
		assert.equal(templateSecretFiles(await fail("TEMPLATE_MANIFEST_INVALID", { files: [] })), undefined);
	});

	it("templateUpdateBlockedDetails reads the reason", async () => {
		const error = await fail("TEMPLATE_UPDATE_BLOCKED", { reason: "ram", details: { needed: 512 } }, 409);
		assert.deepEqual(templateUpdateBlockedDetails(error), { reason: "ram", details: { needed: 512 } });
		assert.equal(templateUpdateBlockedDetails(await fail("TEMPLATE_UPDATE_BLOCKED", {}, 409)), undefined);
	});

	it("templateDetachConfirmation reads the action", async () => {
		assert.equal(templateDetachConfirmation(await fail("TEMPLATE_DETACH_CONFIRMATION_REQUIRED", { action: "files.write" }, 409)), "files.write");
		assert.equal(templateDetachConfirmation(await fail("TEMPLATE_DETACH_CONFIRMATION_REQUIRED", undefined, 409)), undefined);
		assert.equal(templateDetachConfirmation(await fail("TEMPLATE_NOT_FOUND", { action: "files.write" }, 404)), undefined);
	});
});

describe("confirm_detach on the routes that change code", () => {
	it("files.write, move and delete carry confirm_detach in the JSON body", async () => {
		const { client, calls } = makeClient();
		await client.apps.files.write("app-1", { path: "/a", content: "x", confirm_detach: true });
		await client.apps.files.move("app-1", { path: "/a", to: "/b", confirm_detach: true });
		await client.apps.files.delete("app-1", { path: "/a", confirm_detach: true });
		await client.apps.deploys.webhook.create("app-1", { owner: "o", repo_name: "r", repo_id: "1", account_id: "1", confirm_detach: true });
		for (const call of calls) assert.equal(body(call).confirm_detach, true);
	});

	it("files.upload sends confirm_detach as a query param only when asked", async () => {
		const { client, calls } = makeClient();
		await client.apps.files.upload("app-1", new Blob(["x"]), "a.txt", { confirmDetach: true });
		await client.apps.files.upload("app-1", new Blob(["x"]), "a.txt");
		await client.apps.files.upload("app-1", new Blob(["x"]), "a.txt", { confirmDetach: false });
		assert.equal(calls[0]?.url.searchParams.get("confirm_detach"), "true");
		assert.equal(calls[1]?.url.searchParams.has("confirm_detach"), false);
		assert.equal(calls[2]?.url.searchParams.has("confirm_detach"), false);
	});
});

describe("workspaces — move templates and stacks", () => {
	it("hits the right method and path", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: null } });
		await client.workspaces.templates.add("ws", "t-1");
		await client.workspaces.templates.remove("ws", "t-1");
		await client.workspaces.stacks.add("ws", "st-1");
		await client.workspaces.stacks.remove("ws", "st-1");
		assert.deepEqual(
			calls.map((c) => `${c.method} ${c.url.pathname}`),
			["POST /v1/workspaces/ws/templates/t-1", "DELETE /v1/workspaces/ws/templates/t-1", "POST /v1/workspaces/ws/stacks/st-1", "DELETE /v1/workspaces/ws/stacks/st-1"],
		);
	});
});

describe("path segments of the new resources", () => {
	it("reject dot segments before any request", async () => {
		const { client, calls } = makeClient();
		await assert.rejects(client.templates.get(".."), TypeError);
		await assert.rejects(client.templates.shareLinks.revoke("t", "%2e%2e"), TypeError);
		await assert.rejects(client.templates.share.preview(""), TypeError);
		await assert.rejects(client.templates.deploys.get(".."), TypeError);
		await assert.rejects(client.stacks.get(".."), TypeError);
		await assert.rejects(client.stacks.members.remove("st", "application", ".."), TypeError);
		await assert.rejects(client.workspaces.stacks.add("..", "st"), TypeError);
		assert.equal(calls.length, 0);
	});
});

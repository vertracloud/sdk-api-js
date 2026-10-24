import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DockerfileRefusedError, NotFoundError, ValidationError, VertraClient } from "../src/index.js";
import { type CapturedCall, FAKE_KEY, makeClient, makeMockFetch } from "./helpers.js";

const FAKE = "img-1";

describe("images — wiring", () => {
	it("client.images exposes every image method", () => {
		const { client } = makeClient();
		const methods = ["list", "get", "create", "update", "rebuild", "delete", "versions", "logs", "context", "linkGitHub", "unlinkGitHub", "check"];
		for (const method of methods) {
			assert.equal(typeof (client.images as unknown as Record<string, unknown>)[method], "function", method);
		}
	});

	it("apps.createFromImage is exposed next to apps.create", () => {
		const { client } = makeClient();
		assert.equal(typeof client.apps.createFromImage, "function");
	});
});

describe("images — envelope", () => {
	it("unwraps the { response } envelope of a single image", async () => {
		const image = { id: FAKE, name: "api", status: "building" };
		const { client } = makeClient({ status: 202, jsonBody: { response: image } });
		assert.deepEqual(await client.images.get(FAKE), image);
	});

	it("unwraps a list of versions", async () => {
		const versions = [{ id: "v-2", digest: "sha256:b", source: "commit", message: null, created_at: "2026-10-22T10:00:00Z", in_use: true }];
		const { client } = makeClient({ jsonBody: { response: versions } });
		assert.deepEqual(await client.images.versions(FAKE), versions);
	});

	it("sends the API key as a bearer token like every other resource", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: [] } });
		await client.images.list();
		assert.equal((calls[0]?.init.headers as Headers).get("Authorization"), `Bearer ${FAKE_KEY}`);
	});
});

describe("images — create file names", () => {
	it("names a plain Blob context.zip", async () => {
		const calls: CapturedCall[] = [];
		const { client } = makeClient({ jsonBody: { response: {} } }, calls);
		await client.images.create({ name: "api", file: new Blob(["zip"]) });
		const file = (calls[0]?.init.body as FormData).get("file") as File;
		assert.equal(file.name, "context.zip");
	});

	it("keeps the name of a File, so the name chosen by the caller is kept", async () => {
		const calls: CapturedCall[] = [];
		const { client } = makeClient({ jsonBody: { response: {} } }, calls);
		await client.images.create({ name: "api", file: new File(["zip"], "my-context.zip") });
		const file = (calls[0]?.init.body as FormData).get("file") as File;
		assert.equal(file.name, "my-context.zip");
	});

	it("rebuild names the file the same way", async () => {
		const calls: CapturedCall[] = [];
		const { client } = makeClient({ jsonBody: { response: {} } }, calls);
		await client.images.rebuild(FAKE, new File(["zip"], "new.zip"));
		const file = (calls[0]?.init.body as FormData).get("file") as File;
		assert.equal(file.name, "new.zip");
	});
});

describe("images — create workspace", () => {
	it("omits workspace_id when no workspace is given", async () => {
		const calls: CapturedCall[] = [];
		const { client } = makeClient({ jsonBody: { response: {} } }, calls);
		await client.images.create({ name: "api", github: { repository: "acme/api", branch: "main" } });
		assert.equal((calls[0]?.init.body as FormData).has("workspace_id"), false);
	});
});

describe("images — GitHub branch is optional", () => {
	it("create without a branch sends the repository and no github_branch", async () => {
		const calls: CapturedCall[] = [];
		const { client } = makeClient({ jsonBody: { response: {} } }, calls);
		await client.images.create({ name: "api", github: { repository: "acme/api" } });
		const form = calls[0]?.init.body as FormData;
		assert.equal(form.get("github_repository"), "acme/api");
		assert.equal(form.has("github_branch"), false);
	});

	it("linkGitHub without a branch sends only the repository", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: {} } });
		await client.images.linkGitHub(FAKE, { repository: "acme/api" });
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { repository: "acme/api" });
	});
});

describe("images — description and update", () => {
	it("create sends description in the form when given and omits it otherwise", async () => {
		const calls: CapturedCall[] = [];
		const { client } = makeClient({ jsonBody: { response: {} } }, calls);
		await client.images.create({ name: "api", description: "Node 22 base", github: { repository: "acme/api" } });
		await client.images.create({ name: "api", github: { repository: "acme/api" } });
		assert.equal((calls[0]?.init.body as FormData).get("description"), "Node 22 base");
		assert.equal((calls[1]?.init.body as FormData).has("description"), false);
	});

	it("update sends PATCH with name and description and returns the image", async () => {
		const image = { id: FAKE, name: "api-v2", description: "Node 22 base" };
		const { client, calls } = makeClient({ jsonBody: { response: image } });
		const result = await client.images.update(FAKE, { name: "api-v2", description: "Node 22 base" });
		assert.deepEqual(result, image);
		assert.equal(calls[0]?.init.method, "PATCH");
		assert.equal(calls[0]?.url.pathname, `/v1/images/${FAKE}`);
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { name: "api-v2", description: "Node 22 base" });
	});

	it("update sends the workspace in the query", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: {} } });
		await client.images.update(FAKE, { name: "x" }, { workspaceId: "ws-1" });
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), "ws-1");
	});

	it("a name already in use surfaces as ValidationError", async () => {
		const { client } = makeClient({ status: 400, jsonBody: { code: "VALIDATION_ERROR", details: { path: "name" } } });
		await assert.rejects(() => client.images.update(FAKE, { name: "taken" }), ValidationError);
	});
});

describe("images — delete", () => {
	it("sends the confirmation name and returns the deleted app ids", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { deleted_apps: ["app-1", "app-2"] } } });
		const result = await client.images.delete(FAKE, { confirmName: "api" });
		assert.deepEqual(result, { deleted_apps: ["app-1", "app-2"] });
		assert.equal(calls[0]?.init.method, "DELETE");
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { confirm_name: "api" });
	});
});

describe("images — logs stream", () => {
	it("yields only the lines of log events, in order", async () => {
		const sseBody = "event: log\ndata: Step 1/4\n\nevent: heartbeat\ndata: heartbeat\n\nevent: log\ndata: Step 2/4\n\n";
		const { client, calls } = makeClient({ headers: { "content-type": "text/event-stream" }, sseBody });
		const lines: string[] = [];
		for await (const line of client.images.logs(FAKE)) lines.push(line);

		assert.deepEqual(lines, ["Step 1/4", "Step 2/4"]);
		assert.equal(calls[0]?.url.pathname, `/v1/images/${FAKE}/logs`);
		assert.equal(calls[0]?.url.searchParams.has("version_id"), false);
		assert.equal((calls[0]?.init.headers as Headers).get("Accept"), "text/event-stream");
	});

	it("reads one version's log when versionId is given", async () => {
		const { client, calls } = makeClient({ headers: { "content-type": "text/event-stream" }, sseBody: "event: log\ndata: done\n\n" });
		const lines: string[] = [];
		for await (const line of client.images.logs(FAKE, { versionId: "v-1" })) lines.push(line);

		assert.deepEqual(lines, ["done"]);
		assert.equal(calls[0]?.url.searchParams.get("version_id"), "v-1");
	});

	it("an empty stream ends without yielding", async () => {
		const { client } = makeClient({ headers: { "content-type": "text/event-stream" }, sseBody: "" });
		const lines: string[] = [];
		for await (const line of client.images.logs(FAKE)) lines.push(line);
		assert.deepEqual(lines, []);
	});

	it("a failed request throws before any line is yielded", async () => {
		const { client } = makeClient({ status: 404, jsonBody: { code: "IMAGE_NOT_FOUND" } });
		await assert.rejects(async () => {
			for await (const _line of client.images.logs(FAKE)) {
				// never reached
			}
		}, NotFoundError);
	});
});

describe("images — errors", () => {
	it("maps IMAGE_NOT_FOUND to NotFoundError with its code", async () => {
		const { client } = makeClient({ status: 404, jsonBody: { code: "IMAGE_NOT_FOUND", message: "Image not found" } });
		await assert.rejects(client.images.get(FAKE), (error: unknown) => error instanceof NotFoundError && error.code === "IMAGE_NOT_FOUND");
	});
});

describe("apps.createFromImage", () => {
	it("posts the JSON body to /v1/apps/image and returns the app", async () => {
		const body = { image_id: FAKE, name: "api", memory: 512, web: false };
		const { client, calls } = makeClient({ status: 202, jsonBody: { response: { id: "app-9", status: "building" } } });
		const app = await client.apps.createFromImage(body);

		assert.deepEqual(app, { id: "app-9", status: "building" });
		assert.equal(calls[0]?.init.method, "POST");
		assert.equal(calls[0]?.url.pathname, "/v1/apps/image");
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), body);
	});
});

describe("images — transport", () => {
	it("honours a custom fetch and base URL", async () => {
		const calls: CapturedCall[] = [];
		const client = new VertraClient({ apiKey: FAKE_KEY, baseUrl: "https://example.test", fetch: makeMockFetch(calls, { jsonBody: { response: [] } }) as typeof fetch });
		await client.images.list();
		assert.equal(calls[0]?.url.origin, "https://example.test");
	});
});

describe("images — workspace_id query on the image routes", () => {
	const WS = "ws-42";

	it("list sends ?workspace_id=", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: [] } });
		await client.images.list({ workspaceId: WS });
		assert.equal(calls[0]?.url.pathname, "/v1/images");
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), WS);
	});

	it("get sends ?workspace_id=", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: {} } });
		await client.images.get(FAKE, { workspaceId: WS });
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), WS);
	});

	it("rebuild sends ?workspace_id= in the query and the file only in the multipart body", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: {} } });
		await client.images.rebuild(FAKE, new Blob(["zip"]), { workspaceId: WS });
		assert.equal(calls[0]?.init.method, "PUT");
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), WS);
		assert.equal((calls[0]?.init.body as FormData).has("workspace_id"), false);
	});

	it("publish sends port in the body only when it is given", async () => {
		const pub = { subdomain: null, domains: [], type: 1 };
		const { client, calls } = makeClient({ jsonBody: { response: pub } });
		await client.apps.network.publish(FAKE, { subdomain: "random", port: 8080 });
		await client.apps.network.publish(FAKE);
		assert.equal(calls[0]?.url.pathname, `/v1/apps/${FAKE}/network/publish`);
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { subdomain: "random", port: 8080 });
		assert.deepEqual(JSON.parse(String(calls[1]?.init.body)), {});
	});

	it("delete sends ?workspace_id= and keeps confirm_name as the only body field", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { deleted_apps: [] } } });
		await client.images.delete(FAKE, { confirmName: "api", workspaceId: WS });
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), WS);
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { confirm_name: "api" });
	});

	it("versions sends ?workspace_id=", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: [] } });
		await client.images.versions(FAKE, { workspaceId: WS });
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), WS);
	});

	it("logs sends ?workspace_id= next to version_id", async () => {
		const { client, calls } = makeClient({ headers: { "content-type": "text/event-stream" }, sseBody: "" });
		for await (const _line of client.images.logs(FAKE, { versionId: "v-1", workspaceId: WS })) {
			// no lines
		}
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), WS);
		assert.equal(calls[0]?.url.searchParams.get("version_id"), "v-1");
	});

	it("context sends ?workspace_id=", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { url: "https://x" } } });
		await client.images.context(FAKE, { workspaceId: WS });
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), WS);
	});

	it("linkGitHub sends ?workspace_id= and the repository and branch in the body", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: {} } });
		await client.images.linkGitHub(FAKE, { repository: "acme/api", branch: "main" }, { workspaceId: WS });
		assert.equal(calls[0]?.init.method, "PUT");
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), WS);
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { repository: "acme/api", branch: "main" });
	});

	it("unlinkGitHub sends ?workspace_id=", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: {} } });
		await client.images.unlinkGitHub(FAKE, { workspaceId: WS });
		assert.equal(calls[0]?.init.method, "DELETE");
		assert.equal(calls[0]?.url.searchParams.get("workspace_id"), WS);
	});

	it("omits workspace_id from the query when no workspace is given", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: [] } });
		await client.images.list();
		assert.equal(calls[0]?.url.search, "");
	});

	it("check takes no workspace and never sends one", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { refusals: [], warnings: [], suggested_port: 80 } } });
		await client.images.check({ dockerfile: "FROM alpine", files: ["Dockerfile"] });
		assert.equal(calls[0]?.url.search, "");
	});
});

describe("apps.files.upload — image build fields", () => {
	it("returns image_build and message from a commit to an app on a custom image", async () => {
		const payload = { app_id: "app-1", updated_at: "2026-10-23T10:00:00Z", removed_directories: [], image_build: { image_id: FAKE, build_id: "b-1" }, message: "image is rebuilding" };
		const { client } = makeClient({ jsonBody: { response: payload } });
		const result = await client.apps.files.upload("app-1", new Blob(["x"]), "a.zip");
		assert.equal(result.image_build?.build_id, "b-1");
		assert.equal(result.message, "image is rebuilding");
	});

	it("regular apps get no image_build", async () => {
		const { client } = makeClient({ jsonBody: { response: { app_id: "app-1", updated_at: "2026-10-23T10:00:00Z", removed_directories: [] } } });
		const result = await client.apps.files.upload("app-1", new Blob(["x"]), "a.zip");
		assert.equal(result.image_build, undefined);
	});
});

describe("DOCKERFILE_REFUSED — issues on the error", () => {
	it("exposes details.issues as DockerfileRefusedError and it is still a ValidationError", async () => {
		const issues = [
			{ code: "run_network_host", line: 4 },
			{ code: "mount_ssh", line: null },
		];
		const { client } = makeClient({ status: 400, jsonBody: { code: "DOCKERFILE_REFUSED", message: "refused", details: { issues } } });
		await assert.rejects(client.images.create({ name: "api", file: new Blob(["zip"]) }), (error: unknown) => {
			assert.ok(error instanceof DockerfileRefusedError);
			assert.ok(error instanceof ValidationError);
			assert.equal(error.code, "DOCKERFILE_REFUSED");
			assert.deepEqual(error.issues, issues);
			return true;
		});
	});

	it("is tolerant: missing or malformed details give an empty list, unknown codes are kept", async () => {
		const cases: unknown[] = [undefined, null, "text", { issues: "nope" }, { issues: [null, 3, { line: 2 }] }];
		for (const details of cases) {
			const { client } = makeClient({ status: 400, jsonBody: { code: "DOCKERFILE_REFUSED", details } });
			await assert.rejects(client.images.check({ dockerfile: "x", files: [] }), (error: unknown) => {
				assert.ok(error instanceof DockerfileRefusedError);
				assert.deepEqual(error.issues, []);
				return true;
			});
		}
		const { client } = makeClient({ status: 400, jsonBody: { code: "DOCKERFILE_REFUSED", details: { issues: [{ code: "future_code", line: 1 }] } } });
		await assert.rejects(client.images.check({ dockerfile: "x", files: [] }), (error: unknown) => {
			assert.ok(error instanceof DockerfileRefusedError);
			assert.deepEqual(error.issues, [{ code: "future_code", line: 1 }]);
			return true;
		});
	});

	it("other 400 errors stay plain ValidationError", async () => {
		const { client } = makeClient({ status: 400, jsonBody: { code: "IMAGE_NAME_MISMATCH" } });
		await assert.rejects(client.images.delete(FAKE, { confirmName: "x" }), (error: unknown) => error instanceof ValidationError && !(error instanceof DockerfileRefusedError));
	});
});

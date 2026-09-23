import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_KEY_SCOPES } from "@vertracloud/api-types/v1";
import { describe, it } from "vitest";
import { VertraClient } from "../src/index.js";
import { FAKE_KEY, makeMockFetch } from "./helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface RouteEntry {
	method: string;
	path: string;
}

const matrix: RouteEntry[] = JSON.parse(fs.readFileSync(path.join(__dirname, "routes.matrix.json"), "utf8"));

// Every path param, whatever its name, gets this single fake value. Comparing captured concrete
// paths against the fixture's `:placeholder` paths (with placeholders replaced by this same
// value) means every method must hit exactly the path the matrix declares — no more, no less.
const FAKE = "fake-id";
const FAKE2 = "fake-id-2";
const FAKE3 = "fake-id-3";

function expectedPath(template: string): string {
	const params = template.match(/:[a-zA-Z_]+/g) ?? [];
	let out = template;
	const values = [FAKE, FAKE2, FAKE3];
	params.forEach((param, index) => {
		out = out.replace(param, values[index] ?? FAKE);
	});
	return out;
}

const expectedRoutes = new Set(matrix.map((r) => `${r.method} ${expectedPath(r.path)}`));
assert.equal(expectedRoutes.size, 99, "fixture must have exactly 99 unique routes");

// The fixture must be exactly the public API key catalog — a route added to or dropped from the
// catalog fails here until the SDK follows.
const catalogRoutes = new Set(Object.values(API_KEY_SCOPES).flatMap((scope) => scope.routes.map((r) => `${r.method} ${r.path}`)));
assert.deepEqual(new Set(matrix.map((r) => `${r.method} ${r.path}`)), catalogRoutes, "fixture must match API_KEY_SCOPES");

describe("routes matrix — every SDK method maps to exactly one of the 99 frozen routes", () => {
	it("(a)+(b): calling every resource method hits exactly the 99 expected method+path pairs, nothing else", async () => {
		const captured: { method: string; path: string }[] = [];
		const fetchImpl = makeMockFetch([], { jsonBody: { response: {} } });
		const client = new VertraClient({
			apiKey: FAKE_KEY,
			fetch: (async (input: string | URL, init: RequestInit = {}) => {
				const url = new URL(String(input));
				captured.push({ method: init.method ?? "GET", path: url.pathname });
				return fetchImpl(input, init);
			}) as typeof fetch,
		});

		const blob = new Blob(["x"]);
		const noop = () => undefined;

		await client.apps.get(FAKE);
		await client.apps.status(FAKE);
		await client.apps.statusAll();
		await client.apps.runtimes();
		await client.apps.realtime(FAKE).next();
		await client.apps.metrics(FAKE);
		await client.apps.logs(FAKE);
		await client.apps.download(FAKE);
		await client.apps.create({ file: blob, name: "n", memory: 1, main: "m", version: "v" });
		await client.apps.start(FAKE);
		await client.apps.stop(FAKE);
		await client.apps.restart(FAKE);
		await client.apps.updateConfig(FAKE, {});
		await client.apps.delete(FAKE);
		await client.apps.deploys.list(FAKE);
		await client.apps.deploys.webhook.get(FAKE);
		await client.apps.deploys.webhook.create(FAKE, { owner: "o", repo_name: "r", repo_id: "1", account_id: "1" });
		await client.apps.deploys.webhook.delete(FAKE);
		await client.apps.network.customDomain.get(FAKE);
		await client.apps.network.customDomain.set(FAKE, "example.com");
		await client.apps.network.customDomain.remove(FAKE);
		await client.apps.network.dns(FAKE);
		await client.apps.network.purgeCache(FAKE);
		await client.apps.network.setSubdomain(FAKE, "sub");
		await client.apps.network.publish(FAKE);
		await client.apps.network.unpublish(FAKE);
		await client.apps.envs.list(FAKE);
		await client.apps.envs.set(FAKE, { key: "K", value: "V" });
		await client.apps.envs.delete(FAKE, FAKE2);
		await client.apps.files.list(FAKE);
		await client.apps.files.tree(FAKE);
		await client.apps.files.read(FAKE, { path: "/a" });
		await client.apps.files.write(FAKE, { path: "/a" });
		await client.apps.files.move(FAKE, { path: "/a", to: "/b" });
		await client.apps.files.delete(FAKE, { path: "/a" });
		await client.apps.files.upload(FAKE, blob, "a.txt");

		await client.databases.statusAll();
		await client.databases.get(FAKE);
		await client.databases.status(FAKE);
		await client.databases.metrics(FAKE);
		await client.databases.create({ name: "n", ram: 1 });
		await client.databases.update(FAKE, {});
		await client.databases.start(FAKE);
		await client.databases.stop(FAKE);
		await client.databases.reset(FAKE);
		await client.databases.delete(FAKE);
		await client.databases.credentials.certificate.get(FAKE);
		await client.databases.credentials.certificate.reset(FAKE);
		await client.databases.credentials.password.reset(FAKE);

		await client.snapshots.listAll({ scope: "applications" });
		await client.snapshots.list(FAKE, { scope: "applications" });
		await client.snapshots.download(FAKE, FAKE2, { scope: "applications" });
		await client.snapshots.create(FAKE, { scope: "applications" });
		await client.snapshots.restore(FAKE, FAKE2, { scope: "applications" });

		await client.account.get();
		await client.account.update({});
		await client.account.sessions.list();
		await client.account.folders.create({ name: "f" });
		await client.account.folders.update(FAKE, {});
		await client.account.folders.delete(FAKE);
		await client.account.folders.addResource(FAKE, FAKE2, FAKE3);
		await client.account.folders.removeResource(FAKE, FAKE2, FAKE3);
		await client.account.favorites.add(FAKE, FAKE2);
		await client.account.favorites.remove(FAKE, FAKE2);

		await client.workspaces.list();
		await client.workspaces.get(FAKE);
		await client.workspaces.create({ name: "w" });
		await client.workspaces.update(FAKE, { name: "w" });
		await client.workspaces.delete(FAKE);
		await client.workspaces.invites.list(FAKE);
		await client.workspaces.invites.revoke(FAKE, FAKE2);
		await client.workspaces.invites.preview(FAKE);
		await client.workspaces.invites.accept(FAKE);
		await client.workspaces.invites.decline(FAKE);
		await client.workspaces.actionRequests.list(FAKE, { status: "pending" });
		await client.workspaces.actionRequests.create(FAKE, { action: "app_delete", resource_id: FAKE2 });
		await client.workspaces.members.list(FAKE);
		await client.workspaces.members.update(FAKE, FAKE2, {});
		await client.workspaces.members.remove(FAKE, FAKE2);
		await client.workspaces.roles.list(FAKE);
		await client.workspaces.roles.create(FAKE, { name: "r", permissions: [] });
		await client.workspaces.roles.update(FAKE, FAKE2, { name: "r", permissions: [] });
		await client.workspaces.roles.delete(FAKE, FAKE2);
		await client.workspaces.apps.add(FAKE, FAKE2);
		await client.workspaces.apps.remove(FAKE, FAKE2);
		await client.workspaces.databases.add(FAKE, FAKE2);
		await client.workspaces.databases.remove(FAKE, FAKE2);
		await client.workspaces.folders.create(FAKE, { name: "f" });
		await client.workspaces.folders.update(FAKE, FAKE2, {});
		await client.workspaces.folders.delete(FAKE, FAKE2);
		await client.workspaces.folders.addResource(FAKE, FAKE2, FAKE3, FAKE);
		await client.workspaces.folders.removeResource(FAKE, FAKE2, FAKE3, FAKE);
		await client.workspaces.favorites.add(FAKE, FAKE2, FAKE3);
		await client.workspaces.favorites.remove(FAKE, FAKE2, FAKE3);

		await client.billing.orders.list();
		await client.billing.orders.status(FAKE);
		await client.billing.orders.create({});
		await client.billing.orders.initiatePix(FAKE);
		await client.billing.redeem(FAKE);

		noop();

		const capturedSet = new Set(captured.map((c) => `${c.method} ${c.path}`));

		// (a) every route in the fixture was hit
		for (const route of expectedRoutes) {
			assert.ok(capturedSet.has(route), `missing call for ${route}`);
		}
		// (b) nothing outside the fixture was hit
		for (const call of capturedSet) {
			assert.ok(expectedRoutes.has(call), `unexpected call outside the 99-route matrix: ${call}`);
		}
		assert.equal(capturedSet.size, 99);
	});
});

describe("routes matrix — (c) forbidden paths never appear in src/", () => {
	it("no forbidden route string appears anywhere under src/", () => {
		const srcDir = path.join(__dirname, "..", "src");
		const files = walk(srcDir);
		const bannedSubstrings = ["/v1/notifications", "/v1/users/me/api-keys", "/v1/databases/:id/data", "databases/${encodePathSegment(id)}/data", "/v1/admin", "/internal", "/v1/apps/scan", "/v1/users/me/downgrade", "/transfer-ownership", "/approve", "/reject", "/v1/activities", "/activities/export"];

		for (const file of files) {
			const content = fs.readFileSync(file, "utf8");
			for (const banned of bannedSubstrings) {
				assert.equal(content.includes(banned), false, `forbidden string "${banned}" found in ${file}`);
			}
		}
	});
});

function walk(dir: string): string[] {
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	let files: string[] = [];
	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) files = files.concat(walk(full));
		else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
	}
	return files;
}

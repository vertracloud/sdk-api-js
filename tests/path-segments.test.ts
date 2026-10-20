import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { encodePathSegment } from "../src/index.js";
import { makeClient } from "./helpers.js";

const INVALID = ["", ".", "..", "%2e%2e", "%2E.", ".%2e", "%2e", "%252e%252e"];

describe("path segments — dot-segments and empty ids never reach the transport", () => {
	for (const bad of INVALID) {
		it(`encodePathSegment rejects ${JSON.stringify(bad)}`, () => {
			assert.throws(() => encodePathSegment(bad), TypeError);
		});
	}

	it("keeps encoding every other character", () => {
		assert.equal(encodePathSegment("a b/c"), "a%20b%2Fc");
		assert.equal(encodePathSegment("..a"), "..a");
		assert.equal(encodePathSegment("a.b"), "a.b");
		assert.equal(encodePathSegment(42), "42");
		assert.equal(encodePathSegment("%zz"), "%25zz");
	});

	it("apps.domains.remove('abc', '..') does not send DELETE /v1/apps/abc", async () => {
		const { client, calls } = makeClient();
		await assert.rejects(() => client.apps.domains.remove("abc", ".."), TypeError);
		assert.equal(calls.length, 0);
	});

	it("rejects the promise instead of throwing synchronously, with the same message", async () => {
		const { client } = makeClient();
		let pending: Promise<unknown> | undefined;
		assert.doesNotThrow(() => {
			pending = client.apps.get("..");
		});
		await assert.rejects(() => pending as Promise<unknown>, { name: "TypeError", message: 'Invalid path segment: ".."' });
	});

	const cases: [string, (c: ReturnType<typeof makeClient>["client"]) => unknown][] = [
		["apps.domains.dns", (c) => c.apps.domains.dns("abc", "..")],
		["apps.domains.update", (c) => c.apps.domains.update("abc", ".", {})],
		["apps.domains.remove (empty)", (c) => c.apps.domains.remove("abc", "")],
		["apps.domains.remove (encoded)", (c) => c.apps.domains.remove("abc", "%2e%2e")],
		["apps.domains.connect", (c) => c.apps.domains.connect("abc", "%2E.")],
		["apps.get", (c) => c.apps.get("..")],
		["apps.delete", (c) => c.apps.delete("..")],
		["apps.envs.delete", (c) => c.apps.envs.delete("abc", "..")],
		["apps.releases.log", (c) => c.apps.releases.log("abc", "")],
		["databases.get", (c) => c.databases.get("..")],
		["databases.delete", (c) => c.databases.delete(".")],
		["workspaces.delete", (c) => c.workspaces.delete("..")],
		["workspaces.members.remove", (c) => c.workspaces.members.remove("ws", "..")],
		["workspaces.apps.remove", (c) => c.workspaces.apps.remove("..", "abc")],
		["account.folders.delete", (c) => c.account.folders.delete("..")],
		["billing.orders.status", (c) => c.billing.orders.status("..")],
	];

	for (const [name, call] of cases) {
		it(`${name} fails before any request`, async () => {
			const { client, calls } = makeClient();
			let pending: unknown;
			assert.doesNotThrow(() => {
				pending = call(client);
			});
			await assert.rejects(() => pending as Promise<unknown>, TypeError);
			assert.equal(calls.length, 0);
		});
	}
});

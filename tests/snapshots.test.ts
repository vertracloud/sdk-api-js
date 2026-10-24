import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { makeClient } from "./helpers.js";

const APP = "app-1";
const SNAP = "snap-1";

describe("snapshots.restore — restore_image_version", () => {
	it("sends restore_image_version: true in the JSON body when asked", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { message: "ok" } } });
		await client.snapshots.restore(APP, SNAP, { scope: "applications", restoreImageVersion: true });

		assert.equal(calls[0]?.init.method, "POST");
		assert.equal(calls[0]?.url.pathname, `/v1/users/${APP}/snapshots/${SNAP}/restore`);
		assert.equal(calls[0]?.url.searchParams.get("scope"), "applications");
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { restore_image_version: true });
	});

	it("sends restore_image_version: false when explicitly false", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { message: "ok" } } });
		await client.snapshots.restore(APP, SNAP, { scope: "applications", restoreImageVersion: false });
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { restore_image_version: false });
	});

	it("sends no body when the option is not given (the API default is data only)", async () => {
		const { client, calls } = makeClient({ jsonBody: { response: { message: "ok" } } });
		await client.snapshots.restore(APP, SNAP, { scope: "applications" });
		assert.equal(calls[0]?.init.body, undefined);
	});

	it("returns the warning when the image version no longer exists", async () => {
		const response = { message: "Data restored", warning: "IMAGE_VERSION_NOT_FOUND" };
		const { client } = makeClient({ jsonBody: { response } });
		const result = await client.snapshots.restore(APP, SNAP, { scope: "applications", restoreImageVersion: true });
		assert.deepEqual(result, response);
		assert.equal(result.warning, "IMAGE_VERSION_NOT_FOUND");
	});
});

import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { VertraClient } from "../src/index.js";

// Real network smoke test. Only runs when VERTRA_API_KEY is set in the environment — it never
// runs in CI or in this task's validation. It intentionally doesn't assert success/failure of the
// live call; it just proves the client can be constructed and make one real request without
// throwing at the wiring level (auth header, URL, JSON parsing).
describe.skipIf(!process.env.VERTRA_API_KEY)("smoke (real network — only with VERTRA_API_KEY set)", () => {
	it("fetches the authenticated account", async () => {
		const client = new VertraClient({ apiKey: process.env.VERTRA_API_KEY as string });
		const me = await client.account.get();
		assert.ok(me);
	});
});

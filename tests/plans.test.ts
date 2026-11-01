import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { APIOrderQuote, APIPlansCatalog, PlanName } from "../src/index.js";
import { PlansResource } from "../src/index.js";
import { type CapturedCall, makeClient } from "./helpers.js";

const header = (call: CapturedCall | undefined, name: string) => (call?.init.headers as Headers).get(name);

describe("plans", () => {
	it("client.plans is a PlansResource", () => {
		const { client } = makeClient();
		assert.ok(client.plans instanceof PlansResource);
		assert.equal(typeof client.plans.list, "function");
		assert.equal(typeof client.billing.orders.quote, "function");
	});

	it("list hits GET /v1/plans without the Authorization header and unwraps the envelope", async () => {
		const catalog: APIPlansCatalog = {
			cycles: [
				{ months: 1, discount_percent: 0 },
				{ months: 6, discount_percent: 15 },
			],
			plans: [],
		};
		const { client, calls } = makeClient({ jsonBody: { response: catalog } });
		const result = await client.plans.list();
		assert.deepEqual(result, catalog);
		assert.equal(calls[0]?.method, "GET");
		assert.equal(calls[0]?.url.pathname, "/v1/plans");
		assert.equal(header(calls[0], "authorization"), null);
		assert.ok(header(calls[0], "user-agent")?.startsWith("vertracloud-sdk-js/"));
		assert.equal(calls[0]?.init.body, undefined);
	});

	it("other routes still send the Authorization header", async () => {
		const { client, calls } = makeClient();
		await client.account.get();
		assert.ok(header(calls[0], "authorization")?.startsWith("Bearer "));
	});

	it("current plan names are accepted by the types", () => {
		const names: PlanName[] = ["starter-1", "starter-2", "pro-4", "business-24", "enterprise-512"];
		assert.equal(names.length, 5);
	});
});

describe("billing.orders.quote", () => {
	it("posts plan, months and coupon to /v1/orders/quote and returns the quote", async () => {
		const quote: APIOrderQuote = {
			plan: "starter-1",
			months: 6,
			list_price: 100,
			period_discount_percent: 15,
			coupon: null,
			total: 85,
			legacy_price: false,
			legacy_price_until: null,
			payment_methods: ["pix", "card"],
		};
		const { client, calls } = makeClient({ jsonBody: { response: quote } });
		const result = await client.billing.orders.quote({ plan: "starter-1", months: 6, coupon: "V3-X" });
		assert.deepEqual(result, quote);
		assert.equal(calls[0]?.method, "POST");
		assert.equal(calls[0]?.url.pathname, "/v1/orders/quote");
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { plan: "starter-1", months: 6, coupon: "V3-X" });
		assert.ok(header(calls[0], "authorization")?.startsWith("Bearer "));
		assert.equal(header(calls[0], "content-type"), "application/json");
	});

	it("omits coupon when not given", async () => {
		const { client, calls } = makeClient();
		await client.billing.orders.quote({ plan: "pro-4", months: 12 });
		assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), { plan: "pro-4", months: 12 });
	});
});

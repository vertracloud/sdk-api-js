import type { VertraClient } from "../client.js";
import type { APIPlansCatalog } from "../types.js";

type Opts = { signal?: AbortSignal; timeoutMs?: number };

/**
 * `plans.*` — the plan catalog. Public route: requests go out without the API key.
 * @see https://docs.vertracloud.app/api-reference
 */
export class PlansResource {
	constructor(private readonly client: VertraClient) {}

	/**
	 * `GET /v1/plans` — no authentication. The plans currently for sale (`grid`), the billing periods with their
	 * discounts (`cycles`: 1, 3, 6 or 12 months) and, per plan, price, memory, vCPU, limits and features.
	 */
	list(options?: Opts): Promise<APIPlansCatalog> {
		return this.client.request({ method: "GET", path: "/v1/plans", auth: false, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}
}

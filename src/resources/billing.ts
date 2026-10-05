import type { VertraClient } from "../client.js";
import { encodePathSegment } from "../client.js";
import type { APIBillingDetails, APIOrderCreateResponse, APIOrderListItem, APIOrderPixPayment, APIOrderStatus, APIRedeemResponse, OrderProvider, RESTPostAPIOrderCreateBody, RESTPutAPIBillingDetailsBody } from "../types.js";

type Opts = { signal?: AbortSignal; timeoutMs?: number };

/**
 * `billing.*` — one method per route under the `billing:*`/`redeem:*` scopes.
 * @see https://docs.vertracloud.app/api-reference
 */
export class BillingResource {
	constructor(private readonly client: VertraClient) {}

	readonly orders = {
		/** `GET /v1/orders` — scope `billing:read`. `provider` filters by payment method (`pix`, `card` or `redeem_code`). */
		list: (query?: { provider?: OrderProvider }, options?: Opts): Promise<APIOrderListItem[]> => this.client.request({ method: "GET", path: "/v1/orders", query, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/orders/:orderId/status` — scope `billing:read`. */
		status: (orderId: string, options?: Opts): Promise<APIOrderStatus> => this.client.request({ method: "GET", path: `/v1/orders/${encodePathSegment(orderId)}/status`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/orders` — scope `billing:write`. */
		create: (body: RESTPostAPIOrderCreateBody, options?: Opts): Promise<APIOrderCreateResponse> => this.client.request({ method: "POST", path: "/v1/orders", body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/orders/:orderId/initiate/pix` — scope `billing:write`. */
		initiatePix: (orderId: string, options?: Opts): Promise<APIOrderPixPayment> => this.client.request({ method: "POST", path: `/v1/orders/${encodePathSegment(orderId)}/initiate/pix`, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	/** `GET /v1/users/me/billing` — scope `billing:read`. `null` until details are saved. */
	details(options?: Opts): Promise<APIBillingDetails | null> {
		return this.client.request({ method: "GET", path: "/v1/users/me/billing", signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `PUT /v1/users/me/billing` — scope `billing:write`. Replaces the details; needed (complete) before `orders.create`. */
	updateDetails(body: RESTPutAPIBillingDetailsBody, options?: Opts): Promise<APIBillingDetails> {
		return this.client.request({ method: "PUT", path: "/v1/users/me/billing", body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/redeem/:code` — scope `redeem:write`. */
	redeem(code: string, options?: Opts): Promise<APIRedeemResponse> {
		return this.client.request({ method: "POST", path: `/v1/redeem/${encodePathSegment(code)}`, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}
}

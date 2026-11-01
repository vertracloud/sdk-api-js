import type { VertraClient } from "../client.js";
import { deferredPathSegment } from "../client.js";
import type { APIBillingDetails, APIOrderCreateResponse, APIOrderListItem, APIOrderPixPayment, APIOrderQuote, APIOrderStatus, APIRedeemResponse, OrderProvider, RESTPostAPIOrderCreateBody, RESTPostAPIOrderQuoteBody, RESTPutAPIBillingDetailsBody } from "../types.js";

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
		status: (orderId: string, options?: Opts): Promise<APIOrderStatus> => this.client.request({ method: "GET", path: `/v1/orders/${deferredPathSegment(orderId)}/status`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/orders` — scope `billing:write`. */
		create: (body: RESTPostAPIOrderCreateBody, options?: Opts): Promise<APIOrderCreateResponse> => this.client.request({ method: "POST", path: "/v1/orders", body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `POST /v1/orders/quote` — scope `billing:read`. Prices a plan and period (`months`: 1, 3, 6 or 12),
		 * with an optional coupon, without creating an order or using the coupon. `total` is what `orders.create` would charge.
		 */
		quote: (body: RESTPostAPIOrderQuoteBody, options?: Opts): Promise<APIOrderQuote> => this.client.request({ method: "POST", path: "/v1/orders/quote", body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/orders/:orderId/initiate/pix` — scope `billing:write`. */
		initiatePix: (orderId: string, options?: Opts): Promise<APIOrderPixPayment> => this.client.request({ method: "POST", path: `/v1/orders/${deferredPathSegment(orderId)}/initiate/pix`, signal: options?.signal, timeoutMs: options?.timeoutMs }),
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
		return this.client.request({ method: "POST", path: `/v1/redeem/${deferredPathSegment(code)}`, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}
}

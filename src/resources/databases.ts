import type { VertraClient } from "../client.js";
import { encodePathSegment } from "../client.js";
import type { APIDatabase, APIDatabaseCertificate, APIDatabaseMetrics, APIDatabaseOperationResponse, APIDatabasePasswordReset, APIDatabaseStatus, APIDatabaseStatusShort, DatabaseType, RequestOptions } from "../types.js";

export interface CreateDatabaseBody {
	name: string;
	description?: string | null;
	type?: DatabaseType;
	ram: number;
	workspace_id?: string;
	snapshot_id?: string;
}

/**
 * `databases.*` — one method per route under the `databases:*` scopes.
 * @see https://docs.vertracloud.app/api-reference
 */
export class DatabasesResource {
	constructor(private readonly client: VertraClient) {}

	/** `GET /v1/databases/status` — scope `databases:read`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/allstatus */
	statusAll(options?: RequestOptions): Promise<APIDatabaseStatusShort[]> {
		return this.client.request({ method: "GET", path: "/v1/databases/status", query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/databases/:id` — scope `databases:read`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/get */
	get(id: string, options?: RequestOptions): Promise<APIDatabase> {
		return this.client.request({ method: "GET", path: `/v1/databases/${encodePathSegment(id)}`, query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/databases/:id/status` — scope `databases:read`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/status */
	status(id: string, options?: RequestOptions): Promise<APIDatabaseStatus> {
		return this.client.request({ method: "GET", path: `/v1/databases/${encodePathSegment(id)}/status`, query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/databases/:id/metrics` — scope `databases:read`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/metrics */
	metrics(id: string, options?: RequestOptions): Promise<APIDatabaseMetrics[]> {
		return this.client.request({ method: "GET", path: `/v1/databases/${encodePathSegment(id)}/metrics`, query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/databases` — scope `databases:write`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/create */
	create(body: CreateDatabaseBody, options?: RequestOptions): Promise<APIDatabase> {
		return this.client.request({ method: "POST", path: "/v1/databases", body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `PUT /v1/databases/:id` — scope `databases:write`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/update */
	update(id: string, body: { name?: string; description?: string | null; ram?: number }, options?: RequestOptions): Promise<APIDatabase> {
		return this.client.request({ method: "PUT", path: `/v1/databases/${encodePathSegment(id)}`, query: { workspace_id: options?.workspaceId }, body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/databases/:id/start` — scope `databases:write`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/start */
	start(id: string, options?: RequestOptions): Promise<APIDatabaseOperationResponse> {
		return this.client.request({ method: "POST", path: `/v1/databases/${encodePathSegment(id)}/start`, query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/databases/:id/stop` — scope `databases:write`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/stop */
	stop(id: string, options?: RequestOptions): Promise<APIDatabaseOperationResponse> {
		return this.client.request({ method: "POST", path: `/v1/databases/${encodePathSegment(id)}/stop`, query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/databases/:id/reset` — scope `databases:write`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/reset */
	reset(id: string, options?: RequestOptions): Promise<void> {
		return this.client.request({ method: "POST", path: `/v1/databases/${encodePathSegment(id)}/reset`, query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `DELETE /v1/databases/:id` — scope `databases:delete`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/delete */
	delete(id: string, options?: RequestOptions): Promise<void> {
		return this.client.request({ method: "DELETE", path: `/v1/databases/${encodePathSegment(id)}`, query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	readonly credentials = {
		certificate: {
			/**
			 * `GET /v1/databases/:id/credentials/certificate` — scope `databases:credentials`.
			 * @see https://docs.vertracloud.app/api-reference/endpoint/databases/credentials/get
			 */
			get: (id: string, options?: RequestOptions): Promise<APIDatabaseCertificate> => this.client.request({ method: "GET", path: `/v1/databases/${encodePathSegment(id)}/credentials/certificate`, query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

			/** `POST /v1/databases/:id/credentials/certificate/reset` — scope `databases:credentials`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/credentials/reset */
			reset: (id: string, options?: RequestOptions): Promise<void> => this.client.request({ method: "POST", path: `/v1/databases/${encodePathSegment(id)}/credentials/certificate/reset`, query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),
		},

		password: {
			/** `POST /v1/databases/:id/credentials/reset` — scope `databases:credentials`. @see https://docs.vertracloud.app/api-reference/endpoint/databases/credentials/resetpassword */
			reset: (id: string, options?: RequestOptions): Promise<APIDatabasePasswordReset> => this.client.request({ method: "POST", path: `/v1/databases/${encodePathSegment(id)}/credentials/reset`, query: { workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),
		},
	};
}

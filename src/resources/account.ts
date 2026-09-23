import type { VertraClient } from "../client.js";
import { encodePathSegment } from "../client.js";
import type { APIUserInfoResponse, APIUserSession, APIWorkspaceResourceFolder, APIWorkspaceResourceOrganization, RESTPatchAPIUserMeBody, WorkspaceFolderColor } from "../types.js";

/**
 * `account.*` — the authenticated user's own account. One method per route under `account:*`.
 * @see https://docs.vertracloud.app/api-reference
 */
export class AccountResource {
	constructor(private readonly client: VertraClient) {}

	/** `GET /v1/users/me` — scope `account:read`. @see https://docs.vertracloud.app/api-reference/endpoint/users/me */
	get(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<APIUserInfoResponse> {
		return this.client.request({ method: "GET", path: "/v1/users/me", signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `PATCH /v1/users/me` — scope `account:write`. @see https://docs.vertracloud.app/api-reference/endpoint/users/me */
	update(body: RESTPatchAPIUserMeBody, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<APIUserInfoResponse> {
		return this.client.request({ method: "PATCH", path: "/v1/users/me", body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	readonly sessions = {
		/** `GET /v1/users/me/sessions` — scope `account:read`. @see https://docs.vertracloud.app/api-reference/endpoint/users/sessions */
		list: (options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<APIUserSession[]> => this.client.request({ method: "GET", path: "/v1/users/me/sessions", signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly folders = {
		/** `POST /v1/users/me/folders` — scope `account:write`. */
		create: (body: { name: string; color?: WorkspaceFolderColor; position?: number }, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<APIWorkspaceResourceFolder> =>
			this.client.request({ method: "POST", path: "/v1/users/me/folders", body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PATCH /v1/users/me/folders/:folder_id` — scope `account:write`. */
		update: (folderId: string, body: { name?: string; color?: WorkspaceFolderColor; position?: number }, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<APIWorkspaceResourceFolder> =>
			this.client.request({ method: "PATCH", path: `/v1/users/me/folders/${encodePathSegment(folderId)}`, body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/users/me/folders/:folder_id` — scope `account:write`. */
		delete: (folderId: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/users/me/folders/${encodePathSegment(folderId)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PUT /v1/users/me/folders/:folder_id/resources/:resource_type/:resource_id` — scope `account:write`. */
		addResource: (folderId: string, resourceType: string, resourceId: string, body?: { position?: number }, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<APIWorkspaceResourceOrganization> =>
			this.client.request({
				method: "PUT",
				path: `/v1/users/me/folders/${encodePathSegment(folderId)}/resources/${encodePathSegment(resourceType)}/${encodePathSegment(resourceId)}`,
				body: body ?? {},
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),

		/** `DELETE /v1/users/me/folders/:folder_id/resources/:resource_type/:resource_id` — scope `account:write`. */
		removeResource: (folderId: string, resourceType: string, resourceId: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<APIWorkspaceResourceOrganization> =>
			this.client.request({
				method: "DELETE",
				path: `/v1/users/me/folders/${encodePathSegment(folderId)}/resources/${encodePathSegment(resourceType)}/${encodePathSegment(resourceId)}`,
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),
	};

	readonly favorites = {
		/** `PUT /v1/users/me/favorites/:resource_type/:resource_id` — scope `account:write`. */
		add: (resourceType: string, resourceId: string, body?: { position?: number }, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<APIWorkspaceResourceOrganization> =>
			this.client.request({
				method: "PUT",
				path: `/v1/users/me/favorites/${encodePathSegment(resourceType)}/${encodePathSegment(resourceId)}`,
				body: body ?? {},
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),

		/** `DELETE /v1/users/me/favorites/:resource_type/:resource_id` — scope `account:write`. */
		remove: (resourceType: string, resourceId: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<APIWorkspaceResourceOrganization> =>
			this.client.request({
				method: "DELETE",
				path: `/v1/users/me/favorites/${encodePathSegment(resourceType)}/${encodePathSegment(resourceId)}`,
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),
	};
}

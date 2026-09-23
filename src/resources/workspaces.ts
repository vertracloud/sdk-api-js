import type { VertraClient } from "../client.js";
import { encodePathSegment } from "../client.js";
import type {
	APIWorkspace,
	APIWorkspaceActionRequest,
	APIWorkspaceInfoResponse,
	APIWorkspaceInvite,
	APIWorkspaceInvitePreview,
	APIWorkspaceMember,
	APIWorkspaceResourceFolder,
	APIWorkspaceResourceOrganization,
	APIWorkspaceRole,
	ISODateString,
	RESTPostAPIWorkspaceActionRequestBody,
	WorkspaceActionRequestStatus,
	WorkspaceFolderColor,
	WorkspacePermission,
} from "../types.js";

type Opts = { signal?: AbortSignal; timeoutMs?: number };

/**
 * `workspaces.*` — one method per route under the `workspaces:*` scopes.
 * @see https://docs.vertracloud.app/api-reference
 */
export class WorkspacesResource {
	constructor(private readonly client: VertraClient) {}

	/** `GET /v1/workspaces` — scope `workspaces:read`. @see https://docs.vertracloud.app/api-reference/workspaces/get-all */
	list(options?: Opts): Promise<APIWorkspace[]> {
		return this.client.request({ method: "GET", path: "/v1/workspaces", signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/workspaces/:id` — scope `workspaces:read`. @see https://docs.vertracloud.app/api-reference/workspaces/get */
	get(id: string, options?: Opts): Promise<APIWorkspaceInfoResponse> {
		return this.client.request({ method: "GET", path: `/v1/workspaces/${encodePathSegment(id)}`, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/workspaces` — scope `workspaces:write`. @see https://docs.vertracloud.app/api-reference/workspaces/create */
	create(body: { name: string; description?: string }, options?: Opts): Promise<APIWorkspace> {
		return this.client.request({ method: "POST", path: "/v1/workspaces", body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `PUT /v1/workspaces/:id` — scope `workspaces:write`. @see https://docs.vertracloud.app/api-reference/workspaces/update */
	update(id: string, body: { name: string; description?: string }, options?: Opts): Promise<APIWorkspace> {
		return this.client.request({ method: "PUT", path: `/v1/workspaces/${encodePathSegment(id)}`, body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `DELETE /v1/workspaces/:id` — scope `workspaces:delete`, owner only. Soft delete. @see https://docs.vertracloud.app/api-reference/workspaces/delete */
	delete(id: string, options?: Opts): Promise<void> {
		return this.client.request({ method: "DELETE", path: `/v1/workspaces/${encodePathSegment(id)}`, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	readonly invites = {
		/** `GET /v1/workspaces/:id/invites` — scope `workspaces:invites`. @see https://docs.vertracloud.app/api-reference/workspaces/invites/get-all */
		list: (workspaceId: string, options?: Opts): Promise<APIWorkspaceInvite[]> => this.client.request({ method: "GET", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/invites`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/workspaces/:id/invites/:invite_id` — scope `workspaces:invites`. @see https://docs.vertracloud.app/api-reference/workspaces/invites/revoke */
		revoke: (workspaceId: string, inviteId: string, options?: Opts): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/invites/${encodePathSegment(inviteId)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/workspaces/invites/:token` — scope `workspaces:invites`. What the invite grants, before accepting. @see https://docs.vertracloud.app/api-reference/workspaces/invites/preview */
		preview: (token: string, options?: Opts): Promise<APIWorkspaceInvitePreview> => this.client.request({ method: "GET", path: `/v1/workspaces/invites/${encodePathSegment(token)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/workspaces/invites/:token/accept` — scope `workspaces:invites`. Returns the joined workspace. @see https://docs.vertracloud.app/api-reference/workspaces/invites/accept */
		accept: (token: string, options?: Opts): Promise<APIWorkspace> => this.client.request({ method: "POST", path: `/v1/workspaces/invites/${encodePathSegment(token)}/accept`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/workspaces/invites/:token/decline` — scope `workspaces:invites`. @see https://docs.vertracloud.app/api-reference/workspaces/invites/decline */
		decline: (token: string, options?: Opts): Promise<void> => this.client.request({ method: "POST", path: `/v1/workspaces/invites/${encodePathSegment(token)}/decline`, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly actionRequests = {
		/** `GET /v1/workspaces/:id/action-requests` — scope `workspaces:read`. `status` filters the list. @see https://docs.vertracloud.app/api-reference/workspaces/action-requests/get-all */
		list: (workspaceId: string, query?: { status?: WorkspaceActionRequestStatus }, options?: Opts): Promise<APIWorkspaceActionRequest[]> =>
			this.client.request({ method: "GET", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/action-requests`, query: { status: query?.status }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/workspaces/:id/action-requests` — scope `workspaces:write`. Asks a member with the needed permission to approve an action you cannot run yourself. @see https://docs.vertracloud.app/api-reference/workspaces/action-requests/create */
		create: (workspaceId: string, body: RESTPostAPIWorkspaceActionRequestBody, options?: Opts): Promise<APIWorkspaceActionRequest> => this.client.request({ method: "POST", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/action-requests`, body, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly members = {
		/** `GET /v1/workspaces/:id/members` — scope `workspaces:read`. @see https://docs.vertracloud.app/api-reference/workspaces/members/get-all */
		list: (workspaceId: string, options?: Opts): Promise<APIWorkspaceMember[]> => this.client.request({ method: "GET", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/members`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PUT /v1/workspaces/:id/members/:user_id` — scope `workspaces:write`. @see https://docs.vertracloud.app/api-reference/workspaces/members/update */
		update: (workspaceId: string, userId: string, body: { role_id?: string; expires_at?: ISODateString | null }, options?: Opts): Promise<APIWorkspaceMember> =>
			this.client.request({ method: "PUT", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/members/${encodePathSegment(userId)}`, body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/workspaces/:id/members/:user_id` — scope `workspaces:write`. @see https://docs.vertracloud.app/api-reference/workspaces/members/remove */
		remove: (workspaceId: string, userId: string, options?: Opts): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/members/${encodePathSegment(userId)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly roles = {
		/** `GET /v1/workspaces/:id/roles` — scope `workspaces:read`. @see https://docs.vertracloud.app/api-reference/workspaces/roles/get-all */
		list: (workspaceId: string, options?: Opts): Promise<APIWorkspaceRole[]> => this.client.request({ method: "GET", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/roles`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/workspaces/:id/roles` — scope `workspaces:write`. @see https://docs.vertracloud.app/api-reference/workspaces/roles/create */
		create: (workspaceId: string, body: { name: string; permissions: WorkspacePermission[]; position?: number }, options?: Opts): Promise<APIWorkspaceRole> =>
			this.client.request({ method: "POST", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/roles`, body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PUT /v1/workspaces/:id/roles/:role_id` — scope `workspaces:write`. @see https://docs.vertracloud.app/api-reference/workspaces/roles/update */
		update: (workspaceId: string, roleId: string, body: { name: string; permissions: WorkspacePermission[]; position?: number }, options?: Opts): Promise<APIWorkspaceRole> =>
			this.client.request({ method: "PUT", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/roles/${encodePathSegment(roleId)}`, body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/workspaces/:id/roles/:role_id` — scope `workspaces:write`. @see https://docs.vertracloud.app/api-reference/workspaces/roles/delete */
		delete: (workspaceId: string, roleId: string, options?: Opts): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/roles/${encodePathSegment(roleId)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly apps = {
		/** `POST /v1/workspaces/:id/apps/:app_id` — scope `workspaces:write`. Only the app's owner may link it. @see https://docs.vertracloud.app/api-reference/workspaces/link-resource */
		add: (workspaceId: string, appId: string, options?: Opts): Promise<void> => this.client.request({ method: "POST", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/apps/${encodePathSegment(appId)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/workspaces/:id/apps/:app_id` — scope `workspaces:write`. @see https://docs.vertracloud.app/api-reference/workspaces/unlink-resource */
		remove: (workspaceId: string, appId: string, options?: Opts): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/apps/${encodePathSegment(appId)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly databases = {
		/** `POST /v1/workspaces/:id/databases/:db_id` — scope `workspaces:write`. @see https://docs.vertracloud.app/api-reference/workspaces/link-resource */
		add: (workspaceId: string, databaseId: string, options?: Opts): Promise<void> => this.client.request({ method: "POST", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/databases/${encodePathSegment(databaseId)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/workspaces/:id/databases/:db_id` — scope `workspaces:write`. @see https://docs.vertracloud.app/api-reference/workspaces/unlink-resource */
		remove: (workspaceId: string, databaseId: string, options?: Opts): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/databases/${encodePathSegment(databaseId)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly folders = {
		/** `POST /v1/workspaces/:id/folders` — scope `workspaces:write`. */
		create: (workspaceId: string, body: { name: string; color?: WorkspaceFolderColor; position?: number }, options?: Opts): Promise<APIWorkspaceResourceFolder> =>
			this.client.request({ method: "POST", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/folders`, body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PATCH /v1/workspaces/:id/folders/:folder_id` — scope `workspaces:write`. */
		update: (workspaceId: string, folderId: string, body: { name?: string; color?: WorkspaceFolderColor; position?: number }, options?: Opts): Promise<APIWorkspaceResourceFolder> =>
			this.client.request({ method: "PATCH", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/folders/${encodePathSegment(folderId)}`, body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/workspaces/:id/folders/:folder_id` — scope `workspaces:write`. */
		delete: (workspaceId: string, folderId: string, options?: Opts): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/workspaces/${encodePathSegment(workspaceId)}/folders/${encodePathSegment(folderId)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PUT /v1/workspaces/:id/folders/:folder_id/resources/:resource_type/:resource_id` — scope `workspaces:write`. */
		addResource: (workspaceId: string, folderId: string, resourceType: string, resourceId: string, body?: { position?: number }, options?: Opts): Promise<APIWorkspaceResourceOrganization> =>
			this.client.request({
				method: "PUT",
				path: `/v1/workspaces/${encodePathSegment(workspaceId)}/folders/${encodePathSegment(folderId)}/resources/${encodePathSegment(resourceType)}/${encodePathSegment(resourceId)}`,
				body: body ?? {},
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),

		/** `DELETE /v1/workspaces/:id/folders/:folder_id/resources/:resource_type/:resource_id` — scope `workspaces:write`. */
		removeResource: (workspaceId: string, folderId: string, resourceType: string, resourceId: string, options?: Opts): Promise<APIWorkspaceResourceOrganization> =>
			this.client.request({
				method: "DELETE",
				path: `/v1/workspaces/${encodePathSegment(workspaceId)}/folders/${encodePathSegment(folderId)}/resources/${encodePathSegment(resourceType)}/${encodePathSegment(resourceId)}`,
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),
	};

	readonly favorites = {
		/** `PUT /v1/workspaces/:id/favorites/:resource_type/:resource_id` — scope `workspaces:write`. */
		add: (workspaceId: string, resourceType: string, resourceId: string, body?: { position?: number }, options?: Opts): Promise<APIWorkspaceResourceOrganization> =>
			this.client.request({
				method: "PUT",
				path: `/v1/workspaces/${encodePathSegment(workspaceId)}/favorites/${encodePathSegment(resourceType)}/${encodePathSegment(resourceId)}`,
				body: body ?? {},
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),

		/** `DELETE /v1/workspaces/:id/favorites/:resource_type/:resource_id` — scope `workspaces:write`. */
		remove: (workspaceId: string, resourceType: string, resourceId: string, options?: Opts): Promise<APIWorkspaceResourceOrganization> =>
			this.client.request({
				method: "DELETE",
				path: `/v1/workspaces/${encodePathSegment(workspaceId)}/favorites/${encodePathSegment(resourceType)}/${encodePathSegment(resourceId)}`,
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),
	};
}

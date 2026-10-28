import type { VertraClient } from "../client.js";
import { deferredPathSegment } from "../client.js";
import type {
	APIRestartRequired,
	APISnapshotRestoreResponse,
	APIStack,
	APIStackBinding,
	APIStackBindingChange,
	APIStackBlobAdded,
	APIStackChange,
	APIStackConnectionInfo,
	APIStackDatabaseAdded,
	APIStackSnapshot,
	ApplicationLanguage,
	RESTDeleteAPIStackBindingQuery,
	RESTDeleteAPIStackBody,
	RESTDeleteAPIStackMemberQuery,
	RESTPatchAPIStackBody,
	RESTPostAPIStackBindingBody,
	RESTPostAPIStackBlobBody,
	RESTPostAPIStackBody,
	RESTPostAPIStackDatabaseBody,
	RESTPostAPIStackMemberBody,
	RESTPostAPIStackSnapshotRestoreBody,
	RESTPostAPIStackTransformBody,
	RequestOptions,
	SnowFlake,
	StackBindingValue,
	StackMemberType,
	StackNetworkMode,
} from "../types.js";

/** `workspace_id` query param, sent only when given. */
function withWorkspace(options?: RequestOptions): Record<string, string | undefined> {
	return { workspace_id: options?.workspaceId };
}

/** Query of `stacks.connection`: the application to connect and, optionally, the language of the code. */
export interface StackConnectionQuery {
	app_id: SnowFlake;
	/** Default: the language of the application. */
	language?: ApplicationLanguage;
}

/** What happens when a member leaves the stack. `bindings` = the variables its connections created; `blob` = the files of a Blob member. */
export type StackMemberRemoveOptions = RequestOptions & Pick<RESTDeleteAPIStackMemberQuery, "bindings" | "blob">;

/** Resources deleted together with the stack. Empty lists and `deleted_blob: false` with `mode: "dissolve"`. */
export interface StackDeleteResult {
	deleted_apps: SnowFlake[];
	deleted_databases: SnowFlake[];
	/** `true` when the files of the Blob folder were deleted. */
	deleted_blob: boolean;
}

/** `variables` = what happens to the variables the connection created (default `keep_connection`). */
export type StackBindingDeleteOptions = RequestOptions & Pick<RESTDeleteAPIStackBindingQuery, "variables">;

/**
 * `stacks.*` — a stack groups applications, databases and Blob folders and keeps the connection variables of each application up to
 * date, under the `stacks:read`, `stacks:write` and `stacks:delete` scopes. Changes that alter variables or certificates return
 * `restart_required` and `apps_to_restart`: an application reads them only when it starts, so the restart is yours to ask for.
 * @see https://docs.vertracloud.app/api-reference
 */
export class StacksResource {
	constructor(private readonly client: VertraClient) {}

	/** `GET /v1/stacks` — scope `stacks:read`. With `workspaceId`, lists the stacks of that workspace. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/list */
	list(options?: RequestOptions): Promise<APIStack[]> {
		return this.client.request({ method: "GET", path: "/v1/stacks", query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/stacks/:stack_id` — scope `stacks:read`. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/get */
	get(id: string, options?: RequestOptions): Promise<APIStack> {
		return this.client.request({ method: "GET", path: `/v1/stacks/${deferredPathSegment(id)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `POST /v1/stacks` — scope `stacks:write`. Creates a stack from resources that already exist, all in the same account or workspace and
	 * none in another stack. The workspace goes in `body.workspace_id`. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/create
	 */
	create(body: RESTPostAPIStackBody, options?: Omit<RequestOptions, "workspaceId">): Promise<APIStackChange> {
		return this.client.request({ method: "POST", path: "/v1/stacks", body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `POST /v1/stacks/transform` — scope `stacks:write`. Turns the applications and databases of a folder into a stack; the folder stays.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/stacks/transform
	 */
	transform(body: RESTPostAPIStackTransformBody, options?: Omit<RequestOptions, "workspaceId">): Promise<APIStackChange> {
		return this.client.request({ method: "POST", path: "/v1/stacks/transform", body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `PATCH /v1/stacks/:stack_id` — scope `stacks:write`. At least one field is required. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/update */
	update(id: string, body: RESTPatchAPIStackBody, options?: RequestOptions): Promise<APIStack> {
		return this.client.request({ method: "PATCH", path: `/v1/stacks/${deferredPathSegment(id)}`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `DELETE /v1/stacks/:stack_id` — scope `stacks:delete`. `confirm_name` must equal the stack name (`STACK_NAME_MISMATCH` otherwise).
	 * `mode: "dissolve"` removes only the stack; `"delete_all"` deletes every member too (the keys also need the delete scope of each
	 * member type). @see https://docs.vertracloud.app/api-reference/endpoint/stacks/delete
	 */
	delete(id: string, body: RESTDeleteAPIStackBody, options?: RequestOptions): Promise<StackDeleteResult> {
		return this.client.request({ method: "DELETE", path: `/v1/stacks/${deferredPathSegment(id)}`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/stacks/:stack_id/connection` — scope `stacks:read`. Code to connect an application of the stack to what it is linked to. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/connection */
	connection(id: string, query: StackConnectionQuery, options?: RequestOptions): Promise<APIStackConnectionInfo> {
		return this.client.request({
			method: "GET",
			path: `/v1/stacks/${deferredPathSegment(id)}/connection`,
			query: { app_id: query.app_id, language: query.language, workspace_id: options?.workspaceId },
			signal: options?.signal,
			timeoutMs: options?.timeoutMs,
		});
	}

	/** `POST /v1/stacks/:stack_id/network-mode` — scope `stacks:write`. Only `public` is accepted for now (`STACK_NETWORK_MODE_UNAVAILABLE` otherwise). @see https://docs.vertracloud.app/api-reference/endpoint/stacks/network-mode */
	setNetworkMode(id: string, networkMode: StackNetworkMode, options?: RequestOptions): Promise<APIStack> {
		return this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(id)}/network-mode`, query: withWorkspace(options), body: { network_mode: networkMode }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/stacks/:stack_id/databases` — scope `stacks:write`. Creates a database already inside the stack and connects it to the applications you choose. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/databases/create */
	addDatabase(id: string, body: RESTPostAPIStackDatabaseBody, options?: RequestOptions): Promise<APIStackDatabaseAdded> {
		return this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(id)}/databases`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `POST /v1/apps/:id/stack/databases` — scope `stacks:write`. Same as `addDatabase`, starting from an application; when the application is not in a stack,
	 * the stack is created too (named by `stack_name`). @see https://docs.vertracloud.app/api-reference/endpoint/stacks/databases/create
	 */
	addDatabaseToApp(appId: string, body: RESTPostAPIStackDatabaseBody, options?: RequestOptions): Promise<APIStackDatabaseAdded> {
		return this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(appId)}/stack/databases`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `POST /v1/stacks/:stack_id/blob` — scope `stacks:write`. Adds a folder of your Blob Storage to the stack: the platform creates an API key restricted
	 * to that folder and injects the connection variables into the applications you choose. The plan must include Blob Storage.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/stacks/blob/create
	 */
	addBlob(id: string, body?: RESTPostAPIStackBlobBody, options?: RequestOptions): Promise<APIStackBlobAdded> {
		return this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(id)}/blob`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	readonly members = {
		/** `POST /v1/stacks/:stack_id/members` — scope `stacks:write`. Puts an application or database you already have into the stack. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/members/add */
		add: (stackId: string, body: RESTPostAPIStackMemberBody, options?: RequestOptions): Promise<APIStackChange> => this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(stackId)}/members`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `DELETE /v1/stacks/:stack_id/members/:resource_type/:resource_id` — scope `stacks:write`. Takes a member out of the stack without deleting it.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/stacks/members/remove
		 */
		remove: (stackId: string, resourceType: StackMemberType, resourceId: string, options?: StackMemberRemoveOptions): Promise<APIStackChange> =>
			this.client.request({
				method: "DELETE",
				path: `/v1/stacks/${deferredPathSegment(stackId)}/members/${deferredPathSegment(resourceType)}/${deferredPathSegment(resourceId)}`,
				query: { bindings: options?.bindings, blob: options?.blob, workspace_id: options?.workspaceId },
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),
	};

	readonly bindings = {
		/** `GET /v1/stacks/:stack_id/bindings` — scope `stacks:read`. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/bindings/list */
		list: (stackId: string, options?: RequestOptions): Promise<APIStackBinding[]> => this.client.request({ method: "GET", path: `/v1/stacks/${deferredPathSegment(stackId)}/bindings`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/stacks/:stack_id/bindings` — scope `stacks:write`. Connects an application of the stack to exactly one of `database_id`, `blob_id` or `target_app_id`. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/bindings/create */
		create: (stackId: string, body: RESTPostAPIStackBindingBody, options?: RequestOptions): Promise<APIStackBindingChange> => this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(stackId)}/bindings`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PATCH /v1/stacks/:stack_id/bindings/:binding_id` — scope `stacks:write`. Replaces the variable names of the connection. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/bindings/update */
		update: (stackId: string, bindingId: string, envMap: Record<string, StackBindingValue>, options?: RequestOptions): Promise<APIStackBindingChange> =>
			this.client.request({ method: "PATCH", path: `/v1/stacks/${deferredPathSegment(stackId)}/bindings/${deferredPathSegment(bindingId)}`, query: withWorkspace(options), body: { env_map: envMap }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/stacks/:stack_id/bindings/:binding_id` — scope `stacks:write`. `restart_required` is `true` when the variables were removed from an application (`variables: "remove_variables"`). @see https://docs.vertracloud.app/api-reference/endpoint/stacks/bindings/delete */
		delete: (stackId: string, bindingId: string, options?: StackBindingDeleteOptions): Promise<APIRestartRequired> =>
			this.client.request({
				method: "DELETE",
				path: `/v1/stacks/${deferredPathSegment(stackId)}/bindings/${deferredPathSegment(bindingId)}`,
				query: { variables: options?.variables, workspace_id: options?.workspaceId },
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),
	};

	readonly snapshots = {
		/** `GET /v1/stacks/:stack_id/snapshots` — scope `stacks:read`. Newest first. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/snapshots/list */
		list: (stackId: string, options?: RequestOptions): Promise<APIStackSnapshot[]> => this.client.request({ method: "GET", path: `/v1/stacks/${deferredPathSegment(stackId)}/snapshots`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/stacks/:stack_id/snapshots` — scope `stacks:write`. Takes a snapshot of every member that has data, together. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/snapshots/create */
		create: (stackId: string, options?: RequestOptions): Promise<APIStackSnapshot> => this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(stackId)}/snapshots`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/stacks/:stack_id/snapshots/:snapshot_id/restore` — scope `stacks:write`. Brings every member back, together. @see https://docs.vertracloud.app/api-reference/endpoint/stacks/snapshots/restore */
		restore: (stackId: string, snapshotId: string, body?: RESTPostAPIStackSnapshotRestoreBody, options?: RequestOptions): Promise<APISnapshotRestoreResponse> =>
			this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(stackId)}/snapshots/${deferredPathSegment(snapshotId)}/restore`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};
}

export * from "@vertracloud/api-types/v1";

/**
 * Options accepted by (almost) every resource method: `workspace_id` is an optional query param
 * on nearly every app/database/snapshot route, and `signal`/`timeoutMs` let a caller cancel or
 * override the client's default timeout per call.
 */
export interface RequestOptions {
	workspaceId?: string;
	signal?: AbortSignal;
	timeoutMs?: number;
}

export interface FileListQuery {
	path?: string;
	workspace_id?: string;
}
export interface FileContentQuery {
	path: string;
	workspace_id?: string;
}

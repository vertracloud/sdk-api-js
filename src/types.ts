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

/**
 * Body of `POST /v1/apps/:id/restart`. The published `RESTPostAPIApplicationRestartBody` type is
 * missing `cleanup_old_runtime_language`, so this local type adds it.
 */
export interface RestartAppBody {
	reinstall_dependencies?: boolean;
	force_build?: boolean;
	cleanup_old_runtime_language?: string;
}

/** One entry of `GET /v1/apps/runtimes`, keyed by runtime name (e.g. `"javascript"`, `"python"`). */
export interface APIRuntimeEntry {
	recommended: string;
	latest: string;
	specific: string[];
}
export type APIRuntimesResponse = Record<string, APIRuntimeEntry>;

/** Response of `POST /v1/redeem/:code`. */
export interface APIRedeemResponse {
	plan: { name: string; duration: number };
}

import type { VertraClient } from "../client.js";
import { encodePathSegment } from "../client.js";
import type { APIGroupedResourceSnapshots, APIResourceSnapshot, APISnapshotRestoreResponse } from "../types.js";

/** `applications` = app snapshots, `databases` = database snapshots. Required on every `snapshots.*` call. */
export type SnapshotScope = "applications" | "databases";

export interface SnapshotOptions {
	scope: SnapshotScope;
	signal?: AbortSignal;
	timeoutMs?: number;
}

/**
 * `snapshots.*` — one method per route under the `snapshots:*` scopes. Resources here are
 * identified by the **resource** id (an app or a database id), not a user id, despite the `:id`
 * path segment. The API does not read `workspace_id` on this domain, so it is not sent here.
 * @see https://docs.vertracloud.app/api-reference
 */
export class SnapshotsResource {
	constructor(private readonly client: VertraClient) {}

	/** `GET /v1/users/snapshots` — scope `snapshots:read`. All snapshots, grouped by resource. */
	listAll(options: SnapshotOptions): Promise<APIGroupedResourceSnapshots[]> {
		return this.client.request({ method: "GET", path: "/v1/users/snapshots", query: { scope: options.scope }, signal: options.signal, timeoutMs: options.timeoutMs });
	}

	/** `GET /v1/users/:id/snapshots` — scope `snapshots:read`. `id` = the app/database resource id. @see https://docs.vertracloud.app/api-reference/endpoint/apps/commits/getall */
	list(resourceId: string, options: SnapshotOptions): Promise<APIResourceSnapshot[]> {
		return this.client.request({ method: "GET", path: `/v1/users/${encodePathSegment(resourceId)}/snapshots`, query: { scope: options.scope }, signal: options.signal, timeoutMs: options.timeoutMs });
	}

	/** `GET /v1/users/:id/snapshots/:snapshot_id/download` — scope `snapshots:read`. Returns the snapshot's zip as an `ArrayBuffer`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/commits/download */
	download(resourceId: string, snapshotId: string, options: SnapshotOptions): Promise<ArrayBuffer> {
		return this.client.requestBinary({
			method: "GET",
			path: `/v1/users/${encodePathSegment(resourceId)}/snapshots/${encodePathSegment(snapshotId)}/download`,
			query: { scope: options.scope },
			signal: options.signal,
			timeoutMs: options.timeoutMs ?? 120_000,
		});
	}

	/** `POST /v1/users/:id/snapshots` — scope `snapshots:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/commits/upload */
	create(resourceId: string, options: SnapshotOptions): Promise<APIResourceSnapshot> {
		return this.client.request({ method: "POST", path: `/v1/users/${encodePathSegment(resourceId)}/snapshots`, query: { scope: options.scope }, signal: options.signal, timeoutMs: options.timeoutMs });
	}

	/** `POST /v1/users/:id/snapshots/:snapshot_id/restore` — scope `snapshots:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/commits/revert */
	restore(resourceId: string, snapshotId: string, options: SnapshotOptions): Promise<APISnapshotRestoreResponse> {
		return this.client.request({
			method: "POST",
			path: `/v1/users/${encodePathSegment(resourceId)}/snapshots/${encodePathSegment(snapshotId)}/restore`,
			query: { scope: options.scope },
			signal: options.signal,
			timeoutMs: options.timeoutMs,
		});
	}
}

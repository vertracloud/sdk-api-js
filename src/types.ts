import type { APIDatabase, APIResourceSnapshot, APISnapshotCreateAccepted, APISnapshotImageWarning } from "@vertracloud/api-types/v1";

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

/** `details` of `SNAPSHOT_EXCEEDS_STORAGE` (HTTP 400), in a camelCase form read by `snapshotExceedsStorage(error)`. */
export interface SnapshotExceedsStorageDetails {
	requiredBytes: number;
	availableBytes: number;
	/** Databases only: the smallest memory size, in MB, whose storage fits the snapshot. */
	requiredRamMb?: number;
}

/** A resource created from a snapshot (HTTP 202): `restore_job_id` is the restore job to follow with `client.snapshotJobs`. */
export type WithRestoreJob<T> = T & { restore_job_id?: string; warning?: APISnapshotImageWarning };

/** Result of `databases.create`: the database plus its `password`, returned only by this call. */
export type DatabaseCreated = WithRestoreJob<APIDatabase & { password: string }>;

/**
 * Result of `snapshots.create`: the snapshot (`ready`), or `accepted` with the `job_id` to follow with `client.snapshotJobs` (the snapshot is
 * still being taken). `status` is added by the SDK; every other field is the API's own.
 */
export type SnapshotCreateResult = { status: "ready"; snapshot: APIResourceSnapshot } | ({ status: "accepted" } & APISnapshotCreateAccepted);

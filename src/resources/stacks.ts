import type { VertraClient } from "../client.js";
import { deferredPathSegment } from "../client.js";
import { WaitTimeoutError } from "../errors.js";
import type {
	APIRestartRequired,
	APISnapshotJob,
	APIStack,
	APIStackBinding,
	APIStackBindingChange,
	APIStackBlobAdded,
	APIStackChange,
	APIStackConnectionInfo,
	APIStackDatabaseAdded,
	APIStackSnapshot,
	APIStackSnapshotAccepted,
	APIStackSnapshotJob,
	APIStackSnapshotRestoreAccepted,
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
import { DEFAULT_WAIT_TIMEOUT_MS, SnapshotJobsResource } from "./snapshots.js";

/**
 * How the stack waits follow the jobs: `timeoutMs` is the limit of each request, `waitTimeoutMs` the total wait (default 30 min;
 * the work keeps running after it).
 */
export interface StackJobsWaitOptions extends RequestOptions {
	/** Poll interval in ms. Default `2000`. */
	intervalMs?: number;
	/** Total wait in ms before `WaitTimeoutError`. Default `1800000` (30 min). */
	waitTimeoutMs?: number;
	/** Called with the job on every poll while it has not ended. */
	onProgress?: (job: APISnapshotJob) => void;
}

/** Waits for every job of a stack snapshot or restore, in order, sharing one deadline. Resolves with the jobs, all `ready`; throws at the first one that ends `failed` or `skipped` (`SnapshotJobError`). */
async function waitStackJobs(client: VertraClient, jobs: APIStackSnapshotJob[], options: StackJobsWaitOptions = {}): Promise<APISnapshotJob[]> {
	const snapshotJobs = new SnapshotJobsResource(client);
	const total = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
	const deadline = Date.now() + total;
	const finished: APISnapshotJob[] = [];
	for (const item of jobs) {
		const scope = item.resource_type === "database" ? "databases" : "applications";
		try {
			finished.push(await snapshotJobs.wait(item.resource_id, item.job_id, { scope, workspaceId: options.workspaceId, signal: options.signal, timeoutMs: options.timeoutMs, intervalMs: options.intervalMs, waitTimeoutMs: Math.max(1, deadline - Date.now()), onProgress: options.onProgress }));
		} catch (error) {
			if (error instanceof WaitTimeoutError) throw new WaitTimeoutError(`The jobs of the stack did not finish within ${total} ms`, total, error.job);
			throw error;
		}
	}
	return finished;
}

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
	 * member type). Both answer 200 right away. Deleting is permanent: take a snapshot first if you may need the data again.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/stacks/delete
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

	/** `POST /v1/stacks/:stack_id/network-mode` — scope `stacks:write`. Only `public` is accepted (`STACK_NETWORK_MODE_UNAVAILABLE` otherwise). @see https://docs.vertracloud.app/api-reference/endpoint/stacks/network-mode */
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

		/**
		 * `POST /v1/stacks/:stack_id/snapshots` — scope `stacks:write`. Takes a snapshot of every member that has data, together. The call answers 202 with the id of
		 * the stack snapshot and one snapshot job per member (databases first); nothing is taken yet. Each member is a regular manual snapshot (manual quota, 30 days).
		 * The stack snapshot is listed as `pending` and becomes `ready` when the last job ends. Follow the jobs with `waitForCreate` or use `createAndWait`.
		 * A refusal before the jobs start (quota, plan, a restore in progress) carries the code of the member; a stack snapshot already running answers 409 `OPERATION_IN_PROGRESS`.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/stacks/snapshots/create
		 */
		create: (stackId: string, options?: RequestOptions): Promise<APIStackSnapshotAccepted> => this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(stackId)}/snapshots`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * Follows every job of `create` with `snapshotJobs.wait`, in order, under one `waitTimeoutMs` (default 30 min) for the whole stack snapshot. Resolves with the final
		 * job of each member (all `ready`). Throws `SnapshotJobError` (`reason`, `details`, `job`) at the first member that ends `failed` or `skipped` (the others keep going)
		 * and `WaitTimeoutError` when the time runs out; the jobs keep running.
		 */
		waitForCreate: (accepted: Pick<APIStackSnapshotAccepted, "jobs">, options?: StackJobsWaitOptions): Promise<APISnapshotJob[]> => waitStackJobs(this.client, accepted.jobs, options),

		/** Starts the stack snapshot and waits with `waitForCreate`. Resolves with the accepted answer and the final job of each member (`finished`, all `ready`). Throws what `create` and `waitForCreate` throw. */
		createAndWait: async (stackId: string, options?: RequestOptions & StackJobsWaitOptions): Promise<APIStackSnapshotAccepted & { finished: APISnapshotJob[] }> => {
			const accepted = await this.snapshots.create(stackId, options);
			const finished = await this.snapshots.waitForCreate(accepted, options);
			return { ...accepted, finished };
		},

		/**
		 * `POST /v1/stacks/:stack_id/snapshots/:snapshot_id/restore` — scope `stacks:write`. The restore runs as jobs: the call answers 202 in seconds with
		 * `{ jobs }` (one job per member, databases first; `jobs[].warning` is `IMAGE_VERSION_NOT_FOUND` when that member's image version is gone)
		 * and nothing is restored yet. Restoring is permanent for the current content: take a snapshot first if you may need it. The server restores the members one
		 * after the other; the stack is restored when every job is `ready`. When a member fails, the jobs after it end `failed` with
		 * `STACK_RESTORE_MEMBER_FAILED`. Follow the jobs with `waitForRestore` or use `restoreAndWait`. Refusals before the jobs start carry the
		 * code and `details` of the member (`RESTORE_IN_PROGRESS`, `APP_BUILDING`, `SNAPSHOT_EXCEEDS_STORAGE`, ...).
		 * @see https://docs.vertracloud.app/api-reference/endpoint/stacks/snapshots/restore
		 */
		restore: (stackId: string, snapshotId: string, body?: RESTPostAPIStackSnapshotRestoreBody, options?: RequestOptions): Promise<APIStackSnapshotRestoreAccepted> =>
			this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(stackId)}/snapshots/${deferredPathSegment(snapshotId)}/restore`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * Follows every job of `restore` with `snapshotJobs.wait` (in the order of `jobs`) under one `waitTimeoutMs` (default 30 min). Resolves with the final job of each member
		 * (all `ready` = stack restored). Throws `SnapshotJobError` (`reason`, `details`, `job`) at the first member that ends `failed` or `skipped` (the jobs after it end
		 * `failed` with `STACK_RESTORE_MEMBER_FAILED`) and `WaitTimeoutError` when the time runs out; the jobs keep running.
		 */
		waitForRestore: (accepted: Pick<APIStackSnapshotRestoreAccepted, "jobs">, options?: StackJobsWaitOptions): Promise<APISnapshotJob[]> => waitStackJobs(this.client, accepted.jobs, options),

		/** Starts the restore and waits with `waitForRestore`. Resolves with the accepted answer and the final job of each member (`finished`, all `ready`). Throws what `restore` and `waitForRestore` throw. */
		restoreAndWait: async (stackId: string, snapshotId: string, body?: RESTPostAPIStackSnapshotRestoreBody, options?: RequestOptions & StackJobsWaitOptions): Promise<APIStackSnapshotRestoreAccepted & { finished: APISnapshotJob[] }> => {
			const accepted = await this.snapshots.restore(stackId, snapshotId, body, options);
			const finished = await this.snapshots.waitForRestore(accepted, options);
			return { ...accepted, finished };
		},
	};
}

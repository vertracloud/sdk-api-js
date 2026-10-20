import type { VertraClient } from "../client.js";
import { encodePathSegment } from "../client.js";
import { AppBuildFailedError, AppBuildTimeoutError } from "../errors.js";
import type { SseEvent } from "../sse.js";
import type {
	APIApplication,
	APIApplicationDeployment,
	APIApplicationDomain,
	APIApplicationDomainConnect,
	APIApplicationDomainDnsRecord,
	APIApplicationEnvironment,
	APIApplicationFile,
	APIApplicationFileContent,
	APIApplicationFileTree,
	APIApplicationFileUpload,
	APIApplicationMetric,
	APIApplicationOperationResponse,
	APIApplicationRelease,
	APIApplicationReleaseLog,
	APIApplicationRollbackPreview,
	APIApplicationRuntimes,
	APIApplicationStatus,
	APIApplicationStatusShort,
	APIApplicationSubdomain,
	APIApplicationWebPublish,
	APIApplicationWebhook,
	APIApplicationWebhookUrl,
	FileContentQuery,
	FileListQuery,
	PaginationMeta,
	RESTDeleteAPIApplicationFileBody,
	RESTPatchAPIApplicationDomainBody,
	RESTPatchAPIApplicationFileMoveBody,
	RESTPatchAPIApplicationUpdateConfigBody,
	RESTPostAPIApplicationDomainBody,
	RESTPostAPIApplicationEnvironmentBody,
	RESTPostAPIApplicationRestartBody,
	RESTPostAPIApplicationRollbackBody,
	RESTPostAPIApplicationWebhookCreateBody,
	RESTPutAPIApplicationFileBody,
	RequestOptions,
} from "../types.js";

export interface CreateAppOptions extends RequestOptions {
	/** Zip of the application. Mutually exclusive with `snapshotId`. */
	file?: Blob;
	/** Creates the app from an existing snapshot instead of a zip. Mutually exclusive with `file`. */
	snapshotId?: string;
	name: string;
	description?: string | null;
	/** RAM in MB. Required unless `snapshotId` is set. */
	memory?: number;
	main?: string;
	version?: string;
	start?: string;
	build?: string;
	subdomain?: string;
	envs?: { key: string; value: string; note?: string }[];
}

export interface WaitUntilReadyOptions extends RequestOptions {
	/** Give up after this many ms (the build keeps running). Default `600000`. */
	timeoutMs?: number;
	/** Poll interval in ms. Default `2000`. */
	intervalMs?: number;
}

function withWorkspace(options?: RequestOptions): Record<string, string | undefined> {
	return { workspace_id: options?.workspaceId };
}

/**
 * `apps.*` — one method per route under the `apps:*` scopes.
 * @see https://docs.vertracloud.app/api-reference
 */
export class AppsResource {
	constructor(private readonly client: VertraClient) {}

	/** `GET /v1/apps/:id` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/get */
	get(id: string, options?: RequestOptions): Promise<APIApplication> {
		return this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/apps/:id/status` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/status */
	status(id: string, options?: RequestOptions): Promise<APIApplicationStatus> {
		return this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/status`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/apps/status` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/allstatus */
	statusAll(options?: RequestOptions): Promise<APIApplicationStatusShort[]> {
		return this.client.request({ method: "GET", path: "/v1/apps/status", query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/apps/runtimes` — scope `apps:read`. Catalog of supported languages/runtimes for app creation. */
	runtimes(options?: RequestOptions): Promise<APIApplicationRuntimes> {
		return this.client.request({ method: "GET", path: "/v1/apps/runtimes", signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `GET /v1/apps/:id/realtime` — scope `apps:read`. Server-Sent Events stream of live logs and
	 * system notes. `since` is a cursor timestamp to resume from.
	 */
	realtime(id: string, options?: RequestOptions & { since?: number; idleTimeoutMs?: number }): AsyncGenerator<SseEvent, void, unknown> {
		return this.client.requestSse({
			method: "GET",
			path: `/v1/apps/${encodePathSegment(id)}/realtime`,
			query: { workspace_id: options?.workspaceId, since: options?.since },
			signal: options?.signal,
			timeoutMs: options?.timeoutMs,
			idleTimeoutMs: options?.idleTimeoutMs,
		});
	}

	/** `GET /v1/apps/:id/metrics` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/metrics */
	metrics(id: string, options?: RequestOptions & { range?: "10m" | "30m" | "24h"; since?: number }): Promise<APIApplicationMetric[]> {
		return this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/metrics`, query: { workspace_id: options?.workspaceId, range: options?.range, since: options?.since }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/apps/:id/logs` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/logs */
	logs(id: string, options?: RequestOptions): Promise<string> {
		return this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/logs`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/apps/:id/download` — scope `apps:read`. Returns the app's zip as an `ArrayBuffer`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/download */
	download(id: string, options?: RequestOptions): Promise<ArrayBuffer> {
		return this.client.requestBinary({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/download`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs ?? 120_000 });
	}

	/**
	 * `POST /v1/apps` — scope `apps:write`. `multipart/form-data`. Exactly one of `file`/`snapshotId`
	 * must be given. Asynchronous: resolves in seconds with the app in `status: "building"` (HTTP 202);
	 * use `waitUntilReady` to follow it to `up`/`down`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/create
	 */
	create(options: CreateAppOptions): Promise<APIApplication> {
		const form = new FormData();
		if (options.file) form.set("file", options.file, "app.zip");
		if (options.snapshotId) form.set("snapshot_id", options.snapshotId);
		form.set("name", options.name);
		if (options.description !== undefined) form.set("description", options.description ?? "");
		if (options.memory !== undefined) form.set("memory", String(options.memory));
		if (options.main !== undefined) form.set("main", options.main);
		if (options.version !== undefined) form.set("version", options.version);
		if (options.start !== undefined) form.set("start", options.start);
		if (options.build !== undefined) form.set("build", options.build);
		if (options.subdomain !== undefined) form.set("subdomain", options.subdomain);
		if (options.workspaceId !== undefined) form.set("workspace_id", options.workspaceId);
		if (options.envs !== undefined) form.set("envs", JSON.stringify(options.envs));
		return this.client.request({ method: "POST", path: "/v1/apps", form, signal: options.signal, timeoutMs: options.timeoutMs ?? 60_000 });
	}

	/**
	 * Polls `GET /v1/apps/:id` until the build ends. Resolves with the app when `up`; throws
	 * `AppBuildFailedError` when it ends `down` and `AppBuildTimeoutError` after `timeoutMs`.
	 * `options.timeoutMs` is the total wait, not the per-request timeout.
	 */
	async waitUntilReady(id: string, options: WaitUntilReadyOptions = {}): Promise<APIApplication> {
		const { timeoutMs = 600_000, intervalMs = 2_000, signal, workspaceId } = options;
		const deadline = Date.now() + timeoutMs;
		for (;;) {
			const app = await this.get(id, { workspaceId, signal });
			if (app.status === "up") return app;
			if (app.status === "down") throw new AppBuildFailedError(app);
			if (Date.now() + intervalMs > deadline) throw new AppBuildTimeoutError(id, timeoutMs);
			await new Promise<void>((resolve, reject) => {
				const t = setTimeout(resolve, intervalMs);
				signal?.addEventListener(
					"abort",
					() => {
						clearTimeout(t);
						reject(signal.reason);
					},
					{ once: true },
				);
			});
		}
	}

	/** `POST /v1/apps/:id/start` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/start */
	start(id: string, options?: RequestOptions): Promise<APIApplicationOperationResponse> {
		return this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/start`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/apps/:id/stop` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/stop */
	stop(id: string, options?: RequestOptions): Promise<APIApplicationOperationResponse> {
		return this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/stop`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/apps/:id/restart` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/restart */
	restart(id: string, body?: RESTPostAPIApplicationRestartBody, options?: RequestOptions): Promise<APIApplicationOperationResponse> {
		return this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/restart`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `PATCH /v1/apps/:id/config` — scope `apps:write`. `deploy` sets zero downtime, automatic rollback
	 * and the health check path (`null` clears it). Plan-gated: `zero_downtime: "on"` fails with 403
	 * `PLAN_DOES_NOT_SUPPORT_ZERO_DOWNTIME` and `auto_rollback: true` with 403
	 * `PLAN_DOES_NOT_SUPPORT_AUTO_ROLLBACK`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/updateconfig */
	updateConfig(id: string, body: RESTPatchAPIApplicationUpdateConfigBody, options?: RequestOptions): Promise<string> {
		return this.client.request({ method: "PATCH", path: `/v1/apps/${encodePathSegment(id)}/config`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `DELETE /v1/apps/:id` — scope `apps:delete`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/delete */
	delete(id: string, options?: RequestOptions): Promise<void> {
		return this.client.request({ method: "DELETE", path: `/v1/apps/${encodePathSegment(id)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	readonly deploys = {
		/** `GET /v1/apps/:id/deploys` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/deployments */
		list: (id: string, options?: RequestOptions): Promise<APIApplicationDeployment[]> => this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/deploys`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		webhook: {
			/** `GET /v1/apps/:id/deploys/webhook` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/webhook */
			get: (id: string, options?: RequestOptions): Promise<APIApplicationWebhook> => this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/deploys/webhook`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

			/** `POST /v1/apps/:id/deploys/webhook` — scope `apps:write`. */
			create: (id: string, body: RESTPostAPIApplicationWebhookCreateBody, options?: RequestOptions): Promise<APIApplicationWebhookUrl> =>
				this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/deploys/webhook`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

			/** `DELETE /v1/apps/:id/deploys/webhook` — scope `apps:write`. */
			delete: (id: string, options?: RequestOptions): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/apps/${encodePathSegment(id)}/deploys/webhook`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
		},
	};

	readonly releases = {
		/** `GET /v1/apps/:id/releases` — scope `apps:read`. Newest first; `limit` defaults to 20, maximum 50. @see https://docs.vertracloud.app/api-reference/endpoint/apps/releases/list */
		list: (id: string, options?: RequestOptions & { page?: number; limit?: number }): Promise<PaginationMeta<APIApplicationRelease>> =>
			this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/releases`, query: { page: options?.page, limit: options?.limit, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/apps/:id/releases/:release_id/log` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/releases/log */
		log: (id: string, releaseId: string, options?: RequestOptions): Promise<APIApplicationReleaseLog> => this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/releases/${encodePathSegment(releaseId)}/log`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `GET /v1/apps/:id/releases/:release_id/rollback` — scope `apps:envs`. Previews a rollback and changes nothing.
		 * Returns only environment variable names with their change, never values.
		 * Throws a 403 `PLAN_DOES_NOT_SUPPORT_ROLLBACK` when the plan has no rollback.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/releases/rollback-preview
		 */
		previewRollback: (id: string, releaseId: string, options?: RequestOptions): Promise<APIApplicationRollbackPreview> =>
			this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/releases/${encodePathSegment(releaseId)}/rollback`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `POST /v1/apps/:id/releases/:release_id/rollback` — scope `apps:write`; `restore_environment: true`
		 * also needs `apps:envs`. Restores the release's code, restarts the app and returns the new release.
		 * Errors: 403 `PLAN_DOES_NOT_SUPPORT_ROLLBACK`, 404 `RELEASE_NOT_FOUND`, 409 `RELEASE_ALREADY_ACTIVE`,
		 * 410 `RELEASE_EXPIRED`, `OPERATION_IN_PROGRESS`, `RESTORE_COOLDOWN` and `DEPLOY_RATE_LIMITED`.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/apps/releases/rollback
		 */
		rollback: (id: string, releaseId: string, body?: RESTPostAPIApplicationRollbackBody, options?: RequestOptions): Promise<APIApplicationRelease> =>
			this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/releases/${encodePathSegment(releaseId)}/rollback`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly domains = {
		/** `GET /v1/apps/:id/domains` — scope `apps:read`. */
		list: (id: string, options?: RequestOptions): Promise<APIApplicationDomain[]> => this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/domains`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/apps/:id/domains` — scope `apps:write`. Returns the created domain and its automatic `www`/root companion, when there is one. */
		add: (id: string, body: RESTPostAPIApplicationDomainBody, options?: RequestOptions): Promise<APIApplicationDomain[]> => this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/domains`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PATCH /v1/apps/:id/domains/:domainId` — scope `apps:write`. Send only what changes; `null` clears `path_prefix` or `redirect_to`. */
		update: (id: string, domainId: string, body: RESTPatchAPIApplicationDomainBody, options?: RequestOptions): Promise<APIApplicationDomain[]> =>
			this.client.request({ method: "PATCH", path: `/v1/apps/${encodePathSegment(id)}/domains/${encodePathSegment(domainId)}`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/apps/:id/domains/:domainId` — scope `apps:write`. Removes the automatic companion together. */
		remove: (id: string, domainId: string, options?: RequestOptions): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/apps/${encodePathSegment(id)}/domains/${encodePathSegment(domainId)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/apps/:id/domains/:domainId/dns` — scope `apps:read`. */
		dns: (id: string, domainId: string, options?: RequestOptions): Promise<APIApplicationDomainDnsRecord[]> =>
			this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/domains/${encodePathSegment(domainId)}/dns`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/apps/:id/domains/:domainId/connect` — scope `apps:write`. Fails with `DOMAIN_CONNECT_UNAVAILABLE` (404) when automatic setup is not available. */
		connect: (id: string, domainId: string, options?: RequestOptions): Promise<APIApplicationDomainConnect> =>
			this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/domains/${encodePathSegment(domainId)}/connect`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly network = {
		/** `POST /v1/apps/:id/network/purge-cache` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/network/purgecache */
		purgeCache: (id: string, body?: { hostnames?: string[]; paths?: string[] }, options?: RequestOptions): Promise<void> =>
			this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/network/purge-cache`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PATCH /v1/apps/:id/network/subdomain` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/network/subdomain */
		setSubdomain: (id: string, subdomain: string, options?: RequestOptions): Promise<APIApplicationSubdomain> =>
			this.client.request({ method: "PATCH", path: `/v1/apps/${encodePathSegment(id)}/network/subdomain`, query: withWorkspace(options), body: { subdomain }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/apps/:id/network/publish` — scope `apps:write`. `subdomain` omitted = platform picks one. @see https://docs.vertracloud.app/api-reference/endpoint/apps/network/publish */
		publish: (id: string, body?: { subdomain?: string }, options?: RequestOptions): Promise<APIApplicationWebPublish> =>
			this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/network/publish`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/apps/:id/network/publish` — scope `apps:write`. */
		unpublish: (id: string, options?: RequestOptions): Promise<APIApplicationWebPublish> => this.client.request({ method: "DELETE", path: `/v1/apps/${encodePathSegment(id)}/network/publish`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly envs = {
		/** `GET /v1/apps/:id/envs` — scope `apps:envs`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/enviroments/get */
		list: (id: string, options?: RequestOptions): Promise<APIApplicationEnvironment[]> => this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/envs`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/apps/:id/envs` — scope `apps:envs`. Accepts one env object or an array. @see https://docs.vertracloud.app/api-reference/endpoint/apps/enviroments/update */
		set: (id: string, body: RESTPostAPIApplicationEnvironmentBody, options?: RequestOptions): Promise<APIApplicationEnvironment[]> => this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/envs`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/apps/:id/envs/:envId` — scope `apps:envs`. */
		delete: (id: string, envId: string, options?: RequestOptions): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/apps/${encodePathSegment(id)}/envs/${encodePathSegment(envId)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly files = {
		/** `GET /v1/apps/:id/files` — scope `apps:files`. */
		list: (id: string, query?: FileListQuery, options?: RequestOptions): Promise<APIApplicationFile[]> => this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/files`, query: { ...query, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/apps/:id/files/tree` — scope `apps:files`. */
		tree: (id: string, options?: RequestOptions): Promise<APIApplicationFileTree[]> => this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/files/tree`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/apps/:id/files/content` — scope `apps:files`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/filemanager/content */
		read: (id: string, query: FileContentQuery, options?: RequestOptions): Promise<APIApplicationFileContent> =>
			this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/files/content`, query: { ...query, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PUT /v1/apps/:id/files` — scope `apps:files`. */
		write: (id: string, body: RESTPutAPIApplicationFileBody, options?: RequestOptions): Promise<void> => this.client.request({ method: "PUT", path: `/v1/apps/${encodePathSegment(id)}/files`, body: { ...body, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `PATCH /v1/apps/:id/files` — scope `apps:files`. Moves/renames a file. */
		move: (id: string, body: RESTPatchAPIApplicationFileMoveBody, options?: RequestOptions): Promise<void> => this.client.request({ method: "PATCH", path: `/v1/apps/${encodePathSegment(id)}/files`, body: { ...body, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/apps/:id/files` — scope `apps:files`. */
		delete: (id: string, body: RESTDeleteAPIApplicationFileBody, options?: RequestOptions): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/apps/${encodePathSegment(id)}/files`, body: { ...body, workspace_id: options?.workspaceId }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `POST /v1/apps/:id/files/upload` — scope `apps:files`. `multipart/form-data`, field `file`.
		 * `restart` query is serialized as the string `"true"`/`"false"`.
		 * `options.path` is the destination folder inside the app; omitted or empty means the root.
		 * A ZIP is extracted into that folder; any other file is written to `path/<filename>`.
		 * `options.message` is the commit message shown in the release history (up to 500 characters).
		 */
		upload: (id: string, file: Blob, filename: string, options?: RequestOptions & { restart?: boolean; path?: string; message?: string }): Promise<APIApplicationFileUpload> => {
			const form = new FormData();
			form.set("file", file, filename);
			if (options?.message !== undefined) form.set("message", options.message);
			return this.client.request({
				method: "POST",
				path: `/v1/apps/${encodePathSegment(id)}/files/upload`,
				query: { restart: options?.restart, path: options?.path, workspace_id: options?.workspaceId },
				form,
				signal: options?.signal,
				timeoutMs: options?.timeoutMs ?? 120_000,
			});
		},
	};
}

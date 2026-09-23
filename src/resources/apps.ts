import type { VertraClient } from "../client.js";
import { encodePathSegment } from "../client.js";
import type { SseEvent } from "../sse.js";
import type {
	APIApplication,
	APIApplicationCustomDomain,
	APIApplicationDeployment,
	APIApplicationDnsRecord,
	APIApplicationEnvironment,
	APIApplicationFile,
	APIApplicationFileContent,
	APIApplicationFileTree,
	APIApplicationFileUpload,
	APIApplicationMetric,
	APIApplicationOperationResponse,
	APIApplicationStatus,
	APIApplicationStatusShort,
	APIApplicationSubdomain,
	APIApplicationWebPublish,
	APIApplicationWebhook,
	APIApplicationWebhookUrl,
	APIRuntimesResponse,
	FileContentQuery,
	FileListQuery,
	RESTDeleteAPIApplicationFileBody,
	RESTPatchAPIApplicationFileMoveBody,
	RESTPatchAPIApplicationUpdateConfigBody,
	RESTPostAPIApplicationEnvironmentBody,
	RESTPostAPIApplicationWebhookCreateBody,
	RESTPutAPIApplicationFileBody,
	RequestOptions,
	RestartAppBody,
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
	runtimes(options?: RequestOptions): Promise<APIRuntimesResponse> {
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
	 * must be given. @see https://docs.vertracloud.app/api-reference/endpoint/apps/create
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
		return this.client.request({ method: "POST", path: "/v1/apps", form, signal: options.signal, timeoutMs: options.timeoutMs ?? 120_000 });
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
	restart(id: string, body?: RestartAppBody, options?: RequestOptions): Promise<APIApplicationOperationResponse> {
		return this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/restart`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `PATCH /v1/apps/:id/config` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/updateconfig */
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

	readonly network = {
		customDomain: {
			/** `GET /v1/apps/:id/network/custom` — scope `apps:read`. */
			get: (id: string, options?: RequestOptions): Promise<APIApplicationCustomDomain> => this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/network/custom`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

			/** `POST /v1/apps/:id/network/custom` — scope `apps:write`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/network/customdomain */
			set: (id: string, domain: string, options?: RequestOptions): Promise<APIApplicationCustomDomain> => this.client.request({ method: "POST", path: `/v1/apps/${encodePathSegment(id)}/network/custom`, query: withWorkspace(options), body: { domain }, signal: options?.signal, timeoutMs: options?.timeoutMs }),

			/** `DELETE /v1/apps/:id/network/custom` — scope `apps:write`. */
			remove: (id: string, options?: RequestOptions): Promise<void> => this.client.request({ method: "DELETE", path: `/v1/apps/${encodePathSegment(id)}/network/custom`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
		},

		/** `GET /v1/apps/:id/network/dns` — scope `apps:read`. @see https://docs.vertracloud.app/api-reference/endpoint/apps/network/dns */
		dns: (id: string, options?: RequestOptions): Promise<APIApplicationDnsRecord[]> => this.client.request({ method: "GET", path: `/v1/apps/${encodePathSegment(id)}/network/dns`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

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
		 */
		upload: (id: string, file: Blob, filename: string, options?: RequestOptions & { restart?: boolean }): Promise<APIApplicationFileUpload> => {
			const form = new FormData();
			form.set("file", file, filename);
			return this.client.request({
				method: "POST",
				path: `/v1/apps/${encodePathSegment(id)}/files/upload`,
				query: { restart: options?.restart, workspace_id: options?.workspaceId },
				form,
				signal: options?.signal,
				timeoutMs: options?.timeoutMs ?? 120_000,
			});
		},
	};
}

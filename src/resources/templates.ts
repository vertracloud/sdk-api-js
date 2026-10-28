import type { VertraClient } from "../client.js";
import { deferredPathSegment } from "../client.js";
import type {
	APIApplication,
	APIStack,
	APITemplate,
	APITemplateCategoryCount,
	APITemplateDeploy,
	APITemplateDeployEvent,
	APITemplateDetail,
	APITemplateDraft,
	APITemplateI18nText,
	APITemplateManifest,
	APITemplateShareLink,
	APITemplateShareLinkCreated,
	APITemplateSharePreview,
	APITemplateUpdateInfo,
	APITemplateValidation,
	APITemplateVersion,
	PaginationMeta,
	RESTGetAPITemplatesQuery,
	RESTPatchAPITemplateBody,
	RESTPostAPITemplateDeployBody,
	RESTPostAPITemplateFromAppBody,
	RESTPostAPITemplateFromStackBody,
	RESTPostAPITemplateReportBody,
	RESTPostAPITemplateShareCopyBody,
	RESTPostAPITemplateShareDeployBody,
	RESTPostAPITemplateShareLinkBody,
	RESTPostAPITemplateUpdateBody,
	RESTPutAPITemplateGithubBody,
	RequestOptions,
} from "../types.js";

/** `workspace_id` query param, sent only when given. */
function withWorkspace(options?: RequestOptions): Record<string, string | undefined> {
	return { workspace_id: options?.workspaceId };
}

/** Filters of `templates.list`. `workspace_id` is sent as in every other call, through the options (`workspaceId`) or here. */
export type TemplateListQuery = RESTGetAPITemplatesQuery;

/**
 * A manifest: the typed `APITemplateManifest`, any object that serializes to the manifest JSON, or the JSON text itself.
 */
export type TemplateManifestInput = APITemplateManifest | Record<string, unknown> | string;

/**
 * The ZIP of the code of each service of type `code`, by service id (a `Blob` or `File`). Services of type `image` need none:
 * they refer to an image of your account by id.
 */
export type TemplateSources = Record<string, Blob>;

export interface TemplateCreateOptions extends RequestOptions {
	manifest: TemplateManifestInput;
	/** Message of the first version. */
	changelog?: APITemplateI18nText;
	sources?: TemplateSources;
}

export type TemplateVersionCreateOptions = Omit<TemplateCreateOptions, "workspaceId">;

export interface TemplateDeployOptions extends RequestOptions {
	/**
	 * Makes the call safe to repeat: the same key with the same request returns the same job instead of creating a second set of resources;
	 * the same key with a different request fails with `IDEMPOTENCY_KEY_CONFLICT`. Sent only as the `Idempotency-Key` header, never in the
	 * body. Recommended for every call.
	 */
	idempotencyKey?: string;
}

export interface TemplateDeployEventsOptions extends RequestOptions {
	/** Ends the stream with `SseIdleTimeoutError` when no event arrives within this many ms. */
	idleTimeoutMs?: number;
}

function serializeManifest(manifest: TemplateManifestInput): string {
	return typeof manifest === "string" ? manifest : JSON.stringify(manifest);
}

/** Multipart body shared by `create` and `newVersion`: the manifest and changelog as JSON text fields, then one ZIP part per service. */
function buildTemplateForm(options: TemplateVersionCreateOptions & { workspaceId?: string }): FormData {
	const form = new FormData();
	form.set("manifest", serializeManifest(options.manifest));
	if (options.changelog !== undefined) form.set("changelog", JSON.stringify(options.changelog));
	if (options.workspaceId !== undefined) form.set("workspace_id", options.workspaceId);
	for (const id of Object.keys(options.sources ?? {}).sort()) {
		const source = options.sources?.[id];
		if (!source) throw new TypeError(`Source of service ${JSON.stringify(id)} is missing`);
		form.set(`sources[${id}]`, source, `${id}.zip`);
	}
	return form;
}

/**
 * `templates.*` — the catalog, using a template (deploy), your private templates, share links and updating what was created from a
 * template, under the `templates:read`, `templates:write` and `templates:deploy` scopes.
 *
 * A template describes what to create: one application, or a stack with applications, databases and a Blob folder. `deploy` returns a
 * job right away; follow it with `deploys.events` (Server-Sent Events) or read `deploys.get`. A job that fails is undone as a whole.
 * To act on a workspace, pass `workspaceId` (query) or `workspace_id` in the body of the calls that take one.
 * @see https://docs.vertracloud.app/api-reference
 */
export class TemplatesResource {
	constructor(private readonly client: VertraClient) {}

	/**
	 * `GET /v1/templates` — scope `templates:read`. A page of the catalog; with your key it also lists your private templates and adds the
	 * `account` context of each one. @see https://docs.vertracloud.app/api-reference/endpoint/templates/list
	 */
	list(query?: TemplateListQuery, options?: RequestOptions): Promise<PaginationMeta<APITemplate>> {
		return this.client.request({
			method: "GET",
			path: "/v1/templates",
			query: { ...query, workspace_id: options?.workspaceId ?? query?.workspace_id },
			signal: options?.signal,
			timeoutMs: options?.timeoutMs,
		});
	}

	/** `GET /v1/templates/:template_id` — scope `templates:read`. `idOrSlug` is the id or the slug. @see https://docs.vertracloud.app/api-reference/endpoint/templates/get */
	get(idOrSlug: string, options?: RequestOptions): Promise<APITemplateDetail> {
		return this.client.request({ method: "GET", path: `/v1/templates/${deferredPathSegment(idOrSlug)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/templates/categories` — scope `templates:read`. The public catalog, with the number of templates per category. @see https://docs.vertracloud.app/api-reference/endpoint/templates/categories */
	categories(options?: Omit<RequestOptions, "workspaceId">): Promise<APITemplateCategoryCount[]> {
		return this.client.request({ method: "GET", path: "/v1/templates/categories", signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/templates/:template_id/versions` — scope `templates:read`. Newest first. @see https://docs.vertracloud.app/api-reference/endpoint/templates/versions */
	versions(idOrSlug: string, options?: RequestOptions): Promise<APITemplateVersion[]> {
		return this.client.request({ method: "GET", path: `/v1/templates/${deferredPathSegment(idOrSlug)}/versions`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `POST /v1/templates/validate` — scope `templates:read`. Checks a manifest and creates nothing. A manifest that is not even an object is
	 * reported as findings, not as a malformed request. @see https://docs.vertracloud.app/api-reference/endpoint/templates/validate
	 */
	validate(manifest: unknown, options?: Omit<RequestOptions, "workspaceId">): Promise<APITemplateValidation> {
		return this.client.request({ method: "POST", path: "/v1/templates/validate", body: { manifest }, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `POST /v1/templates/:template_id/deploy` — scope `templates:deploy`. Creates, as one operation, everything the template describes; if a
	 * step fails, all that the job created is removed. Returns the job (`202`, `status: "queued"`; `200` with the same job when the
	 * `idempotencyKey` was already used). The workspace that will own what is created goes in `body.workspace_id`.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/templates/deploy
	 */
	deploy(idOrSlug: string, body: RESTPostAPITemplateDeployBody, options?: Omit<TemplateDeployOptions, "workspaceId">): Promise<APITemplateDeploy> {
		return this.client.request({
			method: "POST",
			path: `/v1/templates/${deferredPathSegment(idOrSlug)}/deploy`,
			body,
			headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
			signal: options?.signal,
			timeoutMs: options?.timeoutMs,
		});
	}

	/**
	 * `POST /v1/templates` — scope `templates:write`. `multipart/form-data`. Creates a private template with its first version. Each service of
	 * type `code` needs its ZIP in `sources` (by service id). `options.workspaceId` makes the workspace the owner. A refused manifest throws
	 * `ValidationError` with `TEMPLATE_MANIFEST_INVALID`; read the findings with `templateManifestIssues(error)`.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/templates/create
	 */
	create(options: TemplateCreateOptions): Promise<APITemplateDetail> {
		return this.client.request({ method: "POST", path: "/v1/templates", form: buildTemplateForm(options), signal: options.signal, timeoutMs: options.timeoutMs ?? 120_000 });
	}

	/**
	 * `POST /v1/templates/from-app/:app_id` — scope `templates:write`. Saves an application as a private template. Read `appDraft` first to
	 * review the variables and files. @see https://docs.vertracloud.app/api-reference/endpoint/templates/create-from-app
	 */
	fromApp(appId: string, body: RESTPostAPITemplateFromAppBody, options?: Omit<RequestOptions, "workspaceId">): Promise<APITemplateDetail> {
		return this.client.request({ method: "POST", path: `/v1/templates/from-app/${deferredPathSegment(appId)}`, body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/templates/from-stack/:stack_id` — scope `templates:write`. Saves a stack as a private template, one service per member. @see https://docs.vertracloud.app/api-reference/endpoint/templates/create-from-stack */
	fromStack(stackId: string, body: RESTPostAPITemplateFromStackBody, options?: Omit<RequestOptions, "workspaceId">): Promise<APITemplateDetail> {
		return this.client.request({ method: "POST", path: `/v1/templates/from-stack/${deferredPathSegment(stackId)}`, body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/templates/from-app/:app_id/draft` — scope `templates:write`. What the platform proposes when the application becomes a template; values are never included. @see https://docs.vertracloud.app/api-reference/endpoint/templates/draft */
	appDraft(appId: string, options?: RequestOptions): Promise<APITemplateDraft> {
		return this.client.request({ method: "GET", path: `/v1/templates/from-app/${deferredPathSegment(appId)}/draft`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/templates/from-stack/:stack_id/draft` — scope `templates:write`. Same as `appDraft`, for the members of a stack. @see https://docs.vertracloud.app/api-reference/endpoint/templates/draft */
	stackDraft(stackId: string, options?: RequestOptions): Promise<APITemplateDraft> {
		return this.client.request({ method: "GET", path: `/v1/templates/from-stack/${deferredPathSegment(stackId)}/draft`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `PATCH /v1/templates/:template_id` — scope `templates:write`. Changes the details of a private template (at least one field). A new manifest is a new version: use `newVersion`. @see https://docs.vertracloud.app/api-reference/endpoint/templates/update */
	update(id: string, body: RESTPatchAPITemplateBody, options?: RequestOptions): Promise<APITemplateDetail> {
		return this.client.request({ method: "PATCH", path: `/v1/templates/${deferredPathSegment(id)}`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `DELETE /v1/templates/:template_id` — scope `templates:write`. Removes a private template and revokes its links. What was already
	 * created from it keeps running. @see https://docs.vertracloud.app/api-reference/endpoint/templates/delete
	 */
	delete(id: string, options?: RequestOptions): Promise<void> {
		return this.client.request({ method: "DELETE", path: `/v1/templates/${deferredPathSegment(id)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `POST /v1/templates/:template_id/versions` — scope `templates:write`. `multipart/form-data`, like `create`. The version number of the
	 * manifest must be higher than the current one. @see https://docs.vertracloud.app/api-reference/endpoint/templates/new-version
	 */
	newVersion(id: string, options: TemplateVersionCreateOptions & Pick<RequestOptions, "workspaceId">): Promise<APITemplateVersion> {
		const { workspaceId, ...rest } = options;
		return this.client.request({
			method: "POST",
			path: `/v1/templates/${deferredPathSegment(id)}/versions`,
			query: { workspace_id: workspaceId },
			form: buildTemplateForm(rest),
			signal: options.signal,
			timeoutMs: options.timeoutMs ?? 120_000,
		});
	}

	/**
	 * `PUT /v1/templates/:template_id/github` — scope `templates:write`. Links the template to a repository that has the manifest at its root:
	 * each push to the branch creates a version. The repository must be in one of your GitHub App installations.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/templates/github-link
	 */
	linkGitHub(id: string, source: RESTPutAPITemplateGithubBody, options?: RequestOptions): Promise<APITemplateDetail> {
		const body: RESTPutAPITemplateGithubBody = source.branch === undefined ? { repository: source.repository } : { repository: source.repository, branch: source.branch };
		return this.client.request({ method: "PUT", path: `/v1/templates/${deferredPathSegment(id)}/github`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `DELETE /v1/templates/:template_id/github` — scope `templates:write`. @see https://docs.vertracloud.app/api-reference/endpoint/templates/github-unlink */
	unlinkGitHub(id: string, options?: RequestOptions): Promise<APITemplateDetail> {
		return this.client.request({ method: "DELETE", path: `/v1/templates/${deferredPathSegment(id)}/github`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `POST /v1/apps/:id/template/report` — scope `templates:write`. Reports the template an application came from to the platform. @see https://docs.vertracloud.app/api-reference/endpoint/templates/share-links/report */
	reportApp(appId: string, body: RESTPostAPITemplateReportBody, options?: RequestOptions): Promise<void> {
		return this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(appId)}/template/report`, query: withWorkspace(options), body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	readonly deploys = {
		/**
		 * `GET /v1/template-deploys/:deploy_id` — scope `templates:deploy`. The job. Outputs marked `once` come back on the first read of a
		 * finished job and are `null` afterwards: read them here, never on the stream.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/templates/deploy-status
		 */
		get: (deployId: string, options?: Omit<RequestOptions, "workspaceId">): Promise<APITemplateDeploy> => this.client.request({ method: "GET", path: `/v1/template-deploys/${deferredPathSegment(deployId)}`, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `GET /v1/template-deploys/:deploy_id/events` — scope `templates:deploy`. Server-Sent Events: yields the progress of the job (the current
		 * state first, then one event every time it changes step). Heartbeats are skipped and the iteration ends when the API closes the
		 * stream with its `end` event, when you `break`, or when `signal` aborts. There is no automatic reconnection. Events never carry
		 * outputs: read `deploys.get` at the end. Default `timeoutMs` is 10 minutes for the whole stream.
		 * @see https://docs.vertracloud.app/api-reference/endpoint/templates/deploy-events
		 */
		events: (deployId: string, options?: Omit<TemplateDeployEventsOptions, "workspaceId">): AsyncGenerator<APITemplateDeployEvent, void, unknown> => this.deployEvents(deployId, options),
	};

	readonly shareLinks = {
		/** `POST /v1/templates/:template_id/share-links` — scope `templates:write`. The token is in the answer and is shown only now. @see https://docs.vertracloud.app/api-reference/endpoint/templates/share-links/create */
		create: (templateId: string, body?: RESTPostAPITemplateShareLinkBody, options?: RequestOptions): Promise<APITemplateShareLinkCreated> =>
			this.client.request({ method: "POST", path: `/v1/templates/${deferredPathSegment(templateId)}/share-links`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/templates/:template_id/share-links` — scope `templates:write`. @see https://docs.vertracloud.app/api-reference/endpoint/templates/share-links/list */
		list: (templateId: string, options?: RequestOptions): Promise<APITemplateShareLink[]> => this.client.request({ method: "GET", path: `/v1/templates/${deferredPathSegment(templateId)}/share-links`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `DELETE /v1/templates/:template_id/share-links/:link_id` — scope `templates:write`. Revokes the link: no new use; what was already created from it is not affected. @see https://docs.vertracloud.app/api-reference/endpoint/templates/share-links/revoke */
		revoke: (templateId: string, linkId: string, options?: RequestOptions): Promise<APITemplateShareLink> =>
			this.client.request({ method: "DELETE", path: `/v1/templates/${deferredPathSegment(templateId)}/share-links/${deferredPathSegment(linkId)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly share = {
		/**
		 * `GET /v1/share/templates/:token` — scope `templates:read`. What the link gives, before using it. Fails with `SHARE_LINK_NOT_FOUND`,
		 * `SHARE_LINK_REVOKED`, `SHARE_LINK_EXPIRED` or `SHARE_LINK_EXHAUSTED`. @see https://docs.vertracloud.app/api-reference/endpoint/templates/share-links/preview
		 */
		preview: (token: string, options?: RequestOptions): Promise<APITemplateSharePreview> => this.client.request({ method: "GET", path: `/v1/share/templates/${deferredPathSegment(token)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/share/templates/:token/deploy` — scope `templates:deploy`. A link in `use` mode: the same as `deploy`, without a choice of version. A `full_copy` link is refused here: use `copy`. @see https://docs.vertracloud.app/api-reference/endpoint/templates/share-links/deploy */
		deploy: (token: string, body: RESTPostAPITemplateShareDeployBody, options?: Omit<TemplateDeployOptions, "workspaceId">): Promise<APITemplateDeploy> =>
			this.client.request({
				method: "POST",
				path: `/v1/share/templates/${deferredPathSegment(token)}/deploy`,
				body,
				headers: options?.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : undefined,
				signal: options?.signal,
				timeoutMs: options?.timeoutMs,
			}),

		/** `POST /v1/share/templates/:token/copy` — scope `templates:write`. A link in `full_copy` mode: gives you a private template of your own, independent of the author. @see https://docs.vertracloud.app/api-reference/endpoint/templates/share-links/copy */
		copy: (token: string, body?: RESTPostAPITemplateShareCopyBody, options?: Omit<RequestOptions, "workspaceId">): Promise<APITemplateDetail> =>
			this.client.request({ method: "POST", path: `/v1/share/templates/${deferredPathSegment(token)}/copy`, body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/share/templates/:token/report` — scope `templates:write`. Reports the template to the platform. @see https://docs.vertracloud.app/api-reference/endpoint/templates/share-links/report */
		report: (token: string, body: RESTPostAPITemplateReportBody, options?: Omit<RequestOptions, "workspaceId">): Promise<void> => this.client.request({ method: "POST", path: `/v1/share/templates/${deferredPathSegment(token)}/report`, body, signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	readonly updates = {
		/** `GET /v1/apps/:id/template/update` — scope `templates:deploy`. What updating the application to the latest version of its template would do. @see https://docs.vertracloud.app/api-reference/endpoint/templates/update-info */
		appInfo: (appId: string, options?: RequestOptions): Promise<APITemplateUpdateInfo> => this.client.request({ method: "GET", path: `/v1/apps/${deferredPathSegment(appId)}/template/update`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/**
		 * `POST /v1/apps/:id/template/update` — scope `templates:deploy`. Takes a safety snapshot, updates and, if it fails, goes back to the
		 * snapshot. Never automatic. Returns the job (`kind: "update"`). @see https://docs.vertracloud.app/api-reference/endpoint/templates/update
		 */
		appUpdate: (appId: string, body?: RESTPostAPITemplateUpdateBody, options?: RequestOptions): Promise<APITemplateDeploy> =>
			this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(appId)}/template/update`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/apps/:id/template/detach` — scope `templates:write`. The application stops receiving versions and becomes an ordinary one. @see https://docs.vertracloud.app/api-reference/endpoint/templates/detach */
		appDetach: (appId: string, options?: RequestOptions): Promise<APIApplication> => this.client.request({ method: "POST", path: `/v1/apps/${deferredPathSegment(appId)}/template/detach`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `GET /v1/stacks/:stack_id/template/update` — scope `templates:deploy`. Same as `appInfo`, for a stack. @see https://docs.vertracloud.app/api-reference/endpoint/templates/update-info */
		stackInfo: (stackId: string, options?: RequestOptions): Promise<APITemplateUpdateInfo> => this.client.request({ method: "GET", path: `/v1/stacks/${deferredPathSegment(stackId)}/template/update`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/stacks/:stack_id/template/update` — scope `templates:deploy`. Same as `appUpdate`, for a stack. @see https://docs.vertracloud.app/api-reference/endpoint/templates/update */
		stackUpdate: (stackId: string, body?: RESTPostAPITemplateUpdateBody, options?: RequestOptions): Promise<APITemplateDeploy> =>
			this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(stackId)}/template/update`, query: withWorkspace(options), body: body ?? {}, signal: options?.signal, timeoutMs: options?.timeoutMs }),

		/** `POST /v1/stacks/:stack_id/template/detach` — scope `templates:write`. The stack stops receiving versions of its template. @see https://docs.vertracloud.app/api-reference/endpoint/templates/detach */
		stackDetach: (stackId: string, options?: RequestOptions): Promise<APIStack> => this.client.request({ method: "POST", path: `/v1/stacks/${deferredPathSegment(stackId)}/template/detach`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs }),
	};

	private async *deployEvents(deployId: string, options?: TemplateDeployEventsOptions): AsyncGenerator<APITemplateDeployEvent, void, unknown> {
		for await (const event of this.client.requestSse({
			method: "GET",
			path: `/v1/template-deploys/${deferredPathSegment(deployId)}/events`,
			signal: options?.signal,
			timeoutMs: options?.timeoutMs ?? 600_000,
			idleTimeoutMs: options?.idleTimeoutMs,
		})) {
			if (event.event === "end") return;
			// `heartbeat` and any event this SDK does not know are skipped.
			if (event.event !== "progress" && event.event !== "message") continue;
			if (event.data === "") continue;
			let decoded: APITemplateDeployEvent;
			try {
				decoded = JSON.parse(event.data) as APITemplateDeployEvent;
			} catch {
				throw new Error("Could not decode a template deploy event");
			}
			yield decoded;
		}
	}
}

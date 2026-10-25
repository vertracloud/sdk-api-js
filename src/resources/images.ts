import type { VertraClient } from "../client.js";
import { deferredPathSegment } from "../client.js";
import type { APICustomImage, APICustomImageVersion, APIDockerfileCheck, RESTDeleteAPICustomImageBody, RESTPatchAPICustomImageBody, RESTPostAPICustomImageCheckBody, RESTPutAPICustomImageGithubBody, RequestOptions } from "../types.js";

/** Options of the routes that act on an image. `workspaceId` goes in the query, as on the app routes. */
export type ImageRequestOptions = RequestOptions;

/** Options of `check`, which does not act on an image and takes no workspace. */
export type ImageCheckOptions = Omit<RequestOptions, "workspaceId">;

/** `workspace_id` query param, sent only when given. */
function withWorkspace(options?: RequestOptions): Record<string, string | undefined> {
	return { workspace_id: options?.workspaceId };
}

/**
 * GitHub repository (`owner/name`) and optional branch an image is built from. Without `branch`, the repository's default
 * branch is used. A repository in one of your GitHub App installations is linked (a push to the branch rebuilds the image);
 * on `create`, a public repository outside your installations is built once, with no link.
 */
export type ImageGitHubSource = RESTPutAPICustomImageGithubBody;

export type CreateImageOptions = RequestOptions & {
	name: string;
	/** Optional free-text description, up to 128 characters. An empty string means no description. */
	description?: string;
} & (
		| {
				/** Build context: a ZIP file, up to 100 MB. Mutually exclusive with `github`. */
				file: Blob;
				github?: undefined;
		  }
		| {
				file?: undefined;
				/** Build from a GitHub repository instead of a file. Mutually exclusive with `file`. */
				github: ImageGitHubSource;
		  }
	);

export interface ImageLogsOptions extends ImageRequestOptions {
	/** Version whose build log to read. Default: the latest build. */
	versionId?: string;
	/** Ends the stream when no event arrives within this many ms. */
	idleTimeoutMs?: number;
}

/** A build context is sent with its own file name, so the platform reads the right format (ZIP). */
function contextFileName(file: Blob): string {
	const name = (file as { name?: unknown }).name;
	return typeof name === "string" && name !== "" ? name : "context.zip";
}

/**
 * `images.*` — custom Docker images, under the `images:read`, `images:write` and `images:delete` scopes.
 * @see https://docs.vertracloud.app/api-reference
 */
export class ImagesResource {
	constructor(private readonly client: VertraClient) {}

	/** `GET /v1/images` — scope `images:read`. @see https://docs.vertracloud.app/api-reference/endpoint/images/list */
	list(options?: ImageRequestOptions): Promise<APICustomImage[]> {
		return this.client.request({ method: "GET", path: "/v1/images", query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `GET /v1/images/:id` — scope `images:read`. @see https://docs.vertracloud.app/api-reference/endpoint/images/get */
	get(id: string, options?: ImageRequestOptions): Promise<APICustomImage> {
		return this.client.request({ method: "GET", path: `/v1/images/${deferredPathSegment(id)}`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `POST /v1/images` — scope `images:write`. `multipart/form-data`. Give exactly one of `file` or `github`.
	 * With `github`, `branch` is optional (default: the repository's default branch). A repository in your GitHub App
	 * installations is linked and each push to the branch rebuilds the image; a public repository outside them is built
	 * once, with no link (`github` is `null`). A private or missing repository outside them fails with `INSTALLATION_NOT_FOUND`.
	 * Asynchronous: returns in seconds with `status: "building"` (HTTP 202); poll `get` until `success` or `failed`.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/images/create
	 */
	create(options: CreateImageOptions): Promise<APICustomImage> {
		const form = new FormData();
		form.set("name", options.name);
		if (options.description !== undefined) form.set("description", options.description);
		if (options.file) form.set("file", options.file, contextFileName(options.file));
		if (options.github) {
			form.set("github_repository", options.github.repository);
			if (options.github.branch !== undefined) form.set("github_branch", options.github.branch);
		}
		if (options.workspaceId !== undefined) form.set("workspace_id", options.workspaceId);
		return this.client.request({ method: "POST", path: "/v1/images", form, signal: options.signal, timeoutMs: options.timeoutMs ?? 120_000 });
	}

	/**
	 * `PATCH /v1/images/:id` — scope `images:write`. Renames the image and/or changes its description (send only what
	 * changes; `description: null` or an empty string removes it). Builds nothing: apps keep running and nothing restarts.
	 * At least one field is required. A name already used by another of your images fails with `ValidationError`
	 * (`details.path: "name"`). Returns the updated image.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/images/update
	 */
	update(id: string, body: RESTPatchAPICustomImageBody, options?: ImageRequestOptions): Promise<APICustomImage> {
		return this.client.request({ method: "PATCH", path: `/v1/images/${deferredPathSegment(id)}`, body, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `PUT /v1/images/:id` — scope `images:write`. `multipart/form-data`. Replaces the whole build context and
	 * builds a new version; the apps keep running the current one until they are restarted or deployed.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/images/rebuild
	 */
	rebuild(id: string, file: Blob, options?: ImageRequestOptions): Promise<APICustomImage> {
		const form = new FormData();
		form.set("file", file, contextFileName(file));
		return this.client.request({ method: "PUT", path: `/v1/images/${deferredPathSegment(id)}`, form, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs ?? 120_000 });
	}

	/**
	 * `DELETE /v1/images/:id` — scope `images:delete`. Deletes the image, its versions and every app created from it.
	 * `confirmName` must equal the image name. Returns the ids of the apps deleted with it.
	 * When the image has apps, the key also needs the `apps:delete` scope.
	 * @see https://docs.vertracloud.app/api-reference/endpoint/images/delete
	 */
	delete(id: string, options: ImageRequestOptions & { confirmName: string }): Promise<{ deleted_apps: string[] }> {
		const body: RESTDeleteAPICustomImageBody = { confirm_name: options.confirmName };
		return this.client.request({ method: "DELETE", path: `/v1/images/${deferredPathSegment(id)}`, body, query: withWorkspace(options), signal: options.signal, timeoutMs: options.timeoutMs });
	}

	/** `GET /v1/images/:id/versions` — scope `images:read`. Newest first. @see https://docs.vertracloud.app/api-reference/endpoint/images/versions */
	versions(id: string, options?: ImageRequestOptions): Promise<APICustomImageVersion[]> {
		return this.client.request({ method: "GET", path: `/v1/images/${deferredPathSegment(id)}/versions`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `GET /v1/images/:id/logs` — scope `images:read`. Server-Sent Events: yields each line of the build log as a string.
	 * The stream repeats the history and then follows the build live; it ends when the server closes it. Like
	 * `apps.realtime`, there is no automatic reconnection: stop with `break` or an `AbortSignal`.
	 * Default `timeoutMs` is 10 minutes for the whole stream. @see https://docs.vertracloud.app/api-reference/endpoint/images/logs
	 */
	async *logs(id: string, options?: ImageLogsOptions): AsyncGenerator<string, void, unknown> {
		for await (const event of this.client.requestSse({
			method: "GET",
			path: `/v1/images/${deferredPathSegment(id)}/logs`,
			query: { version_id: options?.versionId, workspace_id: options?.workspaceId },
			signal: options?.signal,
			timeoutMs: options?.timeoutMs ?? 600_000,
			idleTimeoutMs: options?.idleTimeoutMs,
		})) {
			if (event.event === "log") yield event.data;
		}
	}

	/** `GET /v1/images/:id/context` — scope `images:read`. Temporary download URL of the current build context. @see https://docs.vertracloud.app/api-reference/endpoint/images/context */
	context(id: string, options?: ImageRequestOptions): Promise<{ url: string }> {
		return this.client.request({ method: "GET", path: `/v1/images/${deferredPathSegment(id)}/context`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `PUT /v1/images/:id/github` — scope `images:write`. Links the image to a repository in your GitHub App installations; `branch` is optional (default: the repository's default branch). @see https://docs.vertracloud.app/api-reference/endpoint/images/github-link */
	linkGitHub(id: string, source: ImageGitHubSource, options?: ImageRequestOptions): Promise<APICustomImage> {
		const body: RESTPutAPICustomImageGithubBody = source.branch === undefined ? { repository: source.repository } : { repository: source.repository, branch: source.branch };
		return this.client.request({ method: "PUT", path: `/v1/images/${deferredPathSegment(id)}/github`, body, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/** `DELETE /v1/images/:id/github` — scope `images:write`. Unlinks the image from GitHub. @see https://docs.vertracloud.app/api-reference/endpoint/images/github-unlink */
	unlinkGitHub(id: string, options?: ImageRequestOptions): Promise<APICustomImage> {
		return this.client.request({ method: "DELETE", path: `/v1/images/${deferredPathSegment(id)}/github`, query: withWorkspace(options), signal: options?.signal, timeoutMs: options?.timeoutMs });
	}

	/**
	 * `POST /v1/images/check` — scope `images:read`. Checks a `Dockerfile` and the paths of its build context before
	 * building. Creates nothing. Refusals block a build; warnings do not. @see https://docs.vertracloud.app/api-reference/endpoint/images/check
	 */
	check(body: RESTPostAPICustomImageCheckBody, options?: ImageCheckOptions): Promise<APIDockerfileCheck> {
		return this.client.request({ method: "POST", path: "/v1/images/check", body, signal: options?.signal, timeoutMs: options?.timeoutMs });
	}
}

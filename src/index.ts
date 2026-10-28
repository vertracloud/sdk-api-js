export { VertraClient, encodePathSegment } from "./client.js";
export type { QueryParams, QueryValue, RequestConfig, VertraClientConfig } from "./client.js";

export { AppBuildFailedError, AppBuildTimeoutError, AuthenticationError, buildAPIError, DockerfileRefusedError, NotFoundError, PermissionError, RateLimitError, templateDetachConfirmation, templateManifestIssues, templateSecretFiles, templateUpdateBlockedDetails, ValidationError, VertraAPIError } from "./errors.js";
export type { VertraAPIErrorBody } from "./errors.js";

export { parseSseStream, SseIdleTimeoutError } from "./sse.js";
export type { SseEvent, SseParseOptions } from "./sse.js";

export { AccountResource } from "./resources/account.js";
export { AppsResource, type CreateAppOptions, type WaitUntilReadyOptions } from "./resources/apps.js";
export { BillingResource } from "./resources/billing.js";
export { DatabasesResource, type CreateDatabaseBody } from "./resources/databases.js";
export { ImagesResource, type CreateImageOptions, type ImageGitHubSource, type ImageLogsOptions, type ImageRequestOptions } from "./resources/images.js";
export { SnapshotsResource } from "./resources/snapshots.js";
export {
	StacksResource,
	type StackBindingDeleteOptions,
	type StackConnectionQuery,
	type StackDeleteResult,
	type StackMemberRemoveOptions,
} from "./resources/stacks.js";
export {
	TemplatesResource,
	type TemplateCreateOptions,
	type TemplateDeployEventsOptions,
	type TemplateDeployOptions,
	type TemplateListQuery,
	type TemplateManifestInput,
	type TemplateSources,
	type TemplateVersionCreateOptions,
} from "./resources/templates.js";
export { WorkspacesResource } from "./resources/workspaces.js";

export * from "./types.js";

export { VertraClient, encodePathSegment } from "./client.js";
export type { QueryParams, QueryValue, RequestConfig, VertraClientConfig } from "./client.js";

export {
	analyticsBusyRetryAfter,
	analyticsRangeExceedsPlan,
	AppBuildFailedError,
	AppBuildTimeoutError,
	AuthenticationError,
	buildAPIError,
	DockerfileRefusedError,
	NotFoundError,
	restoreCooldownRetryAfter,
	SnapshotJobError,
	snapshotExceedsStorage,
	WaitTimeoutError,
	SNAPSHOT_ERROR_CODES,
	snapshotRateLimited,
	PermissionError,
	RateLimitError,
	templateDetachConfirmation,
	templateManifestIssues,
	templateSecretFiles,
	templateUpdateBlockedDetails,
	ValidationError,
	VertraAPIError,
} from "./errors.js";
export type { VertraAPIErrorBody } from "./errors.js";

export type { DownloadedFile } from "./download.js";

export { parseSseStream, SseIdleTimeoutError } from "./sse.js";
export type { SseEvent, SseParseOptions } from "./sse.js";

export { AccountResource } from "./resources/account.js";
export { AppsResource, type CreateAppOptions, type DownloadOptions, type WaitUntilReadyOptions } from "./resources/apps.js";
export { BillingResource } from "./resources/billing.js";
export { DatabasesResource, type CreateDatabaseBody } from "./resources/databases.js";
export { ImagesResource, type CreateImageOptions, type ImageGitHubSource, type ImageLogsOptions, type ImageRequestOptions } from "./resources/images.js";
export { PlansResource } from "./resources/plans.js";
export { SnapshotJobsResource, SnapshotsResource, type SnapshotCreateAndWaitOptions, type SnapshotDownloadOptions, type SnapshotJobGetOptions, type SnapshotJobListOptions, type SnapshotJobWaitOptions, type SnapshotOptions, type SnapshotRestoreOptions } from "./resources/snapshots.js";
export {
	StacksResource,
	type StackBindingDeleteOptions,
	type StackConnectionQuery,
	type StackDeleteResult,
	type StackJobsWaitOptions,
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

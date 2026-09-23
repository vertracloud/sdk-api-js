export { VertraClient, encodePathSegment } from "./client.js";
export type { QueryParams, QueryValue, RequestConfig, VertraClientConfig } from "./client.js";

export { AuthenticationError, buildAPIError, NotFoundError, PermissionError, RateLimitError, ValidationError, VertraAPIError } from "./errors.js";
export type { VertraAPIErrorBody } from "./errors.js";

export { parseSseStream, SseIdleTimeoutError } from "./sse.js";
export type { SseEvent, SseParseOptions } from "./sse.js";

export { AccountResource } from "./resources/account.js";
export { AppsResource, type CreateAppOptions } from "./resources/apps.js";
export { BillingResource } from "./resources/billing.js";
export { DatabasesResource, type CreateDatabaseBody } from "./resources/databases.js";
export { SnapshotsResource } from "./resources/snapshots.js";
export { WorkspacesResource } from "./resources/workspaces.js";

export * from "./types.js";

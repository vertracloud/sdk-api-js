# Vertra Cloud JavaScript SDK

[![npm](https://img.shields.io/npm/v/@vertracloud/sdk-api.svg)](https://www.npmjs.com/package/@vertracloud/sdk-api)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Official JavaScript/TypeScript SDK for the [Vertra Cloud](https://vertracloud.app) public API: apps, databases, snapshots, account, workspaces and billing — one typed method per route.

- Works in Node.js 18.17+ and any runtime with `fetch`; ships ESM and CommonJS.
- Types come from `@vertracloud/api-types`, the same contract the API uses.
- No hidden retries, caching or state: errors come back as they happened.

## Installation

```bash
npm install @vertracloud/sdk-api
```

## Getting an API key

Sign in to the [dashboard](https://vertracloud.app), open **Settings → API keys** and create a key with only the scopes your code needs (e.g. `apps:read`, `apps:write`). Keep it out of your source code — the examples read it from `VERTRA_API_KEY`.

## Quick start

```ts
import { VertraClient } from "@vertracloud/sdk-api";

const client = new VertraClient({ apiKey: process.env.VERTRA_API_KEY! });

const me = await client.account.get();
console.log(`Hi ${me.name}! Plan: ${me.plan.name}`);

for (const app of me.applications) {
	console.log(app.id, app.name, app.status);
}
```

## Documentation

- Guide: [docs.vertracloud.app/sdks](https://docs.vertracloud.app/sdks)
- API reference and scopes: [docs.vertracloud.app/api-reference](https://docs.vertracloud.app/api-reference/introduction)

Every method has a doc comment with its HTTP route and the API key scope it needs.

## Usage

### Client options

```ts
const client = new VertraClient({
	apiKey: process.env.VERTRA_API_KEY!,
	timeoutMs: 10_000, // default 30s per call
	// baseUrl, userAgent and a custom `fetch` are also accepted
});
```

### Per-call options

Most methods take an options object last:

```ts
// Act on a resource that belongs to a workspace
const app = await client.apps.get(appId, { workspaceId });

// Give one slow call more time, or cancel it
await client.databases.reset(dbId, { timeoutMs: 120_000 });
await client.apps.logs(appId, { signal: AbortSignal.timeout(5_000) });
```

Nested resources are properties: `client.apps.deploys`, `client.apps.envs`, `client.workspaces.members`, `client.billing.orders`, …

### Apps

```ts
const app = await client.apps.get(appId);

await client.apps.restart(appId); // normal restart
await client.apps.restart(appId, { reinstall_dependencies: true });

const metrics = await client.apps.metrics(appId, { range: "24h" });
const logs = await client.apps.logs(appId);
```

### Uploading and downloading

Uploads take a `Blob` (on Node.js 20+, `openAsBlob` reads a file without loading it into memory). To download, use `downloadToFile`, which writes to disk as the bytes arrive and keeps memory constant whatever the size; `download` resolves to an `ArrayBuffer` and holds the whole file in memory, so keep it for small files.

```ts
import { openAsBlob } from "node:fs";

const app = await client.apps.create({
	file: await openAsBlob("app.zip"),
	name: "my-app",
	memory: 512,
});

await client.apps.downloadToFile(appId, "backup.zip");
```

`create` is asynchronous: it returns in seconds with the app in `status: "building"`. Follow it to the end with `waitUntilReady`, which resolves with the app once `up` and throws `AppBuildFailedError` if it ends `down` (`error.code` is the app's `last_build_error`, such as `INSTALL_OUT_OF_MEMORY`, or `APP_DOWN`; read `client.apps.logs(app.id)` for the detail) or `AppBuildTimeoutError` after `timeoutMs` (default 10 min; the build keeps going).

```ts
const ready = await client.apps.waitUntilReady(app.id, { timeoutMs: 300_000, intervalMs: 2_000 });
```

While the app builds, restart/start/stop/deploy/rollback fail with `409 APP_BUILDING`.

`apps.download` has no route of its own: it takes a manual snapshot of the app, follows the job when the API answers `202` and downloads that snapshot, so the API key needs `snapshots:write` **and** `snapshots:read` (a key with only `apps:files` cannot download the whole app; reading one file with `apps.files.read` still works). The snapshot stays in the snapshot list and counts against the snapshot limits (`429 SNAPSHOT_RATE_LIMITED`); an account without a plan cannot take a snapshot, but can still list and download the ones it has (`snapshots.list`, `snapshots.download`). It throws `SnapshotJobError` if the snapshot job fails and `WaitTimeoutError` after `waitTimeoutMs` (default 30 min; the snapshot keeps being taken).

```ts
const { path, bytes } = await client.apps.downloadToFile(appId, "backup.zip", { intervalMs: 2_000, waitTimeoutMs: 600_000, onProgress: (job) => console.log(job.status) });
```

`downloadToFile` is the recommended form for anything that can be large (a snapshot of several GB is fine): the zip goes to a temporary file next to the destination, is renamed to the final name only when the download ends, and a failure or cancellation removes the temporary file, so the destination never holds a partial file. It is Node.js only. `apps.download` (and `snapshots.download`) resolve with the whole zip as an `ArrayBuffer`, held in memory; `apps.downloadStream` (and `snapshots.downloadStream`) resolve with a `ReadableStream<Uint8Array>` for when you want to send the bytes somewhere other than a file.

A download has **no total deadline**: a large file just takes as long as it takes. It fails only when no byte arrives for `inactivityTimeoutMs` (default 60 s; the clock restarts at every chunk) with a `TimeoutError`, or when your `signal` aborts. `timeoutMs` limits each request (for the download, the wait for the response headers). `client.snapshots.downloadToFile(resourceId, snapshotId, path, { scope })` downloads an existing snapshot the same way (also `download` and `downloadStream`). A resource that belongs to a workspace takes `workspaceId` in the options of every `apps.download*`, `snapshots.*`, `snapshotJobs.*` and stack snapshot call; it is sent on each request of the flow (take the snapshot, follow the job, download). A body that ends before its `Content-Length` rejects (the `fetch` of Node.js reports it as a terminated request) and no file is kept.

### Realtime logs (SSE)

```ts
for await (const event of client.apps.realtime(appId)) {
	console.log(event.event, event.data);
}
```

Stop the stream with `break` or an `AbortSignal`. Pass `idleTimeoutMs` to also stop when no event arrives in time, and `since` to resume. There is no automatic reconnection.

### Custom images

An image is a build context with a `Dockerfile`. Create it from a ZIP file or from a GitHub repository, then run apps from it. Builds run in the background: `create` returns with `status: "building"`.

```ts
const image = await client.images.create({ name: "api", description: "Node 22 base", file: await openAsBlob("api.zip") });
// or: client.images.create({ name: "api", github: { repository: "acme/api", branch: "main" } })
// `branch` is optional (default: the repository's default branch). A repository in your GitHub App installations is linked and
// each push rebuilds the image; a public repository outside them is built once, with no link.

// Lines of the build log; the stream follows the build until it ends.
for await (const line of client.images.logs(image.id)) console.log(line);

const app = await client.apps.createFromImage({ image_id: image.id, name: "api", memory: 512, web: true, subdomain: "random" });
await client.apps.waitUntilReady(app.id);
```

`description` is optional (up to 128 characters). `images.update` renames the image and/or changes its description without building anything; apps keep running. Send only what changes, and `description: null` removes it:

```ts
await client.images.update(image.id, { name: "api-base", description: null });
```

`images.rebuildFromSource(id)` builds the image again without uploading anything: an image linked to GitHub uses the tip of the linked branch, any other uses the build context of the latest build, including a failed one. It counts toward the hourly deploy limit and returns with `status: "building"`. `images.rebuild(id, file)` replaces the context with a new ZIP.

`images.delete` needs `confirmName`, the image's name, and also deletes every app created from it. Pass `workspaceId` to act on an image that belongs to a workspace. A refused `Dockerfile` throws `DockerfileRefusedError`, whose `issues` lists what blocked the build.

### Templates

A template describes what to create: one application, or a stack with applications, databases and a Blob folder. `deploy` returns a job right away; follow it with `deploys.events` (Server-Sent Events) or read `deploys.get`. A job that fails is undone as a whole.

```ts
const page = await client.templates.list({ category: "bots", sort: "popular" });

// `idempotencyKey` is sent only as the Idempotency-Key header: repeating the call returns the same job.
const job = await client.templates.deploy("n8n", { name: "my-n8n", inputs: { admin_email: "me@example.com" } }, { idempotencyKey: crypto.randomUUID() });

// Progress: heartbeats are skipped and the loop ends when the API closes the stream.
for await (const event of client.templates.deploys.events(job.id)) console.log(event.status, event.current_step);

// Outputs are never sent on the stream: read them from the job.
const done = await client.templates.deploys.get(job.id);
```

Private templates: `create` and `newVersion` take the manifest and one ZIP per service that runs code (`sources`, by service id); `fromApp` and `fromStack` save what you already run (read `appDraft` / `stackDraft` first to review the variables). `shareLinks` creates, lists and revokes links; `share` previews, uses, copies or reports what a link gives. `updates` reads and runs the update of an app or stack that came from a template, and detaches it. `validate` checks a manifest without creating anything.

A refused manifest throws `ValidationError` with the code `TEMPLATE_MANIFEST_INVALID`; read the findings with `templateManifestIssues(error)`. The same family of readers covers `TEMPLATE_SECRET_IN_SOURCE` (`templateSecretFiles`), `TEMPLATE_UPDATE_BLOCKED` (`templateUpdateBlockedDetails`) and `TEMPLATE_DETACH_CONFIRMATION_REQUIRED` (`templateDetachConfirmation`); each returns `undefined` for any other error.

An application that came from an open template stops receiving versions when its code is changed. The calls that change code (`apps.files.write`, `move`, `delete`, `apps.files.upload` and `apps.deploys.webhook.create`) fail with `TEMPLATE_DETACH_CONFIRMATION_REQUIRED` until you send `confirm_detach: true` (`confirmDetach: true` on `upload`).

### Stacks

A stack groups applications, databases and Blob folders, and keeps the connection variables of each application up to date. Changes that alter variables or certificates return `restart_required` and `apps_to_restart`: an application reads them only when it starts, so the restart is yours to ask for.

```ts
const change = await client.stacks.create({
	name: "shop",
	members: [
		{ resource_type: "application", resource_id: appId },
		{ resource_type: "database", resource_id: dbId },
	],
	bindings: [{ app_id: appId, database_id: dbId }],
});
if (change.restart_required) for (const id of change.apps_to_restart) await client.apps.restart(id);
```

`delete` needs `confirm_name` equal to the stack name; `mode: "dissolve"` removes only the stack (200). `mode: "delete_all"` deletes the members too (200 as well). Both resolve with `{ deleted_apps, deleted_databases, deleted_blob }` and are permanent: take a snapshot first (`stacks.snapshots.create`) if you may need the data again. `members`, `bindings` and `snapshots` group the routes of members, connections and whole-stack snapshots; `connection` returns code to connect an app to what it is linked to. Move a stack or a template to a workspace with `workspaces.stacks.add` and `workspaces.templates.add`. Error codes of both areas (`TEMPLATE_*`, `STACK_*`, `SHARE_LINK_*`, `BLOB_PREFIX_DENIED`, ...) are in `API_ERROR_CODES`, with `TEMPLATE_ERROR_CODES` and `STACK_ERROR_CODES` for each area.

### Database versions

```ts
// Versions available per engine type (keys are the database `type`)
const catalog = await client.databases.versions();
const db = await client.databases.create({ name: "meu-db", type: 1, ram: 512, version: catalog[1].recommended });
console.log(db.version); // major line, e.g. "18"
```

Omit `version` to get the recommended one; with `snapshot_id`, omit it to keep the snapshot's line (an older one fails with `SNAPSHOT_VERSION_NEWER`; an unknown one with `INVALID_DATABASE_VERSION`). A database's version cannot be changed after creation; security updates are applied when it is stopped and started.

### Snapshots

Deleting an app (`apps.delete`), deleting a database (`databases.delete`), resetting a database (`databases.reset`) and restoring a snapshot (`snapshots.restore`) run right away and are permanent: they replace or remove the current content. If you may need it again, take a snapshot first.

```ts
await client.snapshots.createAndWait(dbId, { scope: "databases" });
await client.databases.reset(dbId);
```

`apps.delete` resolves with nothing (`null`), `databases.delete` with the database id, `databases.reset` with `{ status: "success" }` and `snapshots.restore` with `{ job_id, warning? }`. Creating a snapshot can take over a minute, so it waits up to 120 s by default (`timeoutMs` overrides it per call).

#### Taking a snapshot

`snapshots.create` makes one request and resolves with `{ status: "ready", snapshot }`, or with `{ status: "accepted", job_id }` when the snapshot takes longer than about 90 s (the API answers `202` with `{ response: { job_id } }`). `snapshots.createAndWait` does the same and then follows the job, resolving with the snapshot once it is ready.

```ts
const snapshot = await client.snapshots.createAndWait(appId, { scope: "applications" });

const result = await client.snapshots.create(appId, { scope: "applications" });
if (result.status === "accepted") await client.snapshotJobs.wait(appId, result.job_id);
else console.log(result.snapshot.id);
```

All the waits behave the same: they resolve when the job is `ready`, throw `SnapshotJobError` (`status` `failed` or `skipped`, `reason`, `details`, `job`) when it ends any other way, and throw `WaitTimeoutError` (with the last `job`) when the total wait (`waitTimeoutMs`, default 30 min) passes; the snapshot keeps being taken. Everywhere, `timeoutMs` is the limit of each request and `waitTimeoutMs` the total wait. `onProgress` is called on every poll with the job, whose `progress` (`phase`, `percent`, `done_bytes`, `total_bytes`, `eta_seconds`) is set while it is `running`.

#### Restoring and following the job

A restore runs in the background. `snapshots.restore` resolves in seconds with `{ job_id, warning? }` and the resource is **not** restored yet; follow the job with `client.snapshotJobs`. While it runs, every write to the resource fails with `409 RESTORE_IN_PROGRESS`.

```ts
const { job_id, warning } = await client.snapshots.restore(appId, snapshotId, { scope: "applications" });
// warning === "IMAGE_VERSION_NOT_FOUND": only the data is restored

try {
	await client.snapshotJobs.wait(appId, job_id, {
		waitTimeoutMs: 600_000,
		intervalMs: 2_000,
		onProgress: (job) => console.log(job.status, job.progress?.percent),
	});
} catch (error) {
	if (error instanceof SnapshotJobError) console.error(error.reason, error.details); // an error code, such as SNAPSHOT_IMPORT_FAILED
	else throw error;
}

const recent = await client.snapshotJobs.list(appId, { scope: "applications", kind: "restore", limit: 5 }); // limit: 1 to 50, default 10
```

`snapshotJobs.wait` resolves with the job once it is `ready`, throws `SnapshotJobError` when it ends `failed` or `skipped` and `WaitTimeoutError` when `waitTimeoutMs` (the total wait, default 30 min) passes; the job keeps running. `snapshotJobs.get` reads it once; `scope` is optional on both, because the job id already identifies it (a job of another resource or account is `404 SNAPSHOT_NOT_FOUND`). `stacks.snapshots.restore` answers 202 with `{ jobs }` (one job per member, restored in series by the server, each with its own `warning` when its image version is gone; the stack is back when every job is `ready`; after a failure the later jobs end `failed` with `STACK_RESTORE_MEMBER_FAILED`). Follow the jobs with `stacks.snapshots.waitForRestore(accepted)` (one total wait for all of them) or call `stacks.snapshots.restoreAndWait`, which resolves with `{ jobs, finished }` (every job `ready`; it throws `SnapshotJobError` at the first member that fails). `stacks.snapshots.create` also answers 202, with `{ id, jobs }` (one snapshot job per member, databases first, each a regular manual snapshot); the stack snapshot is listed as `pending` and becomes `ready` when the last job ends. Follow the jobs with `stacks.snapshots.waitForCreate(accepted)` or call `stacks.snapshots.createAndWait`, which resolves with `{ id, jobs, finished }` and throws the same way.

Before the job is queued the call can be refused with `400 SNAPSHOT_EXCEEDS_STORAGE` (`snapshotExceedsStorage(error)` returns `requiredBytes`, `availableBytes` and, for databases, `requiredRamMb`), `409 APP_BUILDING`, `409 RESTORE_IN_PROGRESS` or `429 RESTORE_COOLDOWN` (a restore was done too recently on this resource; wait `retryAfter` seconds: `RateLimitError.retryAfter` or `restoreCooldownRetryAfter(error)`). A job that ends `failed` carries one of `SNAPSHOT_CORRUPTED`, `SNAPSHOT_TIMEOUT`, `SNAPSHOT_IMPORT_FAILED`, `SNAPSHOT_ENGINE_MISMATCH` or `SNAPSHOT_VERSION_NEWER` in `reason`.

#### Creating from a snapshot

`apps.create({ snapshotId })` and `databases.create({ snapshot_id })` answer `202` with `restore_job_id`: the resource exists and the data comes back in the background. A **code app** whose restore fails is deleted by the API; a **database** and an app on a **custom Docker image** are kept as they are (empty, or with what was written meanwhile), so always check the job.

```ts
const db = await client.databases.create({ name: "copy", ram: 512, snapshot_id: snapshotId });
const job = await client.snapshotJobs.wait(db.id, db.restore_job_id as string);
if (job.status === "failed") console.warn("The restore failed; the database was created empty");
```

While an app is being snapshotted, deploy, rollback, restart/start/stop, env changes, restore and file-manager writes fail with `409 OPERATION_IN_PROGRESS`; try again shortly.

#### Limits

Snapshot limits, answered with `429 SNAPSHOT_RATE_LIMITED` (read it with `snapshotRateLimited(error)`: `scope` is `resource` or `account`, plus `retryAfter` in seconds and, for the account quota, `resetsAt`):

- 8 snapshots per GB of plan RAM in a rolling 24 hours, per account;
- 1 snapshot every 180 s per resource;
- 1 request every 5 s per user (a plain `429 RATE_LIMIT_EXCEEDED` with `details.retry_after`, not `SNAPSHOT_RATE_LIMITED`);
- restore: the wait between restores is answered `429 RESTORE_COOLDOWN` (an app waits 60 s; a database 60 s per user and 120 s per database), not `SNAPSHOT_RATE_LIMITED`.

Other codes: `RESTORE_COOLDOWN`, `RESTORE_IN_PROGRESS`, `SNAPSHOT_EXCEEDS_STORAGE`, `SNAPSHOT_CORRUPTED`, `SNAPSHOT_IMPORT_FAILED`, `SNAPSHOT_ENGINE_MISMATCH`, `SNAPSHOT_VERSION_NEWER`, `APP_BUILDING`, `OPERATION_IN_PROGRESS`, `DATABASE_NOT_READY`, `SNAPSHOT_FAILED`, `SNAPSHOT_TIMEOUT` and `SNAPSHOT_TOO_LARGE` (`details.max_bytes`), listed in `SNAPSHOT_ERROR_CODES`. In the file manager, `files.read` and `files.write` handle files up to 10 MiB; larger ones fail with `413 FILE_TOO_LARGE` (`details.max_bytes`).

### Errors

Every non-2xx response throws a `VertraAPIError` carrying the HTTP `status`, the API `code` (e.g. `APP_NOT_FOUND`), `message` and `details`. The API key is never part of the error, even when it is logged:

```ts
import { NotFoundError, RateLimitError, VertraAPIError } from "@vertracloud/sdk-api";

try {
	await client.apps.get(appId);
} catch (error) {
	if (error instanceof NotFoundError) {
		// 404
	} else if (error instanceof RateLimitError) {
		console.log("retry after", error.retryAfter, "s"); // from the body, `details` or the header
	} else if (error instanceof VertraAPIError) {
		console.log(error.code, error.message);
	} else {
		throw error;
	}
}
```

Other subclasses: `AuthenticationError` (401), `PermissionError` (403 — including a missing key scope) and `ValidationError` (400/422). The error codes are listed in the [API reference](https://docs.vertracloud.app/api-reference/introduction).

### Releases and rollback

```ts
const { data } = await client.apps.releases.list(appId, { limit: 10 });
// Newest first. data[0] is usually the active release, and rolling back to it returns 409 RELEASE_ALREADY_ACTIVE,
// so pick the newest release that can be rolled back to.
const target = data.find((release) => release.status !== "active" && release.rollback.available);
if (!target) throw new Error("No release on this page can be rolled back to.");
const releaseId = target.id;

// Preview first: only environment variable names and their change, never values.
const preview = await client.apps.releases.previewRollback(appId, releaseId);

// Restores the release's code and restarts the app. Add restore_environment to restore its variables too.
await client.apps.releases.rollback(appId, releaseId, { restore_environment: false });

// Optional commit message shown in the release history.
await client.apps.files.upload(appId, zip, "app.zip", { message: "fix login" });

// Deploy settings (some options depend on the plan).
await client.apps.updateConfig(appId, { deploy: { auto_rollback: true, health_check_path: "/health" } });
```

### Plans and quotes

```ts
// Public route: sent without the API key. The plans for sale, their limits and the billing periods (1, 3, 6 or 12 months).
const catalog = await client.plans.list();
console.log(catalog.cycles, catalog.plans.map((plan) => `${plan.name} R$ ${plan.price}`));

// Price of a plan and period (scope `billing:read`), with an optional coupon, without creating an order. `total` is in BRL.
const quote = await client.billing.orders.quote({ plan: "starter-2", months: 6, coupon: "MYCODE" });
console.log(quote.total, quote.period_discount_percent, quote.legacy_price);
```

`client.billing.orders.create` takes the same `plan` and `months`.

### Testing your code

Pass your own `fetch` to the client to answer requests without touching the network:

```ts
const client = new VertraClient({ apiKey: "test", fetch: myFakeFetch });
```

## Coverage

| Domain | Resource | Routes |
|---|---|---|
| Apps | `client.apps` (+ `.deploys`, `.releases`, `.domains`, `.network`, `.envs`, `.files`, `.analytics`) | 46 |
| Images | `client.images` | 13 |
| Templates | `client.templates` (+ `.deploys`, `.shareLinks`, `.share`, `.updates`) | 32 |
| Stacks | `client.stacks` (+ `.members`, `.bindings`, `.snapshots`) | 20 |
| Databases | `client.databases` (+ `.credentials`) | 14 |
| Snapshots | `client.snapshots`, `client.snapshotJobs` | 7 |
| Account | `client.account` (+ `.sessions`, `.folders`, `.favorites`) | 10 |
| Workspaces | `client.workspaces` (+ `.members`, `.roles`, `.invites`, `.actionRequests`, `.apps`, `.databases`, `.templates`, `.stacks`, `.folders`, `.favorites`) | 34 |
| Billing | `client.billing` (+ `.orders`, with `orders.quote`) | 8 |
| Plans | `client.plans` | 1 (public) |

Dashboard-only features (activity log, notifications, API key management, the database **Data** tab, plan downgrade, creating workspace invites, approving action requests, and card payments: saved cards, paying an order by card, automatic renewal, coupon preview and receipts) are not part of the public API. See [what an API key cannot do](https://docs.vertracloud.app/sdks).

## Versioning

The SDK follows semantic versioning. Until `1.0.0`, minor releases may contain breaking changes; they are always called out in the [changelog](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. Before sending a change, run:

```bash
npm run typecheck && npx biome check . && npm test
```

## License

[MIT](LICENSE)

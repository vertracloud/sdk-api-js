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

Uploads take a `Blob` (on Node.js 20+, `openAsBlob` reads a file without loading it into memory); downloads resolve to an `ArrayBuffer`.

```ts
import { openAsBlob } from "node:fs";
import { writeFile } from "node:fs/promises";

const app = await client.apps.create({
	file: await openAsBlob("app.zip"),
	name: "my-app",
	memory: 512,
});

const zip = await client.apps.download(appId);
await writeFile("backup.zip", Buffer.from(zip));
```

`create` is asynchronous: it returns in seconds with the app in `status: "building"`. Follow it to the end with `waitUntilReady`, which resolves with the app once `up` and throws `AppBuildFailedError` if it ends `down` (`error.code` is the app's `last_build_error`, such as `INSTALL_OUT_OF_MEMORY`, or `APP_DOWN`; read `client.apps.logs(app.id)` for the detail) or `AppBuildTimeoutError` after `timeoutMs` (default 10 min; the build keeps going).

```ts
const ready = await client.apps.waitUntilReady(app.id, { timeoutMs: 300_000, intervalMs: 2_000 });
```

While the app builds, restart/start/stop/deploy/rollback fail with `409 APP_BUILDING`.

`client.snapshots.download` works the same way.

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

`delete` needs `confirm_name` equal to the stack name; `mode: "dissolve"` removes only the stack, `"delete_all"` deletes the members too. `members`, `bindings` and `snapshots` group the routes of members, connections and whole-stack snapshots; `connection` returns code to connect an app to what it is linked to. Move a stack or a template to a workspace with `workspaces.stacks.add` and `workspaces.templates.add`. Error codes of both areas (`TEMPLATE_*`, `STACK_*`, `SHARE_LINK_*`, `BLOB_PREFIX_DENIED`, ...) are in `API_ERROR_CODES`, with `TEMPLATE_ERROR_CODES` and `STACK_ERROR_CODES` for each area.

### Database versions

```ts
// Versions available per engine type (keys are the database `type`)
const catalog = await client.databases.versions();
const db = await client.databases.create({ name: "meu-db", type: 1, ram: 512, version: catalog[1].recommended });
console.log(db.version); // major line, e.g. "18"
```

Omit `version` to get the recommended one; with `snapshot_id`, omit it to keep the snapshot's line (an older one fails with `SNAPSHOT_VERSION_NEWER`; an unknown one with `INVALID_DATABASE_VERSION`). A database's version cannot be changed after creation; security updates are applied when it is stopped and started.

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
		console.log("retry after", error.retryAfter, "s");
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

### Testing your code

Pass your own `fetch` to the client to answer requests without touching the network:

```ts
const client = new VertraClient({ apiKey: "test", fetch: myFakeFetch });
```

## Coverage

| Domain | Resource | Routes |
|---|---|---|
| Apps | `client.apps` (+ `.deploys`, `.releases`, `.domains`, `.network`, `.envs`, `.files`) | 43 |
| Images | `client.images` | 12 |
| Templates | `client.templates` (+ `.deploys`, `.shareLinks`, `.share`, `.updates`) | 32 |
| Stacks | `client.stacks` (+ `.members`, `.bindings`, `.snapshots`) | 20 |
| Databases | `client.databases` (+ `.credentials`) | 14 |
| Snapshots | `client.snapshots` | 5 |
| Account | `client.account` (+ `.sessions`, `.folders`, `.favorites`) | 10 |
| Workspaces | `client.workspaces` (+ `.members`, `.roles`, `.invites`, `.actionRequests`, `.apps`, `.databases`, `.templates`, `.stacks`, `.folders`, `.favorites`) | 34 |
| Billing | `client.billing` (+ `.orders`) | 7 |

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

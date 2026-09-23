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

`client.snapshots.download` works the same way.

### Realtime logs (SSE)

```ts
for await (const event of client.apps.realtime(appId)) {
	console.log(event.event, event.data);
}
```

Stop the stream with `break` or an `AbortSignal`. Pass `idleTimeoutMs` to also stop when no event arrives in time, and `since` to resume. There is no automatic reconnection.

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

### Testing your code

Pass your own `fetch` to the client to answer requests without touching the network:

```ts
const client = new VertraClient({ apiKey: "test", fetch: myFakeFetch });
```

## Coverage

| Domain | Resource | Routes |
|---|---|---|
| Apps | `client.apps` (+ `.deploys`, `.network`, `.envs`, `.files`) | 36 |
| Databases | `client.databases` (+ `.credentials`) | 13 |
| Snapshots | `client.snapshots` | 5 |
| Account | `client.account` (+ `.sessions`, `.folders`, `.favorites`) | 10 |
| Workspaces | `client.workspaces` (+ `.members`, `.roles`, `.invites`, `.actionRequests`, `.apps`, `.databases`, `.folders`, `.favorites`) | 30 |
| Billing | `client.billing` (+ `.orders`) | 5 |

Dashboard-only features (activity log, notifications, API key management, the database **Data** tab, plan downgrade, creating workspace invites, transferring workspace ownership and approving action requests) are not part of the public API. See [what an API key cannot do](https://docs.vertracloud.app/sdks).

## Versioning

The SDK follows semantic versioning. Until `1.0.0`, minor releases may contain breaking changes; they are always called out in the [changelog](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome. Before sending a change, run:

```bash
npm run typecheck && npx biome check . && npm test
```

## License

[MIT](LICENSE)

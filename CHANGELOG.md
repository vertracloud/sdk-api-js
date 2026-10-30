# Changelog

## [0.3.3](https://github.com/vertracloud/sdk-api-js/compare/v0.3.2...v0.3.3) (2026-10-30)


### Features

* add templates and stacks resources ([bbff571](https://github.com/vertracloud/sdk-api-js/commit/bbff571b94c9c60e01a0d56fa5195016f4d062ac))


### Bug Fixes

* **templates:** neutral network mode descriptions ([c581c8b](https://github.com/vertracloud/sdk-api-js/commit/c581c8b701751d29e54d267cd9922ab76a7a093f))

## [0.3.2](https://github.com/vertracloud/sdk-api-js/compare/v0.3.1...v0.3.2) (2026-10-25)


### Features

* add images resource and database engine versions ([822a9f9](https://github.com/vertracloud/sdk-api-js/commit/822a9f97e5743f49debfaa0aca3b2c8d0cb2ad40))

## [0.3.1](https://github.com/vertracloud/sdk-api-js/compare/v0.3.0...v0.3.1) (2026-10-22)


### Features

* **apps:** Deno, .NET and Elixir and language on create ([98f7b19](https://github.com/vertracloud/sdk-api-js/commit/98f7b194595679a2c65954ac57c518943d916225))

## [0.3.0](https://github.com/vertracloud/sdk-api-js/compare/v0.2.1...v0.3.0) (2026-10-22)


### ⚠ BREAKING CHANGES

* plan names and multiple custom domains per app

### Features

* plan names and multiple custom domains per app ([816b8e9](https://github.com/vertracloud/sdk-api-js/commit/816b8e97a9ae2bc32e72e79e374d737ac4d2ec0e))


### Bug Fixes

* **deps:** lock @vertracloud/api-types 0.5.0 ([bc30074](https://github.com/vertracloud/sdk-api-js/commit/bc30074da9c6f06044e1668951c844cf6a065876))
* keep the API key out of inspected client output ([5711289](https://github.com/vertracloud/sdk-api-js/commit/571128946023af31f76715c9edc606918011d4e7))
* reject empty and dot path segments before sending a request ([597a439](https://github.com/vertracloud/sdk-api-js/commit/597a43992ab5ce416679bb824626ff738c5f1bbb))
* reject the promise on an invalid path segment instead of throwing synchronously ([2812cda](https://github.com/vertracloud/sdk-api-js/commit/2812cda3330b41cff25dcda130f966ad0b60fd53))

## [0.2.1](https://github.com/vertracloud/sdk-api-js/compare/v0.2.0...v0.2.1) (2026-10-18)


### Features

* **apps:** handle async app creation with waitUntilReady ([eaa3090](https://github.com/vertracloud/sdk-api-js/commit/eaa3090aa9cb55ee471066396b161d90a4c5e221))

## [0.2.0](https://github.com/vertracloud/sdk-api-js/compare/v0.1.5...v0.2.0) (2026-10-15)


* **deps:** @vertracloud/api-types 0.4.0 ([ebf0d9d](https://github.com/vertracloud/sdk-api-js/commit/ebf0d9d58a03163c6e11fa35d7e6a84542279d5f))


### Features

* pin @vertracloud/api-types 0.3.6 ([6b77406](https://github.com/vertracloud/sdk-api-js/commit/6b77406bb8416b4d151111215c4f746405acd655))

## [0.1.5](https://github.com/vertracloud/sdk-api-js/compare/v0.1.4...v0.1.5) (2026-10-12)


### Features

* **apps:** releases, rollback, deploy settings and upload message ([19889ad](https://github.com/vertracloud/sdk-api-js/commit/19889ad1e7ab5410fd92b5bde00ca2e26aed5bdd))

## [0.1.4](https://github.com/vertracloud/sdk-api-js/compare/v0.1.3...v0.1.4) (2026-10-10)


* release 0.1.4 ([2d5e823](https://github.com/vertracloud/sdk-api-js/commit/2d5e823b484e7dd6011e663f213706f4b20e1488))


### Features

* **apps:** add destination path option to file upload ([7bf30d2](https://github.com/vertracloud/sdk-api-js/commit/7bf30d25f6b1548620be4892cb8c1df1a8ebc10d))

## [0.1.3](https://github.com/vertracloud/sdk-api-js/compare/v0.1.2...v0.1.3) (2026-10-05)


* release 0.1.3 ([79788e4](https://github.com/vertracloud/sdk-api-js/commit/79788e40737562ac54d11db54207695e4c527ed3))


### Features

* **billing:** billing details, card provider and api-types 0.3.2 types ([ca56b89](https://github.com/vertracloud/sdk-api-js/commit/ca56b8987ad425866d3d8baea816f77896dd1d16))

## [0.1.2](https://github.com/vertracloud/sdk-api-js/compare/v0.1.1...v0.1.2) (2026-09-30)


* release 0.1.2 ([c404b68](https://github.com/vertracloud/sdk-api-js/commit/c404b68cad0f70ab3dfecc8661cce8cc76638bbc))

## [0.1.1](https://github.com/vertracloud/sdk-api-js/compare/v0.1.0...v0.1.1) (2026-09-23)


### Bug Fixes

* bump @vertracloud/api-types to 0.2.1 ([50bdadf](https://github.com/vertracloud/sdk-api-js/commit/50bdadfe78b8c8166d20938c3c191e9d34da23c3))
* drop resource-organization segment from folder and favorite routes ([e21b8ca](https://github.com/vertracloud/sdk-api-js/commit/e21b8cafe09fa7ce4ae20198e1b5ce40b5db131b))
* regenerate lockfile to drop stale cross-repo biome entry ([9ba2804](https://github.com/vertracloud/sdk-api-js/commit/9ba28041226c419929062e83ac8f68fcf41476a0))

## 0.1.0 (2026-09-23)


### Features

* add apps, databases, snapshots, account, workspaces and billing resources ([2c2aaf3](https://github.com/vertracloud/sdk-api-js/commit/2c2aaf3037d9b3d74a1f8ab510e2221bd838ab56))
* add HTTP client and error types ([667977a](https://github.com/vertracloud/sdk-api-js/commit/667977a7ba159427459031900a28b4da841cb14f))
* add SSE realtime log streaming ([818b26b](https://github.com/vertracloud/sdk-api-js/commit/818b26b2774f51aee36368e9600b96a89ef62f91))

## Changelog

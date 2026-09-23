import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	sourcemap: true,
	clean: true,
	splitting: false,
	target: "es2020",
	// Bundling api-types in (instead of leaving it external) lets esbuild resolve the real names
	// behind `export * from "@vertracloud/api-types/v1"` in types.ts — otherwise, in ESM output,
	// esbuild can't statically know an external module's export names and silently drops every
	// re-exported value (enums like `DatabaseType`) from the emitted `export {}` list. Types are
	// unaffected either way since `import type` erases at compile time.
	noExternal: ["@vertracloud/api-types"],
});

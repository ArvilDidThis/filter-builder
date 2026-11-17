import { defineConfig } from "tsdown";

export default defineConfig({
  // Two entry points on purpose: only `schema` imports Effect, so an app that
  // never validates filters never loads the Effect runtime.
  entry: ["src/index.ts", "src/schema.ts"],
  format: "esm",
  dts: true,
  clean: true,
});

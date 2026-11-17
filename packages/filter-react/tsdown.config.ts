import { defineConfig } from "tsdown";

export default defineConfig({
  // Two entry points on purpose: `index` is the headless hook, and `ui` adds the ready-made
  // components. An app that draws its own builder never loads the components.
  entry: { index: "src/index.ts", ui: "src/ui/index.ts" },
  format: "esm",
  dts: true,
  clean: true,
  // Both entries use React hooks, which run only in the browser. This line tells a framework
  // with server components (such as Next.js) to treat them that way.
  banner: { js: '"use client";' },
});

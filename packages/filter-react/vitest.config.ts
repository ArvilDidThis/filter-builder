import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The hooks need a browser-like page to render in.
    environment: "happy-dom",
    // Only the quick tests beside the source. The tests in `browser/` need a real browser
    // and have a config of their own: `vitest.browser.config.ts`.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});

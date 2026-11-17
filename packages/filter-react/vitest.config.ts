import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The hooks need a browser-like page to render in.
    environment: "happy-dom",
  },
});

import { fileURLToPath } from "node:url";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { baselinePath } from "./browser/baselines.ts";
import { browserCommands } from "./browser/commands.ts";
import { fixturePages } from "./browser/fixture-server.ts";
import { VIEWPORT } from "./browser/viewport.ts";

// The real-browser suite: `pnpm test:browser`. It is separate from `vitest.config.ts`, which
// runs the quick tests in a simulated page and needs no browser.

const provider = playwright({
  contextOptions: {
    // Lets the tests send real taps as well as real mouse input.
    hasTouch: true,
    // One pixel per CSS pixel, so screenshots are the same size on every screen.
    deviceScaleFactor: 1,
    // The tests choose light or dark themselves.
    colorScheme: "light",
    reducedMotion: "reduce",
  },
});

/** Lets the suite run on the library's source, so it needs no build first. */
const alias = {
  "@arvilmena/filter-core": fileURLToPath(
    new URL("../filter-core/src/index.ts", import.meta.url),
  ),
};

export default defineConfig({
  plugins: [fixturePages({ alias })],
  resolve: { alias },
  optimizeDeps: {
    // Named here so that Vite prepares them before the first test. A package it only finds
    // mid-run makes it load the page again, which fails whatever test was running.
    include: [
      "axe-core",
      "react",
      "react/jsx-dev-runtime",
      "react/jsx-runtime",
      "react-dom",
      "react-dom/client",
    ],
  },
  test: {
    include: ["browser/**/*.test.{ts,tsx}"],
    setupFiles: ["browser/setup.ts"],
    // A failed test is never run again to see whether it passes by chance.
    retry: 0,
    // One test file at a time in each browser. The tests send real mouse and key input, and
    // a page in the background is slowed down by its browser and may not get the input.
    fileParallelism: false,
    // How long a test waits for a condition before it fails. A condition that holds is seen
    // at once, so a generous limit costs nothing. Firefox needs about a second to finish
    // closing a tab.
    expect: { poll: { timeout: 5000 } },
    browser: {
      enabled: true,
      provider,
      headless: true,
      // The report page is for people. A run from a script needs none.
      ui: false,
      viewport: VIEWPORT,
      instances: [
        { browser: "chromium" },
        { browser: "firefox" },
        { browser: "webkit" },
      ],
      commands: browserCommands,
      // A failed test leaves a screenshot behind, under `.vitest/`. CI keeps that folder
      // for download. Playwright's own traces stay off: recording one sometimes fails in
      // WebKit, and that failed a test that had passed.
      screenshotFailures: true,
      trace: "off",
      expect: {
        toMatchScreenshot: {
          comparatorName: "pixelmatch",
          comparatorOptions: {
            // A pixel counts as changed once its colour moves a little, and one pixel in
            // a thousand may change. That lets through an edge that a browser smooths
            // slightly differently from run to run. A changed colour, corner, size or
            // layout is past it: squaring the corners alone fails the comparison.
            threshold: 0.05,
            allowedMismatchedPixelRatio: 0.001,
          },
          resolveScreenshotPath: ({ root, platform, browserName, arg }) =>
            baselinePath({ root, platform, browserName, name: arg }),
        },
      },
    },
  },
});

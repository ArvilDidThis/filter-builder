import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Runs the quick tests of `@arvilmena/filter-react` a second time, against React 18. The
// package says it supports React from version 18, and its own tests run against the newest.
//
// This folder is a package of its own because it needs its own copy of React. Inside
// `filter-react`, a second React would be handed the first one's helper packages.

/** The package whose tests are run. */
const filterReact = fileURLToPath(
  new URL("../../packages/filter-react/", import.meta.url),
);

/** This package's own copy of a package: the one built for React 18. */
const own = (name: string): string =>
  fileURLToPath(new URL(`./node_modules/${name}`, import.meta.url));

export default defineConfig({
  root: filterReact,
  resolve: {
    alias: [
      // Every import of React, from the source and from the tests, gets React 18. `$1` keeps
      // what follows the name, as in "react-dom/client".
      { find: /^react-dom($|\/.*)/, replacement: `${own("react-dom")}$1` },
      { find: /^react($|\/.*)/, replacement: `${own("react")}$1` },
      // The copy of the test helpers that was installed beside React 18, and so uses it.
      {
        find: /^@testing-library\/react$/,
        replacement: own("@testing-library/react"),
      },
    ],
  },
  test: {
    // The hooks need a browser-like page to render in.
    environment: "happy-dom",
    include: [
      // The same tests as `filter-react` runs itself.
      "src/**/*.test.{ts,tsx}",
      // And one that checks that those tests really get React 18.
      "react-18/react-version.test.ts",
    ],
  },
});

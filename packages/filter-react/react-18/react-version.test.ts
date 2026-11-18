import { renderHook } from "@testing-library/react";
import { useRef, version } from "react";
import { version as domVersion } from "react-dom";
import { expect, test } from "vitest";

// Guards the set-up of the React 18 run (`pnpm test:react18`, set up in `tests/react-18`). If
// the stand-in paths in its config ever stop working, the tests would quietly run against the
// newest React and still pass.
//
// It is kept in this package, beside the tests it guards, on purpose. A file finds "react"
// from the folder it is in. Here that is the newest React unless the stand-in paths work,
// just as for the tests in `src`. In `tests/react-18` it would find React 18 either way,
// and prove nothing. `pnpm test` does not run it.

test("the tests run against React 18", () => {
  expect(version).toMatch(/^18\./);
  expect(domVersion).toMatch(/^18\./);
});

test("the test helpers draw with the same React 18", () => {
  // A hook called under another copy of React throws, so this proves there is one copy.
  const { result } = renderHook(() => useRef(version));
  expect(result.current.current).toMatch(/^18\./);
});

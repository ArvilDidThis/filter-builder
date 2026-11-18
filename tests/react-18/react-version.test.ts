import { renderHook } from "@testing-library/react";
import { useRef, version } from "react";
import { version as domVersion } from "react-dom";
import { expect, test } from "vitest";

// Guards the set-up of this package. If the stand-in paths in `vitest.config.ts` ever stop
// working, the other tests would quietly run against the newest React and still pass.

test("the tests run against React 18", () => {
  expect(version).toMatch(/^18\./);
  expect(domVersion).toMatch(/^18\./);
});

test("the test helpers draw with the same React 18", () => {
  // A hook called under another copy of React throws, so this proves there is one copy.
  const { result } = renderHook(() => useRef(version));
  expect(result.current.current).toMatch(/^18\./);
});

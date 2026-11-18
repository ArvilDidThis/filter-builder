import { render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pressInOpenTree } from "./shadowPress.testing";
import { useOutsidePointerDown } from "./useOutsidePointerDown";

// Both pickers close through this hook, and their own tests cover where a press counts as
// outside. These tests cover what a picker cannot show: how often the hook calls back.

/** Counts the calls the hook makes for presses outside the box. */
const onOutside = vi.fn();

/** A box that listens for presses outside it. */
function Box() {
  const rootRef = useRef<HTMLDivElement>(null);
  useOutsidePointerDown(rootRef, true, onOutside);
  return <div ref={rootRef}>Box</div>;
}

afterEach(() => {
  onOutside.mockClear();
});

describe("useOutsidePointerDown", () => {
  it("should call back once for a press that both the page and a shadow tree hear", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const container = document.createElement("div");
    const beside = document.createElement("p");
    host.attachShadow({ mode: "open" }).append(container, beside);
    const { unmount } = render(<Box />, { container });
    // The page's listener can tell that this press is outside the box. The tree's own
    // listener hears the same press next.
    pressInOpenTree(host, beside);
    expect(onOutside).toHaveBeenCalledTimes(1);
    unmount();
    host.remove();
  });
});

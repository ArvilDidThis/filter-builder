import { fireEvent } from "@testing-library/react";

// Shared by the tests of both pickers. It is not part of the library.

/**
 * Sends a press on `pressed`, which is inside the open shadow tree of `host`, the way a
 * browser tells it. A shadow tree is a part of the page that hides its insides: a listener
 * outside the tree is told that the press was on the host. The test page does not hide the
 * pressed element itself, so the press answers by hand. An open tree still shows the whole
 * path of the press, which the test page gives as it is.
 */
export function pressInOpenTree(host: Element, pressed: Element): void {
  const tree = host.shadowRoot;
  if (tree === null) throw new Error("The host has no open shadow tree.");
  const press = new Event("pointerdown", { bubbles: true, composed: true });
  const isHeardInside = () =>
    press.currentTarget instanceof Node && tree.contains(press.currentTarget);
  Object.defineProperty(press, "target", {
    get: () => (isHeardInside() ? pressed : host),
    set: () => {},
  });
  fireEvent(pressed, press);
}

/**
 * Makes `host` stop every press on its way down into its shadow tree, as an app's own code
 * around a picker may. No listener inside the tree hears the press then.
 */
export function stopPressesAt(host: Element): void {
  host.addEventListener(
    "pointerdown",
    (press) => press.stopPropagation(),
    true,
  );
}

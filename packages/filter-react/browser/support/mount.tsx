import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

// Draws a React app into the real page, and takes it off again after the test.

const mounted: Root[] = [];

/**
 * Draws `app` on the page. Without a `container` it gets a new `<div>` at the end of the
 * body. Pass one to draw somewhere else, such as inside a shadow tree or a frame.
 */
export function mount(app: ReactNode, container?: Element): Element {
  const target = container ?? document.body.appendChild(newHolder());
  const root = createRoot(target);
  root.render(app);
  mounted.push(root);
  return target;
}

function newHolder(): HTMLElement {
  const holder = document.createElement("div");
  // Room around the app, so a popover that opens below or beside it stays on screen.
  holder.style.padding = "16px";
  return holder;
}

/** Takes every app drawn with `mount` off the page. */
export function unmountAll(): void {
  for (const root of mounted.splice(0)) root.unmount();
  // Everything on the page: the holders `mount` added, and whatever a test added to the
  // body itself, such as a frame.
  document.body.replaceChildren();
}

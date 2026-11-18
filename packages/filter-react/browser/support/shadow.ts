import styles from "../../styles.css?inline";

// A shadow tree for a test to draw into: a part of the page that hides its insides from the
// rest of the page.

/**
 * Adds the library's style sheet to a shadow tree or to a frame's `<head>`. The page's own
 * copy does not reach into either.
 */
export function addStyles(to: ShadowRoot | HTMLHeadElement): void {
  const sheet = document.createElement("style");
  sheet.textContent = styles;
  to.append(sheet);
}

/** A shadow tree on the page, with what a test needs around it. */
export interface ShadowStage {
  /** The element that holds the tree. It has padding, which is bare: nothing is drawn on it. */
  host: HTMLElement;
  /** The tree itself. A test keeps this way in, even to a closed tree. */
  shadow: ShadowRoot;
  /** An empty element inside the tree, to draw an app into. */
  container: HTMLElement;
  /** A button on the page, outside the tree. */
  outside: HTMLButtonElement;
}

/**
 * Puts a shadow tree on the page, with the library's styles in it. A closed tree (`mode`)
 * hides its insides even from the page's scripts.
 */
export function shadowStage(mode: ShadowRootMode): ShadowStage {
  const outside = document.createElement("button");
  outside.textContent = "Outside the tree";
  const host = document.createElement("div");
  host.style.padding = "16px";
  document.body.append(outside, host);
  const shadow = host.attachShadow({ mode });
  addStyles(shadow);
  const container = shadow.appendChild(document.createElement("div"));
  return { host, shadow, container, outside };
}

/**
 * A place on the bare padding of `host`, near its top left corner. Throws when something else
 * is drawn there, so that a test never presses the wrong thing.
 */
export function barePadding(host: HTMLElement): { x: number; y: number } {
  const box = host.getBoundingClientRect();
  const point = { x: box.left + 4, y: box.top + 4 };
  if (document.elementFromPoint(point.x, point.y) !== host)
    throw new Error("The host's padding is covered by something else.");
  return point;
}

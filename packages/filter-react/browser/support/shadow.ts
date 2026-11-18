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

/** Where a scrolling box is put: on the plain page, or in or around a shadow tree. */
export type BoxPlace =
  | "the page"
  | "an open shadow tree"
  | "a closed shadow tree"
  | "an open tree's slot";

/** Every place a scrolling box can be put, for a test that runs in each. */
export const BOX_PLACES: readonly BoxPlace[] = [
  "the page",
  "an open shadow tree",
  "a closed shadow tree",
  "an open tree's slot",
];

/** A scrolling box on the page, with what a test needs around it. */
export interface ScrollStage {
  /** The box that scrolls. */
  scroller: HTMLElement;
  /** An empty element inside the box, to draw an app into. */
  container: HTMLElement;
  /** Where to look for what the app draws: the page, or the shadow tree that holds it. */
  within: ParentNode;
}

/**
 * Puts a box that scrolls on the page, `width` by `height` pixels, for an app that is larger
 * than the box. With a shadow tree, the box is inside the tree, where the page never hears
 * its scroll. With "an open tree's slot" the app itself stays on the plain page, and the box
 * shows it through a slot (a gap in the tree), as a web component that scrolls its content
 * does.
 */
export function scrollStage(
  place: BoxPlace,
  size: { width: number; height: number },
): ScrollStage {
  const scroller = document.createElement("div");
  scroller.style.cssText = `width: ${size.width}px; height: ${size.height}px; overflow: auto;`;
  const container = document.createElement("div");
  if (place === "the page") {
    scroller.append(container);
    document.body.append(scroller);
    return { scroller, container, within: document };
  }
  if (place === "an open tree's slot") {
    const host = document.createElement("div");
    document.body.append(host);
    host.attachShadow({ mode: "open" }).append(scroller);
    scroller.append(document.createElement("slot"));
    host.append(container);
    return { scroller, container, within: document };
  }
  const { shadow, container: inTree } = shadowStage(
    place === "an open shadow tree" ? "open" : "closed",
  );
  scroller.append(container);
  inTree.append(scroller);
  return { scroller, container, within: shadow };
}

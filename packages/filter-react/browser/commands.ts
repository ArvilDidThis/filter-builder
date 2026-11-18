import { existsSync } from "node:fs";
import type { CDPSession, Page } from "playwright";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";
import { baselinePath } from "./baselines.ts";
import { BLANK_PAGE_PATH } from "./fixture-paths.ts";

// Commands the tests call from the page. Each runs here, in Node, and drives the browser
// through Playwright. This is what makes the input real: the browser gets a mouse move or a
// finger at a place on the screen, and works out the events itself.

/** A place in the test page, in CSS pixels from its top left corner. */
export interface Point {
  x: number;
  y: number;
}

/**
 * Turns a place in the test page into a place in the browser window. Vitest draws the test
 * page in a frame (a page within the page), and Playwright's mouse counts from the window.
 */
async function toWindow(
  context: BrowserCommandContext,
  point: Point,
): Promise<Point> {
  const frame = await context.frame();
  const element = await frame.frameElement();
  // Both are read anew for every input, and at the same time, as neither needs the other.
  const [box, inner] = await Promise.all([
    element.boundingBox(),
    frame.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    })),
  ]);
  if (box === null) throw new Error("The test page's frame is not on screen.");
  // The frame can be drawn smaller than the page it holds.
  return {
    x: box.x + (point.x * box.width) / inner.width,
    y: box.y + (point.y * box.height) / inner.height,
  };
}

/** Moves the real mouse to a place in the test page, in `steps` moves. */
const mouseMove: BrowserCommand<[point: Point, steps?: number]> = async (
  context,
  point,
  steps = 1,
) => {
  const { x, y } = await toWindow(context, point);
  await context.page.mouse.move(x, y, { steps });
};

/** Presses the real mouse's main button where the mouse is. */
const mouseDown: BrowserCommand<[]> = async (context) => {
  await context.page.mouse.down();
};

/** Lets go of the real mouse's main button. */
const mouseUp: BrowserCommand<[]> = async (context) => {
  await context.page.mouse.up();
};

/** Taps the screen once with a finger, at a place in the test page. */
const tap: BrowserCommand<[point: Point]> = async (context, point) => {
  const { x, y } = await toWindow(context, point);
  await context.page.touchscreen.tap(x, y);
};

/** One line to the browser's own debugging interface per page. Only Chromium has it. */
const debugLines = new WeakMap<Page, Promise<CDPSession>>();

function debugLine(context: BrowserCommandContext): Promise<CDPSession> {
  let line = debugLines.get(context.page);
  if (line === undefined) {
    line = context.context.newCDPSession(context.page);
    debugLines.set(context.page, line);
  }
  return line;
}

/** The pages with a finger on their screen, put there by `touch` and not lifted yet. */
const touched = new WeakSet<Page>();

/**
 * Puts a finger on the screen, moves it, or lifts it. Playwright itself can only tap, so this
 * asks Chromium's debugging interface for a real touch. The other browsers have no such way.
 */
const touch: BrowserCommand<
  [phase: "start" | "move" | "end", point?: Point]
> = async (context, phase, point) => {
  const line = await debugLine(context);
  const type = { start: "touchStart", move: "touchMove", end: "touchEnd" }[
    phase
  ] as "touchStart" | "touchMove" | "touchEnd";
  const touchPoints =
    point === undefined ? [] : [await toWindow(context, point)];
  await line.send("Input.dispatchTouchEvent", { type, touchPoints });
  if (phase === "end") touched.delete(context.page);
  else touched.add(context.page);
};

/**
 * Lifts a finger that `touch` left on the screen, as when a test failed before it lifted it.
 * Does nothing when no finger is down, so it is safe after every test and in every browser.
 */
const liftFinger: BrowserCommand<[]> = async (context) => {
  if (!touched.has(context.page)) return;
  touched.delete(context.page);
  const line = await debugLine(context);
  await line.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
};

/** Tells the page that the person's device is set to a light or a dark theme. */
const colorScheme: BrowserCommand<[scheme: "light" | "dark"]> = async (
  context,
  scheme,
) => {
  await context.page.emulateMedia({ colorScheme: scheme });
};

/** Whether a stored screenshot exists for this browser on this machine's system. */
const hasBaseline: BrowserCommand<[name: string]> = (context, name) =>
  existsSync(
    baselinePath({
      root: context.project.config.root,
      platform: process.platform,
      browserName: context.project.config.browser.name,
      name,
    }),
  );

/** One thing to do in a visited tab: click an element, or wait for one to hold a text. */
export type VisitStep =
  | { click: string }
  | { waitFor: string; toHoldText: string };

/** What a browser holds for a page: its local storage entries and its cookies, as text. */
export interface Held {
  local: Record<string, string>;
  cookie: string;
}

/**
 * Opens a page in a tab of its own, waits until it says it is ready, runs `steps` in it, and
 * then leaves it: by closing the tab, or by going to another address. Gives back what the
 * browser held for the page just before it was left.
 */
const visitAndLeave: BrowserCommand<
  [path: string, steps: readonly VisitStep[], leave: "close" | "navigate"]
> = async (context, path, steps, leave): Promise<Held> => {
  const origin = new URL(context.page.url()).origin;
  const tab = await context.context.newPage();
  try {
    await tab.goto(origin + path);
    await tab.locator("[data-ready]").waitFor();
    for (const step of steps) {
      if ("click" in step) {
        await tab.locator(step.click).click();
      } else {
        await tab.waitForFunction(
          ([selector, text]) =>
            document.querySelector(selector)?.textContent === text,
          [step.waitFor, step.toHoldText] as const,
        );
      }
    }
    const heldBeforeLeaving = await tab.evaluate(
      (): Held => ({ local: { ...localStorage }, cookie: document.cookie }),
    );
    if (leave === "navigate") {
      await tab.goto(origin + BLANK_PAGE_PATH);
    } else {
      // As a person closing the tab: the page is told that it is going away.
      await tab.close({ runBeforeUnload: true });
      if (!tab.isClosed()) await tab.waitForEvent("close");
    }
    return heldBeforeLeaving;
  } finally {
    if (!tab.isClosed()) await tab.close();
  }
};

/** Turns the real mouse's wheel where the mouse is, to scroll `deltaY` pixels down. */
const wheel: BrowserCommand<[deltaY: number]> = async (context, deltaY) => {
  await context.page.mouse.wheel(0, deltaY);
};

/** One element as the browser tells it to a screen reader, with the elements inside it. */
export interface ReaderNode {
  role: string;
  name: string;
  children: ReaderNode[];
}

/**
 * The test page as Chromium itself tells it to a screen reader: the browser's own
 * accessibility tree, read through its debugging interface. Elements that the browser keeps
 * from a screen reader are left out, and what is inside them moves up a level.
 *
 * Only Chromium offers this. Playwright has no way to ask Firefox or WebKit for theirs.
 */
const readerTree: BrowserCommand<[]> = async (context): Promise<ReaderNode> => {
  const line = await debugLine(context);
  // The test page is drawn in a frame, which has a tree of its own.
  const frame = await context.frame();
  interface FrameTree {
    frame: { id: string; url: string };
    childFrames?: FrameTree[];
  }
  const { frameTree } = (await line.send("Page.getFrameTree")) as {
    frameTree: FrameTree;
  };
  const find = (tree: FrameTree): string | undefined =>
    tree.frame.url === frame.url()
      ? tree.frame.id
      : tree.childFrames?.map(find).find((id) => id !== undefined);
  const frameId = find(frameTree);
  if (frameId === undefined) throw new Error("The test page's frame is gone.");
  await line.send("Accessibility.enable");
  const { nodes } = await line.send("Accessibility.getFullAXTree", { frameId });
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const build = (id: string): ReaderNode[] => {
    const node = byId.get(id);
    if (node === undefined) return [];
    const children = (node.childIds ?? []).flatMap(build);
    if (node.ignored) return children;
    return [
      {
        role: String(node.role?.value ?? ""),
        name: String(node.name?.value ?? ""),
        children,
      },
    ];
  };
  const root = nodes.find((node) => node.parentId === undefined);
  const [tree] = root ? build(root.nodeId) : [];
  if (tree === undefined) throw new Error("The browser reported no tree.");
  return tree;
};

/**
 * The element that `selector` finds in the test page, as Playwright reads it for a screen
 * reader: each element's role and name, as indented text. Playwright works this out itself
 * from the page, by the rules browsers are meant to follow. It is not the browser's own
 * account, so it cannot show a browser that departs from those rules.
 */
const ariaSnapshot: BrowserCommand<[selector: string]> = async (
  context,
  selector,
) => {
  const frame = await context.frame();
  return frame.locator(selector).ariaSnapshot();
};

/** The tab that `openPickerTab` opened for each test page, until `closePickerTab`. */
const pickerTabs = new WeakMap<Page, { tab: Page; line: CDPSession }>();

function pickerTab(context: BrowserCommandContext) {
  const open = pickerTabs.get(context.page);
  if (open === undefined)
    throw new Error("No tab is open: call openPickerTab.");
  return open;
}

/**
 * Opens a fixture page in a tab of its own and opens its first column picker with a real
 * click. A zoom with two fingers changes the part of a whole tab that is in view, and a page
 * in a frame is never told of it. So a test of that zoom needs a tab. Chromium only: the tab
 * is driven through its debugging interface.
 */
const openPickerTab: BrowserCommand<[path: string]> = async (context, path) => {
  await closePickerTab(context);
  const origin = new URL(context.page.url()).origin;
  const tab = await context.context.newPage();
  try {
    await tab.goto(origin + path);
    await tab.locator("[data-ready]").waitFor();
    await tab.locator(".fb-columns-trigger").first().click();
    await tab.locator(".fb-columns-popover").waitFor();
    const line = await context.context.newCDPSession(tab);
    pickerTabs.set(context.page, { tab, line });
  } catch (error) {
    await tab.close();
    throw error;
  }
};

/** Closes the tab that `openPickerTab` opened. Does nothing when none is open. */
const closePickerTab: BrowserCommand<[]> = async (context) => {
  const open = pickerTabs.get(context.page);
  if (open === undefined) return;
  pickerTabs.delete(context.page);
  if (!open.tab.isClosed()) await open.tab.close();
  // The test page is shown again, as it was before the tab opened over it.
  await context.page.bringToFront();
};

/**
 * The middle of the element that `selector` finds in the open tab, counted from the corner of
 * the part of the page in view. A finger is put down at such a place.
 */
function middleInView(tab: Page, selector: string): Promise<Point> {
  return tab.evaluate((chosen) => {
    const view = window.visualViewport as VisualViewport;
    const element = document.querySelector(chosen);
    if (element === null) throw new Error(`Nothing matches ${chosen}`);
    const box = element.getBoundingClientRect();
    // The debugging interface counts in the page's own pixels, whatever the zoom.
    return {
      x: box.left + box.width / 2 - view.offsetLeft,
      y: box.top + box.height / 2 - view.offsetTop,
    };
  }, selector);
}

/**
 * Zooms the open tab with two real fingers that move apart, as a person does on a touch
 * screen. The fingers start on the element that `selector` finds. `scale` is how many times
 * larger the page gets.
 */
const pinchPickerTab: BrowserCommand<
  [selector: string, scale: number]
> = async (context, selector, scale) => {
  const { tab, line } = pickerTab(context);
  const { x, y } = await middleInView(tab, selector);
  await line.send("Input.synthesizePinchGesture", {
    x,
    y,
    scaleFactor: scale,
    gestureSourceType: "touch",
  });
};

/**
 * Slides the zoomed page in the open tab with one real finger. The finger starts on the
 * element that `selector` finds and moves `right` pixels of the page to the right. The part
 * in view moves the other way.
 */
const panPickerTab: BrowserCommand<[selector: string, right: number]> = async (
  context,
  selector,
  right,
) => {
  const { tab, line } = pickerTab(context);
  const { x, y } = await middleInView(tab, selector);
  await line.send("Input.synthesizeScrollGesture", {
    x,
    y,
    xDistance: right,
    gestureSourceType: "touch",
  });
};

/** Where the popover in the open tab is, and which part of the tab's page is in view. */
export interface ZoomReading {
  /** How many times larger than usual the page is drawn. */
  scale: number;
  /** The part of the page in view: where it starts from the page's left edge, and its width. */
  viewLeft: number;
  viewWidth: number;
  /** The popover's left and right edges, from the page's left edge. `null` once it closed. */
  popoverLeft: number | null;
  popoverRight: number | null;
}

/** Reads the open tab: see `ZoomReading`. */
const readPickerTab: BrowserCommand<[]> = (context): Promise<ZoomReading> =>
  pickerTab(context).tab.evaluate((): ZoomReading => {
    const view = window.visualViewport as VisualViewport;
    const box = document
      .querySelector(".fb-columns-popover")
      ?.getBoundingClientRect();
    return {
      scale: view.scale,
      viewLeft: view.offsetLeft,
      viewWidth: view.width,
      popoverLeft: box?.left ?? null,
      popoverRight: box?.right ?? null,
    };
  });

/** Every command, by the name the tests call it with. */
export const browserCommands = {
  mouseMove,
  mouseDown,
  mouseUp,
  tap,
  touch,
  liftFinger,
  colorScheme,
  hasBaseline,
  visitAndLeave,
  wheel,
  readerTree,
  ariaSnapshot,
  openPickerTab,
  closePickerTab,
  pinchPickerTab,
  panPickerTab,
  readPickerTab,
};

declare module "vitest/browser" {
  interface BrowserCommands {
    mouseMove: (point: Point, steps?: number) => Promise<void>;
    mouseDown: () => Promise<void>;
    mouseUp: () => Promise<void>;
    tap: (point: Point) => Promise<void>;
    touch: (phase: "start" | "move" | "end", point?: Point) => Promise<void>;
    liftFinger: () => Promise<void>;
    colorScheme: (scheme: "light" | "dark") => Promise<void>;
    hasBaseline: (name: string) => Promise<boolean>;
    visitAndLeave: (
      path: string,
      steps: readonly VisitStep[],
      leave: "close" | "navigate",
    ) => Promise<Held>;
    wheel: (deltaY: number) => Promise<void>;
    readerTree: () => Promise<ReaderNode>;
    ariaSnapshot: (selector: string) => Promise<string>;
    openPickerTab: (path: string) => Promise<void>;
    closePickerTab: () => Promise<void>;
    pinchPickerTab: (selector: string, scale: number) => Promise<void>;
    panPickerTab: (selector: string, right: number) => Promise<void>;
    readPickerTab: () => Promise<ZoomReading>;
  }
}

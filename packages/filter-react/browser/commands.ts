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
  }
}

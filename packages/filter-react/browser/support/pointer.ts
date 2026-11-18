import { commands } from "vitest/browser";
import type { Point } from "../commands";

export type { Point };

// Real pointer input at real places on the screen. The places are read from the page's own
// layout, so a test never guesses where a row is.

/**
 * The top left corner of the page that holds `element`, counted from the test page. It is
 * not the test page's own corner when the element is inside a frame (a page within the page).
 */
function pageCorner(element: Element): Point {
  const corner = { x: 0, y: 0 };
  let frame = element.ownerDocument.defaultView?.frameElement ?? null;
  while (frame !== null) {
    const box = frame.getBoundingClientRect();
    // A frame's content starts inside its border.
    corner.x += box.left + frame.clientLeft;
    corner.y += box.top + frame.clientTop;
    frame = frame.ownerDocument.defaultView?.frameElement ?? null;
  }
  return corner;
}

/**
 * A place on `element`. `across` and `down` say how far along it, from 0 (its left or top
 * edge) to 1. Without them it is the middle.
 */
export function pointOn(element: Element, across = 0.5, down = 0.5): Point {
  const box = element.getBoundingClientRect();
  const corner = pageCorner(element);
  return {
    x: corner.x + box.left + box.width * across,
    y: corner.y + box.top + box.height * down,
  };
}

/** Just below the middle of a row: a drop here lands after that row. */
export const lowerHalf = (row: Element): Point => pointOn(row, 0.5, 0.9);

/** Just above the middle of a row: a drop here lands before that row. */
export const upperHalf = (row: Element): Point => pointOn(row, 0.5, 0.1);

/**
 * The middle of `element`, for real input to aim at. Throws when there is nothing to aim at:
 * the element was taken off its page, or it is drawn with no size. Its place would then read
 * as the page's corner, and the input would land on whatever is there.
 */
function aimAt(element: Element): Point {
  if (!element.isConnected)
    throw new Error("The element to press is no longer on the page.");
  const box = element.getBoundingClientRect();
  if (box.width === 0 && box.height === 0)
    throw new Error("The element to press is not drawn: it has no size.");
  return pointOn(element);
}

/**
 * Waits until `element` has kept its place for one screen frame. A list may still be scrolling
 * or being laid out just after it changed, and a press aimed too early would miss.
 */
async function untilStill(element: Element): Promise<void> {
  const place = (): string => {
    const { x, y } = aimAt(element);
    return `${x},${y}`;
  };
  let before = place();
  for (;;) {
    await new Promise((done) => requestAnimationFrame(done));
    const now = place();
    if (now === before) return;
    before = now;
  }
}

/** Presses the mouse button on the middle of `element`, and keeps it held. */
export async function pressOn(element: Element): Promise<void> {
  await untilStill(element);
  // Checked again here: the element may have gone while the last frame was awaited.
  await commands.mouseMove(aimAt(element));
  await commands.mouseDown();
}

/** Moves the mouse to `point` in a few steps, as a hand would. */
export async function moveTo(point: Point, steps = 5): Promise<void> {
  await commands.mouseMove(point, steps);
}

/** Lets go of the mouse button. */
export async function release(): Promise<void> {
  await commands.mouseUp();
}

/** Clicks the middle of `element` with the real mouse. */
export async function clickOn(element: Element): Promise<void> {
  await pressOn(element);
  await release();
}

/** Drags from the middle of `from` to `to` with the real mouse, and drops there. */
export async function dragTo(from: Element, to: Point): Promise<void> {
  await pressOn(from);
  await moveTo(to);
  await release();
}

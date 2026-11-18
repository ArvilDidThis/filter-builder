import type { RefObject } from "react";
import { useEarlyEffect } from "../useEarlyEffect";
import { listenForScrollAround } from "./scrollAround";

// Keeps a popover inside the visible screen. The style sheet places the popover beside its
// button. Where that would run past an edge of the screen, this measures by how much and hands
// the style sheet two numbers to correct it with.

/** The gap kept between the popover and the edge of the screen, in pixels. */
const SCREEN_MARGIN = 8;

/**
 * The CSS variable that says how far the style sheet moves the popover sideways. It holds a
 * length in pixels, negative to move left.
 */
const SHIFT_VARIABLE = "--fb-popover-shift";

/**
 * The CSS variable that says how much height the screen has left below the popover's top edge.
 * The style sheet caps the popover's height with it.
 */
const ROOM_VARIABLE = "--fb-popover-room";

/**
 * Keeps the popover that `popoverRef` points at inside the visible screen while `active` is
 * true. It moves the popover sideways only as far as needed, and caps its height to the room
 * below its top edge. It measures after each draw, when the window changes size, and when the
 * page or a box around the popover scrolls.
 *
 * On a page that a person has zoomed into with two fingers, "the visible screen" sideways is
 * the part of the page in view, where the popover can fit into that part.
 *
 * The style sheet does the moving: this only sets `--fb-popover-shift` and `--fb-popover-room`
 * on the popover's own element. Nothing is drawn again for it.
 */
export function useKeepOnScreen(
  popoverRef: RefObject<HTMLElement | null>,
  active: boolean,
): void {
  // After every draw, not only the first: a change inside the picker can move the popover,
  // such as its button growing wider. It runs before the browser paints, so the popover is
  // never seen in the wrong place. Costs one measurement of one element.
  useEarlyEffect(() => {
    if (active) keepOnScreen(popoverRef.current);
  });

  useEarlyEffect(() => {
    if (!active) return;
    const popover = popoverRef.current;
    // The popover's own window, which is not the global one when the popover is drawn inside
    // a frame (a page within the page).
    const view = popover?.ownerDocument.defaultView;
    if (!popover || !view) return;
    const onResize = () => keepOnScreen(popoverRef.current);
    view.addEventListener("resize", onResize);

    // Scrolling moves the popover on the screen without drawing anything again: the page
    // itself may scroll, or a scrolling box around the picker. A scroll is reported many
    // times a second, so the popover is measured at most once per screen frame.
    let frame: number | null = null;
    const measureSoon = () => {
      if (frame !== null) return;
      frame = view.requestAnimationFrame(() => {
        frame = null;
        keepOnScreen(popoverRef.current);
      });
    };
    const onScroll = (event: Event) => {
      // The list inside the popover scrolls without moving the popover.
      if (popoverRef.current?.contains(event.target as Node | null)) return;
      measureSoon();
    };
    // Heard on the page and in every shadow tree the popover is drawn in.
    const stopHearingScrolls = listenForScrollAround(popover, onScroll);

    // The part of the page in view (the browser's "visual viewport") changes when a person
    // zooms in with two fingers, and when they slide the zoomed page. Both are reported many
    // times a second, and neither is told to the window or the page. An older browser has
    // no such part, and the page's own width stands there.
    const seen = view.visualViewport;
    seen?.addEventListener("resize", measureSoon);
    seen?.addEventListener("scroll", measureSoon);

    return () => {
      view.removeEventListener("resize", onResize);
      stopHearingScrolls();
      seen?.removeEventListener("resize", measureSoon);
      seen?.removeEventListener("scroll", measureSoon);
      if (frame !== null) view.cancelAnimationFrame(frame);
    };
  }, [active, popoverRef]);
}

/** Measures the popover and sets the two variables the style sheet places it with. */
function keepOnScreen(popover: HTMLElement | null): void {
  if (popover === null) return;
  // The visible part of the popover's own page, without its scroll bars.
  const screen = popover.ownerDocument.documentElement;
  const box = popover.getBoundingClientRect();
  // Where the style sheet alone would put the popover: its place now, less the shift it
  // already has.
  const shiftNow = Number.parseFloat(
    popover.style.getPropertyValue(SHIFT_VARIABLE),
  );
  const start = box.left - (Number.isNaN(shiftNow) ? 0 : shiftNow);
  const across = widthInView(popover, box.width);
  const shift = shiftToFit(start, box.width, across.width, across.left);
  setPixels(popover, SHIFT_VARIABLE, shift === 0 ? null : shift);

  // A page with no layout, such as a simulated one in a test, reports no height. The style
  // sheet's own cap stands then.
  const room = screen.clientHeight - box.top - SCREEN_MARGIN;
  setPixels(popover, ROOM_VARIABLE, screen.clientHeight > 0 ? room : null);
}

/**
 * The stretch of the page, from left to right, that a popover `width` wide is kept inside:
 * where it starts and how wide it is. Both are measured as the popover's own place is, from
 * the left edge of the page's window.
 */
function widthInView(
  popover: HTMLElement,
  width: number,
): { left: number; width: number } {
  const page = popover.ownerDocument;
  // The visible part of the popover's own page, without its scroll bars.
  const whole = { left: 0, width: page.documentElement.clientWidth };
  // The part of the page in view. It is narrower than the page only after a person has
  // zoomed in with two fingers. An older browser does not report it.
  const seen = page.defaultView?.visualViewport;
  if (!seen) return whole;
  // Never past the page's own edges, whatever the browser reports.
  const left = Math.max(seen.offsetLeft, 0);
  const right = Math.min(seen.offsetLeft + seen.width, whole.width);
  // A part too narrow to hold the popover is not followed. The popover would be pinned to
  // its left edge, and no sliding of the page could bring the rest of the popover into view.
  const hasRoom = right - left >= width + 2 * SCREEN_MARGIN;
  return hasRoom ? { left, width: right - left } : whole;
}

/**
 * How far to move a box sideways so that it lies inside a screen `screenWidth` wide, with a
 * margin on both sides. It is 0 for a box that fits where it is. A box wider than the screen
 * keeps its left edge on the screen. The screen starts at `screenLeft`, which is 0 unless only
 * a part of the page is in view.
 */
export function shiftToFit(
  left: number,
  width: number,
  screenWidth: number,
  screenLeft = 0,
): number {
  // A page with no layout reports no width. There is nothing to fit the box into.
  if (screenWidth <= 0) return 0;
  const furthestLeft = screenLeft + screenWidth - SCREEN_MARGIN - width;
  // The left edge is checked last, so it wins when both cannot be met.
  const fitted = Math.max(
    Math.min(left, furthestLeft),
    screenLeft + SCREEN_MARGIN,
  );
  // Whole pixels, so the text inside is not drawn blurred between two pixels.
  return Math.round(fitted - left);
}

/** Sets a CSS variable on `element` to a length in pixels, or takes it off for `null`. */
function setPixels(
  element: HTMLElement,
  variable: string,
  pixels: number | null,
): void {
  const value = pixels === null ? "" : `${pixels}px`;
  // Written only when it changes, so a draw that moved nothing costs no new layout.
  if (element.style.getPropertyValue(variable) === value) return;
  if (pixels === null) element.style.removeProperty(variable);
  else element.style.setProperty(variable, value);
}

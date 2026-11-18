import { describe, expect, test } from "vitest";
import { commands, server } from "vitest/browser";
import type { ZoomReading } from "./commands";
import { tablePagePath } from "./fixture-paths";

// The popover on a page that a person has zoomed into with two fingers. The zoom leaves the
// page's layout alone and shows only a part of it, and the popover is kept inside that part.
//
// It needs a tab of its own: the zoom belongs to the whole tab, and the test page, which is
// drawn in a frame, is never told of it.
//
// Chromium only. Its debugging interface puts two real fingers on the screen and moves them
// apart. Playwright has no way to zoom like this in Firefox or WebKit, so nothing is checked
// there: `ColumnPicker.test.tsx` covers the sums with a made-up part in view.
//
// Not on Linux either, where CI runs. Chromium there takes the two fingers and does not
// zoom, with or without its `--enable-pinch` switch, so the test has nothing to check. It
// runs on a developer's Mac.

/** The gap the picker keeps between its popover and the edge of the part in view. */
const MARGIN = 8;

/** Whether the popover lies inside the part of the page in view, with the margin kept. */
function isInView(reading: ZoomReading): boolean {
  if (reading.popoverLeft === null || reading.popoverRight === null)
    return false;
  // A browser may round a place by part of a pixel, so half a pixel is let through.
  return (
    reading.popoverLeft >= reading.viewLeft + MARGIN - 0.5 &&
    reading.popoverRight <= reading.viewLeft + reading.viewWidth - MARGIN + 0.5
  );
}

describe.runIf(server.browser === "chromium" && server.platform !== "linux")(
  "the popover on a page zoomed with two fingers",
  () => {
    test("moves into the part in view, and follows it when the page is slid", async () => {
      await commands.openPickerTab(tablePagePath("tables=orders"));
      const start = await commands.readPickerTab();
      expect(start.scale).toBe(1);
      expect(isInView(start)).toBe(true);

      // Both fingers start on the popover. A finger put down beside it would close it, as
      // any press outside the picker does.
      await commands.pinchPickerTab(".fb-columns-popover", 2);
      await expect
        .poll(async () => (await commands.readPickerTab()).scale)
        .toBeCloseTo(2, 1);
      const zoomed = await commands.readPickerTab();
      // The part in view no longer starts at the page's left edge, where the popover was.
      expect(zoomed.viewLeft).toBeGreaterThan(
        (start.popoverLeft as number) + 1,
      );
      await expect
        .poll(async () => isInView(await commands.readPickerTab()))
        .toBe(true);
      const fitted = await commands.readPickerTab();
      // Moved only as far as it had to: its left edge is at the margin.
      expect(fitted.popoverLeft).toBeCloseTo(fitted.viewLeft + MARGIN, 0);

      // One finger slides the page to the left, which moves the part in view to the right.
      await commands.panPickerTab(".fb-columns-footer", -150);
      await expect
        .poll(async () => (await commands.readPickerTab()).viewLeft)
        .toBeGreaterThan(fitted.viewLeft + 100);
      await expect
        .poll(async () => {
          const now = await commands.readPickerTab();
          return isInView(now) && now.popoverLeft !== fitted.popoverLeft;
        })
        .toBe(true);
      const slid = await commands.readPickerTab();
      expect(slid.popoverLeft).toBeCloseTo(slid.viewLeft + MARGIN, 0);
    });
  },
);

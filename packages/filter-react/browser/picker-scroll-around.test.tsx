import { describe, expect, test } from "vitest";
import { commands, server } from "vitest/browser";
import {
  manyColumns,
  mountOpenPicker,
  openPicker,
  PickerApp,
  type PickerParts,
} from "./support/apps";
import { mount } from "./support/mount";
import {
  lowerHalf,
  moveTo,
  pointOn,
  pressOn,
  release,
} from "./support/pointer";
import { BOX_PLACES, scrollStage } from "./support/shadow";

// What scrolls around the picker, and what the picker's own list hands on to the page.
//
// Only a real browser lays the rows out, scrolls a box under a still pointer, and decides
// which box a turn of the wheel scrolls.

/** The height of one row of the list, in pixels. */
const ROW_HEIGHT = 32;

/** An app far taller than the box it is drawn in, so the box scrolls. */
function TallContent({ columns }: { columns?: number }) {
  return (
    <div style={{ height: 2000, paddingTop: 8 }}>
      <PickerApp
        columns={columns === undefined ? undefined : manyColumns(columns)}
      />
    </div>
  );
}

/** The label of the row that carries the drop line, with where on the row the line is. */
function dropLine(picker: PickerParts): string | undefined {
  const row = picker.rows().find((item) => item.dataset.drop);
  if (row === undefined) return undefined;
  const label = row.querySelector(".fb-columns-label")?.textContent;
  return `${row.dataset.drop} ${label}`;
}

describe.each(BOX_PLACES)(
  "a box around the picker that scrolls while a row is held, in %s",
  (place) => {
    test("moves the drop line, and the drop lands where the line shows", async () => {
      const { scroller, container, within } = scrollStage(place, {
        width: 600,
        height: 420,
      });
      mount(<TallContent />, container);
      const picker = await openPicker(within);
      expect(picker.row("Stock").getBoundingClientRect().height).toBe(
        ROW_HEIGHT,
      );

      await pressOn(picker.handle("Name"));
      await moveTo(lowerHalf(picker.row("Stock")));
      await expect.poll(() => dropLine(picker)).toBe("before Notes");

      // The box scrolls by one row under the still mouse, which is now over the lower half
      // of "Notes".
      scroller.scrollTop = ROW_HEIGHT;
      await expect.poll(() => scroller.scrollTop).toBe(ROW_HEIGHT);
      await expect.poll(() => dropLine(picker)).toBe("after Notes");

      await release();
      await expect
        .poll(picker.listed)
        .toEqual(["Price", "Stock", "Notes", "Name"]);
    });

    test("does not start the list scrolling by itself", async () => {
      const { scroller, container, within } = scrollStage(place, {
        width: 600,
        height: 600,
      });
      mount(<TallContent columns={16} />, container);
      const picker = await openPicker(within);
      const list = picker.list();
      // The list shows ten of its sixteen rows, so it could scroll.
      expect(list.clientHeight).toBe(10 * ROW_HEIGHT);
      let scrolls = 0;
      list.addEventListener("scroll", () => {
        scrolls += 1;
      });

      await pressOn(picker.handle("Column 3"));
      // Over the ninth row, just above its middle, and well away from the list's bottom
      // edge: 54 pixels above it, where the list starts to scroll at 28.
      const listBox = list.getBoundingClientRect();
      const corner = pointOn(list, 0.5, 0);
      await moveTo({ x: corner.x, y: corner.y + 8 * ROW_HEIGHT + 10 });
      await expect.poll(() => dropLine(picker)).toBe("before Column 8");
      expect(scrolls).toBe(0);

      // The box scrolls by 30 pixels. The still mouse is now below the ninth row's middle,
      // and 24 pixels from the list's bottom edge: where a moving pointer would scroll it.
      scroller.scrollTop = 30;
      await expect.poll(() => scroller.scrollTop).toBe(30);
      expect(list.getBoundingClientRect().top).toBe(listBox.top - 30);
      await expect.poll(() => dropLine(picker)).toBe("before Column 9");

      await release();
      // The drop lands where the line was: "Column 3" now stands just before "Column 9".
      await expect
        .poll(() => picker.listed().slice(7, 10))
        .toEqual(["Column 8", "Column 3", "Column 9"]);
      // The list never moved. Every scroll of it from the press to the drop was counted, so
      // nothing depends on looking at the right moment.
      expect(scrolls).toBe(0);
      expect(list.scrollTop).toBe(0);
    });
  },
);

describe("a scroll over the picker's list", () => {
  /** Draws the open picker with a list that scrolls, on a page that scrolls too. */
  async function openOnTallPage(): Promise<PickerParts> {
    const picker = await mountOpenPicker({ columns: manyColumns(16) });
    // Room below the picker, so the page has somewhere to scroll to.
    const room = document.body.appendChild(document.createElement("div"));
    room.style.height = "3000px";
    expect(window.scrollY).toBe(0);
    return picker;
  }

  /** The furthest the list scrolls. A browser may round it by part of a pixel. */
  const isAtEnd = (list: HTMLElement): boolean =>
    Math.abs(list.scrollTop - (list.scrollHeight - list.clientHeight)) <= 1;

  test("scrolls the list, and not the page, while the list has further to go", async () => {
    const picker = await openOnTallPage();
    const list = picker.list();
    await commands.mouseMove(pointOn(list));
    await commands.wheel(64);
    await expect.poll(() => list.scrollTop).toBeGreaterThan(0);
    expect(window.scrollY).toBe(0);
  });

  // The list once held such a scroll to itself, with a style rule. With that rule put back,
  // this fails in Chromium and WebKit. Firefox, as Playwright drives it, scrolls the page on
  // either way, so there it checks the outcome only.
  test("scrolls the page on once the list is at its end", async () => {
    const picker = await openOnTallPage();
    const list = picker.list();
    list.scrollTop = list.scrollHeight;
    await expect.poll(() => isAtEnd(list)).toBe(true);

    await commands.mouseMove(pointOn(list));
    await commands.wheel(64);
    await expect.poll(() => window.scrollY).toBeGreaterThan(0);
    // The picker is still open, and its list is where it was.
    expect(picker.popover()).not.toBeNull();
    expect(isAtEnd(list)).toBe(true);
  });

  // Only Chromium lets a test put a real finger down, move it and lift it.
  test.runIf(server.browser === "chromium")(
    "scrolls the page on under a finger once the list is at its end",
    async () => {
      const picker = await openOnTallPage();
      const list = picker.list();
      list.scrollTop = list.scrollHeight;
      await expect.poll(() => isAtEnd(list)).toBe(true);

      // On a column's name, not on a handle: a finger on a handle drags the row.
      const from = pointOn(
        picker.row("Column 12").querySelector("label") as Element,
      );
      await commands.touch("start", from);
      await commands.touch("move", { x: from.x, y: from.y - 40 });
      await commands.touch("move", { x: from.x, y: from.y - 120 });
      await expect.poll(() => window.scrollY).toBeGreaterThan(0);
      await commands.touch("end");
      // The finger scrolled. It did not tick the column it started on.
      expect(picker.checkbox("Column 12").checked).toBe(true);
      expect(picker.popover()).not.toBeNull();
    },
  );
});

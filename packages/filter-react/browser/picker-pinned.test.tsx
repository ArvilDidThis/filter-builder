import { type ColumnDefinition, columnPin } from "@arvilmena/filter-core";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { ColumnPicker } from "../src/ui/ColumnPicker";
import { useColumnSettings } from "../src/useColumnSettings";
import { type Counter, mountOpenPicker, openPicker } from "./support/apps";
import { mount } from "./support/mount";
import { moveTo, pointOn, pressOn, release } from "./support/pointer";

// Pinned columns in the picker, under a real pointer and a real keyboard, and in a table that
// keeps them in view with CSS of its own.

/** "Name" is pinned to the start and "Actions" to the end. */
const PINNED: readonly ColumnDefinition[] = [
  { key: "name", label: "Name", pinned: "start", hideable: false },
  { key: "price", label: "Price" },
  { key: "stock", label: "Stock" },
  { key: "notes", label: "Notes" },
  { key: "actions", label: "Actions", pinned: "end" },
];

/** Whether a row has a handle to move it by. */
const hasHandle = (row: Element): boolean =>
  row.querySelector("[data-fb-column-handle]") !== null;

describe("a pinned column in the picker", () => {
  test("is listed at its end with a pin in place of the handle", async () => {
    const picker = await mountOpenPicker({ columns: PINNED });
    expect(picker.listed()).toEqual([
      "Name",
      "Price",
      "Stock",
      "Notes",
      "Actions",
    ]);
    expect(picker.rows().map(hasHandle)).toEqual([
      false,
      true,
      true,
      true,
      false,
    ]);
    // The pin takes the handle's room, so every name starts at the same place.
    const lefts = picker
      .rows()
      .map((row) =>
        Math.round(
          (
            row.querySelector(".fb-columns-label") as Element
          ).getBoundingClientRect().left,
        ),
      );
    expect(new Set(lefts).size).toBe(1);
    const pin = picker.row("Name").querySelector(".fb-columns-pin") as Element;
    expect(pin.getBoundingClientRect().width).toBeGreaterThan(0);
  });

  test("stops a column moved with the keyboard", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ columns: PINNED, changed });
    picker.handle("Notes").focus();
    await userEvent.keyboard("{Home}");
    await expect
      .poll(picker.listed)
      .toEqual(["Name", "Notes", "Price", "Stock", "Actions"]);
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Notes"));
    expect(picker.announced()).toBe("Notes moved to position 2 of 5.");

    // Already next to the pinned column: the key changes nothing.
    await userEvent.keyboard("{ArrowUp}");
    await userEvent.keyboard("{End}");
    await expect
      .poll(picker.listed)
      .toEqual(["Name", "Price", "Stock", "Notes", "Actions"]);
    expect(changed.count).toBe(2);
    expect(picker.table()).toBe("name price stock notes actions");
  });

  test("stops a column dragged past it", async () => {
    const picker = await mountOpenPicker({ columns: PINNED });
    await pressOn(picker.handle("Notes"));
    // Onto the top of the pinned first row.
    await moveTo(pointOn(picker.row("Name"), 0.5, 0.1));
    // The line is drawn under the pinned row, where the column will land.
    await expect.poll(() => picker.row("Price").dataset.drop).toBe("before");
    expect(picker.row("Name").dataset.drop).toBeUndefined();
    await release();
    await expect
      .poll(picker.listed)
      .toEqual(["Name", "Notes", "Price", "Stock", "Actions"]);

    await pressOn(picker.handle("Notes"));
    // Onto the bottom of the pinned last row.
    await moveTo(pointOn(picker.row("Actions"), 0.5, 0.9));
    await expect.poll(() => picker.row("Actions").dataset.drop).toBe("before");
    await release();
    await expect
      .poll(picker.listed)
      .toEqual(["Name", "Price", "Stock", "Notes", "Actions"]);
    expect(picker.table()).toBe("name price stock notes actions");
  });
});

/** A wide table in a narrow box. Its own CSS keeps the pinned columns in view. */
function StickyTable() {
  const state = useColumnSettings({
    columns: PINNED,
    // Saved before any column was pinned, with the pinned ones in the middle.
    defaultValue: {
      order: ["price", "actions", "stock", "name", "notes"],
      hidden: [],
    },
  });
  return (
    <>
      <ColumnPicker state={state} />
      <div data-testid="scroller" style={{ width: 300, overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {state.visibleColumns.map((column) => (
                <th
                  data-pinned={columnPin(column)}
                  key={column.key}
                  style={{
                    minWidth: 150,
                    background: "Canvas",
                    ...(columnPin(column) === "start"
                      ? { position: "sticky", left: 0 }
                      : columnPin(column) === "end"
                        ? { position: "sticky", right: 0 }
                        : {}),
                  }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
    </>
  );
}

describe("a table that makes its pinned columns sticky", () => {
  test("keeps them in view while it scrolls sideways", async () => {
    mount(<StickyTable />);
    await expect
      .poll(() => document.querySelectorAll("th").length)
      .toBe(PINNED.length);
    const scroller = document.querySelector(
      '[data-testid="scroller"]',
    ) as HTMLElement;
    const heads = Array.from(document.querySelectorAll("th"));
    // The saved order had the pinned columns in the middle. They are at the ends now.
    expect(heads.map((head) => head.textContent)).toEqual([
      "Name",
      "Price",
      "Stock",
      "Notes",
      "Actions",
    ]);
    expect(heads.map((head) => head.dataset.pinned)).toEqual([
      "start",
      undefined,
      undefined,
      undefined,
      "end",
    ]);

    scroller.scrollLeft = 200;
    await expect.poll(() => scroller.scrollLeft).toBe(200);
    const box = scroller.getBoundingClientRect();
    const name = heads[0] as HTMLElement;
    const price = heads[1] as HTMLElement;
    const actions = heads.at(-1) as HTMLElement;
    // The pinned columns stay at the box's edges, and the others scroll under them.
    expect(Math.round(name.getBoundingClientRect().left)).toBe(
      Math.round(box.left),
    );
    expect(Math.round(actions.getBoundingClientRect().right)).toBe(
      Math.round(box.left + scroller.clientWidth),
    );
    expect(price.getBoundingClientRect().left).toBeLessThan(box.left);

    // The picker of the same table lists them as pinned.
    const picker = await openPicker();
    expect(picker.rows().map((row) => row.dataset.pinned)).toEqual([
      "start",
      undefined,
      undefined,
      undefined,
      "end",
    ]);
  });
});

import type { ColumnDefinition } from "@arvilmena/filter-core";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { addAppCss } from "./support/app-css";
import {
  type Counter,
  manyColumns,
  mountOpenDialog,
  mountOpenPicker,
  type PickerParts,
} from "./support/apps";
import {
  clickOn,
  lowerHalf,
  moveTo,
  pressOn,
  release,
  upperHalf,
} from "./support/pointer";

// Group drag in a real browser: selecting rows with a real mouse, and moving them together
// with a real pointer and a real keyboard, in the popover and in the dialog's grid.

/** A table's columns. "Symbol" is pinned to the start. */
const COLUMNS: readonly ColumnDefinition[] = [
  { key: "symbol", label: "Symbol", pinned: "start", hideable: false },
  { key: "company", label: "Company" },
  { key: "industry", label: "Industry" },
  { key: "cap", label: "Cap" },
  { key: "return", label: "Return" },
  { key: "age", label: "Age" },
  { key: "release", label: "Release" },
  { key: "beta", label: "Beta" },
];

/** Turns group drag on and selects the rows named, each with a real click. */
async function select(picker: PickerParts, ...labels: string[]) {
  await clickOn(picker.groupDrag());
  for (const label of labels) await clickOn(picker.selectBox(label));
  await expect.poll(picker.selected).toEqual(labels);
}

/**
 * What an app's style sheet may do to every checkbox: draw it itself. The browser's own
 * look is then gone, and with it the grey of a box that is turned off.
 */
const REDRAWN_CHECKBOXES = `
  input[type="checkbox"] {
    appearance: none;
    display: inline-block;
    width: 1rem;
    height: 1rem;
    border: 1px solid gray;
    background-color: white;
  }
`;

/**
 * The left edge of each part of every row, rounded: the box that selects (or the gap a pinned
 * row has there), the box that shows and hides, the handle (or the pin), and the name.
 */
function partLefts(picker: PickerParts): Record<string, Set<number>> {
  const parts = {
    select: ".fb-columns-select",
    checkbox: "input:not(.fb-columns-select)",
    handle: ".fb-columns-handle, .fb-columns-pin",
    label: ".fb-columns-label",
  };
  // Within one grid column of the dialog, so that every row has the same start.
  const [first] = picker.rows();
  const start = Math.round((first as Element).getBoundingClientRect().left);
  const rows = picker
    .rows()
    .filter((row) => Math.round(row.getBoundingClientRect().left) === start);
  return Object.fromEntries(
    Object.entries(parts).map(([name, selector]) => [
      name,
      new Set(
        rows.map((row) =>
          Math.round(
            (row.querySelector(selector) as Element).getBoundingClientRect()
              .left,
          ),
        ),
      ),
    ]),
  );
}

describe("how group drag looks", () => {
  test.each(["popover", "dialog"] as const)(
    "keeps the boxes, handles and names of every row lined up in the %s, the pinned row too",
    async (view) => {
      addAppCss(REDRAWN_CHECKBOXES);
      const open = view === "dialog" ? mountOpenDialog : mountOpenPicker;
      const picker = await open({ columns: COLUMNS });
      await clickOn(picker.groupDrag());
      await expect.poll(() => picker.selectBox("Company")).not.toBeNull();
      const lefts = partLefts(picker);
      for (const [part, places] of Object.entries(lefts)) {
        expect([part, places.size]).toEqual([part, 1]);
      }
      // The parts stand in this order, each clear of the one before it.
      const at = (part: string) =>
        [...(lefts[part] as Set<number>)][0] as number;
      expect(at("checkbox")).toBeGreaterThanOrEqual(at("select") + 16);
      expect(at("handle")).toBeGreaterThanOrEqual(at("checkbox") + 16);
      expect(at("label")).toBeGreaterThanOrEqual(at("handle") + 16);
      // The gap of the pinned row is as wide as the box of the others.
      const gap = picker.row("Symbol").querySelector(".fb-columns-select");
      expect(gap?.getBoundingClientRect().width).toBe(
        picker.selectBox("Company").getBoundingClientRect().width,
      );
    },
  );

  test.each([
    ["the browser draws the checkboxes", ""],
    ["an app's style sheet draws the checkboxes", REDRAWN_CHECKBOXES],
  ])(
    "dims the locked boxes and rings the box that selects, when %s",
    async (_, css) => {
      if (css !== "") addAppCss(css);
      const picker = await mountOpenPicker({ columns: COLUMNS });
      const opacity = (box: Element) => Number(getComputedStyle(box).opacity);
      const ring = (box: Element) => getComputedStyle(box).outlineStyle;
      // Before group drag: only the box of a column that must stay shown is locked.
      expect(opacity(picker.checkbox("Company"))).toBe(1);
      expect(opacity(picker.checkbox("Symbol"))).toBeLessThan(0.6);

      await clickOn(picker.groupDrag());
      await expect.poll(() => picker.checkbox("Company").disabled).toBe(true);
      // Every show/hide box is locked now, and clearly fainter than the box that selects.
      for (const label of ["Symbol", "Company", "Beta"]) {
        expect(opacity(picker.checkbox(label))).toBeLessThan(0.6);
        expect(ring(picker.checkbox(label))).toBe("none");
      }
      const select = picker.selectBox("Company");
      expect(opacity(select)).toBe(1);
      expect(ring(select)).toBe("solid");
      expect(getComputedStyle(select).outlineWidth).toBe("2px");
      // The ring stays when the box is ticked.
      await clickOn(select);
      await expect.poll(picker.selected).toEqual(["Company"]);
      expect(ring(select)).toBe("solid");

      // Turned off again, the boxes are as bright as before.
      await clickOn(picker.groupDrag());
      await expect.poll(() => picker.checkbox("Company").disabled).toBe(false);
      expect(opacity(picker.checkbox("Company"))).toBe(1);
    },
  );

  test("lets an app set how faint a locked box is, and the colour of the ring", async () => {
    addAppCss(
      ":root { --fb-locked-opacity: 0.25; --fb-select-ring: rgb(1, 2, 3); }",
    );
    const picker = await mountOpenPicker({ columns: COLUMNS });
    await clickOn(picker.groupDrag());
    await expect.poll(() => picker.checkbox("Company").disabled).toBe(true);
    expect(getComputedStyle(picker.checkbox("Company")).opacity).toBe("0.25");
    expect(getComputedStyle(picker.selectBox("Company")).outlineColor).toBe(
      "rgb(1, 2, 3)",
    );
  });
});

describe("group drag in the popover", () => {
  test("turns the show and hide boxes off, and gives movable rows a box to select them", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ columns: COLUMNS, changed });
    await clickOn(picker.groupDrag());
    await expect
      .poll(() => picker.groupDrag().getAttribute("aria-pressed"))
      .toBe("true");
    expect(picker.checkbox("Company").disabled).toBe(true);
    // A real click on a box that is turned off changes nothing.
    await clickOn(picker.checkbox("Company"));
    expect(changed.count).toBe(0);
    // The pinned row has a gap where the others have a box, so the names still line up.
    expect(picker.row("Symbol").querySelector("input.fb-columns-select")).toBe(
      null,
    );
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
    // A click on a row's name selects it.
    await clickOn(picker.row("Cap").querySelector("label") as Element);
    await expect.poll(picker.selected).toEqual(["Cap"]);
  });

  test("moves every selected row together under a real pointer", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ columns: COLUMNS, changed });
    await select(picker, "Cap", "Return", "Beta");
    await pressOn(picker.handle("Return"));
    await moveTo(upperHalf(picker.row("Company")));
    await expect
      .poll(() => picker.row("Company").getAttribute("data-drop"))
      .toBe("before");
    // Every row of the group is drawn as held.
    expect(
      picker.rows().filter((row) => row.hasAttribute("data-dragging")),
    ).toHaveLength(3);
    await release();
    await expect
      .poll(picker.listed)
      .toEqual([
        "Symbol",
        "Cap",
        "Return",
        "Beta",
        "Company",
        "Industry",
        "Age",
        "Release",
      ]);
    expect(picker.table()).toBe(
      "symbol cap return beta company industry age release",
    );
    // One change for the whole group.
    expect(changed.count).toBe(1);
    expect(picker.announced()).toBe(
      "3 columns moved to positions 2 to 4 of 8.",
    );
    // The selection is emptied, and group drag stays on.
    expect(picker.selected()).toEqual([]);
    expect(picker.groupDrag().getAttribute("aria-pressed")).toBe("true");
  });

  test("never takes a group past the pinned column", async () => {
    const picker = await mountOpenPicker({ columns: COLUMNS });
    await select(picker, "Age", "Beta");
    await pressOn(picker.handle("Beta"));
    await moveTo(upperHalf(picker.row("Symbol")));
    await release();
    await expect
      .poll(() => picker.listed().slice(0, 4))
      .toEqual(["Symbol", "Age", "Beta", "Company"]);
  });

  test("moves only the dragged row when that row is not selected", async () => {
    const picker = await mountOpenPicker({ columns: COLUMNS });
    await select(picker, "Cap", "Return");
    await pressOn(picker.handle("Beta"));
    await moveTo(lowerHalf(picker.row("Symbol")));
    await release();
    await expect
      .poll(() => picker.listed().slice(0, 3))
      .toEqual(["Symbol", "Beta", "Company"]);
    expect(picker.selected()).toEqual(["Cap", "Return"]);
  });

  test("moves the whole selection with the keyboard, and keeps the focus", async () => {
    const picker = await mountOpenPicker({ columns: COLUMNS });
    await select(picker, "Cap", "Return");
    picker.handle("Return").focus();
    await userEvent.keyboard("{ArrowUp}");
    await expect
      .poll(picker.listed)
      .toEqual([
        "Symbol",
        "Company",
        "Cap",
        "Return",
        "Industry",
        "Age",
        "Release",
        "Beta",
      ]);
    expect(picker.announced()).toBe(
      "2 columns moved to positions 3 to 4 of 8.",
    );
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Return"));
    // The rows stay selected, so the key can be pressed again.
    await userEvent.keyboard("{End}");
    await expect
      .poll(() => picker.listed().slice(-2))
      .toEqual(["Cap", "Return"]);
    await userEvent.keyboard("{Home}");
    await expect
      .poll(() => picker.listed().slice(0, 3))
      .toEqual(["Symbol", "Cap", "Return"]);
    expect(picker.selected()).toEqual(["Cap", "Return"]);
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Return"));
  });

  test("turns the boxes back on, and lets the selection go, when it is turned off", async () => {
    const picker = await mountOpenPicker({ columns: COLUMNS });
    await select(picker, "Cap");
    await clickOn(picker.groupDrag());
    await expect
      .poll(() => picker.groupDrag().getAttribute("aria-pressed"))
      .toBe("false");
    expect(picker.checkbox("Company").disabled).toBe(false);
    expect(document.querySelector("input.fb-columns-select")).toBeNull();
    await clickOn(picker.checkbox("Company"));
    await expect.poll(picker.table).not.toContain("company");
  });

  test("selects nothing while a search narrows the list", async () => {
    const picker = await mountOpenPicker({
      columns: COLUMNS,
      picker: { search: true },
    });
    await clickOn(picker.groupDrag());
    await userEvent.type(
      document.querySelector(".fb-columns-search-input") as Element,
      "ca",
    );
    await expect.poll(picker.listed).toEqual(["Cap"]);
    expect(picker.selectBox("Cap").disabled).toBe(true);
  });
});

describe("group drag in the dialog", () => {
  /** How many rows the first grid column holds. */
  const rowsInFirstGridColumn = (picker: PickerParts): number => {
    const lefts = picker
      .rows()
      .map((row) => Math.round(row.getBoundingClientRect().left));
    return lefts.filter((left) => left === lefts[0]).length;
  };

  test("moves the selected rows together across grid columns", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(60) });
    const perColumn = rowsInFirstGridColumn(picker);
    await select(picker, "Column 1", "Column 3", "Column 4");
    const target = perColumn + 5;
    await pressOn(picker.handle("Column 3"));
    await moveTo(upperHalf(picker.row(`Column ${target}`)));
    await release();
    // Three rows left the places before the target, so the group starts three earlier.
    await expect
      .poll(() => picker.listed().slice(target - 4, target))
      .toEqual([`Column ${target - 1}`, "Column 1", "Column 3", "Column 4"]);
    expect(picker.listed()[target]).toBe(`Column ${target}`);
    expect(picker.announced()).toBe(
      `3 columns moved to positions ${target - 2} to ${target} of 60.`,
    );
    expect(picker.selected()).toEqual([]);
  });

  test("moves the selection by one grid column with the right arrow key", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(60) });
    const perColumn = rowsInFirstGridColumn(picker);
    await select(picker, "Column 1", "Column 2");
    picker.handle("Column 1").focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .poll(() => picker.listed().slice(perColumn + 1, perColumn + 3))
      .toEqual(["Column 1", "Column 2"]);
    expect(picker.selected()).toEqual(["Column 1", "Column 2"]);
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Column 1"));
  });
});

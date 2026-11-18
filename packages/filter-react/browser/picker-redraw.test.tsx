import type { ColumnDefinition } from "@arvilmena/filter-core";
import { describe, expect, test } from "vitest";
import type { ColumnPickerProps } from "../src/ui/ColumnPicker";
import {
  type Counter,
  manyColumns,
  mountOpenPicker,
  standardRow,
} from "./support/apps";
import {
  clickOn,
  lowerHalf,
  moveTo,
  pressOn,
  release,
} from "./support/pointer";

// How much is redrawn. A table can be large, so it must hear of a move once, on the drop, and
// a tick must redraw one row of the picker, not all of them.

const COLUMNS: readonly ColumnDefinition[] = manyColumns(50);

/** Every column key, in the order the list starts in. */
const ALL_KEYS = COLUMNS.map((column) => column.key);

/** The rows a drag of "Column 0" down to "Column 4" may draw while it is held. */
const HELD_AND_PASSED = ["c0", "c1", "c2", "c3", "c4", "c5"];

/** The column keys a table's text names. */
const keysIn = (table: string | null): string[] => (table ?? "").split(" ");

/**
 * A way to draw the picker's rows that notes the key of each row it draws. The rows look and
 * work as the picker's own do.
 */
function countedRows(): {
  rowsDrawn: string[];
  renderRow: NonNullable<ColumnPickerProps["renderRow"]>;
} {
  const rowsDrawn: string[] = [];
  return {
    rowsDrawn,
    // One function for every render, as the picker asks for.
    renderRow: (row) => {
      rowsDrawn.push(row.column.key);
      return standardRow(row);
    },
  };
}

describe("what a real drag and a real tick redraw (item 9)", () => {
  test("hands the table the new order once per drop", async () => {
    const { rowsDrawn, renderRow } = countedRows();
    const tableDrawn: Counter = { count: 0 };
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({
      columns: COLUMNS,
      picker: { renderRow },
      tableDrawn,
      changed,
    });
    const drawnBefore = tableDrawn.count;
    rowsDrawn.length = 0;

    await pressOn(picker.handle("Column 0"));
    // Across several rows, so the drop line moves several times.
    for (const label of ["Column 1", "Column 2", "Column 3", "Column 4"]) {
      await moveTo(lowerHalf(picker.row(label)));
      await expect
        .poll(() => picker.rows().findIndex((row) => row.dataset.drop))
        .toBe(Number(label.slice("Column ".length)) + 1);
    }
    // The row is still held: the table has heard nothing and was not drawn again.
    expect(changed.count).toBe(0);
    expect(tableDrawn.count).toBe(drawnBefore);
    // The picker drew only the held row and the rows the drop line passed. A drag that
    // drew every row on each move would name all 50 here, many times over.
    expect(HELD_AND_PASSED).toEqual(expect.arrayContaining(rowsDrawn));
    expect(rowsDrawn.length).toBeLessThan(COLUMNS.length);

    await release();
    // The whole order, so a column that went missing elsewhere in the list fails too.
    await expect
      .poll(() => keysIn(picker.table()))
      .toEqual(["c1", "c2", "c3", "c4", "c0", ...ALL_KEYS.slice(5)]);
    expect(changed.count).toBe(1);
    expect(tableDrawn.count).toBe(drawnBefore + 1);
  });

  test("redraws one row of the picker per tick", async () => {
    const { rowsDrawn, renderRow } = countedRows();
    const tableDrawn: Counter = { count: 0 };
    const picker = await mountOpenPicker({
      columns: COLUMNS,
      picker: { renderRow },
      tableDrawn,
    });
    expect(new Set(rowsDrawn).size).toBe(COLUMNS.length);

    rowsDrawn.length = 0;
    const drawnBefore = tableDrawn.count;
    await clickOn(picker.checkbox("Column 3"));
    // Every other column is still shown, in its place.
    await expect
      .poll(() => keysIn(picker.table()))
      .toEqual(ALL_KEYS.filter((key) => key !== "c3"));
    expect(rowsDrawn).toEqual(["c3"]);
    expect(tableDrawn.count).toBe(drawnBefore + 1);

    rowsDrawn.length = 0;
    await clickOn(picker.row("Column 7").querySelector("label") as Element);
    await expect
      .poll(() => keysIn(picker.table()))
      .toEqual(ALL_KEYS.filter((key) => key !== "c3" && key !== "c7"));
    expect(rowsDrawn).toEqual(["c7"]);
  });
});

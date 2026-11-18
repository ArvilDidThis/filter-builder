import type { ColumnDefinition } from "@arvilmena/filter-core";
import { describe, expect, test } from "vitest";
import type { ColumnPickerProps } from "../src/ui/ColumnPicker";
import { type Counter, manyColumns, mountOpenPicker } from "./support/apps";
import { clickOn, moveTo, pointOn, pressOn, release } from "./support/pointer";

// How much is redrawn. A table can be large, so it must hear of a move once, on the drop, and
// a tick must redraw one row of the picker, not all of them.

const COLUMNS: readonly ColumnDefinition[] = manyColumns(50);

/** The column keys a table's text names. */
const keysIn = (table: string | null): string[] => (table ?? "").split(" ");

describe("what a real drag and a real tick redraw (item 9)", () => {
  test("hands the table the new order once per drop", async () => {
    const tableDrawn: Counter = { count: 0 };
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({
      columns: COLUMNS,
      tableDrawn,
      changed,
    });
    const drawnBefore = tableDrawn.count;

    await pressOn(picker.handle("Column 0"));
    // Across several rows, so the drop line moves several times.
    for (const label of ["Column 1", "Column 2", "Column 3", "Column 4"]) {
      await moveTo(pointOn(picker.row(label), 0.5, 0.9));
      await expect
        .poll(() => picker.rows().findIndex((row) => row.dataset.drop))
        .toBe(Number(label.slice("Column ".length)) + 1);
    }
    // The row is still held: the table has heard nothing and was not drawn again.
    expect(changed.count).toBe(0);
    expect(tableDrawn.count).toBe(drawnBefore);

    await release();
    await expect
      .poll(() => keysIn(picker.table()).slice(0, 6))
      .toEqual(["c1", "c2", "c3", "c4", "c0", "c5"]);
    expect(changed.count).toBe(1);
    expect(tableDrawn.count).toBe(drawnBefore + 1);
  });

  test("redraws one row of the picker per tick", async () => {
    const rowsDrawn: string[] = [];
    // One function for every render, as the picker asks for.
    const renderRow: ColumnPickerProps["renderRow"] = (row) => {
      rowsDrawn.push(row.column.key);
      return (
        <>
          <input className="fb-columns-checkbox" {...row.checkboxProps} />
          <button className="fb-columns-handle" {...row.handleProps}>
            <span aria-hidden="true">⠿</span>
          </button>
          <label className="fb-columns-label" htmlFor={row.checkboxProps.id}>
            {row.column.label}
          </label>
        </>
      );
    };
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
    await expect.poll(() => keysIn(picker.table())).not.toContain("c3");
    expect(rowsDrawn).toEqual(["c3"]);
    expect(tableDrawn.count).toBe(drawnBefore + 1);

    rowsDrawn.length = 0;
    await clickOn(picker.row("Column 7").querySelector("label") as Element);
    await expect.poll(() => keysIn(picker.table())).not.toContain("c7");
    expect(rowsDrawn).toEqual(["c7"]);
  });
});

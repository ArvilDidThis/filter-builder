import { reconcileColumnSettings } from "@arvilmena/filter-core";
import { describe, expect, test } from "vitest";
import { useColumnSettings } from "../src/useColumnSettings";
import { manyColumns } from "./support/apps";
import { mount } from "./support/mount";

// A very long column list whose saved settings name only its first column. Every other column
// is new, and goes after that one. Each browser's engine limits how many values one function
// call may take, and each has a limit of its own, so this runs in every one of them.

/** A long list for a table. Handing its new columns to one call fails in Chromium. */
const LONG = 200_000;
/**
 * A list past the limit of all three engines. Measured on a laptop, one call with this many
 * values fails in Chromium, Firefox and WebKit, and one with 600,000 passes in WebKit.
 */
const LONGEST = 1_500_000;

/** Settings saved when the table had one column. */
const SAVED = { order: ["c0"], hidden: [] };

const LONG_COLUMNS = manyColumns(LONG);

/** A table that says how many columns it shows, and which come first and last. */
function CountingTable() {
  const { visibleColumns } = useColumnSettings({
    columns: LONG_COLUMNS,
    value: SAVED,
    onChange: () => {},
  });
  return (
    <p data-testid="shown">
      {visibleColumns.length} {visibleColumns[0]?.key}{" "}
      {visibleColumns.at(-1)?.key}
    </p>
  );
}

describe("a very long column list, all but one of its columns new", () => {
  test.each([LONG, LONGEST])(
    "is fitted to the saved settings without an error, at %d columns",
    (count) => {
      const columns = count === LONG ? LONG_COLUMNS : manyColumns(count);
      const { order, hidden } = reconcileColumnSettings(columns, SAVED);
      expect(order).toHaveLength(count);
      // The saved column first, then the new ones in the list's own order.
      expect(order.slice(0, 3)).toEqual(["c0", "c1", "c2"]);
      expect(order.at(-1)).toBe(`c${count - 1}`);
      expect(hidden).toEqual([]);
    },
  );

  test(`is drawn by a table that reads its settings from the hook, at ${LONG} columns`, async () => {
    mount(<CountingTable />);
    await expect
      .poll(() => document.querySelector('[data-testid="shown"]')?.textContent)
      .toBe(`${LONG} c0 c${LONG - 1}`);
  });
});

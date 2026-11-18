import { describe, expect, it } from "vitest";
import {
  type ColumnDefinition,
  type ColumnSettings,
  defaultColumnSettings,
  moveColumn,
  orderedColumns,
  reconcileColumnSettings,
  resetColumnSettings,
  setColumnVisible,
  showAllColumns,
  visibleColumns,
} from "./columns";

const COLUMNS = [
  { key: "name", label: "Name", hideable: false, width: 240 },
  { key: "price", label: "Price", width: 80 },
  { key: "stock", label: "Stock", width: 80 },
  { key: "notes", label: "Notes", defaultHidden: true, width: 320 },
] satisfies (ColumnDefinition & { width: number })[];

const DEFAULTS: ColumnSettings = {
  order: ["name", "price", "stock", "notes"],
  hidden: ["notes"],
};

/** Writes ordered columns as text: "name price (notes)" has the notes column hidden. */
const shape = (
  columns: readonly ColumnDefinition[],
  settings: ColumnSettings,
): string =>
  orderedColumns(columns, settings)
    .map(({ column, visible }) => (visible ? column.key : `(${column.key})`))
    .join(" ");

describe("defaultColumnSettings", () => {
  it("should keep the list's order and hide the columns that start hidden", () => {
    expect(defaultColumnSettings(COLUMNS)).toEqual(DEFAULTS);
  });

  it("should never hide a column that cannot be hidden", () => {
    const settings = defaultColumnSettings([
      { key: "id", label: "Id", hideable: false, defaultHidden: true },
    ]);
    expect(settings).toEqual({ order: ["id"], hidden: [] });
  });

  it("should count a key used twice only once", () => {
    const settings = defaultColumnSettings([
      { key: "a", label: "A" },
      { key: "a", label: "A again", defaultHidden: true },
    ]);
    expect(settings).toEqual({ order: ["a"], hidden: [] });
  });

  it("should give empty settings for an empty list", () => {
    expect(defaultColumnSettings([])).toEqual({ order: [], hidden: [] });
  });
});

describe("reconcileColumnSettings", () => {
  it("should return the same object when the saved settings already fit", () => {
    const saved: ColumnSettings = {
      order: ["stock", "name", "notes", "price"],
      hidden: ["price"],
    };
    expect(reconcileColumnSettings(COLUMNS, saved)).toBe(saved);
  });

  it("should drop a key that is no longer a column", () => {
    const saved = {
      order: ["gone", "stock", "name", "notes", "price"],
      hidden: ["gone", "stock"],
    };
    expect(reconcileColumnSettings(COLUMNS, saved)).toEqual({
      order: ["stock", "name", "notes", "price"],
      hidden: ["stock"],
    });
  });

  it("should drop a key saved twice, keeping its first place", () => {
    const saved = {
      order: ["price", "name", "price", "stock", "notes"],
      hidden: ["stock", "stock"],
    };
    expect(reconcileColumnSettings(COLUMNS, saved)).toEqual({
      order: ["price", "name", "stock", "notes"],
      hidden: ["stock"],
    });
  });

  it("should put a new column after the column it follows in the list", () => {
    // "price" has been moved to the end, and "stock" is new. It follows "price" in the list.
    const saved = { order: ["notes", "name", "price"], hidden: [] };
    expect(reconcileColumnSettings(COLUMNS, saved).order).toEqual([
      "notes",
      "name",
      "price",
      "stock",
    ]);
  });

  it("should put a new first column first, and keep new neighbours in list order", () => {
    const columns: ColumnDefinition[] = [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
      { key: "c", label: "C" },
      { key: "d", label: "D" },
      { key: "e", label: "E" },
    ];
    const saved = { order: ["e", "c"], hidden: [] };
    expect(reconcileColumnSettings(columns, saved).order).toEqual([
      "a",
      "b",
      "e",
      "c",
      "d",
    ]);
  });

  it("should give a new column its starting visibility", () => {
    const saved = { order: ["name", "price", "stock"], hidden: [] };
    expect(reconcileColumnSettings(COLUMNS, saved).hidden).toEqual(["notes"]);
  });

  it("should keep a column shown that a person chose to show", () => {
    const saved = { order: ["name", "price", "stock", "notes"], hidden: [] };
    expect(reconcileColumnSettings(COLUMNS, saved)).toBe(saved);
  });

  it("should never hide a column that cannot be hidden", () => {
    const saved = {
      order: ["name", "price", "stock", "notes"],
      hidden: ["name", "price"],
    };
    expect(reconcileColumnSettings(COLUMNS, saved).hidden).toEqual(["price"]);
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "name,price"],
    ["a number", 7],
    ["a list", ["name", "price"]],
    ["an empty object", {}],
    ["parts of the wrong kind", { order: "name", hidden: 3 }],
  ])("should fall back to the defaults for %s", (_name, saved) => {
    expect(reconcileColumnSettings(COLUMNS, saved)).toEqual(DEFAULTS);
  });

  it("should skip broken items inside the saved lists", () => {
    const order = ["stock", 4, null, { key: "price" }, "name"];
    // A list with a gap in it, as a hand-edited store might hold.
    order.length = 7;
    order[6] = "price";
    const saved = { order, hidden: [undefined, "stock", ["notes"]] };
    // "notes" is new here: it follows "stock" in the list, and starts hidden.
    expect(reconcileColumnSettings(COLUMNS, saved)).toEqual({
      order: ["stock", "notes", "name", "price"],
      hidden: ["stock", "notes"],
    });
  });

  it("should keep a usable order when only the hidden list is broken", () => {
    const saved = { order: ["notes", "stock", "price", "name"], hidden: null };
    expect(reconcileColumnSettings(COLUMNS, saved)).toEqual({
      order: ["notes", "stock", "price", "name"],
      hidden: ["notes"],
    });
  });

  it("should keep the usable hidden keys when only the order is broken", () => {
    const saved = { order: 12, hidden: ["price"] };
    expect(reconcileColumnSettings(COLUMNS, saved)).toEqual({
      order: ["name", "price", "stock", "notes"],
      hidden: ["price", "notes"],
    });
  });

  it("should not change the saved settings it was given", () => {
    const saved = { order: ["gone", "price"], hidden: ["gone"] };
    reconcileColumnSettings(COLUMNS, saved);
    expect(saved).toEqual({ order: ["gone", "price"], hidden: ["gone"] });
  });
});

describe("setColumnVisible", () => {
  it("should hide a shown column and show a hidden one", () => {
    const hidden = setColumnVisible(DEFAULTS, "price", false);
    expect(hidden.hidden).toEqual(["notes", "price"]);
    expect(hidden.order).toBe(DEFAULTS.order);
    expect(setColumnVisible(hidden, "notes", true).hidden).toEqual(["price"]);
  });

  it("should return the same settings when nothing changes", () => {
    expect(setColumnVisible(DEFAULTS, "price", true)).toBe(DEFAULTS);
    expect(setColumnVisible(DEFAULTS, "notes", false)).toBe(DEFAULTS);
  });

  it("should ignore a key the order does not name", () => {
    expect(setColumnVisible(DEFAULTS, "gone", false)).toBe(DEFAULTS);
    expect(setColumnVisible(DEFAULTS, "gone", true)).toBe(DEFAULTS);
  });

  it("should not change the settings it was given", () => {
    setColumnVisible(DEFAULTS, "price", false);
    expect(DEFAULTS.hidden).toEqual(["notes"]);
  });
});

describe("moveColumn", () => {
  it("should move a column down and up to the place asked for", () => {
    expect(moveColumn(DEFAULTS, "name", 2).order).toEqual([
      "price",
      "stock",
      "name",
      "notes",
    ]);
    expect(moveColumn(DEFAULTS, "notes", 1).order).toEqual([
      "name",
      "notes",
      "price",
      "stock",
    ]);
  });

  it("should keep the hidden list untouched", () => {
    expect(moveColumn(DEFAULTS, "name", 2).hidden).toBe(DEFAULTS.hidden);
  });

  it("should treat an index past either end as the first or the last place", () => {
    expect(moveColumn(DEFAULTS, "price", 99).order.at(-1)).toBe("price");
    expect(moveColumn(DEFAULTS, "price", -5).order[0]).toBe("price");
    expect(moveColumn(DEFAULTS, "price", Number.POSITIVE_INFINITY)).toEqual(
      moveColumn(DEFAULTS, "price", 3),
    );
  });

  it("should return the same settings when nothing changes", () => {
    expect(moveColumn(DEFAULTS, "price", 1)).toBe(DEFAULTS);
    expect(moveColumn(DEFAULTS, "name", -1)).toBe(DEFAULTS);
    expect(moveColumn(DEFAULTS, "gone", 0)).toBe(DEFAULTS);
    expect(moveColumn(DEFAULTS, "price", Number.NaN)).toBe(DEFAULTS);
  });

  it("should not change the settings it was given", () => {
    moveColumn(DEFAULTS, "name", 3);
    expect(DEFAULTS.order).toEqual(["name", "price", "stock", "notes"]);
  });
});

describe("showAllColumns", () => {
  it("should show every column and keep the order", () => {
    const moved = moveColumn(DEFAULTS, "notes", 0);
    const shown = showAllColumns(moved);
    expect(shown).toEqual({ order: moved.order, hidden: [] });
    expect(shown.order).toBe(moved.order);
  });

  it("should return the same settings when nothing is hidden", () => {
    const settings: ColumnSettings = { order: ["name"], hidden: [] };
    expect(showAllColumns(settings)).toBe(settings);
  });
});

describe("resetColumnSettings", () => {
  it("should put back the list's order and starting visibility", () => {
    const changed = setColumnVisible(
      moveColumn(DEFAULTS, "notes", 0),
      "notes",
      true,
    );
    expect(resetColumnSettings(COLUMNS, changed)).toEqual(DEFAULTS);
  });

  it("should return the same settings when they are the defaults already", () => {
    expect(resetColumnSettings(COLUMNS, DEFAULTS)).toBe(DEFAULTS);
  });
});

describe("orderedColumns", () => {
  it("should list every column in the chosen order, with whether it is shown", () => {
    const settings: ColumnSettings = {
      order: ["stock", "notes", "name", "price"],
      hidden: ["notes", "price"],
    };
    expect(shape(COLUMNS, settings)).toBe("stock (notes) name (price)");
  });

  it("should say whether each column can be hidden", () => {
    const [name, price] = orderedColumns(COLUMNS, DEFAULTS);
    expect(name?.hideable).toBe(false);
    expect(price?.hideable).toBe(true);
  });

  it("should show a column that cannot be hidden, whatever the settings say", () => {
    const settings = { order: DEFAULTS.order, hidden: ["name", "price"] };
    expect(shape(COLUMNS, settings)).toBe("name (price) stock notes");
  });

  it("should skip unknown and repeated keys, and put unnamed columns last", () => {
    const settings = { order: ["stock", "gone", "stock", "name"], hidden: [] };
    expect(shape(COLUMNS, settings)).toBe("stock name price notes");
  });

  it("should hand back the app's own column objects", () => {
    const [first] = orderedColumns(COLUMNS, DEFAULTS);
    expect(first?.column).toBe(COLUMNS[0]);
  });
});

describe("visibleColumns", () => {
  it("should return the shown columns in order, as the app's own objects", () => {
    const settings: ColumnSettings = {
      order: ["stock", "notes", "name", "price"],
      hidden: ["notes"],
    };
    const visible = visibleColumns(COLUMNS, settings);
    expect(visible).toEqual([COLUMNS[2], COLUMNS[0], COLUMNS[1]]);
    expect(visible[0]).toBe(COLUMNS[2]);
    // The extra property an app put on its columns is still typed and still there.
    expect(visible.map((column) => column.width)).toEqual([80, 240, 80]);
  });

  it("should return nothing for an empty list", () => {
    expect(visibleColumns([], DEFAULTS)).toEqual([]);
  });
});

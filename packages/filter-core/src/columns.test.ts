import { describe, expect, it } from "vitest";
import {
  type ColumnDefinition,
  type ColumnSettings,
  columnMatchesSearch,
  columnPin,
  defaultColumnSettings,
  hideAllColumns,
  isDefaultColumnSettings,
  moveColumn,
  moveColumnAroundPinned,
  moveColumnGroup,
  moveColumnGroupAroundPinned,
  orderedColumns,
  reconcileColumnSettings,
  resetColumnSettings,
  searchColumns,
  setColumnVisible,
  showAllColumns,
  unpinnedRange,
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

  it("should not take a saved order with a hole in it as fitting", () => {
    // A list of four places where the second was never filled in.
    const order: string[] = [];
    order[0] = "name";
    order[2] = "stock";
    order[3] = "notes";
    const saved = { order, hidden: ["notes"] };
    const settings = reconcileColumnSettings(COLUMNS, saved);
    // "price" is new to these settings, so it lands after "name", which it follows in the list.
    expect(settings).toEqual({
      order: ["name", "price", "stock", "notes"],
      hidden: ["notes"],
    });
    expect(settings).not.toBe(saved);
    expect(1 in settings.order).toBe(true);
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

  it("should place a very large run of new columns without failing", () => {
    // Every column after the first is new, so they all follow that one saved column.
    const columns: ColumnDefinition[] = Array.from(
      { length: 200_000 },
      (_, index) => ({ key: `c${index}`, label: `C${index}` }),
    );
    const { order } = reconcileColumnSettings(columns, {
      order: ["c0"],
      hidden: [],
    });
    expect(order).toHaveLength(200_000);
    expect(order[0]).toBe("c0");
    expect(order[1]).toBe("c1");
    expect(order[199_999]).toBe("c199999");
  });

  it("should give a new column its starting visibility", () => {
    const saved = { order: ["name", "price", "stock"], hidden: [] };
    expect(reconcileColumnSettings(COLUMNS, saved).hidden).toEqual(["notes"]);
  });

  it("should give a new column its starting visibility even if the saved hidden list names it", () => {
    // "price" and "notes" are new: the saved order does not name them. "price" starts shown.
    const saved = { order: ["name", "stock"], hidden: ["price", "stock"] };
    expect(reconcileColumnSettings(COLUMNS, saved)).toEqual({
      order: ["name", "price", "stock", "notes"],
      hidden: ["stock", "notes"],
    });
  });

  it("should keep the usable hidden keys when the saved order names no column of the list", () => {
    const saved = { order: ["gone"], hidden: ["price"] };
    expect(reconcileColumnSettings(COLUMNS, saved)).toEqual({
      order: ["name", "price", "stock", "notes"],
      hidden: ["price", "notes"],
    });
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

describe("hideAllColumns", () => {
  it("should hide every column that may be hidden and keep the order", () => {
    const moved = moveColumn(DEFAULTS, "notes", 0);
    const hidden = hideAllColumns(COLUMNS, moved);
    // "Name" must stay shown. "Notes" was hidden already, so it keeps its place in the list.
    expect(hidden.hidden).toEqual(["notes", "price", "stock"]);
    expect(hidden.order).toBe(moved.order);
    expect(shape(COLUMNS, hidden)).toBe("(notes) name (price) (stock)");
  });

  it("should hide a pinned column that may be hidden", () => {
    const columns: ColumnDefinition[] = [
      { key: "id", label: "Id", pinned: "start" },
      { key: "name", label: "Name", pinned: "end", hideable: false },
      { key: "price", label: "Price" },
    ];
    const hidden = hideAllColumns(columns, defaultColumnSettings(columns));
    expect(shape(columns, hidden)).toBe("(id) (price) name");
  });

  it("should return the same settings when nothing more can be hidden", () => {
    const all = hideAllColumns(COLUMNS, DEFAULTS);
    expect(hideAllColumns(COLUMNS, all)).toBe(all);
    // A list whose only column must stay shown.
    const settings: ColumnSettings = { order: ["name"], hidden: [] };
    expect(hideAllColumns(COLUMNS, settings)).toBe(settings);
  });

  it("should skip a key that is no column of the list", () => {
    const settings: ColumnSettings = { order: ["name", "gone"], hidden: [] };
    expect(hideAllColumns(COLUMNS, settings)).toBe(settings);
  });

  it("should not change the settings it was given", () => {
    hideAllColumns(COLUMNS, DEFAULTS);
    expect(DEFAULTS.hidden).toEqual(["notes"]);
  });

  it("should be undone by showAllColumns", () => {
    const hidden = hideAllColumns(COLUMNS, DEFAULTS);
    expect(showAllColumns(hidden)).toEqual({
      order: DEFAULTS.order,
      hidden: [],
    });
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

describe("isDefaultColumnSettings", () => {
  it("should be true for the list's own order and starting visibility", () => {
    expect(isDefaultColumnSettings(COLUMNS, DEFAULTS)).toBe(true);
    expect(
      isDefaultColumnSettings(COLUMNS, defaultColumnSettings(COLUMNS)),
    ).toBe(true);
  });

  it("should be false once a column is moved, shown or hidden", () => {
    const moved = moveColumn(DEFAULTS, "stock", 0);
    const shown = setColumnVisible(DEFAULTS, "notes", true);
    const hidden = setColumnVisible(DEFAULTS, "price", false);
    expect(isDefaultColumnSettings(COLUMNS, moved)).toBe(false);
    expect(isDefaultColumnSettings(COLUMNS, shown)).toBe(false);
    expect(isDefaultColumnSettings(COLUMNS, hidden)).toBe(false);
  });

  it("should be true again after a change is undone", () => {
    const undone = setColumnVisible(
      setColumnVisible(DEFAULTS, "price", false),
      "price",
      true,
    );
    expect(isDefaultColumnSettings(COLUMNS, undone)).toBe(true);
  });

  it("should be true when the same columns are hidden in another sequence", () => {
    const columns = [
      { key: "name", label: "Name" },
      { key: "notes", label: "Notes", defaultHidden: true },
      { key: "tags", label: "Tags", defaultHidden: true },
    ];
    const settings = {
      order: ["name", "notes", "tags"],
      hidden: ["tags", "notes"],
    };
    expect(isDefaultColumnSettings(columns, settings)).toBe(true);
    // A reset then has nothing to do, so it hands the same object back.
    expect(resetColumnSettings(columns, settings)).toBe(settings);
  });

  it("should be false exactly when a reset would change the settings", () => {
    const all: ColumnSettings[] = [
      DEFAULTS,
      moveColumn(DEFAULTS, "notes", 0),
      showAllColumns(DEFAULTS),
      { order: DEFAULTS.order, hidden: ["notes", "price"] },
    ];
    for (const settings of all) {
      expect(isDefaultColumnSettings(COLUMNS, settings)).toBe(
        resetColumnSettings(COLUMNS, settings) === settings,
      );
    }
  });

  it("should be true for an empty list with empty settings", () => {
    expect(isDefaultColumnSettings([], { order: [], hidden: [] })).toBe(true);
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

describe("pinned columns", () => {
  // "name" is pinned to the start and "actions" to the end, though the list has neither there.
  const PINNED = [
    { key: "price", label: "Price" },
    { key: "actions", label: "Actions", pinned: "end" },
    { key: "name", label: "Name", pinned: "start", hideable: false },
    { key: "stock", label: "Stock" },
    { key: "notes", label: "Notes", defaultHidden: true },
  ] satisfies ColumnDefinition[];

  const FITTED: ColumnSettings = {
    order: ["name", "price", "stock", "notes", "actions"],
    hidden: ["notes"],
  };

  describe("defaultColumnSettings", () => {
    it("should put each pinned column at its end of the order", () => {
      expect(defaultColumnSettings(PINNED)).toEqual(FITTED);
    });

    it("should keep several pinned columns in the list's order", () => {
      const settings = defaultColumnSettings([
        { key: "a", label: "A" },
        { key: "z2", label: "Z2", pinned: "end" },
        { key: "s1", label: "S1", pinned: "start" },
        { key: "z1", label: "Z1", pinned: "end" },
        { key: "s2", label: "S2", pinned: "start" },
      ]);
      expect(settings.order).toEqual(["s1", "s2", "a", "z2", "z1"]);
    });

    it("should count as the defaults, so a reset has nothing to do", () => {
      expect(isDefaultColumnSettings(PINNED, FITTED)).toBe(true);
      expect(resetColumnSettings(PINNED, FITTED)).toBe(FITTED);
    });
  });

  describe("reconcileColumnSettings", () => {
    it("should load settings saved before the columns were pinned", () => {
      const saved = {
        order: ["stock", "actions", "price", "name", "notes"],
        hidden: ["price"],
      };
      expect(reconcileColumnSettings(PINNED, saved)).toEqual({
        order: ["name", "stock", "price", "notes", "actions"],
        hidden: ["price"],
      });
    });

    it("should return the same object when the pinned columns are already in place", () => {
      expect(reconcileColumnSettings(PINNED, FITTED)).toBe(FITTED);
    });

    it("should put a new pinned column at its end of the order", () => {
      const saved = { order: ["stock", "price", "notes"], hidden: [] };
      expect(reconcileColumnSettings(PINNED, saved).order).toEqual([
        "name",
        "stock",
        "price",
        "notes",
        "actions",
      ]);
    });

    it("should keep a pinned column hidden when a person hid it", () => {
      const saved = { order: FITTED.order, hidden: ["actions"] };
      expect(reconcileColumnSettings(PINNED, saved)).toBe(saved);
    });

    it("should ignore a pin that is not one of the two known values", () => {
      const columns = [
        { key: "a", label: "A" },
        { key: "b", label: "B", pinned: true },
      ] as unknown as ColumnDefinition[];
      const saved = { order: ["a", "b"], hidden: [] };
      expect(reconcileColumnSettings(columns, saved)).toBe(saved);
      expect(orderedColumns(columns, saved)[1]?.pinned).toBeUndefined();
    });
  });

  describe("moveColumnAroundPinned", () => {
    const order = (key: string, toIndex: number) =>
      moveColumnAroundPinned(PINNED, FITTED, key, toIndex).order.join(" ");

    it("should move a column among the places between the pinned columns", () => {
      expect(order("price", 2)).toBe("name stock price notes actions");
      expect(order("notes", 1)).toBe("name notes price stock actions");
    });

    it("should not move a pinned column", () => {
      expect(moveColumnAroundPinned(PINNED, FITTED, "name", 3)).toBe(FITTED);
      expect(moveColumnAroundPinned(PINNED, FITTED, "actions", 0)).toBe(FITTED);
    });

    it("should stop a column at the pinned columns", () => {
      // Into a pinned column's place, or past either end: the nearest place it may take.
      expect(order("stock", 0)).toBe("name stock price notes actions");
      expect(order("stock", -5)).toBe("name stock price notes actions");
      expect(order("price", 4)).toBe("name stock notes price actions");
      expect(order("price", 99)).toBe("name stock notes price actions");
    });

    it("should return the same settings when the column is already next to the pinned ones", () => {
      expect(moveColumnAroundPinned(PINNED, FITTED, "price", 0)).toBe(FITTED);
      expect(moveColumnAroundPinned(PINNED, FITTED, "notes", 4)).toBe(FITTED);
    });

    it("should return the same settings for an unknown key or a place that is no number", () => {
      expect(moveColumnAroundPinned(PINNED, FITTED, "gone", 2)).toBe(FITTED);
      expect(moveColumnAroundPinned(PINNED, FITTED, "price", Number.NaN)).toBe(
        FITTED,
      );
    });

    it("should move as moveColumn does when no column is pinned", () => {
      expect(moveColumnAroundPinned(COLUMNS, DEFAULTS, "notes", 0)).toEqual(
        moveColumn(DEFAULTS, "notes", 0),
      );
      expect(moveColumnAroundPinned(COLUMNS, DEFAULTS, "name", 0)).toBe(
        DEFAULTS,
      );
    });

    it("should not move anything when every column is pinned", () => {
      const columns: ColumnDefinition[] = [
        { key: "a", label: "A", pinned: "start" },
        { key: "b", label: "B", pinned: "end" },
      ];
      const settings = defaultColumnSettings(columns);
      expect(moveColumnAroundPinned(columns, settings, "a", 1)).toBe(settings);
      expect(moveColumnAroundPinned(columns, settings, "b", 0)).toBe(settings);
    });
  });

  describe("moveColumnGroup", () => {
    const WIDE: ColumnSettings = {
      order: [
        "symbol",
        "company",
        "industry",
        "cap",
        "return",
        "age",
        "release",
        "beta",
      ],
      hidden: ["age"],
    };
    const group = (keys: readonly string[], toIndex: number) =>
      moveColumnGroup(WIDE, keys, toIndex).order.join(" ");

    it("should land the columns together, in the order they had among themselves", () => {
      expect(group(["cap", "return", "beta"], 1)).toBe(
        "symbol cap return beta company industry age release",
      );
      // The order the keys are named in does not count.
      expect(group(["beta", "cap", "return"], 1)).toBe(
        "symbol cap return beta company industry age release",
      );
    });

    it("should move a group down the order", () => {
      expect(group(["company", "cap"], 5)).toBe(
        "symbol industry return age release company cap beta",
      );
    });

    it("should take an index too near either end as the nearest place that fits", () => {
      expect(group(["cap", "beta"], -4)).toBe(
        "cap beta symbol company industry return age release",
      );
      expect(group(["symbol", "cap"], 99)).toBe(
        "company industry return age release beta symbol cap",
      );
    });

    it("should keep the hidden keys, and not change the settings it was given", () => {
      const moved = moveColumnGroup(WIDE, ["cap", "beta"], 0);
      expect(moved.hidden).toBe(WIDE.hidden);
      expect(WIDE.order[0]).toBe("symbol");
    });

    it("should return the same settings when the group already stands there", () => {
      expect(moveColumnGroup(WIDE, ["cap", "return"], 3)).toBe(WIDE);
      expect(moveColumnGroup(WIDE, ["release", "beta"], 99)).toBe(WIDE);
      expect(moveColumnGroup(WIDE, [], 0)).toBe(WIDE);
    });

    it("should skip a key the order does not name, and a key named twice", () => {
      expect(group(["gone", "beta", "beta"], 0)).toBe(
        "beta symbol company industry cap return age release",
      );
      expect(moveColumnGroup(WIDE, ["gone"], 0)).toBe(WIDE);
    });

    it("should turn down an index that is not a number", () => {
      expect(moveColumnGroup(WIDE, ["cap"], Number.NaN)).toBe(WIDE);
    });

    it("should move one column as moveColumn does", () => {
      for (const toIndex of [-1, 0, 2, 3, 7, 12, 2.7]) {
        expect(moveColumnGroup(WIDE, ["cap"], toIndex).order).toEqual(
          moveColumn(WIDE, "cap", toIndex).order,
        );
      }
    });
  });

  describe("moveColumnGroupAroundPinned", () => {
    const group = (keys: readonly string[], toIndex: number) =>
      moveColumnGroupAroundPinned(PINNED, FITTED, keys, toIndex).order.join(
        " ",
      );

    it("should move a group between the pinned columns", () => {
      expect(group(["price", "notes"], 2)).toBe(
        "name stock price notes actions",
      );
      expect(group(["stock", "notes"], 1)).toBe(
        "name stock notes price actions",
      );
    });

    it("should stop a group at the pinned columns", () => {
      expect(group(["stock", "notes"], 0)).toBe(
        "name stock notes price actions",
      );
      expect(group(["price", "stock"], 4)).toBe(
        "name notes price stock actions",
      );
    });

    it("should skip a pinned column, and still move the others", () => {
      expect(group(["name", "notes", "actions"], 1)).toBe(
        "name notes price stock actions",
      );
      expect(
        moveColumnGroupAroundPinned(PINNED, FITTED, ["name", "actions"], 2),
      ).toBe(FITTED);
    });

    it("should return the same settings when nothing changes", () => {
      expect(
        moveColumnGroupAroundPinned(PINNED, FITTED, ["price", "stock"], 0),
      ).toBe(FITTED);
      expect(
        moveColumnGroupAroundPinned(PINNED, FITTED, ["price"], Number.NaN),
      ).toBe(FITTED);
    });

    it("should move as moveColumnGroup does with no pinned column", () => {
      expect(
        moveColumnGroupAroundPinned(COLUMNS, DEFAULTS, ["stock", "notes"], 0),
      ).toEqual(moveColumnGroup(DEFAULTS, ["stock", "notes"], 0));
    });
  });

  describe("unpinnedRange", () => {
    it("should give the places between the pinned columns", () => {
      expect(unpinnedRange(PINNED, FITTED.order)).toEqual({
        first: 1,
        last: 3,
      });
    });

    it("should give every place when no column is pinned", () => {
      expect(unpinnedRange(COLUMNS, DEFAULTS.order)).toEqual({
        first: 0,
        last: 3,
      });
    });

    it("should give no place when every column is pinned", () => {
      const columns: ColumnDefinition[] = [
        { key: "a", label: "A", pinned: "start" },
        { key: "b", label: "B", pinned: "start" },
      ];
      const { first, last } = unpinnedRange(columns, ["a", "b"]);
      expect(last).toBeLessThan(first);
    });
  });

  describe("columnPin", () => {
    it("should say which end a column is pinned to", () => {
      expect(columnPin(PINNED[1])).toBe("end");
      expect(columnPin(PINNED[2])).toBe("start");
      expect(columnPin(PINNED[0])).toBeUndefined();
    });

    it("should read a column of a list written with `as const`", () => {
      const exact = [
        { key: "name", label: "Name", pinned: "start" },
        { key: "price", label: "Price" },
      ] as const satisfies readonly ColumnDefinition[];
      // A plain `column.pinned` does not compile here: "price" has no such property.
      expect(exact.map((column) => columnPin(column))).toEqual([
        "start",
        undefined,
      ]);
    });

    it("should count anything else as not pinned", () => {
      const odd = { key: "a", label: "A", pinned: "middle" };
      expect(columnPin(odd as unknown as ColumnDefinition)).toBeUndefined();
      expect(columnPin(undefined)).toBeUndefined();
    });
  });

  describe("orderedColumns and visibleColumns", () => {
    // Settings that were not fitted to the list: the order has the pinned columns elsewhere.
    const loose: ColumnSettings = {
      order: ["stock", "actions", "name", "price"],
      hidden: ["price"],
    };

    it("should keep the pinned columns in place whatever the order says", () => {
      // "notes" is not in the order, so it goes last of the columns a person may move.
      expect(shape(PINNED, loose)).toBe("name stock (price) notes actions");
      expect(visibleColumns(PINNED, loose).map((column) => column.key)).toEqual(
        ["name", "stock", "notes", "actions"],
      );
    });

    it("should say which columns are pinned", () => {
      expect(
        orderedColumns(PINNED, FITTED).map((entry) => entry.pinned),
      ).toEqual(["start", undefined, undefined, undefined, "end"]);
    });

    it("should leave the pin on the columns a table draws", () => {
      const [first] = visibleColumns(PINNED, FITTED);
      expect(first).toBe(PINNED[2]);
      expect(first?.pinned).toBe("start");
    });
  });
});

describe("columnMatchesSearch", () => {
  const column = { label: "Close price" };

  it("should match part of the label, ignoring case", () => {
    expect(columnMatchesSearch(column, "PRI")).toBe(true);
    expect(columnMatchesSearch(column, "close p")).toBe(true);
    expect(columnMatchesSearch(column, "open")).toBe(false);
  });

  it("should ask for every word typed, in any order", () => {
    expect(columnMatchesSearch(column, "price close")).toBe(true);
    expect(columnMatchesSearch(column, "price open")).toBe(false);
  });

  it("should match every column for an empty search", () => {
    expect(columnMatchesSearch(column, "")).toBe(true);
    expect(columnMatchesSearch(column, "   ")).toBe(true);
  });

  it("should not read the search as a pattern", () => {
    expect(columnMatchesSearch({ label: "Change (%)" }, "(%)")).toBe(true);
    expect(columnMatchesSearch(column, ".*")).toBe(false);
  });

  it("should not throw on a search that is not text", () => {
    expect(columnMatchesSearch(column, undefined as unknown as string)).toBe(
      true,
    );
  });
});

describe("searchColumns", () => {
  it("should list the matching columns in the order given", () => {
    const found = searchColumns(COLUMNS, "o");
    expect(found.map((column) => column.key)).toEqual(["stock", "notes"]);
    // The app's own objects, with their extra properties still typed.
    expect(found[0]?.width).toBe(80);
  });

  it("should take the entries of orderedColumns", () => {
    const entries = orderedColumns(COLUMNS, DEFAULTS);
    const found = searchColumns(entries, "pri");
    expect(found).toEqual([entries[1]]);
    expect(found[0]).toBe(entries[1]);
  });

  it("should return the same list for an empty search", () => {
    expect(searchColumns(COLUMNS, " ")).toBe(COLUMNS);
  });

  it("should return nothing when no column matches", () => {
    expect(searchColumns(COLUMNS, "zzz")).toEqual([]);
  });
});

import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ColumnDefinition, ColumnSettings } from "./columns";
import { createRowPredicate } from "./evaluate";
import {
  columnStatePart,
  createSavedState,
  filterStatePart,
  MAX_SAVED_FILTER_DEPTH,
  readSavedParts,
  readSavedState,
  resolveStateKey,
  type StatePart,
} from "./saved-state";
import type { FilterDefinition } from "./types";

const COLUMNS = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "notes", label: "Notes", defaultHidden: true },
] satisfies ColumnDefinition[];

const COLUMN_DEFAULTS: ColumnSettings = {
  order: ["name", "price", "notes"],
  hidden: ["notes"],
};

const EMPTY_FILTER: FilterDefinition = { criteria: [], logic: "AND" };

const PRICE_FILTER: FilterDefinition = {
  logic: "AND",
  criteria: [
    {
      condition: ">=",
      data: "Price",
      origData: "price",
      type: "num",
      value: ["10"],
    },
  ],
};

interface Sort {
  key: string;
  direction: "asc" | "desc";
}

/** A part an app adds itself: the column the table is sorted by. */
const sortPart: StatePart<Sort | null> = {
  defaultValue: null,
  parse: (saved) => {
    const { key, direction } = saved as Partial<Sort>;
    if (typeof key !== "string") return undefined;
    return { key, direction: direction === "desc" ? "desc" : "asc" };
  },
};

const PARTS = {
  filter: filterStatePart(),
  columns: columnStatePart(COLUMNS),
  sort: sortPart,
};

describe("resolveStateKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should prefer the name, then the id, then the page's path", () => {
    const location = "/orders";
    expect(resolveStateKey({ name: "main", id: "orders", location })).toBe(
      "main",
    );
    expect(resolveStateKey({ id: "orders", location })).toBe("orders");
    expect(resolveStateKey({ location })).toBe("/orders");
  });

  it("should count an empty name or id as not given", () => {
    expect(resolveStateKey({ name: "", id: "orders" })).toBe("orders");
    expect(resolveStateKey({ name: "", id: "", location: "/orders" })).toBe(
      "/orders",
    );
  });

  it.each([
    ["/orders?page=2", "/orders"],
    ["/orders#top", "/orders"],
    ["/orders?page=2#top", "/orders"],
    ["/orders/#top?x", "/orders/"],
    ["https://example.com/orders?page=2", "/orders"],
    ["//example.com/orders/7", "/orders/7"],
    ["https://example.com", "/"],
    ["https://example.com?page=2", "/"],
    ["orders/list", "orders/list"],
  ])("should read the path of %s as %s", (address, path) => {
    expect(resolveStateKey({ location: address })).toBe(path);
  });

  it("should read the path of a location object", () => {
    // The shape of `window.location` and of a `URL`.
    const location = { pathname: "/orders/7", search: "?page=2", hash: "#top" };
    expect(resolveStateKey({ location })).toBe("/orders/7");
  });

  it("should use the address of the page the code runs on", () => {
    vi.stubGlobal("location", { pathname: "/products", search: "?page=2" });
    expect(resolveStateKey()).toBe("/products");
  });

  it("should find no key when nothing is given and there is no page", () => {
    vi.stubGlobal("location", undefined);
    expect(resolveStateKey()).toBeUndefined();
    expect(resolveStateKey({ location: "" })).toBeUndefined();
    expect(resolveStateKey({ location: "?page=2" })).toBeUndefined();
  });
});

describe("readSavedState", () => {
  it("should hand back each saved part", () => {
    const columns: ColumnSettings = {
      order: ["price", "name", "notes"],
      hidden: [],
    };
    const saved = createSavedState({
      filter: PRICE_FILTER,
      columns,
      sort: { key: "price", direction: "desc" },
    });
    const state = readSavedState(JSON.parse(JSON.stringify(saved)), PARTS);
    expect(state).toEqual({
      filter: PRICE_FILTER,
      columns,
      sort: { key: "price", direction: "desc" },
    });
  });

  it("should infer each part's type from its definition", () => {
    const state = readSavedState(undefined, PARTS);
    expectTypeOf(state.filter).toEqualTypeOf<FilterDefinition>();
    expectTypeOf(state.columns).toEqualTypeOf<ColumnSettings>();
    expectTypeOf(state.sort).toEqualTypeOf<Sort | null>();
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["text", "orders"],
    ["a number", 7],
    ["a list", [1, 2]],
    ["an object with no parts", { version: 1 }],
    ["parts that are a list", { version: 1, parts: [] }],
    ["parts that are text", { version: 1, parts: "filter" }],
  ])("should give every part its default for %s", (_label, saved) => {
    expect(readSavedState(saved, PARTS)).toEqual({
      filter: EMPTY_FILTER,
      columns: COLUMN_DEFAULTS,
      sort: null,
    });
  });

  it("should hand back the part's own default object", () => {
    expect(readSavedState(undefined, PARTS).filter).toBe(
      PARTS.filter.defaultValue,
    );
  });

  it("should give a missing part its default and still use the others", () => {
    const state = readSavedState(
      { version: 1, parts: { filter: PRICE_FILTER } },
      PARTS,
    );
    expect(state.filter).toEqual(PRICE_FILTER);
    expect(state.columns).toEqual(COLUMN_DEFAULTS);
    expect(state.sort).toBeNull();
  });

  it("should give a broken part its default and still use the others", () => {
    const state = readSavedState(
      {
        version: 1,
        parts: {
          filter: "price >= 10",
          columns: { order: ["price", "gone", "name"], hidden: 7 },
          sort: { key: 12 },
        },
      },
      PARTS,
    );
    expect(state.filter).toEqual(EMPTY_FILTER);
    expect(state.columns).toEqual({
      order: ["price", "notes", "name"],
      hidden: ["notes"],
    });
    expect(state.sort).toBeNull();
  });

  it("should give a part its default when its parse throws", () => {
    // `null` has no properties to read, so the sort part's parse throws.
    const state = readSavedState(
      { version: 1, parts: { filter: PRICE_FILTER, sort: null } },
      PARTS,
    );
    expect(state.sort).toBeNull();
    expect(state.filter).toEqual(PRICE_FILTER);
  });

  it("should ignore a saved part the app does not have", () => {
    const state = readSavedState(
      { version: 1, parts: { pageSize: 50, filter: PRICE_FILTER } },
      PARTS,
    );
    expect(Object.keys(state)).toEqual(["filter", "columns", "sort"]);
  });

  it("should not take something every object carries for a saved part", () => {
    const parse = vi.fn((saved: unknown) => String(saved));
    const state = readSavedState(
      { version: 1, parts: {} },
      { toString: { defaultValue: "none", parse } },
    );
    expect(state.toString).toBe("none");
    expect(parse).not.toHaveBeenCalled();
  });

  describe("versions", () => {
    const saved = { version: 1, parts: { sort: { column: "price" } } };
    /** Version 1 kept the sort's key under `column`. */
    const migrate = vi.fn(
      (parts: Record<string, unknown>, fromVersion: number) =>
        fromVersion === 1
          ? {
              ...parts,
              sort: { key: (parts.sort as { column: string }).column },
            }
          : parts,
    );

    it("should not use a value saved under another version", () => {
      expect(readSavedState(saved, PARTS, { version: 2 }).sort).toBeNull();
      // A newer version, as after the app went back to an older release.
      expect(
        readSavedState({ ...saved, version: 3 }, PARTS, { version: 2 }).sort,
      ).toBeNull();
    });

    it("should upgrade a value saved under an older version", () => {
      const state = readSavedState(saved, PARTS, { version: 2, migrate });
      expect(state.sort).toEqual({ key: "price", direction: "asc" });
      expect(migrate).toHaveBeenCalledWith(saved.parts, 1);
    });

    it("should not upgrade a value saved under the current version", () => {
      migrate.mockClear();
      readSavedState({ ...saved, version: 2 }, PARTS, { version: 2, migrate });
      expect(migrate).not.toHaveBeenCalled();
    });

    it("should count a value with no usable version as version 0", () => {
      const seen: number[] = [];
      const record = (parts: Record<string, unknown>, fromVersion: number) => {
        seen.push(fromVersion);
        return parts;
      };
      readSavedState({ parts: {} }, PARTS, { migrate: record });
      readSavedState({ version: "2", parts: {} }, PARTS, { migrate: record });
      expect(seen).toEqual([0, 0]);
    });

    it("should still read every upgraded part through its parse", () => {
      const state = readSavedState(saved, PARTS, {
        version: 2,
        migrate: () => ({ sort: "price", filter: PRICE_FILTER }),
      });
      expect(state.sort).toBeNull();
      expect(state.filter).toEqual(PRICE_FILTER);
    });

    it.each([
      [
        "throws",
        () => {
          throw new Error("cannot upgrade");
        },
      ],
      ["returns nothing", () => undefined as never],
      ["returns a list", () => [] as never],
    ])("should use the defaults when the upgrade %s", (_label, broken) => {
      const state = readSavedState(saved, PARTS, {
        version: 2,
        migrate: broken,
      });
      expect(state).toEqual({
        filter: EMPTY_FILTER,
        columns: COLUMN_DEFAULTS,
        sort: null,
      });
    });
  });
});

describe("createSavedState", () => {
  it("should wrap the parts with version 1", () => {
    expect(createSavedState({ sort: null })).toEqual({
      version: 1,
      parts: { sort: null },
    });
  });

  it("should carry the app's version", () => {
    expect(createSavedState({}, 4).version).toBe(4);
  });

  it("should copy the parts, so a later change to them is not saved", () => {
    const values: Record<string, unknown> = { sort: null };
    const saved = createSavedState(values);
    values.sort = { key: "price" };
    expect(saved.parts.sort).toBeNull();
  });
});

describe("readSavedParts", () => {
  it("should hand out every saved part, unchecked", () => {
    const parts = { sort: "broken", other: [1, 2] };
    expect(readSavedParts({ version: 1, parts })).toBe(parts);
  });

  it("should upgrade parts saved under another version", () => {
    const migrate = vi.fn((parts: Record<string, unknown>) => ({
      ...parts,
      pageSize: parts.rows,
    }));
    expect(
      readSavedParts(
        { version: 1, parts: { rows: 50 } },
        { version: 2, migrate },
      ),
    ).toEqual({ rows: 50, pageSize: 50 });
    expect(migrate).toHaveBeenCalledExactlyOnceWith({ rows: 50 }, 1);
  });

  it.each([
    ["nothing", undefined],
    ["text", "saved"],
    ["a value with no parts", { version: 1 }],
    ["a value from another version", { version: 7, parts: {} }],
  ])("should find no parts in %s", (_label, saved) => {
    expect(readSavedParts(saved)).toBeUndefined();
  });
});

describe("filterStatePart", () => {
  const { parse } = filterStatePart();

  it("should start from an empty filter, or the one the app gives", () => {
    expect(filterStatePart().defaultValue).toEqual(EMPTY_FILTER);
    expect(filterStatePart(PRICE_FILTER).defaultValue).toBe(PRICE_FILTER);
  });

  it("should keep a saved filter as it is", () => {
    expect(parse(PRICE_FILTER)).toBe(PRICE_FILTER);
  });

  it.each([
    ["nothing", null],
    ["text", "AND"],
    ["a list", [PRICE_FILTER]],
    ["a group with no list of rows", { logic: "AND", criteria: "none" }],
    ["a single condition", PRICE_FILTER.criteria[0]],
  ])("should turn down %s", (_label, saved) => {
    expect(parse(saved)).toBeUndefined();
  });

  /** A filter of `depth` groups, each inside the one before, with a condition at the bottom. */
  const nestedFilter = (depth: number): unknown => {
    let group: unknown = { logic: "AND", criteria: PRICE_FILTER.criteria };
    for (let level = 1; level < depth; level += 1) {
      group = { logic: "AND", criteria: [group] };
    }
    return group;
  };

  it("should keep a filter nested as deep as the limit", () => {
    const saved = nestedFilter(MAX_SAVED_FILTER_DEPTH);
    expect(parse(saved)).toBe(saved);
    const matches = createRowPredicate(
      saved as FilterDefinition,
      (row: { price: number }) => String(row.price),
    );
    expect(matches({ price: 12 })).toBe(true);
    expect(matches({ price: 8 })).toBe(false);
  });

  it.each([MAX_SAVED_FILTER_DEPTH + 1, 20_000])(
    "should turn down a filter nested %i groups deep",
    (depth) => {
      expect(parse(nestedFilter(depth))).toBeUndefined();
      expect(
        readSavedState(
          { version: 1, parts: { filter: nestedFilter(depth) } },
          PARTS,
        ).filter,
      ).toEqual(EMPTY_FILTER);
    },
  );

  it("should keep broken rows, which matching skips", () => {
    const saved = {
      logic: "AND",
      criteria: [null, 7, { condition: ">=" }, PRICE_FILTER.criteria[0]],
    };
    const filter = parse(saved);
    expect(filter).toBe(saved);
    const matches = createRowPredicate(
      filter as FilterDefinition,
      (row: { price: number }) => String(row.price),
    );
    expect(matches({ price: 12 })).toBe(true);
    expect(matches({ price: 8 })).toBe(false);
  });
});

describe("columnStatePart", () => {
  it("should start from the list's own order and visibility", () => {
    expect(columnStatePart(COLUMNS).defaultValue).toEqual(COLUMN_DEFAULTS);
  });

  it("should fit saved settings to the column list", () => {
    const { parse } = columnStatePart(COLUMNS);
    expect(
      parse({ order: ["notes", "gone", "name"], hidden: ["name"] }),
    ).toEqual({ order: ["notes", "name", "price"], hidden: [] });
    expect(parse("broken")).toEqual(COLUMN_DEFAULTS);
  });

  it("should keep settings that already fit as the same object", () => {
    const saved: ColumnSettings = {
      order: ["price", "name", "notes"],
      hidden: [],
    };
    expect(columnStatePart(COLUMNS).parse(saved)).toBe(saved);
  });
});

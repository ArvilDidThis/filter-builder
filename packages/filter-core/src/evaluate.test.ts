import { describe, expect, it } from "vitest";
import {
  createRowPredicate,
  filterHasFilledCondition,
  isConditionFilled,
  isNumberType,
  matchesFilter,
} from "./evaluate";
import type { FilterDefinition, LeafCondition } from "./types";

// Each expectation below is what DataTables SearchBuilder does, read from its source
// (dataTables.searchBuilder.js). Where a stricter evaluator would answer differently, the test
// says so.

type Row = Record<string, string | number | null>;

/** SearchBuilder's rule for turning a stored value into the text it filters on. */
const filterValueOf = (row: Row, key: string): string => {
  const v = row[key];
  return v === null || v === undefined ? "" : String(v);
};

const leaf = (
  origData: string,
  condition: LeafCondition["condition"],
  value: string[],
  type: LeafCondition["type"] = "num",
): LeafCondition => ({ origData, data: origData, condition, type, value });

const only = (c: LeafCondition): FilterDefinition => ({
  criteria: [c],
  logic: "AND",
});

const matches = (filter: FilterDefinition, row: Row) =>
  matchesFilter(filter, row, filterValueOf);

describe("isNumberType", () => {
  it("should be true for plain and formatted numbers, with or without markup", () => {
    for (const type of ["num", "num-fmt", "html-num", "html-num-fmt"]) {
      expect(isNumberType(type)).toBe(true);
    }
  });

  it("should be false for text, dates, lists and a type it does not know", () => {
    for (const type of [
      "string",
      "html",
      "date",
      "array",
      "money",
      undefined,
    ]) {
      expect(isNumberType(type)).toBe(false);
    }
  });
});

describe("a blank value, the way SearchBuilder treats it", () => {
  const blankRow: Row = { rating: null, status: null };

  it("counts a blank number as zero", () => {
    // A stricter evaluator would say no here — a row with no value is not below 20.
    // SearchBuilder says yes, because it reads the blank as 0.
    expect(matches(only(leaf("rating", "<", ["20"])), blankRow)).toBe(true);
    expect(matches(only(leaf("rating", ">=", ["5"])), blankRow)).toBe(false);
    expect(matches(only(leaf("rating", "=", ["0"])), blankRow)).toBe(true);
    expect(
      matches(only(leaf("rating", "between", ["-1", "1"])), blankRow),
    ).toBe(true);
  });

  it("counts a blank text as empty, so it is not equal to any word", () => {
    expect(
      matches(only(leaf("status", "!=", ["ACTIVE"], "string")), blankRow),
    ).toBe(true);
    expect(
      matches(only(leaf("status", "=", ["ACTIVE"], "string")), blankRow),
    ).toBe(false);
  });

  it("is found on purpose with Empty and left out with Not empty", () => {
    expect(matches(only(leaf("rating", "null", [])), blankRow)).toBe(true);
    expect(matches(only(leaf("rating", "!null", [])), blankRow)).toBe(false);
    expect(matches(only(leaf("rating", "null", [])), { rating: 12 })).toBe(
      false,
    );
  });
});

describe("the number conditions", () => {
  const row: Row = { rating: 15 };

  it("compares by value, including text that holds a number", () => {
    expect(matches(only(leaf("rating", ">", ["14.9"])), row)).toBe(true);
    expect(matches(only(leaf("rating", "<=", ["15"])), row)).toBe(true);
    expect(matches(only(leaf("rating", "!=", ["15"])), row)).toBe(false);
  });

  it("takes the two bounds of between in either order", () => {
    expect(matches(only(leaf("rating", "between", ["10", "20"])), row)).toBe(
      true,
    );
    expect(matches(only(leaf("rating", "between", ["20", "10"])), row)).toBe(
      true,
    );
    expect(matches(only(leaf("rating", "!between", ["20", "10"])), row)).toBe(
      false,
    );
  });
});

describe("the text conditions", () => {
  const row: Row = { name: "Acme Widgets" };

  it("matches equals exactly, capital letters included", () => {
    expect(
      matches(only(leaf("name", "=", ["Acme Widgets"], "string")), row),
    ).toBe(true);
    expect(
      matches(only(leaf("name", "=", ["acme widgets"], "string")), row),
    ).toBe(false);
  });

  it("ignores capital letters for contains, starts and ends", () => {
    expect(
      matches(only(leaf("name", "contains", ["WIDG"], "string")), row),
    ).toBe(true);
    expect(matches(only(leaf("name", "starts", ["acme"], "string")), row)).toBe(
      true,
    );
    expect(matches(only(leaf("name", "!ends", ["GETS"], "string")), row)).toBe(
      false,
    );
  });
});

describe("conditions not yet filled in", () => {
  const row: Row = { rating: 5 };

  it("are recognised the way SearchBuilder recognises them", () => {
    expect(isConditionFilled(leaf("rating", ">", [""]))).toBe(false);
    expect(isConditionFilled(leaf("rating", "between", ["1"]))).toBe(false);
    expect(isConditionFilled(leaf("", ">", ["1"]))).toBe(false);
    // Empty and Not empty need no value at all.
    expect(isConditionFilled(leaf("rating", "null", []))).toBe(true);
  });

  it("are skipped by an AND group rather than failing it", () => {
    // SearchBuilder's own filter box holds an empty row like this, and still shows every row.
    const filter: FilterDefinition = {
      criteria: [leaf("rating", ">", [""]), leaf("rating", "<", ["10"])],
      logic: "AND",
    };
    expect(matches(filter, row)).toBe(true);
  });

  it("do not count in an OR group, and an OR group with none filled matches everything", () => {
    const oneFilled: FilterDefinition = {
      criteria: [leaf("rating", ">", [""]), leaf("rating", ">", ["10"])],
      logic: "OR",
    };
    expect(matches(oneFilled, row)).toBe(false);

    const noneFilled: FilterDefinition = {
      criteria: [leaf("rating", ">", [""])],
      logic: "OR",
    };
    expect(matches(noneFilled, row)).toBe(true);
  });
});

describe("nested groups", () => {
  it("combine the way SearchBuilder combines them", () => {
    // A typical nested filter: rating AND (active OR featured).
    const filter: FilterDefinition = {
      criteria: [
        {
          criteria: [
            leaf("score", ">=", ["5"]),
            leaf("rating", ">=", ["20"]),
            { criteria: [leaf("progress", ">=", ["80"])], logic: "AND" },
          ],
          logic: "AND",
        },
        {
          criteria: [
            leaf("status", "=", ["ACTIVE"], "string"),
            leaf("status", "=", ["FEATURED"], "string"),
          ],
          logic: "OR",
        },
      ],
      logic: "AND",
    };

    const base = { score: 5, rating: 25, progress: 85 };
    expect(matches(filter, { ...base, status: "FEATURED" })).toBe(true);
    expect(matches(filter, { ...base, status: "ARCHIVED" })).toBe(false);
    expect(matches(filter, { ...base, rating: 10, status: "ACTIVE" })).toBe(
      false,
    );
  });
});

describe("a condition whose value is not a list", () => {
  // Text has a `slice` of its own, so reading a stored `"20"` as a list of value boxes got part-way
  // and then stopped the run — in the middle of filtering, not at the save.
  const valueShapes: [string, unknown][] = [
    ["text", "20"],
    ["a number", 5],
    ["nothing", null],
    ["an object", { "0": "20" }],
  ];

  for (const [name, value] of valueShapes) {
    it(`counts as an empty box instead of stopping the run — ${name}`, () => {
      const filter = {
        criteria: [{ ...leaf("score", ">=", ["5"]), value }],
        logic: "AND",
      } as unknown as FilterDefinition;

      expect(matches(filter, { score: 1 })).toBe(true);
      expect(filterHasFilledCondition(filter)).toBe(false);
    });
  }

  it("still applies the conditions around it", () => {
    const filter = {
      criteria: [
        leaf("score", ">=", ["5"]),
        { ...leaf("rating", ">=", ["20"]), value: "20" },
      ],
      logic: "AND",
    } as unknown as FilterDefinition;

    expect(matches(filter, { score: 9, rating: 1 })).toBe(true);
    expect(matches(filter, { score: 1, rating: 99 })).toBe(false);
  });
});

describe("a slot holding no condition at all", () => {
  // Stored lists can hold anything. Each of these stopped the run when read as a condition; they now
  // count as an empty box, which the rules already skip.
  const malformed: [string, unknown][] = [
    ["nothing", { criteria: [null], logic: "AND" }],
    ["a number", { criteria: [5], logic: "AND" }],
    ["a piece of text", { criteria: ["x"], logic: "AND" }],
    [
      "nothing, nested",
      { criteria: [{ criteria: [null], logic: "OR" }], logic: "AND" },
    ],
    [
      "a property that is not text",
      {
        criteria: [
          { condition: ">=", origData: 7, type: "num", value: ["20"] },
        ],
        logic: "AND",
      },
    ],
  ];

  for (const [name, filter] of malformed) {
    it(`narrows nothing instead of stopping the run — ${name}`, () => {
      expect(matches(filter as FilterDefinition, { score: 5 })).toBe(true);
      expect(filterHasFilledCondition(filter as FilterDefinition)).toBe(false);
    });
  }

  it("still applies the conditions around it", () => {
    const filter = {
      criteria: [leaf("score", ">=", ["5"]), null],
      logic: "AND",
    } as unknown as FilterDefinition;

    expect(matches(filter, { score: 9 })).toBe(true);
    expect(matches(filter, { score: 1 })).toBe(false);
  });
});

describe("a group whose conditions are not a list", () => {
  // A filter comes back from its database column exactly as stored. Reading these as a list used to
  // stop the run outright, rather than skip the group.
  const malformed: [string, unknown][] = [
    [
      "nested, text instead of a list",
      { criteria: [{ criteria: "x", logic: "OR" }], logic: "AND" },
    ],
    [
      "nested, a number",
      { criteria: [{ criteria: 7, logic: "OR" }], logic: "AND" },
    ],
    ["nested, no list at all", { criteria: [{ logic: "OR" }], logic: "AND" }],
    ["the whole filter", { criteria: "x", logic: "AND" }],
  ];

  for (const [name, filter] of malformed) {
    it(`narrows nothing instead of stopping the run — ${name}`, () => {
      expect(matches(filter as FilterDefinition, { score: 5 })).toBe(true);
      expect(filterHasFilledCondition(filter as FilterDefinition)).toBe(false);
    });
  }

  it("still applies the conditions around it", () => {
    const filter = {
      criteria: [leaf("score", ">=", ["5"]), { criteria: "x", logic: "OR" }],
      logic: "AND",
    } as unknown as FilterDefinition;

    expect(matches(filter, { score: 9 })).toBe(true);
    expect(matches(filter, { score: 1 })).toBe(false);
  });
});

describe("filterHasFilledCondition", () => {
  const leafOn = (value: string[]) => ({
    condition: ">=" as const,
    data: "Rating %",
    origData: "details.rating",
    type: "num" as const,
    value,
  });

  it("is true when something is filled in", () => {
    expect(
      filterHasFilledCondition({ criteria: [leafOn(["20"])], logic: "AND" }),
    ).toBe(true);
  });

  it("is false for a filter with no conditions", () => {
    expect(filterHasFilledCondition({ criteria: [], logic: "AND" })).toBe(
      false,
    );
  });

  it("is false when the only condition has an empty value box", () => {
    expect(
      filterHasFilledCondition({ criteria: [leafOn([])], logic: "AND" }),
    ).toBe(false);
  });

  it("looks inside nested groups", () => {
    // A filter holding one empty group has nothing to apply either — the case a length check misses,
    // which would let a rule that acts on every match act on every row.
    expect(
      filterHasFilledCondition({
        criteria: [{ criteria: [], logic: "OR" }],
        logic: "AND",
      }),
    ).toBe(false);
    expect(
      filterHasFilledCondition({
        criteria: [{ criteria: [leafOn(["20"])], logic: "OR" }],
        logic: "AND",
      }),
    ).toBe(true);
  });

  it("is false for a filter that is missing or malformed", () => {
    expect(filterHasFilledCondition(null)).toBe(false);
    expect(filterHasFilledCondition(undefined)).toBe(false);
    expect(filterHasFilledCondition({ criteria: "nonsense" } as never)).toBe(
      false,
    );
  });
});

describe("createRowPredicate", () => {
  it("filters a list of rows with the same rules as matchesFilter", () => {
    const rows: Row[] = [
      { id: "A", rating: 25 },
      { id: "B", rating: 10 },
      { id: "C", rating: null },
    ];
    const filter = only(leaf("rating", "<", ["20"]));
    const kept = rows.filter(createRowPredicate(filter, filterValueOf));
    // C has no value, which compares as 0 (rule 1), so it passes "below 20".
    expect(kept.map((r) => r.id)).toEqual(["B", "C"]);
    expect(kept).toEqual(rows.filter((r) => matches(filter, r)));
  });

  it("keeps testing the filter as it was when the function was built", () => {
    const filter = only(leaf("rating", "<", ["20"]));
    const passes = createRowPredicate(filter, filterValueOf);
    const condition = filter.criteria[0] as LeafCondition;
    condition.value = ["5"];
    // The edit is seen by a new function, not by the one built before it.
    expect(passes({ id: "B", rating: 10 })).toBe(true);
    expect(
      createRowPredicate(filter, filterValueOf)({ id: "B", rating: 10 }),
    ).toBe(false);
  });

  it("is not changed by an edit inside the filter's own value list", () => {
    const filter = only(leaf("rating", "<", ["20"]));
    const passes = createRowPredicate(filter, filterValueOf);
    (filter.criteria[0] as LeafCondition).value[0] = "5";
    expect(passes({ id: "B", rating: 10 })).toBe(true);
  });
});

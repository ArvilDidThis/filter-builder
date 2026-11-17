import { describe, expect, it } from "vitest";
import {
  DATE_OPERATOR_PHRASES,
  describeFilter,
  summaryToText,
} from "./describe";
import { type FilterValue, matchesFilter } from "./evaluate";
import type { FieldDefinition } from "./fields";
import { invertFilter, invertOperator } from "./transform";
import type { FilterDefinition, LeafCondition } from "./types";

// What SearchBuilder itself does with each data type is proven in searchbuilder-parity.test.ts,
// by running the real SearchBuilder beside this library. This file covers the rest: what this
// library adds, and what it must do with input SearchBuilder never sees.

type Row = Record<string, unknown>;
const readValue = (row: Row, key: string) => row[key] as FilterValue;

const leaf = (
  origData: string,
  type: LeafCondition["type"],
  condition: LeafCondition["condition"],
  value: string[] = [],
): LeafCondition => ({ origData, data: origData, condition, type, value });

const only = (condition: LeafCondition): FilterDefinition => ({
  criteria: [condition],
  logic: "AND",
});

const passes = (condition: LeafCondition, row: Row): boolean =>
  matchesFilter(only(condition), row, readValue);

describe("formatted numbers", () => {
  it("should compare a salary by its number, whatever the currency sign and separators", () => {
    const row = { salary: "$86,000" };
    expect(passes(leaf("salary", "num-fmt", "=", ["86000"]), row)).toBe(true);
    expect(passes(leaf("salary", "num-fmt", ">", ["$85,999.99"]), row)).toBe(
      true,
    );
    expect(passes(leaf("salary", "num-fmt", "<", ["9,000"]), row)).toBe(false);
  });

  it("should read a plain number type as not a number when it holds a currency sign", () => {
    // This is why `num-fmt` exists: "$86,000" is not a number to the `num` type.
    expect(
      passes(leaf("salary", "num", "=", ["86000"]), { salary: "$86,000" }),
    ).toBe(false);
  });

  it("should read numbers written with a decimal comma when told to", () => {
    const filter = only(leaf("salary", "num", "between", ["1234", "1235"]));
    const row = { salary: "1234,5" };
    expect(matchesFilter(filter, row, readValue)).toBe(false);
    expect(matchesFilter(filter, row, readValue, { decimal: "," })).toBe(true);
  });
});

describe("dates", () => {
  const row = { joined: "2011/04/25" };

  it("should accept a date written with slashes against a filter written with dashes", () => {
    expect(passes(leaf("joined", "date", "=", ["2011-04-25"]), row)).toBe(true);
    expect(passes(leaf("joined", "date", "<", ["2011-04-26"]), row)).toBe(true);
    expect(passes(leaf("joined", "date", ">", ["2011-04-25"]), row)).toBe(
      false,
    );
  });

  it("should accept 'on or before' and 'on or after', which SearchBuilder does not offer", () => {
    expect(passes(leaf("joined", "date", "<=", ["2011-04-25"]), row)).toBe(
      true,
    );
    expect(passes(leaf("joined", "date", ">=", ["2011-04-26"]), row)).toBe(
      false,
    );
  });

  it("should keep an inverted date condition true for exactly the other rows", () => {
    const after = only(leaf("joined", "date", ">", ["2011-04-25"]));
    const notAfter = invertFilter(after);
    for (const joined of ["2011-04-24", "2011-04-25", "2011-04-26"]) {
      expect(matchesFilter(notAfter, { joined }, readValue)).toBe(
        !matchesFilter(after, { joined }, readValue),
      );
    }
  });
});

describe("lists", () => {
  const row = { tags: ["red", "blue"] };

  it("should match a list that holds the wanted item", () => {
    expect(passes(leaf("tags", "array", "contains", ["red"]), row)).toBe(true);
    expect(passes(leaf("tags", "array", "without", ["red"]), row)).toBe(false);
    expect(passes(leaf("tags", "array", "without", ["green"]), row)).toBe(true);
  });

  it("should treat two lists as equal whatever their order", () => {
    expect(passes(leaf("tags", "array", "=", ["blue", "red"]), row)).toBe(true);
    expect(passes(leaf("tags", "array", "=", ["red"]), row)).toBe(false);
    expect(passes(leaf("tags", "array", "!=", ["red"]), row)).toBe(true);
  });

  it("should leave the row's own list in its original order", () => {
    const tags = ["red", "blue"];
    passes(leaf("tags", "array", "=", ["blue", "red"]), { tags });
    expect(tags).toEqual(["red", "blue"]);
  });

  it("should leave the filter's own values in their original order", () => {
    const condition = leaf("tags", "array", "=", ["red", "blue"]);
    passes(condition, row);
    expect(condition.value).toEqual(["red", "blue"]);
  });

  it("should invert 'contains' to 'without', not to the text-only 'does not contain'", () => {
    expect(invertOperator("contains", "array")).toBe("without");
    expect(invertOperator("without", "array")).toBe("contains");
    expect(invertOperator("contains", "string")).toBe("!contains");
  });
});

describe("values tagged with HTML", () => {
  it("should compare the text inside the tags", () => {
    const row = { link: '<a href="/x">Acme</a>', salary: "<b>$5</b>" };
    expect(passes(leaf("link", "html", "=", ["Acme"]), row)).toBe(true);
    expect(passes(leaf("salary", "html-num-fmt", "=", ["5"]), row)).toBe(true);
  });

  it("should keep the tags for a type that is not an HTML type", () => {
    expect(
      passes(leaf("link", "string", "=", ["Acme"]), { link: "<i>Acme</i>" }),
    ).toBe(false);
  });
});

describe("values that are not what the type expects", () => {
  it.each([
    ["a missing value", undefined],
    ["nothing", null],
    ["a number", 5],
    ["a list on a text field", ["a", "b"]],
    ["an object", { a: 1 }],
  ])("should answer, not stop, when a row holds %s", (_name, value) => {
    for (const type of ["num", "num-fmt", "string", "date", "html"] as const) {
      expect(() =>
        passes(leaf("x", type, "=", ["5"]), { x: value }),
      ).not.toThrow();
    }
  });

  // Stored JSON can hold any of these in a value box. `{ toString: null }` is the worst case:
  // turning it into text or a number stops the run.
  const brokenBoxes = [5, null, { toString: null }, ["a"]];

  it.each(["num", "num-fmt", "string", "date", "html", "array"] as const)(
    "should answer, not stop, when a %s condition holds a broken second value",
    (type) => {
      for (const broken of brokenBoxes) {
        for (const operator of [
          "=",
          "!=",
          "<",
          "contains",
          "without",
        ] as const) {
          const condition = leaf("x", type, operator, ["5"]);
          (condition.value as unknown[]).push(broken);
          expect(() =>
            passes(condition, { x: type === "array" ? ["5"] : "5" }),
          ).not.toThrow();
        }
      }
    },
  );

  it("should skip a list condition that must equal a list holding something other than text", () => {
    const condition = leaf("tags", "array", "!=", ["red"]);
    (condition.value as unknown[]).push({ toString: null });
    // Skipped means the filter narrows nothing, so the row passes either way.
    expect(passes(condition, { tags: ["red"] })).toBe(true);
    expect(passes({ ...condition, condition: "=" }, { tags: ["blue"] })).toBe(
      true,
    );
  });

  it("should compare a stored type it does not know as text", () => {
    const condition = { ...leaf("x", "string", "=", ["5.0"]), type: "moment" };
    const filter = only(condition as unknown as LeafCondition);
    expect(matchesFilter(filter, { x: "5.0" }, readValue)).toBe(true);
    expect(matchesFilter(filter, { x: "5" }, readValue)).toBe(false);
  });

  it("should let every row through a group joined by neither AND nor OR, as SearchBuilder does", () => {
    const filter = {
      criteria: [leaf("x", "num", "=", ["5"])],
      logic: "XOR",
    } as unknown as FilterDefinition;
    expect(matchesFilter(filter, { x: "6" }, readValue)).toBe(true);
  });
});

describe("summaries of the new types", () => {
  const fields: FieldDefinition[] = [
    { key: "joined", label: "Joined", type: "date" },
    { key: "tags", label: "Tags", type: "array" },
  ];
  const summary = (condition: LeafCondition): string =>
    summaryToText(describeFilter(only(condition), fields));

  it("should say 'before' and 'after' for dates", () => {
    expect(summary(leaf("joined", "date", "<", ["2011-04-25"]))).toBe(
      "Joined before 2011-04-25",
    );
    expect(summary(leaf("joined", "date", ">=", ["2011-04-25"]))).toBe(
      "Joined on or after 2011-04-25",
    );
    expect(Object.keys(DATE_OPERATOR_PHRASES)).toEqual(["<", "<=", ">", ">="]);
  });

  it("should name every item when a list must equal another", () => {
    expect(summary(leaf("tags", "array", "=", ["red", "blue"]))).toBe(
      "Tags is red, blue",
    );
    expect(summary(leaf("tags", "array", "without", ["red"]))).toBe(
      "Tags does not include red",
    );
  });

  it("should let a caller reword date conditions only", () => {
    const text = summaryToText(
      describeFilter(only(leaf("joined", "date", "<", ["2011"])), fields, {
        datePhrases: { "<": ([v]) => `earlier than ${v}` },
      }),
    );
    expect(text).toBe("Joined earlier than 2011");
  });
});

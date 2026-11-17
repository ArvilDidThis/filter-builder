import { describe, expect, it } from "vitest";
import {
  describeFilter,
  formatFieldValue,
  type SummaryPart,
  summaryToText,
} from "./describe";
import type { FieldDefinition } from "./fields";
import type { FilterDefinition, LeafCondition } from "./types";

const fields: FieldDefinition[] = [
  {
    key: "budget",
    label: "Budget",
    summaryLabel: "budget",
    type: "num",
    prefix: "$",
    suffix: "B",
  },
  {
    key: "growth",
    label: "Expected growth",
    summaryLabel: "expected growth",
    type: "num",
    suffix: "%",
  },
  { key: "ratio", label: "Ratio", type: "num" },
  {
    key: "discount",
    label: "Discount",
    summaryLabel: "discount",
    type: "num",
    suffix: "%",
  },
  {
    key: "passed",
    label: "Checks passed",
    summaryLabel: "checks passed",
    type: "num",
    suffix: "%",
  },
  {
    key: "status",
    label: "Status",
    summaryLabel: "status",
    type: "string",
    choices: [
      { value: "FEATURED", label: "Featured" },
      { value: "ACTIVE", label: "Active" },
    ],
  },
  {
    key: "change",
    label: "Change since last year",
    summaryLabel: "change since last year",
    type: "num",
    suffix: "%",
  },
  {
    key: "reviews",
    label: "Number of reviews",
    summaryLabel: "number of reviews",
    type: "num",
  },
];

const leaf = (
  origData: string,
  condition: LeafCondition["condition"],
  value: string[],
  type: LeafCondition["type"] = "num",
): LeafCondition => ({ origData, data: origData, condition, type, value });

/** Renders joiners in **bold**, the way the design shows them. */
const asMarkdown = (parts: SummaryPart[]) =>
  parts.map((p) => (p.kind === "joiner" ? `**${p.text}**` : p.text)).join("");

describe("describeFilter", () => {
  it("writes the sentence from the redesign", () => {
    const filter: FilterDefinition = {
      logic: "AND",
      criteria: [
        leaf("budget", ">=", ["10"]),
        leaf("growth", ">=", ["15"]),
        leaf("ratio", "<=", ["50"]),
        leaf("discount", ">=", ["10"]),
        {
          logic: "OR",
          criteria: [
            leaf("passed", ">=", ["70"]),
            leaf("status", "=", ["FEATURED"], "string"),
            {
              logic: "AND",
              criteria: [
                leaf("change", ">=", ["0"]),
                leaf("reviews", ">=", ["10"]),
              ],
            },
          ],
        },
      ],
    };

    expect(asMarkdown(describeFilter(filter, fields))).toBe(
      "budget $10B or more **and** expected growth 15% or more " +
        "**and** Ratio up to 50 **and** discount 10% or more **and** " +
        "(checks passed 70% or more **or** status is Featured " +
        "**or** (change since last year 0% or more **and** number of " +
        "reviews 10 or more))",
    );
  });

  it("leaves out what matching skips: unfilled conditions and empty groups", () => {
    const filter: FilterDefinition = {
      logic: "AND",
      criteria: [
        leaf("ratio", "<=", ["50"]),
        leaf("budget", ">=", [""]),
        leaf("reviews", "between", ["5"]),
        { logic: "OR", criteria: [leaf("passed", ">=", [])] },
        { logic: "OR", criteria: [] },
      ],
    };
    expect(summaryToText(describeFilter(filter, fields))).toBe(
      "Ratio up to 50",
    );
  });

  it("drops the brackets from a group that describes a single item", () => {
    const filter: FilterDefinition = {
      logic: "AND",
      criteria: [
        leaf("ratio", "<=", ["50"]),
        {
          logic: "OR",
          criteria: [leaf("passed", ">=", ["70"]), leaf("change", ">=", [""])],
        },
      ],
    };
    expect(summaryToText(describeFilter(filter, fields))).toBe(
      "Ratio up to 50 and checks passed 70% or more",
    );
  });

  it("describes every operator", () => {
    const one = (c: LeafCondition) =>
      summaryToText(describeFilter({ logic: "AND", criteria: [c] }, fields));
    expect(one(leaf("ratio", "=", ["5"]))).toBe("Ratio is 5");
    expect(one(leaf("ratio", "!=", ["5"]))).toBe("Ratio is not 5");
    expect(one(leaf("ratio", "<", ["5"]))).toBe("Ratio less than 5");
    expect(one(leaf("ratio", ">", ["5"]))).toBe("Ratio more than 5");
    expect(one(leaf("ratio", "between", ["5", "9"]))).toBe(
      "Ratio between 5 and 9",
    );
    expect(one(leaf("ratio", "!between", ["5", "9"]))).toBe(
      "Ratio not between 5 and 9",
    );
    expect(one(leaf("ratio", "null", []))).toBe("Ratio is empty");
    expect(one(leaf("ratio", "!null", []))).toBe("Ratio is not empty");
    expect(one(leaf("name", "contains", ["corp"], "string"))).toBe(
      "name contains corp",
    );
    expect(one(leaf("name", "!contains", ["corp"], "string"))).toBe(
      "name does not contain corp",
    );
    expect(one(leaf("name", "starts", ["A"], "string"))).toBe(
      "name starts with A",
    );
    expect(one(leaf("name", "!starts", ["A"], "string"))).toBe(
      "name does not start with A",
    );
    expect(one(leaf("name", "ends", ["Inc"], "string"))).toBe(
      "name ends with Inc",
    );
    expect(one(leaf("name", "!ends", ["Inc"], "string"))).toBe(
      "name does not end with Inc",
    );
  });

  it("falls back to the name stored in the filter for a field the app no longer has", () => {
    const gone: LeafCondition = {
      origData: "removed.field",
      data: "Old Score",
      condition: ">=",
      type: "num",
      value: ["3"],
    };
    expect(
      summaryToText(describeFilter({ logic: "AND", criteria: [gone] }, fields)),
    ).toBe("Old Score 3 or more");
  });

  it("returns joiners as their own parts, so a UI can style them", () => {
    const parts = describeFilter(
      {
        logic: "OR",
        criteria: [leaf("ratio", "<=", ["50"]), leaf("ratio", "null", [])],
      },
      fields,
    );
    expect(parts).toEqual([
      { kind: "text", text: "Ratio up to 50 " },
      { kind: "joiner", text: "or" },
      { kind: "text", text: " Ratio is empty" },
    ]);
  });

  it("lets an app replace the wording", () => {
    const parts = describeFilter(
      {
        logic: "AND",
        criteria: [leaf("ratio", ">=", ["5"]), leaf("ratio", "<=", ["9"])],
      },
      fields,
      {
        phrases: { ">=": ([v]) => `≥ ${v}` },
        joiners: { AND: "y", OR: "o" },
      },
    );
    expect(summaryToText(parts)).toBe("Ratio ≥ 5 y Ratio up to 9");
  });

  it("returns nothing for a filter that narrows nothing, or is not a filter", () => {
    expect(describeFilter({ logic: "AND", criteria: [] }, fields)).toEqual([]);
    expect(describeFilter(null, fields)).toEqual([]);
    expect(describeFilter(undefined, fields)).toEqual([]);
    // A stored filter can hold anything: it is read loosely, like the evaluator reads it.
    const broken = {
      logic: "AND",
      criteria: "x",
    } as unknown as FilterDefinition;
    expect(describeFilter(broken, fields)).toEqual([]);
    const brokenSlots = {
      logic: "AND",
      criteria: [null, 5, { logic: "OR", criteria: 7 }],
    } as unknown as FilterDefinition;
    expect(describeFilter(brokenSlots, fields)).toEqual([]);
  });
});

describe("formatFieldValue", () => {
  it("wraps a value in the field's prefix and suffix", () => {
    expect(formatFieldValue(fields[0], "10")).toBe("$10B");
    expect(formatFieldValue(fields[2], "50")).toBe("50");
  });

  it("shows a choice's label, and the raw value when no choice matches", () => {
    expect(formatFieldValue(fields[5], "FEATURED")).toBe("Featured");
    expect(formatFieldValue(fields[5], "UNKNOWN")).toBe("UNKNOWN");
  });

  it("returns the raw value for an unknown field", () => {
    expect(formatFieldValue(undefined, "7")).toBe("7");
  });
});

import { describe, expect, it } from "vitest";
import {
  collectFilterPathTypes,
  countConditions,
  countFilledConditions,
} from "./inspect";
import type { FilterDefinition, LeafCondition } from "./types";

const leaf = (
  origData: string,
  value: string[],
  type: LeafCondition["type"] = "num",
): LeafCondition => ({
  origData,
  data: origData,
  condition: ">=",
  type,
  value,
});

const nested: FilterDefinition = {
  logic: "AND",
  criteria: [
    leaf("a", ["1"]),
    leaf("b", [""]),
    {
      logic: "OR",
      criteria: [
        leaf("a", ["2"]),
        leaf("c", ["x"], "string"),
        { logic: "AND", criteria: [leaf("user.d", ["3"])] },
      ],
    },
  ],
};

describe("countConditions", () => {
  it("counts every condition row at any depth, and no groups", () => {
    expect(countConditions(nested)).toBe(5);
  });

  it("counts only the filled ones on request", () => {
    expect(countFilledConditions(nested)).toBe(4);
  });

  it("counts nothing for an empty, missing or broken filter", () => {
    expect(countConditions({ logic: "AND", criteria: [] })).toBe(0);
    expect(countConditions(null)).toBe(0);
    expect(countConditions(undefined)).toBe(0);
    const broken = {
      logic: "AND",
      criteria: [null, 5, { logic: "OR", criteria: "x" }],
    } as unknown as FilterDefinition;
    expect(countConditions(broken)).toBe(0);
    expect(countFilledConditions(broken)).toBe(0);
  });
});

describe("collectFilterPathTypes", () => {
  it("lists each path once, in first-seen order, with its type", () => {
    expect(collectFilterPathTypes(nested)).toEqual([
      { path: "a", type: "num" },
      { path: "b", type: "num" },
      { path: "c", type: "string" },
      { path: "user.d", type: "num" },
    ]);
  });

  it("leaves out the paths the caller asks to skip", () => {
    const paths = collectFilterPathTypes(nested, (p) => p.startsWith("user."));
    expect(paths.map((p) => p.path)).toEqual(["a", "b", "c"]);
  });

  it("returns nothing for a missing filter or a broken condition list", () => {
    expect(collectFilterPathTypes(null)).toEqual([]);
    expect(collectFilterPathTypes(undefined)).toEqual([]);
    const broken = { logic: "AND", criteria: 5 } as unknown as FilterDefinition;
    expect(collectFilterPathTypes(broken)).toEqual([]);
  });
});

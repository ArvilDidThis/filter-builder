import { describe, expect, it } from "vitest";
import {
  type BuilderCondition,
  type BuilderGroup,
  buildBuilderRows,
} from "./builder";
import { createFieldLookup, type FieldDefinition } from "./fields";
import type { Criterion, FilterDefinition, LeafCondition } from "./types";

const FIELDS: FieldDefinition[] = [
  { key: "amount", label: "Amount", type: "num", prefix: "$" },
  { key: "name", label: "Name", type: "string", operators: ["=", "contains"] },
  { key: "tags", label: "Tags", type: "array" },
];
const lookup = createFieldLookup(FIELDS);

const leaf = (
  origData: string,
  condition: LeafCondition["condition"] = "=",
  value: string[] = ["5"],
  type: LeafCondition["type"] = "num",
): LeafCondition => ({ condition, data: origData, origData, type, value });

const group = (
  logic: "AND" | "OR",
  ...criteria: Criterion[]
): FilterDefinition => ({ criteria, logic });

describe("buildBuilderRows", () => {
  it("should describe the top group", () => {
    const top = buildBuilderRows(group("OR"), lookup);
    expect(top).toMatchObject({
      kind: "group",
      id: "root",
      path: [],
      level: 0,
      joiner: null,
      logic: "OR",
      rows: [],
      canAddGroup: true,
    });
  });

  it("should give each row its path, a unique id and its level", () => {
    const top = buildBuilderRows(
      group("AND", leaf("amount"), group("OR", leaf("name"), leaf("tags"))),
      lookup,
    );
    const nested = top.rows[1] as BuilderGroup;
    expect(top.rows[0]).toMatchObject({ id: "0", path: [0], level: 1 });
    expect(nested).toMatchObject({ id: "1", path: [1], level: 1 });
    expect(nested.rows[1]).toMatchObject({ id: "1.1", path: [1, 1], level: 2 });
  });

  it("should join each row to the one before it with its group's logic", () => {
    const top = buildBuilderRows(
      group("AND", leaf("amount"), group("OR", leaf("name"), leaf("tags"))),
      lookup,
    );
    const nested = top.rows[1] as BuilderGroup;
    expect(top.rows[0]?.joiner).toBeNull();
    // The nested group joins the row before it with the OUTER group's logic.
    expect(nested.joiner).toBe("AND");
    expect(nested.rows[0]?.joiner).toBeNull();
    expect(nested.rows[1]?.joiner).toBe("OR");
  });

  it("should attach the field and offer the field's own operators", () => {
    const top = buildBuilderRows(group("AND", leaf("name")), lookup);
    const row = top.rows[0] as BuilderCondition;
    expect(row.field).toBe(FIELDS[1]);
    expect(row.operators).toEqual(["=", "contains"]);
  });

  it("should offer the operators of the condition's type when the field is unknown", () => {
    const top = buildBuilderRows(group("AND", leaf("gone")), lookup);
    const row = top.rows[0] as BuilderCondition;
    expect(row.field).toBeUndefined();
    expect(row.operators).toContain("between");
  });

  it("should offer no operators for a type it does not know, without stopping", () => {
    const odd = leaf("gone", "=", ["5"], "money" as LeafCondition["type"]);
    const row = buildBuilderRows(group("AND", odd), lookup)
      .rows[0] as BuilderCondition;
    expect(row.operators).toEqual([]);
  });

  it("should say how many value boxes each condition shows", () => {
    const top = buildBuilderRows(
      group(
        "AND",
        leaf("amount", ">"),
        leaf("amount", "between", ["1", "9"]),
        leaf("amount", "null", []),
        leaf("tags", "=", ["a", "b"], "array"),
        leaf("tags", "contains", ["a"], "array"),
      ),
      lookup,
    );
    const counts = top.rows.map((row) => (row as BuilderCondition).valueCount);
    expect(counts).toEqual([1, 2, 0, null, 1]);
  });

  it("should say whether matching applies each condition", () => {
    const top = buildBuilderRows(
      group("AND", leaf("amount", ">", ["5"]), leaf("amount", ">", [""])),
      lookup,
    );
    expect((top.rows[0] as BuilderCondition).filled).toBe(true);
    expect((top.rows[1] as BuilderCondition).filled).toBe(false);
  });

  it("should allow a new group only above the depth limit", () => {
    const filter = group("AND", group("OR", group("AND")));
    const top = buildBuilderRows(filter, lookup, { depthLimit: 3 });
    const second = top.rows[0] as BuilderGroup;
    const third = second.rows[0] as BuilderGroup;
    expect(top.canAddGroup).toBe(true);
    expect(second.canAddGroup).toBe(true);
    expect(third.canAddGroup).toBe(false);
  });

  it("should list the moves each row can make", () => {
    const top = buildBuilderRows(
      group("AND", leaf("amount"), group("OR", leaf("name"))),
      lookup,
      { depthLimit: 2 },
    );
    expect(top.rows[0]?.moves).toMatchObject({ up: false, down: true });
    const inner = (top.rows[1] as BuilderGroup).rows[0];
    expect(inner?.moves).toMatchObject({
      outOfGroup: true,
      wrapInGroup: false,
    });
  });

  it("should show a slot that is neither a condition nor a group as broken", () => {
    const filter = group("AND", leaf("amount"), 5 as unknown as Criterion);
    const top = buildBuilderRows(filter, lookup);
    expect(top.rows[1]).toMatchObject({ kind: "broken", raw: 5, path: [1] });
  });

  it("should draw a group that has no list of rows as an empty group", () => {
    const noList = { logic: "OR" } as unknown as FilterDefinition;
    expect(buildBuilderRows(noList, lookup)).toMatchObject({
      kind: "group",
      logic: "OR",
      rows: [],
    });
    const nullList = {
      criteria: null,
      logic: "AND",
    } as unknown as FilterDefinition;
    expect(buildBuilderRows(nullList, lookup).rows).toEqual([]);
  });

  it("should show a group with a joiner it does not know as AND", () => {
    const filter = { criteria: [leaf("amount"), leaf("name")], logic: "and" };
    const top = buildBuilderRows(filter as unknown as FilterDefinition, lookup);
    expect(top.logic).toBe("AND");
    expect(top.rows[1]?.joiner).toBe("AND");
  });
});

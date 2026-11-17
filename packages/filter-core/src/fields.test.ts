import { describe, expect, it } from "vitest";
import { VALUES_NEEDED } from "./evaluate";
import {
  createFieldLookup,
  OPERATORS_BY_TYPE,
  operatorsForField,
} from "./fields";
import { OPERATOR_LABELS } from "./labels";
import { getValueByPath } from "./path";

describe("fields", () => {
  it("looks a field up by key", () => {
    const lookup = createFieldLookup([
      { key: "ratio", label: "Ratio", type: "num" },
    ]);
    expect(lookup.get("ratio")?.label).toBe("Ratio");
    expect(lookup.get("missing")).toBeUndefined();
  });

  it("offers the operators for the field's type, unless the field limits them", () => {
    expect(operatorsForField({ type: "num" })).toBe(OPERATORS_BY_TYPE.num);
    expect(
      operatorsForField({ type: "string", operators: ["=", "!="] }),
    ).toEqual(["=", "!="]);
  });

  it("only offers operators the evaluator knows, each with a label", () => {
    for (const operator of Object.values(OPERATORS_BY_TYPE).flat()) {
      expect(Object.hasOwn(VALUES_NEEDED, operator)).toBe(true);
      expect(OPERATOR_LABELS[operator].length).toBeGreaterThan(0);
    }
  });
});

describe("getValueByPath", () => {
  const row = { details: { growth: 12, note: null }, name: "Acme" };

  it("reads a dotted path", () => {
    expect(getValueByPath(row, "details.growth")).toBe(12);
    expect(getValueByPath(row, "name")).toBe("Acme");
  });

  it("returns undefined when a step is missing or not an object", () => {
    expect(getValueByPath(row, "details.missing")).toBeUndefined();
    expect(getValueByPath(row, "details.note.deeper")).toBeUndefined();
    expect(getValueByPath(row, "name.length.x")).toBeUndefined();
    expect(getValueByPath(null, "a")).toBeUndefined();
  });
});

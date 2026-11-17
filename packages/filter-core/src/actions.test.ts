import { describe, expect, it } from "vitest";
import {
  addCondition,
  addGroup,
  availableMoves,
  clearFilter,
  createCondition,
  getItemAt,
  isSamePath,
  moveDown,
  moveIntoGroupAbove,
  moveItem,
  moveOutOfGroup,
  moveUp,
  removeItem,
  setConditionField,
  setConditionOperator,
  setConditionValue,
  setConditionValues,
  setGroupLogic,
  valueBoxCount,
  wrapInGroup,
} from "./actions";
import { isConditionFilled } from "./evaluate";
import type { FieldDefinition } from "./fields";
import type {
  Criterion,
  FilterDefinition,
  FilterGroup,
  LeafCondition,
} from "./types";
import { isFilterGroup } from "./types";

/** A condition named by one letter, so a test can read the order of a filter at a glance. */
const leaf = (name: string): LeafCondition => ({
  condition: "=",
  data: name,
  origData: name,
  type: "string",
  value: ["x"],
});

const group = (logic: "AND" | "OR", ...criteria: Criterion[]): FilterGroup => ({
  criteria,
  logic,
});

/** Writes a filter as text: "a b (c d)" is two conditions and then a group of two. */
function shape(item: Criterion): string {
  if (!isFilterGroup(item)) return item.origData;
  return `(${item.criteria.map(shape).join(" ")})`;
}

/** a, b, a group of c and d, then e. */
const sample = (): FilterDefinition =>
  group(
    "AND",
    leaf("a"),
    leaf("b"),
    group("OR", leaf("c"), leaf("d")),
    leaf("e"),
  );

const AMOUNT: FieldDefinition = { key: "amount", label: "Amount", type: "num" };
const NAME: FieldDefinition = { key: "name", label: "Name", type: "string" };
const TAGS: FieldDefinition = { key: "tags", label: "Tags", type: "array" };

describe("getItemAt", () => {
  it("should find the top group, a condition and a nested condition", () => {
    const filter = sample();
    expect(getItemAt(filter, [])).toBe(filter);
    expect(shape(getItemAt(filter, [1]) as Criterion)).toBe("b");
    expect(shape(getItemAt(filter, [2, 1]) as Criterion)).toBe("d");
  });

  it("should return undefined for a path that leads nowhere", () => {
    const filter = sample();
    expect(getItemAt(filter, [9])).toBeUndefined();
    expect(getItemAt(filter, [0, 0])).toBeUndefined();
    expect(getItemAt(filter, [2, 5])).toBeUndefined();
  });
});

describe("createCondition", () => {
  it("should make a blank row that matching skips when no field is given", () => {
    const blank = createCondition();
    expect(blank.origData).toBe("");
    expect(isConditionFilled(blank)).toBe(false);
  });

  it("should take the field's label, key and type, and its first operator", () => {
    expect(createCondition(AMOUNT)).toEqual({
      condition: "=",
      data: "Amount",
      origData: "amount",
      type: "num",
      value: [""],
    });
  });

  it("should start with the operator asked for, with a value box for each bound", () => {
    const between = createCondition(AMOUNT, "between");
    expect(between.condition).toBe("between");
    expect(between.value).toEqual(["", ""]);
  });

  it("should fall back to the first operator when the field does not offer the one asked for", () => {
    expect(createCondition(NAME, "between").condition).toBe("=");
  });

  it("should respect a field's own operator list", () => {
    const field: FieldDefinition = { ...AMOUNT, operators: [">=", "<="] };
    expect(createCondition(field).condition).toBe(">=");
  });
});

describe("addCondition and addGroup", () => {
  it("should add a condition to the end of the top group", () => {
    expect(shape(addCondition(sample(), [], leaf("z")))).toBe(
      "(a b (c d) e z)",
    );
  });

  it("should add a condition to the end of a nested group", () => {
    expect(shape(addCondition(sample(), [2], leaf("z")))).toBe(
      "(a b (c d z) e)",
    );
  });

  it("should add an empty group, with the logic asked for", () => {
    const filter = addGroup(sample(), [], { logic: "OR" });
    expect(shape(filter)).toBe("(a b (c d) e ())");
    expect((getItemAt(filter, [4]) as FilterGroup).logic).toBe("OR");
  });

  it("should not add a group past the depth limit", () => {
    const filter = sample();
    // The top group is level 1 and the nested group is level 2.
    expect(addGroup(filter, [2], { depthLimit: 2 })).toBe(filter);
    expect(shape(addGroup(filter, [2], { depthLimit: 3 }))).toBe(
      "(a b (c d ()) e)",
    );
    expect(addGroup(filter, [], { depthLimit: 1 })).toBe(filter);
  });

  it("should return the same filter for a path that is not a group", () => {
    const filter = sample();
    expect(addCondition(filter, [0], leaf("z"))).toBe(filter);
    expect(addGroup(filter, [7])).toBe(filter);
  });

  it("should not change the filter it was given", () => {
    const filter = sample();
    const before = JSON.stringify(filter);
    addCondition(filter, [2], leaf("z"));
    addGroup(filter, []);
    expect(JSON.stringify(filter)).toBe(before);
  });
});

describe("a stored filter whose top group has no list of rows", () => {
  const noList = { logic: "OR" } as unknown as FilterDefinition;

  it("should add to it as to an empty group", () => {
    expect(addCondition(noList, [], leaf("a"))).toEqual({
      criteria: [leaf("a")],
      logic: "OR",
    });
    expect(addGroup(noList, [])).toEqual({
      criteria: [{ criteria: [], logic: "AND" }],
      logic: "OR",
    });
  });

  it("should find nothing in it, without stopping", () => {
    expect(getItemAt(noList, [0])).toBeUndefined();
    expect(removeItem(noList, [0])).toEqual({ criteria: [], logic: "OR" });
    expect(setConditionValue(noList, [0], 0, "x")).toEqual({
      criteria: [],
      logic: "OR",
    });
  });
});

describe("the small shared rules", () => {
  it("should tell whether two paths lead to the same place", () => {
    expect(isSamePath([0, 2], [0, 2])).toBe(true);
    expect(isSamePath([], [])).toBe(true);
    expect(isSamePath([0, 2], [0])).toBe(false);
    expect(isSamePath([0, 2], [0, 1])).toBe(false);
  });

  it("should say how many value boxes an operator needs", () => {
    expect(valueBoxCount("null", "num")).toBe(0);
    expect(valueBoxCount(">", "num")).toBe(1);
    expect(valueBoxCount("between", "num")).toBe(2);
    // A list compared for equality takes any number of values.
    expect(valueBoxCount("=", "array")).toBeNull();
    expect(valueBoxCount("contains", "array")).toBe(1);
  });

  it("should clear every row and keep the top group's joiner", () => {
    const filter = group("OR", leaf("a"), group("AND", leaf("b")));
    expect(clearFilter(filter)).toEqual({ criteria: [], logic: "OR" });
    const empty = group("OR");
    expect(clearFilter(empty)).toBe(empty);
    // A stored filter with no list of rows is cleared without stopping.
    expect(
      clearFilter({ logic: "AND" } as unknown as FilterDefinition),
    ).toEqual({
      criteria: [],
      logic: "AND",
    });
  });
});

describe("removeItem", () => {
  it("should remove a condition and a whole group", () => {
    expect(shape(removeItem(sample(), [0]))).toBe("(b (c d) e)");
    expect(shape(removeItem(sample(), [2]))).toBe("(a b e)");
    expect(shape(removeItem(sample(), [2, 0]))).toBe("(a b (d) e)");
  });

  it("should leave a group in place when its last condition is removed", () => {
    const filter = group("AND", group("OR", leaf("a")));
    expect(shape(removeItem(filter, [0, 0]))).toBe("(())");
  });

  it("should not remove the top group or a missing item", () => {
    const filter = sample();
    expect(removeItem(filter, [])).toBe(filter);
    expect(removeItem(filter, [9])).toBe(filter);
  });
});

describe("setGroupLogic", () => {
  it("should change the top group and a nested group", () => {
    expect(setGroupLogic(sample(), [], "OR").logic).toBe("OR");
    const filter = setGroupLogic(sample(), [2], "AND");
    expect((getItemAt(filter, [2]) as FilterGroup).logic).toBe("AND");
  });

  it("should return the same filter when the logic is already set", () => {
    const filter = sample();
    expect(setGroupLogic(filter, [], "AND")).toBe(filter);
  });
});

describe("changing a condition", () => {
  it("should point a condition at another field and clear its value", () => {
    const filter = setConditionField(sample(), [0], AMOUNT);
    expect(getItemAt(filter, [0])).toEqual({
      condition: "=",
      data: "Amount",
      origData: "amount",
      type: "num",
      value: [""],
    });
  });

  it("should keep the operator when the new field offers it", () => {
    const start = addCondition(
      group("AND"),
      [],
      createCondition(AMOUNT, "between"),
    );
    const kept = setConditionField(start, [0], { ...AMOUNT, key: "total" });
    expect((getItemAt(kept, [0]) as LeafCondition).condition).toBe("between");
    const reset = setConditionField(start, [0], NAME);
    expect((getItemAt(reset, [0]) as LeafCondition).condition).toBe("=");
  });

  it("should give a condition the value boxes its new operator needs", () => {
    let filter = addCondition(group("AND"), [], createCondition(AMOUNT));
    filter = setConditionValue(filter, [0], 0, "5");
    filter = setConditionOperator(filter, [0], "between");
    expect((getItemAt(filter, [0]) as LeafCondition).value).toEqual(["5", ""]);
    filter = setConditionValue(filter, [0], 1, "9");
    filter = setConditionOperator(filter, [0], ">");
    expect((getItemAt(filter, [0]) as LeafCondition).value).toEqual(["5"]);
    filter = setConditionOperator(filter, [0], "null");
    expect((getItemAt(filter, [0]) as LeafCondition).value).toEqual([]);
  });

  it("should keep every value of a list compared for equality", () => {
    let filter = addCondition(
      group("AND"),
      [],
      createCondition(TAGS, "contains"),
    );
    filter = setConditionValues(filter, [0], ["red", "blue", "green"]);
    filter = setConditionOperator(filter, [0], "=");
    expect((getItemAt(filter, [0]) as LeafCondition).value).toEqual([
      "red",
      "blue",
      "green",
    ]);
  });

  it("should set the second bound without leaving a gap before it", () => {
    const start = addCondition(group("AND"), [], {
      ...createCondition(AMOUNT, "between"),
      value: [],
    });
    const filter = setConditionValue(start, [0], 1, "9");
    expect((getItemAt(filter, [0]) as LeafCondition).value).toEqual(["", "9"]);
  });

  it("should read a broken value list as empty, without stopping", () => {
    const broken = { ...leaf("a"), value: "5" as unknown as string[] };
    const filter = setConditionValue(group("AND", broken), [0], 0, "7");
    expect((getItemAt(filter, [0]) as LeafCondition).value).toEqual(["7"]);
  });

  it("should return the same filter when the path is a group or leads nowhere", () => {
    const filter = sample();
    expect(setConditionOperator(filter, [2], ">")).toBe(filter);
    expect(setConditionValue(filter, [9], 0, "x")).toBe(filter);
    expect(setConditionField(filter, [], AMOUNT)).toBe(filter);
  });
});

describe("the operator of a blank row once its field is picked", () => {
  const blank = group("AND", createCondition());

  it("should start on the first operator the field offers, not the blank row's own", () => {
    const field: FieldDefinition = { ...AMOUNT, operators: [">=", "="] };
    expect(getItemAt(setConditionField(blank, [0], field), [0])).toMatchObject({
      condition: ">=",
    });
  });

  it("should start on the default operator when the field offers it", () => {
    const picked = setConditionField(blank, [0], AMOUNT, {
      defaultOperator: "between",
    });
    expect(getItemAt(picked, [0])).toMatchObject({
      condition: "between",
      value: ["", ""],
    });
    const notOffered = setConditionField(blank, [0], NAME, {
      defaultOperator: "between",
    });
    expect(getItemAt(notOffered, [0])).toMatchObject({ condition: "=" });
  });

  it("should keep a chosen operator over the default when the field changes", () => {
    const start = group("AND", createCondition(AMOUNT, ">"));
    const moved = setConditionField(
      start,
      [0],
      { ...AMOUNT, key: "total" },
      {
        defaultOperator: "between",
      },
    );
    expect(getItemAt(moved, [0])).toMatchObject({ condition: ">" });
  });
});

describe("a change that changes nothing", () => {
  const filled: LeafCondition = {
    condition: "between",
    data: "Amount",
    origData: "amount",
    type: "num",
    value: ["10", "20"],
  };
  const filter = group("AND", filled);

  it("should keep the values when the field picked is the one already set", () => {
    expect(setConditionField(filter, [0], AMOUNT)).toBe(filter);
  });

  it("should return the same filter for the operator already set", () => {
    expect(setConditionOperator(filter, [0], "between")).toBe(filter);
  });

  it("should return the same filter for a value already there", () => {
    expect(setConditionValue(filter, [0], 1, "20")).toBe(filter);
    expect(setConditionValue(filter, [0], 1, "21")).not.toBe(filter);
  });

  it("should return the same filter for an equal list of values", () => {
    expect(setConditionValues(filter, [0], ["10", "20"])).toBe(filter);
    expect(setConditionValues(filter, [0], ["10"])).not.toBe(filter);
  });
});

describe("wrapInGroup", () => {
  it("should wrap a condition in a new group in the same spot", () => {
    const filter = wrapInGroup(sample(), [1], { logic: "OR" });
    expect(shape(filter)).toBe("(a (b) (c d) e)");
    expect((getItemAt(filter, [1]) as FilterGroup).logic).toBe("OR");
  });

  it("should wrap a group", () => {
    expect(shape(wrapInGroup(sample(), [2]))).toBe("(a b ((c d)) e)");
  });

  it("should not wrap past the depth limit", () => {
    const filter = sample();
    // Wrapping a condition in the nested group would make a third level.
    expect(wrapInGroup(filter, [2, 0], { depthLimit: 2 })).toBe(filter);
    expect(shape(wrapInGroup(filter, [2, 0], { depthLimit: 3 }))).toBe(
      "(a b ((c) d) e)",
    );
    // Wrapping the nested group itself pushes it down to level 3.
    expect(wrapInGroup(filter, [2], { depthLimit: 2 })).toBe(filter);
  });

  it("should not wrap the top group", () => {
    const filter = sample();
    expect(wrapInGroup(filter, [])).toBe(filter);
  });
});

describe("moveItem", () => {
  it("should move an item earlier and later within its group", () => {
    expect(shape(moveItem(sample(), [3], [], 0))).toBe("(e a b (c d))");
    expect(shape(moveItem(sample(), [0], [], 4))).toBe("(b (c d) e a)");
    expect(shape(moveItem(sample(), [0], [], 2))).toBe("(b a (c d) e)");
  });

  it("should move a condition into a group, at the place asked for", () => {
    expect(shape(moveItem(sample(), [0], [2], 0))).toBe("(b (a c d) e)");
    expect(shape(moveItem(sample(), [3], [2], 2))).toBe("(a b (c d e))");
    expect(shape(moveItem(sample(), [1], [2], 1))).toBe("(a (c b d) e)");
  });

  it("should move a condition out of a group", () => {
    expect(shape(moveItem(sample(), [2, 0], [], 0))).toBe("(c a b (d) e)");
    expect(shape(moveItem(sample(), [2, 1], [], 4))).toBe("(a b (c) e d)");
  });

  it("should move a whole group", () => {
    expect(shape(moveItem(sample(), [2], [], 0))).toBe("((c d) a b e)");
  });

  it("should move between two nested groups", () => {
    const filter = group(
      "AND",
      group("OR", leaf("a"), leaf("b")),
      group("OR", leaf("c")),
    );
    expect(shape(moveItem(filter, [0, 1], [1], 0))).toBe("((a) (b c))");
    expect(shape(moveItem(filter, [1, 0], [0], 1))).toBe("((a c b) ())");
  });

  it("should not move a group into itself or into a group inside it", () => {
    const filter = group(
      "AND",
      group("OR", leaf("a"), group("AND", leaf("b"))),
    );
    expect(moveItem(filter, [0], [0], 0)).toBe(filter);
    expect(moveItem(filter, [0], [0, 1], 0)).toBe(filter);
  });

  it("should not move a group where it would pass the depth limit", () => {
    const filter = group(
      "AND",
      group("OR", leaf("a")),
      group("OR", leaf("b"), group("AND", leaf("c"))),
    );
    // The second group is two levels tall, so inside the first it would reach level 4.
    expect(moveItem(filter, [1], [0], 0, { depthLimit: 3 })).toBe(filter);
    expect(shape(moveItem(filter, [1], [0], 0, { depthLimit: 4 }))).toBe(
      "(((b (c)) a))",
    );
    // A condition is never stopped by the depth limit.
    expect(shape(moveItem(filter, [0, 0], [1, 1], 0, { depthLimit: 3 }))).toBe(
      "(() (b (a c)))",
    );
  });

  it("should return the same filter when nothing would change", () => {
    const filter = sample();
    expect(moveItem(filter, [1], [], 1)).toBe(filter);
    expect(moveItem(filter, [1], [], 2)).toBe(filter);
  });

  it("should return the same filter for a bad source, target or position", () => {
    const filter = sample();
    expect(moveItem(filter, [], [], 0)).toBe(filter);
    expect(moveItem(filter, [9], [], 0)).toBe(filter);
    expect(moveItem(filter, [0], [1], 0)).toBe(filter);
    expect(moveItem(filter, [0], [], 9)).toBe(filter);
    expect(moveItem(filter, [0], [], -1)).toBe(filter);
  });

  it("should keep every condition exactly once, whatever the move", () => {
    // Try every pairing of source and destination on a three-level filter.
    const filter = group(
      "AND",
      leaf("a"),
      group("OR", leaf("b"), group("AND", leaf("c"), leaf("d")), leaf("e")),
      leaf("f"),
      group("OR"),
    );
    const paths: number[][] = [];
    const groups: number[][] = [];
    const collect = (item: Criterion, path: number[]): void => {
      if (path.length > 0) paths.push(path);
      if (!isFilterGroup(item)) return;
      groups.push(path);
      item.criteria.forEach((child, index) => {
        collect(child, [...path, index]);
      });
    };
    collect(filter, []);
    const names = (item: Criterion): string[] =>
      isFilterGroup(item) ? item.criteria.flatMap(names) : [item.origData];
    const countGroups = (item: Criterion): number =>
      isFilterGroup(item)
        ? 1 + item.criteria.reduce((sum, child) => sum + countGroups(child), 0)
        : 0;
    const before = JSON.stringify(filter);
    let moves = 0;
    for (const from of paths) {
      for (const to of groups) {
        const size = (getItemAt(filter, to) as FilterGroup).criteria.length;
        for (let index = 0; index <= size; index++) {
          const moved = moveItem(filter, from, to, index);
          expect(names(moved).sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
          expect(countGroups(moved)).toBe(countGroups(filter));
          if (moved !== filter) moves += 1;
        }
      }
    }
    expect(moves).toBeGreaterThan(50);
    expect(JSON.stringify(filter)).toBe(before);
  });
});

describe("the menu moves", () => {
  it("should move an item up and down within its group", () => {
    expect(shape(moveUp(sample(), [1]))).toBe("(b a (c d) e)");
    expect(shape(moveDown(sample(), [1]))).toBe("(a (c d) b e)");
    expect(shape(moveUp(sample(), [2, 1]))).toBe("(a b (d c) e)");
  });

  it("should not move the first item up or the last item down", () => {
    const filter = sample();
    expect(moveUp(filter, [0])).toBe(filter);
    expect(moveDown(filter, [3])).toBe(filter);
    expect(moveDown(filter, [2, 1])).toBe(filter);
  });

  it("should move an item to the end of the group above it", () => {
    expect(shape(moveIntoGroupAbove(sample(), [3]))).toBe("(a b (c d e))");
  });

  it("should not move into the item above when it is a condition", () => {
    const filter = sample();
    expect(moveIntoGroupAbove(filter, [1])).toBe(filter);
    expect(moveIntoGroupAbove(filter, [0])).toBe(filter);
  });

  it("should not move a group into the group above past the depth limit", () => {
    const filter = group("AND", group("OR", leaf("a")), group("OR", leaf("b")));
    expect(moveIntoGroupAbove(filter, [1], { depthLimit: 2 })).toBe(filter);
    expect(shape(moveIntoGroupAbove(filter, [1], { depthLimit: 3 }))).toBe(
      "((a (b)))",
    );
  });

  it("should move an item out of its group, to just after the group", () => {
    expect(shape(moveOutOfGroup(sample(), [2, 0]))).toBe("(a b (d) c e)");
  });

  it("should not move an item out of the top group", () => {
    const filter = sample();
    expect(moveOutOfGroup(filter, [0])).toBe(filter);
  });
});

describe("availableMoves", () => {
  it("should offer what each position allows", () => {
    const filter = sample();
    expect(availableMoves(filter, [0])).toEqual({
      up: false,
      down: true,
      intoGroupAbove: false,
      outOfGroup: false,
      wrapInGroup: true,
    });
    expect(availableMoves(filter, [3])).toEqual({
      up: true,
      down: false,
      intoGroupAbove: true,
      outOfGroup: false,
      wrapInGroup: true,
    });
    expect(availableMoves(filter, [2, 0])).toEqual({
      up: false,
      down: true,
      intoGroupAbove: false,
      outOfGroup: true,
      wrapInGroup: true,
    });
  });

  it("should turn off wrapping at the depth limit", () => {
    expect(
      availableMoves(sample(), [2, 0], { depthLimit: 2 }).wrapInGroup,
    ).toBe(false);
  });
});

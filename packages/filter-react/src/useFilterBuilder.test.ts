import type {
  BuilderCondition,
  BuilderGroup,
  FieldDefinition,
  FilterDefinition,
} from "@arvilmena/filter-core";
import { act, renderHook } from "@testing-library/react";
import { useLayoutEffect, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  type UseFilterBuilderOptions,
  useFilterBuilder,
} from "./useFilterBuilder";

const FIELDS: FieldDefinition[] = [
  { key: "amount", label: "Amount", type: "num" },
  { key: "name", label: "Name", type: "string" },
];

const EMPTY: FilterDefinition = { criteria: [], logic: "AND" };

/** Runs the hook the way an app does: the app keeps the filter and passes it back in. */
function renderBuilder(
  initial: FilterDefinition = EMPTY,
  extra: Partial<UseFilterBuilderOptions> = {},
) {
  const onChange = vi.fn();
  const rendered = renderHook(() => {
    const [value, setValue] = useState(initial);
    const builder = useFilterBuilder({
      fields: FIELDS,
      value,
      onChange: (next) => {
        onChange(next);
        setValue(next);
      },
      ...extra,
    });
    return { builder, value };
  });
  return { ...rendered, onChange };
}

/** Writes the rows as text: "amount name (amount)" is two conditions and then a group of one. */
function shape(group: BuilderGroup): string {
  return group.rows
    .map((row) => {
      if (row.kind === "group") return `(${shape(row)})`;
      return row.kind === "condition" ? row.condition.origData || "blank" : "?";
    })
    .join(" ");
}

describe("useFilterBuilder", () => {
  it("should describe an empty filter", () => {
    const { result } = renderBuilder();
    expect(result.current.builder.root.rows).toEqual([]);
    expect(result.current.builder.conditionCount).toBe(0);
    expect(result.current.builder.fields.get("amount")?.label).toBe("Amount");
  });

  it("should add a blank condition and a condition on a field", () => {
    const { result } = renderBuilder();
    act(() => result.current.builder.actions.addCondition([]));
    act(() => result.current.builder.actions.addCondition([], "amount"));
    expect(shape(result.current.builder.root)).toBe("blank amount");
    expect(result.current.builder.conditionCount).toBe(2);
    expect(result.current.builder.filledConditionCount).toBe(0);
  });

  it("should start a new condition with the default operator when the field offers it", () => {
    const { result } = renderBuilder(EMPTY, { defaultOperator: "between" });
    act(() => result.current.builder.actions.addCondition([], "amount"));
    act(() => result.current.builder.actions.addCondition([], "name"));
    const [amount, name] = result.current.builder.root
      .rows as BuilderCondition[];
    expect(amount?.condition.condition).toBe("between");
    expect(amount?.valueCount).toBe(2);
    // Text has no "between", so it falls back to the field's first operator.
    expect(name?.condition.condition).toBe("=");
  });

  it("should use the default operator when a blank row's field is picked", () => {
    const { result } = renderBuilder(EMPTY, { defaultOperator: "between" });
    // The ready-made builder adds a blank row first, then the person picks its field.
    act(() => result.current.builder.actions.addCondition([]));
    act(() => result.current.builder.actions.setField([0], "amount"));
    const [amount] = result.current.builder.root.rows as BuilderCondition[];
    expect(amount?.condition.condition).toBe("between");
    expect(amount?.valueCount).toBe(2);
  });

  it("should fill in a condition step by step", () => {
    const { result } = renderBuilder();
    act(() => result.current.builder.actions.addCondition([]));
    act(() => result.current.builder.actions.setField([0], "amount"));
    act(() => result.current.builder.actions.setOperator([0], "between"));
    act(() => result.current.builder.actions.setValue([0], 0, "100"));
    act(() => result.current.builder.actions.setValue([0], 1, "500"));
    expect(result.current.value).toEqual({
      criteria: [
        {
          condition: "between",
          data: "Amount",
          origData: "amount",
          type: "num",
          value: ["100", "500"],
        },
      ],
      logic: "AND",
    });
    expect(result.current.builder.filledConditionCount).toBe(1);
  });

  it("should replace a list of values", () => {
    const { result } = renderBuilder();
    act(() => result.current.builder.actions.addCondition([], "name"));
    act(() => result.current.builder.actions.setValues([0], ["a", "b"]));
    const row = result.current.builder.root.rows[0] as BuilderCondition;
    expect(row.condition.value).toEqual(["a", "b"]);
  });

  it("should build nested groups and change their logic", () => {
    const { result } = renderBuilder();
    act(() => result.current.builder.actions.addCondition([], "amount"));
    act(() => result.current.builder.actions.addGroup([], "OR"));
    act(() => result.current.builder.actions.addCondition([1], "name"));
    act(() => result.current.builder.actions.setLogic([], "OR"));
    expect(shape(result.current.builder.root)).toBe("amount (name)");
    expect(result.current.value.logic).toBe("OR");
    const nested = result.current.builder.root.rows[1] as BuilderGroup;
    expect(nested.logic).toBe("OR");
    expect(nested.joiner).toBe("OR");
  });

  it("should remove a row", () => {
    const { result } = renderBuilder();
    act(() => result.current.builder.actions.addCondition([], "amount"));
    act(() => result.current.builder.actions.addCondition([], "name"));
    act(() => result.current.builder.actions.remove([0]));
    expect(shape(result.current.builder.root)).toBe("name");
  });

  it("should move rows up, down, into a group and out of it", () => {
    const { result } = renderBuilder();
    const { actions } = result.current.builder;
    act(() => actions.addCondition([], "amount"));
    act(() => actions.addGroup([]));
    act(() => actions.addCondition([], "name"));
    expect(shape(result.current.builder.root)).toBe("amount () name");
    act(() => actions.moveIntoGroupAbove([2]));
    expect(shape(result.current.builder.root)).toBe("amount (name)");
    act(() => actions.moveDown([0]));
    expect(shape(result.current.builder.root)).toBe("(name) amount");
    act(() => actions.moveUp([1]));
    expect(shape(result.current.builder.root)).toBe("amount (name)");
    act(() => actions.moveOutOfGroup([1, 0]));
    expect(shape(result.current.builder.root)).toBe("amount () name");
    act(() => actions.move([2], [1], 0));
    expect(shape(result.current.builder.root)).toBe("amount (name)");
    act(() => actions.wrapInGroup([0]));
    expect(shape(result.current.builder.root)).toBe("(amount) (name)");
  });

  it("should respect the depth limit in every action that can deepen the filter", () => {
    const { result, onChange } = renderBuilder(EMPTY, { depthLimit: 2 });
    const { actions } = result.current.builder;
    act(() => actions.addGroup([]));
    act(() => actions.addCondition([0], "amount"));
    act(() => actions.addGroup([]));
    onChange.mockClear();
    // Each of these would make a third level of groups.
    act(() => actions.addGroup([0]));
    act(() => actions.wrapInGroup([0, 0]));
    act(() => actions.moveIntoGroupAbove([1]));
    act(() => actions.move([1], [0], 0));
    expect(onChange).not.toHaveBeenCalled();
    // `canMove` gives the same answer without trying the move.
    expect(result.current.builder.actions.canMove([1], [0], 0)).toBe(false);
    expect(result.current.builder.actions.canMove([1], [], 0)).toBe(true);
    // A row is not offered the place it is already in.
    expect(result.current.builder.actions.canMove([1], [], 1)).toBe(false);
    expect(shape(result.current.builder.root)).toBe("(amount) ()");
    const first = result.current.builder.root.rows[0] as BuilderGroup;
    expect(first.canAddGroup).toBe(false);
    expect(result.current.builder.root.canAddGroup).toBe(true);
  });

  it("should not call onChange when an action cannot be done", () => {
    const { result, onChange } = renderBuilder();
    const { actions } = result.current.builder;
    act(() => actions.remove([5]));
    act(() => actions.moveUp([0]));
    act(() => actions.setField([0], "amount"));
    act(() => actions.clear());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should ignore a field key it does not know", () => {
    const { result, onChange } = renderBuilder();
    act(() => result.current.builder.actions.addCondition([], "amount"));
    onChange.mockClear();
    act(() => result.current.builder.actions.setField([0], "nope"));
    expect(onChange).not.toHaveBeenCalled();
    // Adding a condition on an unknown key adds a blank row.
    act(() => result.current.builder.actions.addCondition([], "nope"));
    expect(shape(result.current.builder.root)).toBe("amount blank");
  });

  it("should clear every row and keep the top group's logic", () => {
    const { result } = renderBuilder({
      criteria: [
        {
          condition: "=",
          data: "Name",
          origData: "name",
          type: "string",
          value: ["a"],
        },
      ],
      logic: "OR",
    });
    act(() => result.current.builder.actions.clear());
    expect(result.current.value).toEqual({ criteria: [], logic: "OR" });
  });

  it("should replace the whole filter, as a preset does", () => {
    const { result } = renderBuilder();
    const preset: FilterDefinition = {
      criteria: [
        {
          condition: ">",
          data: "Amount",
          origData: "amount",
          type: "num",
          value: ["5"],
        },
      ],
      logic: "AND",
    };
    act(() => result.current.builder.actions.replace(preset));
    expect(result.current.value).toBe(preset);
    expect(result.current.builder.filledConditionCount).toBe(1);
  });

  it("should apply two actions in one event, one after the other", () => {
    const { result } = renderBuilder();
    act(() => {
      result.current.builder.actions.addCondition([], "amount");
      result.current.builder.actions.addCondition([], "name");
    });
    expect(shape(result.current.builder.root)).toBe("amount name");
  });

  it("should not carry a change the app turned down into the next change", async () => {
    const seen: FilterDefinition[] = [];
    let accept = false;
    const { result } = renderHook(() => {
      const [value, setValue] = useState(EMPTY);
      return useFilterBuilder({
        fields: FIELDS,
        value,
        onChange: (next) => {
          seen.push(next);
          if (accept) setValue(next);
        },
      });
    });
    // The app turns this one down: it does not pass the new filter back in.
    await act(async () => result.current.actions.addCondition([], "amount"));
    accept = true;
    await act(async () => result.current.actions.addCondition([], "name"));
    // The second change holds only its own condition, not the one turned down.
    expect(seen[1]?.criteria).toHaveLength(1);
    expect(shape(result.current.root)).toBe("name");
  });

  it("should keep the same actions from one render to the next", () => {
    const { result } = renderBuilder();
    const before = result.current.builder.actions;
    act(() => result.current.builder.actions.addCondition([], "amount"));
    expect(result.current.builder.actions).toBe(before);
  });

  it("should follow a filter that the app changes from outside", () => {
    const { result, rerender } = renderHook(
      (props: { value: FilterDefinition }) =>
        useFilterBuilder({ fields: FIELDS, onChange: () => {}, ...props }),
      { initialProps: { value: EMPTY } },
    );
    expect(result.current.conditionCount).toBe(0);
    rerender({
      value: {
        criteria: [
          {
            condition: "=",
            data: "Name",
            origData: "name",
            type: "string",
            value: ["a"],
          },
        ],
        logic: "AND",
      },
    });
    expect(result.current.conditionCount).toBe(1);
    expect(shape(result.current.root)).toBe("name");
  });

  it("should build on a new filter in an action called as soon as it arrives", () => {
    const onChange = vi.fn();
    const loaded: FilterDefinition = {
      criteria: [
        {
          condition: "=",
          data: "Name",
          origData: "name",
          type: "string",
          value: ["a"],
        },
      ],
      logic: "AND",
    };
    const { rerender } = renderHook(
      (props: { value: FilterDefinition }) => {
        const builder = useFilterBuilder({
          fields: FIELDS,
          onChange,
          ...props,
        });
        // An app that adds a row straight after loading a saved filter, before the browser
        // paints. The action must see the loaded filter, not the one before it.
        useLayoutEffect(() => {
          if (props.value === loaded)
            builder.actions.addCondition([], "amount");
        }, [props.value, builder.actions]);
        return builder;
      },
      { initialProps: { value: EMPTY } },
    );
    rerender({ value: loaded });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]?.[0] as FilterDefinition;
    expect(next.criteria).toHaveLength(2);
    expect(next.criteria[0]).toBe(loaded.criteria[0]);
  });
});

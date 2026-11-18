import type { ColumnDefinition, ColumnSettings } from "@arvilmena/filter-core";
import { act, renderHook } from "@testing-library/react";
import { createElement, useState } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  type ColumnSettingsState,
  type UseColumnSettingsOptions,
  useColumnSettings,
} from "./useColumnSettings";

const COLUMNS = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "stock", label: "Stock" },
  { key: "notes", label: "Notes", defaultHidden: true },
] as const satisfies readonly ColumnDefinition[];

type Column = (typeof COLUMNS)[number];

/** Writes the picker's list as text: "name price (notes)" has the notes column hidden. */
const shape = (state: ColumnSettingsState<Column>): string =>
  state.orderedColumns
    .map(({ column, visible }) => (visible ? column.key : `(${column.key})`))
    .join(" ");

const visibleKeys = (state: ColumnSettingsState<Column>): string =>
  state.visibleColumns.map((column) => column.key).join(" ");

/** A page that draws the visible keys, for the server test. */
function Keys() {
  const state = useColumnSettings({ columns: COLUMNS });
  return createElement("p", null, visibleKeys(state));
}

/** Runs the hook with the hook keeping the settings ("uncontrolled"). */
function renderUncontrolled(
  extra: Partial<UseColumnSettingsOptions<Column>> = {},
) {
  const onChange = vi.fn();
  const rendered = renderHook(() =>
    useColumnSettings({ columns: COLUMNS, onChange, ...extra }),
  );
  return { ...rendered, onChange };
}

/** Runs the hook the way an app that owns the settings does ("controlled"). */
function renderControlled(initial: ColumnSettings | null) {
  const onChange = vi.fn();
  const rendered = renderHook(() => {
    const [value, setValue] = useState(initial);
    return useColumnSettings({
      columns: COLUMNS,
      value,
      onChange: (next) => {
        onChange(next);
        setValue(next);
      },
    });
  });
  return { ...rendered, onChange };
}

describe("useColumnSettings", () => {
  it("should start from the column list's own order and visibility", () => {
    const { result } = renderUncontrolled();
    expect(shape(result.current)).toBe("name price stock (notes)");
    expect(visibleKeys(result.current)).toBe("name price stock");
    expect(result.current.settings).toEqual({
      order: ["name", "price", "stock", "notes"],
      hidden: ["notes"],
    });
  });

  it("should hand back the app's own column objects", () => {
    const { result } = renderUncontrolled();
    expect(result.current.visibleColumns[0]).toBe(COLUMNS[0]);
    expect(result.current.orderedColumns[3]?.column).toBe(COLUMNS[3]);
    expect(result.current.orderedColumns[0]?.hideable).toBe(false);
  });

  it("should hide, show and toggle a column, and report each change", () => {
    const { result, onChange } = renderUncontrolled();
    act(() => result.current.actions.setVisible("price", false));
    expect(shape(result.current)).toBe("name (price) stock (notes)");
    act(() => result.current.actions.setVisible("price", true));
    act(() => result.current.actions.toggle("notes"));
    expect(shape(result.current)).toBe("name price stock notes");
    act(() => result.current.actions.toggle("notes"));
    expect(shape(result.current)).toBe("name price stock (notes)");
    expect(onChange).toHaveBeenCalledTimes(4);
    expect(onChange).toHaveBeenLastCalledWith(result.current.settings);
  });

  it("should keep a column shown that cannot be hidden", () => {
    const { result, onChange } = renderUncontrolled();
    act(() => result.current.actions.setVisible("name", false));
    act(() => result.current.actions.toggle("name"));
    expect(visibleKeys(result.current)).toBe("name price stock");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should move a column, show all and reset", () => {
    const { result } = renderUncontrolled();
    act(() => result.current.actions.move("stock", 0));
    expect(shape(result.current)).toBe("stock name price (notes)");
    act(() => result.current.actions.showAll());
    expect(shape(result.current)).toBe("stock name price notes");
    act(() => result.current.actions.reset());
    expect(shape(result.current)).toBe("name price stock (notes)");
  });

  it("should not report an action that changes nothing", () => {
    const { result, onChange } = renderUncontrolled();
    const before = result.current;
    act(() => {
      result.current.actions.setVisible("price", true);
      result.current.actions.move("name", 0);
      result.current.actions.reset();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(result.current.settings).toBe(before.settings);
  });

  it("should build a second action in the same event on the first", () => {
    const { result, onChange } = renderUncontrolled();
    act(() => {
      result.current.actions.move("notes", 0);
      result.current.actions.toggle("notes");
    });
    expect(shape(result.current)).toBe("notes name price stock");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("should start from the settings an app read from storage", () => {
    const { result } = renderUncontrolled({
      defaultValue: { order: ["stock", "gone", "name"], hidden: ["stock"] },
    });
    // "price" and "notes" are new to these settings. Each lands after the column it follows
    // in the list: "price" after "name", and "notes" after "stock".
    expect(shape(result.current)).toBe("(stock) (notes) name price");
  });

  it("should fall back to the defaults when the stored settings are broken", () => {
    const { result } = renderUncontrolled({
      defaultValue: "not settings" as unknown as ColumnSettings,
    });
    expect(shape(result.current)).toBe("name price stock (notes)");
  });

  it("should follow the app's settings when the app owns them", () => {
    const initial: ColumnSettings = {
      order: ["notes", "name", "price", "stock"],
      hidden: [],
    };
    const { result, onChange } = renderControlled(initial);
    expect(result.current.settings).toBe(initial);
    act(() => result.current.actions.toggle("price"));
    expect(shape(result.current)).toBe("notes name (price) stock");
    expect(onChange).toHaveBeenCalledWith({
      order: initial.order,
      hidden: ["price"],
    });
  });

  it("should show the defaults when an app that owns the settings has none saved", () => {
    const { result, onChange } = renderControlled(null);
    expect(shape(result.current)).toBe("name price stock (notes)");
    act(() => result.current.actions.toggle("price"));
    expect(shape(result.current)).toBe("name (price) stock (notes)");
    expect(result.current.settings).toBe(onChange.mock.lastCall?.[0]);
  });

  it("should leave the app in charge while its settings are null", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() =>
      useColumnSettings({ columns: COLUMNS, value: null, onChange }),
    );
    // The app is told about the change and does not pass it back in, so nothing may change.
    // A hook that took `null` for "keep the settings yourself" would hide the column here.
    act(() => result.current.actions.toggle("price"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(shape(result.current)).toBe("name price stock (notes)");
  });

  it("should start from the defaults when the stored settings are null", () => {
    const { result } = renderUncontrolled({ defaultValue: null });
    expect(shape(result.current)).toBe("name price stock (notes)");
    act(() => result.current.actions.toggle("price"));
    expect(shape(result.current)).toBe("name (price) stock (notes)");
  });

  it("should leave the settings alone when the app turns a change down", async () => {
    const onChange = vi.fn();
    const value: ColumnSettings = {
      order: ["name", "price", "stock", "notes"],
      hidden: [],
    };
    const { result } = renderHook(() =>
      useColumnSettings({ columns: COLUMNS, value, onChange }),
    );
    act(() => result.current.actions.toggle("price"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(shape(result.current)).toBe("name price stock notes");
    // The change that was turned down is forgotten once its event is over, so the next one
    // starts from `value`.
    await Promise.resolve();
    act(() => result.current.actions.toggle("stock"));
    expect(onChange).toHaveBeenLastCalledWith({
      order: value.order,
      hidden: ["stock"],
    });
  });

  it("should keep the same actions between renders", () => {
    const { result, rerender } = renderUncontrolled();
    const { actions } = result.current;
    act(() => actions.toggle("price"));
    rerender();
    expect(result.current.actions).toBe(actions);
    expect(result.current.actions.toggle).toBe(actions.toggle);
  });

  it("should keep the same lists on a render that changes nothing", () => {
    const { result, rerender } = renderUncontrolled();
    const before = result.current;
    rerender();
    expect(result.current.orderedColumns).toBe(before.orderedColumns);
    expect(result.current.visibleColumns).toBe(before.visibleColumns);
    expect(result.current.settings).toBe(before.settings);
  });

  it("should keep the visible list when only a hidden column moves", () => {
    const { result } = renderUncontrolled();
    const before = result.current.visibleColumns;
    act(() => result.current.actions.move("notes", 0));
    expect(shape(result.current)).toBe("(notes) name price stock");
    expect(result.current.visibleColumns).toBe(before);
  });

  it("should change the visible list when its content changes", () => {
    const { result } = renderUncontrolled();
    const before = result.current.visibleColumns;
    act(() => result.current.actions.toggle("price"));
    expect(result.current.visibleColumns).not.toBe(before);
    expect(visibleKeys(result.current)).toBe("name stock");
  });

  it("should reuse the entries of the columns a change did not touch", () => {
    const { result } = renderUncontrolled();
    const before = result.current.orderedColumns;
    act(() => result.current.actions.toggle("price"));
    expect(result.current.orderedColumns).not.toBe(before);
    expect(result.current.orderedColumns[0]).toBe(before[0]);
    expect(result.current.orderedColumns[1]).not.toBe(before[1]);
    expect(result.current.orderedColumns[2]).toBe(before[2]);
  });

  it("should keep the visible list when the app passes equal settings again", () => {
    const { result, rerender } = renderHook(
      (props: { value: ColumnSettings }) =>
        useColumnSettings({ columns: COLUMNS, ...props }),
      {
        initialProps: {
          value: { order: ["price", "name", "stock", "notes"], hidden: [] },
        },
      },
    );
    const before = result.current.visibleColumns;
    rerender({
      value: { order: ["price", "name", "stock", "notes"], hidden: [] },
    });
    expect(result.current.visibleColumns).toBe(before);
  });

  it("should fit the settings to a column list that changes", () => {
    const { result, rerender } = renderHook(
      (props: { columns: readonly ColumnDefinition[] }) =>
        useColumnSettings(props),
      { initialProps: { columns: COLUMNS as readonly ColumnDefinition[] } },
    );
    act(() => result.current.actions.move("stock", 0));
    rerender({
      columns: [
        { key: "name", label: "Name" },
        { key: "stock", label: "Stock" },
        { key: "added", label: "Added" },
      ],
    });
    // "price" and "notes" are gone, and "added" follows "stock" as it does in the new list.
    expect(result.current.settings).toEqual({
      order: ["stock", "added", "name"],
      hidden: [],
    });
  });

  it("should see new props in an action called after a rerender", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(
      (props: { onChange: (settings: ColumnSettings) => void }) =>
        useColumnSettings({ columns: COLUMNS, ...props }),
      { initialProps: { onChange: first } },
    );
    rerender({ onChange: second });
    act(() => result.current.actions.toggle("price"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("should only accept the keys of the app's own columns", () => {
    const { result } = renderUncontrolled();
    // The check is made by the type checker: a misspelt key must not compile.
    // @ts-expect-error "pric" is not a column key
    act(() => result.current.actions.toggle("pric"));
    expect(shape(result.current)).toBe("name price stock (notes)");
  });

  it("should render on a server", () => {
    expect(renderToString(createElement(Keys))).toBe("<p>name price stock</p>");
  });
});

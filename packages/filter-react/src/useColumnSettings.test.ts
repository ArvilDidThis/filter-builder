import type { ColumnDefinition, ColumnSettings } from "@arvilmena/filter-core";
import { act, render, renderHook } from "@testing-library/react";
import {
  createElement,
  Fragment,
  Suspense,
  startTransition,
  use,
  useState,
} from "react";
import { flushSync } from "react-dom";
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

/** What the transition test shares with the page it draws. */
const gate: {
  isOpen: boolean;
  opened: Promise<void>;
  actions?: ColumnSettingsState<Column>["actions"];
} = { isOpen: true, opened: Promise.resolve() };

/** Cannot be drawn while the price column is hidden, until the gate opens. */
function Blocker({ hidden }: { hidden: readonly string[] }) {
  if (!gate.isOpen && hidden.includes("price")) use(gate.opened);
  return null;
}

/** A page that draws the picker's list as text, with a part that can hold a drawing back. */
function GatedPage() {
  const state = useColumnSettings({ columns: COLUMNS });
  gate.actions = state.actions;
  return createElement(
    Fragment,
    null,
    createElement("p", null, shape(state)),
    createElement(
      Suspense,
      { fallback: null },
      createElement(Blocker, { hidden: state.settings.hidden }),
    ),
  );
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

  it("should build a second action in the same event on the first when the app owns the settings", () => {
    const { result, onChange } = renderControlled(null);
    act(() => {
      result.current.actions.move("notes", 0);
      result.current.actions.toggle("notes");
    });
    expect(shape(result.current)).toBe("notes name price stock");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("should build on the settings the app put on screen, not on an older proposal", () => {
    const fromApp: ColumnSettings = {
      order: ["stock", "name", "price", "notes"],
      hidden: [],
    };
    let answerWithOwn = true;
    const { result } = renderHook(() => {
      const [value, setValue] = useState<ColumnSettings | null>(null);
      return useColumnSettings({
        columns: COLUMNS,
        value,
        // The app answers the first change with settings of its own.
        onChange: (next) => {
          setValue(answerWithOwn ? fromApp : next);
          answerWithOwn = false;
        },
      });
    });
    act(() => result.current.actions.toggle("notes"));
    expect(result.current.settings).toBe(fromApp);
    // Straight after, before the first event is over. The app's settings are on screen by
    // now, so this change starts from them and not from what the first action asked for.
    act(() => result.current.actions.toggle("price"));
    expect(shape(result.current)).toBe("stock name (price) notes");
  });

  it("should forget a change the app turned down once the app draws other settings, even if it then puts the first ones back", () => {
    const first: ColumnSettings = {
      order: ["name", "price", "stock", "notes"],
      hidden: [],
    };
    const other: ColumnSettings = {
      order: ["notes", "name", "price", "stock"],
      hidden: [],
    };
    const onChange = vi.fn();
    let setValue: (value: ColumnSettings) => void = () => {};
    const { result } = renderHook(() => {
      const [value, set] = useState(first);
      setValue = set;
      return useColumnSettings({ columns: COLUMNS, value, onChange });
    });
    act(() => {
      // The app turns this change down.
      result.current.actions.toggle("price");
      // Still in the same event, the app draws other settings, and then the first ones
      // again. `flushSync` makes React draw at once.
      flushSync(() => setValue(other));
      flushSync(() => setValue(first));
      result.current.actions.toggle("stock");
    });
    // The first change was out of date as soon as other settings were drawn.
    expect(onChange).toHaveBeenLastCalledWith({
      order: first.order,
      hidden: ["stock"],
    });
  });

  it("should forget a change the app turned down when the app hands the settings over to the hook", () => {
    const onChange = vi.fn();
    let setValue: (value: ColumnSettings | undefined) => void = () => {};
    const { result } = renderHook(() => {
      const [value, set] = useState<ColumnSettings | undefined>({
        order: ["name", "price", "stock", "notes"],
        hidden: [],
      });
      setValue = set;
      return useColumnSettings({ columns: COLUMNS, value, onChange });
    });
    act(() => {
      // The app turns this change down.
      result.current.actions.toggle("price");
      // Still in the same event, the app stops passing settings in, so the hook keeps its
      // own from here on. `flushSync` makes React draw at once.
      flushSync(() => setValue(undefined));
      result.current.actions.toggle("stock");
    });
    // The hook's own settings start from the defaults. The change the app turned down
    // is not among them.
    expect(shape(result.current)).toBe("name price (stock) (notes)");
  });

  it("should forget a change still waiting in the hook when the app takes the settings over", () => {
    const fromApp: ColumnSettings = {
      order: ["name", "price", "stock", "notes"],
      hidden: [],
    };
    const onChange = vi.fn();
    let setValue: (value: ColumnSettings | undefined) => void = () => {};
    const { result } = renderHook(() => {
      const [value, set] = useState<ColumnSettings | undefined>(undefined);
      setValue = set;
      return useColumnSettings({ columns: COLUMNS, value, onChange });
    });
    act(() => {
      // A change the hook has asked React to draw, and React has not drawn yet.
      result.current.actions.toggle("price");
      // Still in the same event, the app starts passing settings in.
      flushSync(() => setValue(fromApp));
      result.current.actions.toggle("stock");
    });
    // The app's settings are what counts now, so the change starts from them.
    expect(onChange).toHaveBeenLastCalledWith({
      order: fromApp.order,
      hidden: ["stock"],
    });
  });

  it("should build on a change that is still waiting in a transition", async () => {
    let openGate = () => {};
    const opened = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    gate.opened = opened;
    gate.isOpen = false;
    const { container, unmount } = render(createElement(GatedPage));
    const actions = gate.actions;
    const drawn = () => container.querySelector("p")?.textContent;

    // A transition (a change React may put on screen later). This one cannot be drawn yet,
    // so React keeps it waiting and the screen stays as it was.
    await act(async () => {
      startTransition(() => actions?.toggle("price"));
    });
    expect(drawn()).toBe("name price stock (notes)");
    // A change React draws at once. It must not undo the one that is waiting.
    await act(async () => actions?.move("stock", 0));
    gate.isOpen = true;
    openGate();
    await act(async () => {
      await opened;
    });
    expect(drawn()).toBe("stock name (price) (notes)");
    unmount();
  });

  it("should keep a waiting change when an earlier one is drawn first", async () => {
    let openGate = () => {};
    const opened = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    gate.opened = opened;
    gate.isOpen = false;
    const { container, unmount } = render(createElement(GatedPage));
    const actions = gate.actions;
    const drawn = () => container.querySelector("p")?.textContent;

    // Two changes in one event. React draws the first at once, and keeps the second waiting
    // in a transition (a change React may put on screen later) that cannot be drawn yet.
    await act(async () => {
      actions?.move("stock", 0);
      startTransition(() => actions?.toggle("price"));
    });
    expect(drawn()).toBe("stock name price (notes)");
    // The first change is on screen now. This one must still build on the waiting one.
    await act(async () => actions?.toggle("notes"));
    gate.isOpen = true;
    openGate();
    await act(async () => {
      await opened;
    });
    expect(drawn()).toBe("stock name (price) notes");
    unmount();
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

  describe("whether Show all and Reset have anything to do", () => {
    it("should start with the defaults, and not all shown while a column starts hidden", () => {
      const { result } = renderUncontrolled();
      expect(result.current.isDefault).toBe(true);
      expect(result.current.allVisible).toBe(false);
    });

    it("should say all are shown when no column starts hidden", () => {
      const { result } = renderHook(() =>
        useColumnSettings({ columns: COLUMNS.slice(0, 3) }),
      );
      expect(result.current.allVisible).toBe(true);
      expect(result.current.isDefault).toBe(true);
    });

    it("should follow each change a person makes", () => {
      const { result } = renderUncontrolled();
      act(() => result.current.actions.showAll());
      expect(result.current.allVisible).toBe(true);
      expect(result.current.isDefault).toBe(false);
      act(() => result.current.actions.toggle("price"));
      expect(result.current.allVisible).toBe(false);
      act(() => result.current.actions.reset());
      expect(result.current.isDefault).toBe(true);
      expect(result.current.allVisible).toBe(false);
    });

    it("should not be the defaults once a column is only moved", () => {
      const { result } = renderUncontrolled();
      act(() => result.current.actions.move("stock", 0));
      expect(result.current.isDefault).toBe(false);
      act(() => result.current.actions.move("stock", 2));
      expect(result.current.isDefault).toBe(true);
    });

    it("should count a column that cannot be hidden as shown", () => {
      // Stored settings that try to hide the name, which must stay shown.
      const { result } = renderUncontrolled({
        defaultValue: {
          order: ["name", "price", "stock", "notes"],
          hidden: ["name"],
        },
      });
      expect(result.current.allVisible).toBe(true);
    });

    it("should say an action has nothing to do exactly when it reports no change", () => {
      const { result, onChange } = renderUncontrolled({
        defaultValue: {
          order: ["price", "name", "stock", "notes"],
          hidden: [],
        },
      });
      expect(result.current.allVisible).toBe(true);
      act(() => result.current.actions.showAll());
      expect(onChange).not.toHaveBeenCalled();
      expect(result.current.isDefault).toBe(false);
      act(() => result.current.actions.reset());
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(result.current.isDefault).toBe(true);
      act(() => result.current.actions.reset());
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    it("should follow the app's settings when the app owns them", () => {
      const { result, rerender } = renderHook(
        (props: { value: ColumnSettings | null }) =>
          useColumnSettings({ columns: COLUMNS, ...props }),
        { initialProps: { value: null as ColumnSettings | null } },
      );
      expect(result.current.isDefault).toBe(true);
      // The app turns the change down, so nothing is different.
      act(() => result.current.actions.showAll());
      expect(result.current.allVisible).toBe(false);
      expect(result.current.isDefault).toBe(true);
      rerender({
        value: { order: ["name", "price", "stock", "notes"], hidden: [] },
      });
      expect(result.current.allVisible).toBe(true);
      expect(result.current.isDefault).toBe(false);
    });

    it("should follow a column list that changes", () => {
      const { result, rerender } = renderHook(
        (props: { columns: readonly ColumnDefinition[] }) =>
          useColumnSettings(props),
        { initialProps: { columns: COLUMNS as readonly ColumnDefinition[] } },
      );
      act(() => result.current.actions.toggle("notes"));
      expect(result.current.isDefault).toBe(false);
      // The same columns, with notes now shown from the start.
      rerender({
        columns: COLUMNS.map((column) => ({ ...column, defaultHidden: false })),
      });
      expect(result.current.isDefault).toBe(true);
    });

    it("should leave the lists and actions as they were on a render that changes nothing", () => {
      const { result, rerender } = renderUncontrolled();
      const before = result.current;
      rerender();
      expect(result.current.isDefault).toBe(before.isDefault);
      expect(result.current.allVisible).toBe(before.allVisible);
      expect(result.current.orderedColumns).toBe(before.orderedColumns);
      expect(result.current.visibleColumns).toBe(before.visibleColumns);
      expect(result.current.actions).toBe(before.actions);
    });
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

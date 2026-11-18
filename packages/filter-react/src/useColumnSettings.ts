import {
  type ColumnDefinition,
  type ColumnSettings,
  moveColumn,
  type OrderedColumn,
  orderedColumns,
  reconcileColumnSettings,
  resetColumnSettings,
  setColumnVisible,
  showAllColumns,
  visibleColumns,
} from "@arvilmena/filter-core";
import { useCallback, useMemo, useRef, useState } from "react";
import { useEarlyEffect } from "./useEarlyEffect";

/** What `useColumnSettings` needs from the app. */
export interface UseColumnSettingsOptions<
  Column extends ColumnDefinition = ColumnDefinition,
> {
  /** The table's columns. Keep the same list between renders (see `useMemo`). */
  columns: readonly Column[];
  /**
   * The settings to show, when the app owns them ("controlled"): keep them in state and pass
   * every change from `onChange` back in. Leave out to let the hook keep them.
   */
  value?: ColumnSettings;
  /** The settings to start from when the hook keeps them, such as ones read from storage. */
  defaultValue?: ColumnSettings;
  /** Called with the new settings after every change a person makes. */
  onChange?: (settings: ColumnSettings) => void;
}

/**
 * Every change a column picker can make. An action that changes nothing does not call
 * `onChange`.
 */
export interface ColumnSettingsActions<Key extends string = string> {
  /** Shows or hides one column. A column that cannot be hidden stays shown. */
  setVisible: (key: Key, visible: boolean) => void;
  /** Hides a shown column, or shows a hidden one. */
  toggle: (key: Key) => void;
  /**
   * Moves a column so that it ends up at `toIndex` in the order. The order counts hidden
   * columns too, so the index is the column's place in `columns`.
   */
  move: (key: Key, toIndex: number) => void;
  /** Shows every column, keeping the order. */
  showAll: () => void;
  /** Puts back the list's own order and starting visibility. */
  reset: () => void;
}

/** What `useColumnSettings` gives a table and its column picker. */
export interface ColumnSettingsState<
  Column extends ColumnDefinition = ColumnDefinition,
> {
  /** The settings now, fitted to the column list. Store this to keep a person's choices. */
  settings: ColumnSettings;
  /** Every column in its chosen place, each with whether it is shown. A picker draws this. */
  columns: readonly OrderedColumn<Column>[];
  /**
   * The columns the table should draw, in order. The list stays the same object until its
   * content changes, so a memoised table does not redraw for nothing.
   */
  visibleColumns: readonly Column[];
  /** The changes a picker can make. The object stays the same between renders. */
  actions: ColumnSettingsActions<Column["key"]>;
}

/**
 * Which columns a table shows and in what order, with no markup or styling. A table draws
 * `visibleColumns`, and a picker draws `columns` and calls `actions`.
 *
 * It works like a form input. Pass `value` and `onChange` to own the settings, or leave `value`
 * out and the hook keeps them, starting from `defaultValue`. Either way the settings are fitted
 * to the column list first, so stored settings from an older column list are safe to pass in.
 *
 * @example
 * const table = useColumnSettings({ columns });
 * // table.visibleColumns: draw these as the table's columns.
 * // table.actions.toggle("price"), table.actions.move("price", 0)
 */
export function useColumnSettings<Column extends ColumnDefinition>(
  options: UseColumnSettingsOptions<Column>,
): ColumnSettingsState<Column> {
  const { columns, value, defaultValue, onChange } = options;
  const isControlled = value !== undefined;
  const [own, setOwn] = useState(defaultValue);
  const saved = isControlled ? value : own;
  const settings = useMemo(
    () => reconcileColumnSettings(columns, saved),
    [columns, saved],
  );

  // The actions read the newest props through this ref, so they can stay the same functions
  // from one render to the next. It is written after React has put a render on screen, not
  // while rendering: React may throw a render away, and its props must not reach the actions.
  const latest = useRef({ settings, columns, onChange, isControlled });
  useEarlyEffect(() => {
    latest.current = { settings, columns, onChange, isControlled };
  });

  // The settings proposed by an action in the event being handled now, if any. A second action
  // in the same event builds on them, not on the old settings. They are forgotten once the
  // event is over: an app that owns the settings may have turned the change down.
  const proposed = useRef<ColumnSettings | null>(null);

  const apply = useCallback(
    (
      change: (
        columns: readonly ColumnDefinition[],
        settings: ColumnSettings,
      ) => ColumnSettings,
    ) => {
      const before = proposed.current ?? latest.current.settings;
      const next = change(latest.current.columns, before);
      // The actions return the same settings when nothing changed.
      if (next === before) return;
      if (proposed.current === null) {
        // Runs as soon as the event's own code has finished.
        queueMicrotask(() => {
          proposed.current = null;
        });
      }
      proposed.current = next;
      if (!latest.current.isControlled) setOwn(next);
      latest.current.onChange?.(next);
    },
    [],
  );

  const actions = useMemo<ColumnSettingsActions<Column["key"]>>(() => {
    const setVisible = (key: string, wanted: boolean | "toggle") =>
      apply((list, before) => {
        const visible =
          wanted === "toggle" ? before.hidden.includes(key) : wanted;
        return visible || canHide(list, key)
          ? setColumnVisible(before, key, visible)
          : before;
      });
    return {
      setVisible,
      toggle: (key) => setVisible(key, "toggle"),
      move: (key, toIndex) =>
        apply((_list, before) => moveColumn(before, key, toIndex)),
      showAll: () => apply((_list, before) => showAllColumns(before)),
      reset: () => apply(resetColumnSettings),
    };
  }, [apply]);

  const ordered = useKeptList(
    useMemo(() => orderedColumns(columns, settings), [columns, settings]),
    isSameOrderedColumn,
  );
  const visible = useKeptList(
    useMemo(() => visibleColumns(columns, settings), [columns, settings]),
    Object.is,
  );

  return { settings, columns: ordered, visibleColumns: visible, actions };
}

/** Whether a person may hide the column with this key. */
function canHide(columns: readonly ColumnDefinition[], key: string): boolean {
  return columns.find((column) => column.key === key)?.hideable !== false;
}

const isSameOrderedColumn = (a: OrderedColumn, b: OrderedColumn): boolean =>
  a.column === b.column && a.visible === b.visible;

/**
 * Hands back the list from the render before when the new list holds the same items, and
 * otherwise the new list with every unchanged item reused in its place. Something that
 * compares with `===`, such as a memoised table, then sees a change only when there is one.
 */
function useKeptList<Item>(
  next: readonly Item[],
  isSame: (a: Item, b: Item) => boolean,
): readonly Item[] {
  const shown = useRef(next);
  const kept = keepSameItems(shown.current, next, isSame);
  // Remembered only once React has put this render on screen, as for the actions above.
  useEarlyEffect(() => {
    shown.current = kept;
  });
  return kept;
}

/** `next`, with each item that equals the one in the same place of `previous` reused. */
function keepSameItems<Item>(
  previous: readonly Item[],
  next: readonly Item[],
  isSame: (a: Item, b: Item) => boolean,
): readonly Item[] {
  if (previous === next) return previous;
  let changed = previous.length !== next.length;
  const kept = next.map((item, index) => {
    // The index may be past the end of the shorter list from before.
    const before = previous[index] as Item | undefined;
    if (before !== undefined && isSame(before, item)) return before;
    changed = true;
    return item;
  });
  return changed ? kept : previous;
}

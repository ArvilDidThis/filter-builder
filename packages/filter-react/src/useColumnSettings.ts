import {
  type ColumnDefinition,
  type ColumnSettings,
  isDefaultColumnSettings,
  moveColumnAroundPinned,
  moveColumnGroupAroundPinned,
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
   * every change from `onChange` back in.
   *
   * `null` means the app owns the settings and has none saved yet, so the column list's
   * defaults are shown until the app passes the settings from `onChange` back in. Only leaving
   * `value` out, or passing `undefined`, lets the hook keep the settings itself.
   */
  value?: ColumnSettings | null;
  /**
   * The settings to start from when the hook keeps them, such as ones read from storage.
   * `null` or leaving it out means nothing was saved, so the column list's defaults are used.
   */
  defaultValue?: ColumnSettings | null;
  /** Called with the new settings after every change a person makes. */
  onChange?: (settings: ColumnSettings) => void;
}

/**
 * Every change a column picker can make. An action that changes nothing does not call
 * `onChange`.
 *
 * Call an action from an event handler, or from a `useEffect`. An action reads the options of the
 * last render React put on screen, and it gets them in a layout effect (one that runs before
 * the browser paints) of the component that calls the hook. A layout effect of a child
 * component runs before that one. So an action called there, in the very render that passes a
 * new `onChange`, `columns` or `value`, still uses the ones from the render before.
 */
export interface ColumnSettingsActions<Key extends string = string> {
  /** Shows or hides one column. A column that cannot be hidden stays shown. */
  setVisible: (key: Key, visible: boolean) => void;
  /** Hides a shown column, or shows a hidden one. */
  toggle: (key: Key) => void;
  /**
   * Moves a column so that it ends up at `toIndex` in the order. The order counts hidden
   * columns too, so the index is the column's place in `orderedColumns`.
   *
   * Pinned columns stay in place. A pinned column does not move, and another column stops at
   * the pinned ones: an index in a pinned column's place means the nearest place it may take.
   */
  move: (key: Key, toIndex: number) => void;
  /**
   * Moves several columns together, so that they stand side by side with the first of them at
   * `toIndex` in the order. They keep the order they had among themselves, whatever order
   * `keys` names them in.
   *
   * Pinned columns stay in place. A pinned column named in `keys` is skipped, and the group
   * stops at the pinned ones.
   *
   * @example
   * // Lands "cap", "return" and "beta" together, with the first of them in the second place.
   * table.actions.moveGroup(["cap", "return", "beta"], 1);
   */
  moveGroup: (keys: readonly Key[], toIndex: number) => void;
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
  /**
   * Every column in its chosen place, each with whether it is shown. A picker draws this. The
   * option `columns` is the list the app passed in. This is that list after a person's choices.
   *
   * Each entry's `pinned` says whether its column is kept at the start or the end.
   */
  orderedColumns: readonly OrderedColumn<Column>[];
  /**
   * The columns the table should draw, in order. The list stays the same object until its
   * content changes, so a memoised table does not redraw for nothing.
   *
   * They are the app's own column objects, so a table reads `column.pinned` to keep a pinned
   * column in view with sticky CSS of its own. The pinned columns are at the ends of the list.
   */
  visibleColumns: readonly Column[];
  /**
   * Whether every column is shown, so that `actions.showAll` would change nothing. A picker
   * uses it to turn its "show all" button off.
   */
  allVisible: boolean;
  /**
   * Whether the settings are the column list's own order and starting visibility, so that
   * `actions.reset` would change nothing. A picker uses it to turn its "reset" button off.
   */
  isDefault: boolean;
  /** The changes a picker can make. The object stays the same between renders. */
  actions: ColumnSettingsActions<Column["key"]>;
}

/**
 * Which columns a table shows and in what order, with no markup or styling. A table draws
 * `visibleColumns`, and a picker draws `orderedColumns` and calls `actions`.
 *
 * It works like a form input. Pass `value` and `onChange` to own the settings, or leave `value`
 * out and the hook keeps them, starting from `defaultValue`. Either way the settings are fitted
 * to the column list first, so stored settings from an older column list are safe to pass in.
 * Pass `null` as either one when nothing is saved yet: the column list's defaults are used.
 *
 * @example
 * const table = useColumnSettings({ columns });
 * // table.visibleColumns: draw these as the table's columns.
 * // table.actions.toggle("price"), table.actions.move("price", 0)
 * // table.allVisible, table.isDefault: whether "show all" and "reset" have anything to do.
 */
export function useColumnSettings<Column extends ColumnDefinition>(
  options: UseColumnSettingsOptions<Column>,
): ColumnSettingsState<Column> {
  const { columns, value, defaultValue, onChange } = options;
  // `null` still counts as the app owning the settings: it only has none saved yet. Otherwise
  // an app that starts with nothing saved would switch owner on the first change.
  const isControlled = value !== undefined;
  const [own, setOwn] = useState(defaultValue);
  const saved = isControlled ? value : own;
  const settings = useMemo(
    () => reconcileColumnSettings(columns, saved),
    [columns, saved],
  );

  // The settings an action asked for that are not on screen yet. The next action builds on
  // them, not on the old settings, in two cases:
  // - a second action in the same event, as in `useFilterBuilder`;
  // - when the hook keeps the settings, an action that follows a change React has not drawn
  //   yet, such as one made in a transition (a change React may put on screen later).
  //   Building on the old settings there would undo the waiting change.
  // They are held in an object of their own, so that two actions that ask for the same
  // settings can still be told apart.
  const proposed = useRef<{ settings: ColumnSettings } | null>(null);

  // The actions read the newest props through this ref, so they can stay the same functions
  // from one render to the next. It is written after React has put a render on screen, not
  // while rendering: React may throw a render away, and its props must not reach the actions.
  const latest = useRef({ settings, saved, columns, onChange, isControlled });
  useEarlyEffect(() => {
    const was = latest.current;
    // What an action asked for goes out of date the moment either of these is drawn, and
    // stays out of date even if the app later puts things back as they were:
    // - The app put other saved settings on screen. Building on what was asked for before
    //   them would drop whatever the newer settings hold.
    // - The settings changed owner, between the app and the hook. What was asked of one
    //   owner must not be carried over to the other.
    // The hook's own draws are not in this list. React may draw an earlier change of the
    // hook's first, and that must not end the wait of a later one.
    const isReplaced = isControlled && was.saved !== saved;
    const hasNewOwner = was.isControlled !== isControlled;
    if (isReplaced || hasNewOwner) proposed.current = null;
    latest.current = { settings, saved, columns, onChange, isControlled };
  });

  const apply = useCallback(
    (
      change: (
        columns: readonly ColumnDefinition[],
        settings: ColumnSettings,
      ) => ColumnSettings,
    ) => {
      const now = latest.current;
      const asked = proposed.current;
      // Whether what was asked for is still to come on screen, and so is what to build on.
      // For an app that owns the settings, it is until it is forgotten: by the effect above,
      // or once the event is over. The hook's own change waits until that very change is on
      // screen. Each change is built on the one before, so the newest one holds them all.
      const isWaiting =
        asked !== null && (now.isControlled || asked.settings !== now.saved);
      const waiting = isWaiting ? asked : null;
      const before =
        waiting === null
          ? now.settings
          : // The column list may have changed while the settings waited.
            reconcileColumnSettings(now.columns, waiting.settings);
      const next = change(now.columns, before);
      // The actions return the same settings when nothing changed.
      if (next === before) return;
      const mine = { settings: next };
      proposed.current = mine;
      if (now.isControlled) {
        // An app that owns the settings may turn the change down, and then nothing new ever
        // comes on screen. So what was asked for is forgotten as soon as the event's own
        // code has finished.
        queueMicrotask(() => {
          if (proposed.current === mine) proposed.current = null;
        });
      } else {
        // The hook's own change always reaches the screen, so it waits for as long as React
        // takes to draw it.
        setOwn(next);
      }
      now.onChange?.(next);
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
        apply((list, before) =>
          moveColumnAroundPinned(list, before, key, toIndex),
        ),
      moveGroup: (keys, toIndex) =>
        apply((list, before) =>
          moveColumnGroupAroundPinned(list, before, keys, toIndex),
        ),
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

  // Both ask the action itself, so each says "nothing to do" exactly when its action would do
  // nothing. `showAllColumns` hands back the same settings when no column is hidden. That
  // check is one quick read, so only the second one is kept between renders.
  const allVisible = showAllColumns(settings) === settings;
  const isDefault = useMemo(
    () => isDefaultColumnSettings(columns, settings),
    [columns, settings],
  );

  return {
    settings,
    orderedColumns: ordered,
    visibleColumns: visible,
    allVisible,
    isDefault,
    actions,
  };
}

/** Whether a person may hide the column with this key. */
function canHide(columns: readonly ColumnDefinition[], key: string): boolean {
  return columns.find((column) => column.key === key)?.hideable !== false;
}

// Every part is compared. `hideable` and `pinned` are read from the column object, and an app
// may have changed that object in place, so the same object does not prove the same answer.
const isSameOrderedColumn = (a: OrderedColumn, b: OrderedColumn): boolean =>
  a.column === b.column &&
  a.visible === b.visible &&
  a.hideable === b.hideable &&
  a.pinned === b.pinned;

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

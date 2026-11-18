import type { ColumnDefinition, OrderedColumn } from "@arvilmena/filter-core";
import {
  type KeyboardEvent,
  memo,
  type PointerEvent,
  type ReactNode,
  type RefCallback,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ColumnSettingsActions,
  ColumnSettingsState,
} from "../useColumnSettings";
import { useColumnDrag } from "./useColumnDrag";
import { useOutsidePointerDown } from "./useOutsidePointerDown";

// A ready-made column picker with default styling: a button that opens a list of every column.
// Each row has a checkbox that shows or hides the column, and a handle that moves it.
//
// It uses plain HTML controls and the class names in `styles.css`, so it needs no UI kit. An app
// that wants a different design draws its own picker from `useColumnSettings`.

/** Every piece of wording in the column picker. */
export interface ColumnPickerLabels {
  /** The text on the button that opens the picker. */
  trigger: string;
  /** Shown beside the button's text while columns are hidden, e.g. "2 hidden". */
  hiddenCount: (count: number) => string;
  /** The name of the list, read out by a screen reader when the picker opens. */
  title: string;
  /** The button that shows every column. */
  showAll: string;
  /** The button that puts back the starting order and visibility. */
  reset: string;
  /** The name of a row's handle, read out by a screen reader. */
  move: (label: string) => string;
  /** Read out after a handle's name, to say which keys move the column. */
  moveHint: string;
  /** Read out after a move. `position` counts from 1. */
  moved: (label: string, position: number, total: number) => string;
  /** Read out after the "show all" button is pressed. */
  showAllDone: string;
  /** Read out after the "reset" button is pressed. */
  resetDone: string;
}

/** The picker's wording in English. Pass `labels` to replace any of it. */
export const COLUMN_PICKER_LABELS: ColumnPickerLabels = {
  trigger: "Columns",
  hiddenCount: (count) => `${count} hidden`,
  title: "Columns",
  showAll: "Show all",
  reset: "Reset",
  move: (label) => `Move ${label}`,
  moveHint:
    "Press the up or down arrow key to move the column, or Home or End to move it to either end.",
  moved: (label, position, total) =>
    `${label} moved to position ${position} of ${total}.`,
  showAllDone: "All columns are shown.",
  resetDone: "The columns are back in their starting order and visibility.",
};

/** The attributes of the button that opens the picker. Spread them onto your own button. */
export interface ColumnPickerTriggerProps {
  ref: RefCallback<HTMLElement>;
  type: "button";
  "aria-expanded": boolean;
  "aria-haspopup": "dialog";
  "aria-controls": string | undefined;
  onClick: () => void;
}

/** What a replacement trigger can show besides its own text. */
export interface ColumnPickerTriggerInfo {
  /** Whether the picker is open. */
  open: boolean;
  /** How many columns are hidden. */
  hiddenCount: number;
}

/** What a replacement row is given. Spread each group of attributes onto its own element. */
export interface ColumnPickerRow<
  Column extends ColumnDefinition = ColumnDefinition,
> extends OrderedColumn<Column> {
  /** The row's place in the list, from 0. */
  index: number;
  /** Whether this row is the one being dragged. */
  isDragging: boolean;
  /**
   * For the `<input>` that shows or hides the column. Point the column's `<label>` at its
   * `id`, so a click on the name ticks the box.
   */
  checkboxProps: {
    type: "checkbox";
    id: string;
    checked: boolean;
    disabled: boolean;
    onChange: () => void;
  };
  /**
   * For the `<button>` that moves the column, by dragging and by the arrow keys. Its `style`
   * stops a finger on the handle from scrolling the list. If you set a `style` of your own,
   * spread this one into it. Keep the same element while the row is dragged: a handle that is
   * replaced mid-drag ends the drag.
   */
  handleProps: {
    type: "button";
    style: { touchAction: "none" };
    "aria-label": string;
    "aria-describedby": string;
    "data-fb-column-handle": "";
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
}

/** What the column picker needs from the app. */
export interface ColumnPickerProps<
  Column extends ColumnDefinition = ColumnDefinition,
> {
  /**
   * What `useColumnSettings` returned. The table needs the same state as the picker, so the
   * hook runs once in the app and its result goes to both.
   */
  state: ColumnSettingsState<Column>;
  /** Replace some of the wording, e.g. `{ trigger: "Edit columns" }`. */
  labels?: Partial<ColumnPickerLabels>;
  /** Which edge of the button the list lines up with. Use "end" near a page's right edge. */
  align?: "start" | "end";
  /** Draws the button that opens the picker. Spread `props` onto the button. */
  renderTrigger?: (
    props: ColumnPickerTriggerProps,
    info: ColumnPickerTriggerInfo,
  ) => ReactNode;
  /**
   * Draws the inside of one row. Keep the same function between renders (see `useCallback`),
   * or every row redraws whenever the picker does.
   */
  renderRow?: (row: ColumnPickerRow<Column>) => ReactNode;
  /** Added to the picker's own class, for an app's extra styling. */
  className?: string;
}

/**
 * A button that opens a list of a table's columns. A person ticks a column to show it, and
 * drags its handle to move it. With a keyboard, the arrow keys on a handle move the column.
 *
 * Load its style sheet once in the app: `import "@arvilmena/filter-react/styles.css"`.
 *
 * @example
 * const table = useColumnSettings({ columns });
 * return (
 *   <>
 *     <ColumnPicker state={table} />
 *     <p>{table.visibleColumns.map((column) => column.label).join(", ")}</p>
 *   </>
 * );
 */
export function ColumnPicker<Column extends ColumnDefinition>({
  state,
  labels: labelOverrides,
  align = "start",
  renderTrigger,
  renderRow,
  className,
}: ColumnPickerProps<Column>) {
  const { orderedColumns, actions } = state;
  const [open, setOpen] = useState(false);
  // What a screen reader is told. `count` goes up with every message, so that the same text
  // said twice is still a new message.
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  const announce = useCallback((text: string) => {
    setAnnouncement((was) => ({ text, count: was.count + 1 }));
  }, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const popoverId = useId();
  const hintId = useId();

  // An app often writes `labels={{ … }}` in place, which is a new object on every render. So
  // nothing below may depend on this object staying the same. A row is given finished text.
  const labels = { ...COLUMN_PICKER_LABELS, ...labelOverrides };

  // One function for the picker's life. A new one on each render would make React detach the
  // button and attach it again every time.
  const setTrigger = useCallback((element: HTMLElement | null) => {
    triggerRef.current = element;
  }, []);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    pendingMove.current = null;
    if (returnFocus) triggerRef.current?.focus();
  };
  useOutsidePointerDown(rootRef, open, () => close(false));

  // Opening moves the keyboard focus into the list, so that Tab reaches its first control and
  // a screen reader reads out the list's name.
  useEffect(() => {
    if (open) popoverRef.current?.focus();
  }, [open]);

  const keys = useMemo(
    () => orderedColumns.map((entry) => entry.column.key),
    [orderedColumns],
  );

  // The move a key press or a drop asked for. It waits here until the list shows it. An app
  // that owns the settings may apply a move later, or turn it down, so the move is followed up
  // only once it has really happened.
  const pendingMove = useRef<{
    /** The place the column was asked to go to. */
    to: number;
    /** The order of the keys when the move was asked for. */
    before: readonly string[];
    /** The order of the keys that the move would give. */
    after: readonly string[];
    /** Whether the column's handle held the keyboard focus when the move was asked for. */
    hadFocus: boolean;
  } | null>(null);
  useEffect(() => {
    const pending = pendingMove.current;
    if (pending === null) return;
    // Still the old order: the move is not applied yet, or never will be.
    if (isSameOrder(keys, pending.before)) return;
    pendingMove.current = null;
    const entry = orderedColumns[pending.to];
    const root = rootRef.current;
    // The order changed, but not to the one this move asked for. Something else changed the
    // list, such as the app adding a column, and that is not this move's to speak for.
    if (!isSameOrder(keys, pending.after)) return;
    if (entry === undefined || root === null) return;

    // React may take the row out of the page and put it back to move it, which loses the
    // keyboard focus. So the focus is put back on the column's handle, and pressing the key
    // again moves the same column again. It is put back only when the move took it away: the
    // handle had it, and now nothing has. A person who has gone on to another control, in
    // the picker or outside it, keeps their place. The picker's blur handler withdraws
    // `hadFocus` for that, in case the other control has lost the focus since.
    const focused = root.ownerDocument.activeElement;
    const isFocusLost = focused === null || focused === root.ownerDocument.body;
    if (pending.hadFocus && isFocusLost) {
      handleAt(listRef.current, pending.to)?.focus();
    }
    announce(
      labels.moved(entry.column.label, pending.to + 1, orderedColumns.length),
    );
  });

  // Reads the newest columns, so the function below can stay the same between renders and the
  // rows that did not change are not redrawn.
  const latestColumns = useRef(orderedColumns);
  useEffect(() => {
    latestColumns.current = orderedColumns;
  });

  // A column is named by its key, not its place: the list may have changed since the row that
  // asks for the move was drawn or picked up.
  const moveTo = useCallback(
    (key: string, to: number) => {
      const list = latestColumns.current;
      const from = list.findIndex((item) => item.column.key === key);
      const entry = list[from];
      if (entry === undefined || to < 0 || to >= list.length || to === from) {
        return;
      }
      const handle = handleAt(listRef.current, from);
      // Asked of the handle's own tree, which is a shadow tree (a part of the page that hides
      // its insides) when the picker is drawn in one. The page would name the tree's host.
      const focused = (
        handle?.getRootNode() as Document | ShadowRoot | undefined
      )?.activeElement;
      const before = list.map((item) => item.column.key);
      const after = [...before];
      after.splice(from, 1);
      after.splice(to, 0, entry.column.key);
      pendingMove.current = {
        to,
        before,
        after,
        hadFocus: handle !== null && focused === handle,
      };
      actions.move(entry.column.key, to);
    },
    [actions],
  );
  const drag = useColumnDrag({ listRef, keys, active: open, onDrop: moveTo });

  const hiddenCount = useMemo(
    () =>
      orderedColumns.reduce(
        (count, entry) => count + (entry.visible ? 0 : 1),
        0,
      ),
    [orderedColumns],
  );
  const triggerProps: ColumnPickerTriggerProps = {
    ref: setTrigger,
    type: "button",
    "aria-expanded": open,
    "aria-haspopup": "dialog",
    "aria-controls": open ? popoverId : undefined,
    onClick: () => (open ? close(false) : setOpen(true)),
  };

  return (
    // It only hears the keys and the blur of the controls inside it. A person never acts on
    // it directly.
    // biome-ignore lint/a11y/noStaticElementInteractions: see the lines above
    <div
      className={className ? `fb-columns ${className}` : "fb-columns"}
      // Tab moves the focus on past the list, which would otherwise stay open over the page.
      // A click on something that takes no focus is left to the outside-click check above.
      onBlur={(event) => {
        const next = event.relatedTarget;
        // The person took the focus to another control. A move that is still waiting must
        // not pull it back later, even if nothing holds the focus by then. The move itself
        // stays, so that it is still read out.
        if (next !== null && pendingMove.current !== null) {
          pendingMove.current.hadFocus = false;
        }
        if (open && next !== null && !rootRef.current?.contains(next)) {
          close(false);
        }
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          close(true);
        }
      }}
      ref={rootRef}
    >
      {renderTrigger ? (
        renderTrigger(triggerProps, { open, hiddenCount })
      ) : (
        <button className="fb-button fb-columns-trigger" {...triggerProps}>
          {labels.trigger}
          {hiddenCount > 0 && (
            <span className="fb-count">
              {" "}
              ({labels.hiddenCount(hiddenCount)})
            </span>
          )}
        </button>
      )}

      {open && (
        <div
          aria-label={labels.title}
          className="fb-columns-popover"
          data-align={align}
          id={popoverId}
          ref={popoverRef}
          role="dialog"
          tabIndex={-1}
        >
          {/* Read out after a handle's name. It is hidden, but a handle can still point at it. */}
          <span hidden id={hintId}>
            {labels.moveHint}
          </span>
          <ul
            className="fb-columns-list"
            data-dragging={drag.key === null ? undefined : ""}
            ref={listRef}
          >
            {orderedColumns.map((entry, index) => (
              <Row
                actions={actions}
                drop={dropMark(drag.slot, index, orderedColumns.length)}
                entry={entry}
                hintId={hintId}
                index={index}
                count={orderedColumns.length}
                isDragging={drag.key === entry.column.key}
                key={entry.column.key}
                moveLabel={labels.move(entry.column.label)}
                onDragStart={drag.start}
                onMove={moveTo}
                renderRow={renderRow}
              />
            ))}
          </ul>
          <div className="fb-columns-footer">
            <button
              className="fb-button"
              onClick={() => {
                pendingMove.current = null;
                actions.showAll();
                // The button stays where it is and the list barely changes, so without
                // this a screen reader would say nothing.
                announce(labels.showAllDone);
              }}
              type="button"
            >
              {labels.showAll}
            </button>
            <button
              className="fb-button"
              onClick={() => {
                // Reset moves columns too. A move still waiting must not take the credit.
                pendingMove.current = null;
                actions.reset();
                announce(labels.resetDone);
              }}
              type="button"
            >
              {labels.reset}
            </button>
          </div>
        </div>
      )}

      {/* Always on the page, so a screen reader hears each new message put into it. */}
      <span aria-live="polite" className="fb-visually-hidden">
        {/* A new element for each message. A screen reader reads out what is added, and
            putting the same text in again would add nothing. */}
        <span key={announcement.count}>{announcement.text}</span>
      </span>
    </div>
  );
}

/** The handle of the row at `index` of the list, if the list is open and has such a row. */
function handleAt(list: HTMLElement | null, index: number): HTMLElement | null {
  return (
    list?.children[index]?.querySelector<HTMLElement>(
      "[data-fb-column-handle]",
    ) ?? null
  );
}

/** Whether two lists of column keys hold the same keys in the same order. */
function isSameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((key, index) => key === b[index]);
}

/** Where the line that marks a drop is drawn on a row: above it, below it, or not at all. */
type DropMark = "before" | "after" | undefined;

/** The drop line of the row at `index`. A drop after the last row is drawn below that row. */
function dropMark(slot: number | null, index: number, count: number): DropMark {
  if (slot === index) return "before";
  return slot === count && index === count - 1 ? "after" : undefined;
}

interface RowProps<Column extends ColumnDefinition> {
  entry: OrderedColumn<Column>;
  index: number;
  /** How many rows the list has. */
  count: number;
  isDragging: boolean;
  drop: DropMark;
  /**
   * The name of the row's handle. It is text, not the wording object, because text compares
   * equal from one render to the next and so does not make the row redraw.
   */
  moveLabel: string;
  hintId: string;
  actions: ColumnSettingsActions<Column["key"]>;
  onDragStart: (event: PointerEvent<HTMLElement>, key: string) => void;
  onMove: (key: string, to: number) => void;
  renderRow: ColumnPickerProps<Column>["renderRow"];
}

/**
 * One row of the list. It is memoised (redrawn only when what it is given changes), so a list
 * of hundreds of columns stays quick while one row is ticked or dragged.
 */
const Row = memo(function Row<Column extends ColumnDefinition>({
  entry,
  index,
  count,
  isDragging,
  drop,
  moveLabel,
  hintId,
  actions,
  onDragStart,
  onMove,
  renderRow,
}: RowProps<Column>) {
  const { column, visible, hideable } = entry;
  const checkboxId = useId();

  const row: ColumnPickerRow<Column> = {
    column,
    visible,
    hideable,
    index,
    isDragging,
    checkboxProps: {
      type: "checkbox",
      id: checkboxId,
      checked: visible,
      disabled: !hideable,
      onChange: () => actions.toggle(column.key),
    },
    handleProps: {
      type: "button",
      style: HANDLE_STYLE,
      "aria-label": moveLabel,
      "aria-describedby": hintId,
      "data-fb-column-handle": "",
      onPointerDown: (event) => onDragStart(event, column.key),
      onKeyDown: (event) => {
        const to = keyTarget(event.key, index, count);
        if (to === undefined) return;
        // The arrow keys would otherwise scroll the list.
        event.preventDefault();
        onMove(column.key, to);
      },
    },
  };

  return (
    <li
      className="fb-columns-row"
      data-dragging={isDragging ? "" : undefined}
      data-drop={drop}
      data-fixed={hideable ? undefined : ""}
    >
      {renderRow ? (
        renderRow(row)
      ) : (
        <>
          <input className="fb-columns-checkbox" {...row.checkboxProps} />
          <button className="fb-columns-handle" {...row.handleProps}>
            <span aria-hidden="true">⠿</span>
          </button>
          <label className="fb-columns-label" htmlFor={checkboxId}>
            {column.label}
          </label>
        </>
      )}
    </li>
  );
  // `memo` drops the row's type parameter, so it is put back here.
}) as <Column extends ColumnDefinition>(props: RowProps<Column>) => ReactNode;

/**
 * Without this a finger on a handle scrolls the list, and the drag never starts. It is set on
 * the handle itself, not only in the style sheet, so that a row an app draws has it too.
 */
const HANDLE_STYLE = { touchAction: "none" } as const;

/**
 * The place a key press on a handle moves its row to, or `undefined` for a key that moves
 * nothing. A place past either end is turned down by the move itself.
 */
function keyTarget(
  key: string,
  index: number,
  count: number,
): number | undefined {
  if (key === "ArrowUp") return index - 1;
  if (key === "ArrowDown") return index + 1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}

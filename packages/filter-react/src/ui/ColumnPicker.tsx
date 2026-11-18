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
  /** What `useColumnSettings` returned. The same object gives the table its columns. */
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
 *     <MyTable columns={table.visibleColumns} rows={rows} />
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
  const [announcement, setAnnouncement] = useState("");
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
    if (returnFocus) triggerRef.current?.focus();
  };
  useOutsidePointerDown(rootRef, open, () => close(false));

  // Opening moves the keyboard focus into the list, so that Tab reaches its first control and
  // a screen reader reads out the list's name.
  useEffect(() => {
    if (open) popoverRef.current?.focus();
  }, [open]);

  // The column a move button or a drop just moved. React may take the row out of the page and
  // put it back to move it, which loses the keyboard focus. So the focus is put back on the
  // column's handle, and pressing the key again moves the same column again.
  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const key = focusNext.current;
    if (key === null) return;
    focusNext.current = null;
    const index = orderedColumns.findIndex((entry) => entry.column.key === key);
    listRef.current?.children[index]
      ?.querySelector<HTMLElement>("[data-fb-column-handle]")
      ?.focus();
  });

  // Reads the newest columns and wording, so the functions below can stay the same between
  // renders and the rows that did not change are not redrawn.
  const latest = useRef({ orderedColumns, labels });
  useEffect(() => {
    latest.current = { orderedColumns, labels };
  });

  // A column is named by its key, not its place: the list may have changed since the row that
  // asks for the move was drawn or picked up.
  const moveTo = useCallback(
    (key: string, to: number) => {
      const { orderedColumns: list, labels: wording } = latest.current;
      const from = list.findIndex((item) => item.column.key === key);
      const entry = list[from];
      if (entry === undefined || to < 0 || to >= list.length || to === from) {
        return;
      }
      actions.move(entry.column.key, to);
      focusNext.current = entry.column.key;
      setAnnouncement(wording.moved(entry.column.label, to + 1, list.length));
    },
    [actions],
  );
  const keys = useMemo(
    () => orderedColumns.map((entry) => entry.column.key),
    [orderedColumns],
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
              onClick={actions.showAll}
              type="button"
            >
              {labels.showAll}
            </button>
            <button className="fb-button" onClick={actions.reset} type="button">
              {labels.reset}
            </button>
          </div>
        </div>
      )}

      {/* Always on the page, so a screen reader hears each new message put into it. */}
      <span aria-live="polite" className="fb-visually-hidden">
        {announcement}
      </span>
    </div>
  );
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

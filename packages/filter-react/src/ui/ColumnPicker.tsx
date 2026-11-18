import {
  type ColumnDefinition,
  moveColumn,
  type OrderedColumn,
} from "@arvilmena/filter-core";
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
import type { ColumnSettingsState } from "../useColumnSettings";
import { useEarlyEffect } from "../useEarlyEffect";
import { isDrawnInside } from "./shadowTrees";
import { useColumnDrag } from "./useColumnDrag";
import { useKeepOnScreen } from "./useKeepOnScreen";
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
  /** The button that shows every column. It is unavailable while every column is shown. */
  showAll: string;
  /**
   * The button that puts back the starting order and visibility. It is unavailable while the
   * settings are the starting ones.
   */
  reset: string;
  /** The name of a row's handle, read out by a screen reader. */
  move: (label: string) => string;
  /** Read out after a handle's name, to say which keys move the column. */
  moveHint: string;
  /** Read out after a move. `position` counts from 1. */
  moved: (label: string, position: number, total: number) => string;
  /** Read out once the "show all" button has shown every column. */
  showAllDone: string;
  /** Read out once the "reset" button has put the starting settings back. */
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

/** The picker's own wording, with each piece the app gave put in its place. */
function withDefaultLabels(
  overrides: Partial<ColumnPickerLabels> | undefined,
): ColumnPickerLabels {
  // A piece passed as `undefined` keeps the picker's own wording. An app often forwards an
  // optional value of its own, and an empty piece would break the picker when it is used.
  const given = Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, text]) => text !== undefined),
  ) as Partial<ColumnPickerLabels>;
  return { ...COLUMN_PICKER_LABELS, ...given };
}

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
  /**
   * Which edge of the button the list lines up with. Use "end" near a page's right edge. Where
   * the list would run off the screen, it moves sideways just far enough to stay on it.
   */
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
  const { orderedColumns, allVisible, isDefault, actions } = state;
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
  const labels = withDefaultLabels(labelOverrides);

  // One function for the picker's life. A new one on each render would make React detach the
  // button and attach it again every time.
  const setTrigger = useCallback((element: HTMLElement | null) => {
    triggerRef.current = element;
  }, []);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    pendingMove.current = null;
    pendingButton.current = null;
    if (returnFocus) triggerRef.current?.focus();
  };
  useOutsidePointerDown(rootRef, open, () => close(false));
  // The list lines up with the side of the button that `align` names. On a narrow screen that
  // may leave it too little room, so it is moved back inside the screen.
  useKeepOnScreen(popoverRef, open);

  // Whether Tab was the last key pressed in the picker, with no focus arriving in it since.
  // A blur that names no next element is then Tab's doing, and may have left the page.
  const tabPressed = useRef(false);
  /** The wait before the picker looks where such a blur took the focus. */
  const leaveCheck = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A closed picker has nothing left to close, so it stops waiting.
  useEffect(() => {
    if (!open) return;
    return () => {
      tabPressed.current = false;
      if (leaveCheck.current !== null) clearTimeout(leaveCheck.current);
      leaveCheck.current = null;
    };
  }, [open]);
  /**
   * Closes the picker if a blur that named no next element took the focus off the picker's
   * page. Tab does that from the last control of a frame (a page within the page), and of a
   * page: the focus goes to the page around the frame, or to the browser's own bar.
   */
  const closeIfFocusLeftPage = () => {
    // Without a Tab press the cause is something else, and the picker stays open: a row
    // that moved can drop the focus, and so does a switch to another window.
    if (!tabPressed.current || leaveCheck.current !== null) return;
    tabPressed.current = false;
    const page = rootRef.current?.ownerDocument;
    // Asked a moment later, once the browser has finished moving the focus.
    leaveCheck.current = setTimeout(() => {
      leaveCheck.current = null;
      if (page?.hasFocus() === false) close(false);
    }, 0);
  };

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
    /** The place the column had when the move was asked for. */
    from: number;
    /** The place the column was asked to go to. */
    to: number;
    /** The order of the keys when the move was asked for. */
    before: readonly string[];
    /** The order of the keys that the move would give. */
    after: readonly string[];
  } | null>(null);
  // Whether the column's handle holds the keyboard focus just before the rows change place.
  // It is asked here, while this draw is worked out and the page still shows the old order.
  // Once React has moved the rows it is too late to ask, because moving a row can drop the
  // focus. A waiting move always has its old order on the page: the first draw with any other
  // order ends the wait.
  const moveAtDraw = pendingMove.current;
  const heldFocusBeforeMove =
    moveAtDraw !== null &&
    !isSameOrder(keys, moveAtDraw.before) &&
    holdsFocus(handleAt(listRef.current, moveAtDraw.from));
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
    // handle had it just before the rows changed place, and now nothing has. A person who
    // left the handle before the app applied the move keeps their place, wherever that is.
    const focused = root.ownerDocument.activeElement;
    const isFocusLost = focused === null || focused === root.ownerDocument.body;
    const handle = handleAt(listRef.current, pending.to);
    if (heldFocusBeforeMove && isFocusLost) handle?.focus();
    // React may instead move the other rows around a handle that kept the focus. Nothing
    // scrolls then, so a long list could leave the moved row out of sight.
    if (holdsFocus(handle)) handle?.scrollIntoView({ block: "nearest" });
    announce(
      labels.moved(entry.column.label, pending.to + 1, orderedColumns.length),
    );
  });

  // The "show all" or "reset" press that is still to be read out. Like a move, it waits here
  // until it has really happened, because an app that owns the settings may apply it later, or
  // turn it down. A tick or a move asked for in the meantime ends the wait: the press cannot
  // tell its own result from theirs.
  const pendingButton = useRef<{
    button: "showAll" | "reset";
    /** The list when the button was pressed. The hook keeps it until its content changes. */
    list: readonly OrderedColumn<Column>[];
    /** The order of the keys when the button was pressed. */
    order: readonly string[];
  } | null>(null);
  useEffect(() => {
    const pending = pendingButton.current;
    if (pending === null) return;
    // A button can only be pressed while it has something to do. So once the list shows what
    // the press would give, the press has landed. "Show all" gives every column shown in the
    // order it was pressed in: an app that shows every column in another order applied
    // settings of its own. "Reset" gives the starting settings, which is all `isDefault` says.
    const isShowAll = pending.button === "showAll";
    const hasLanded = isShowAll
      ? allVisible && isSameOrder(keys, pending.order)
      : isDefault;
    if (hasLanded) {
      pendingButton.current = null;
      // The button stays where it is and the list may barely change, so without this a
      // screen reader would say nothing.
      announce(isShowAll ? labels.showAllDone : labels.resetDone);
    } else if (orderedColumns !== pending.list) {
      // The list changed to something else: the app turned the press down and applied
      // another change. That is not this press's to speak for.
      pendingButton.current = null;
    }
  });

  const press = (button: "showAll" | "reset") => {
    // Either button can change the list. A move still waiting must not take the credit.
    pendingMove.current = null;
    pendingButton.current = { button, list: orderedColumns, order: keys };
    actions[button]();
  };

  // Reads the newest columns, so the function below can stay the same between renders and the
  // rows that did not change are not redrawn.
  // It is kept in an early effect, as the drag keeps its own copy of the order. A pointer can
  // be let go while a new order is being drawn, and the drop is worked out from the drag's
  // copy. A plain effect would run later, and the move below would be checked against the
  // order before.
  const latestColumns = useRef(orderedColumns);
  useEarlyEffect(() => {
    latestColumns.current = orderedColumns;
  });

  // A column is named by its key, not its place: the list may have changed since the row that
  // asks for the move was drawn or picked up.
  const moveTo = useCallback(
    (key: string, to: number) => {
      const before = latestColumns.current.map((item) => item.column.key);
      // The move itself says what it would do, so the picker holds no copy of its rules.
      const after = moveColumn({ order: before, hidden: [] }, key, to).order;
      // The same list back means the move changes nothing.
      if (after === before) return;
      // A "show all" or "reset" press still waiting gives up. What the list becomes next is
      // this move's doing, and the press must not be read out for it.
      pendingButton.current = null;
      pendingMove.current = {
        from: before.indexOf(key),
        to: after.indexOf(key),
        before,
        after,
      };
      actions.move(key, to);
    },
    [actions],
  );
  const drag = useColumnDrag({ listRef, keys, active: open, onDrop: moveTo });

  // Ticks or unticks a row's checkbox. As with a move, a button press still waiting gives up,
  // so that it is not read out for what this tick did.
  const toggle = useCallback(
    (key: Column["key"]) => {
      pendingButton.current = null;
      actions.toggle(key);
    },
    [actions],
  );

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
    // It only hears the keys, the focus and the blur of the controls inside it. A person never
    // acts on it directly.
    // biome-ignore lint/a11y/noStaticElementInteractions: see the lines above
    <div
      className={className ? `fb-columns ${className}` : "fb-columns"}
      // Tab moves the focus on past the list, which would otherwise stay open over the page.
      // A click on something that takes no focus is left to the outside-click check above.
      onBlur={(event) => {
        if (!open) return;
        const next = event.relatedTarget;
        const root = rootRef.current;
        // No next element is named when the focus goes nowhere, or to another page.
        if (next === null) closeIfFocusLeftPage();
        // A control that an app's own row shows through a slot is inside the picker too.
        else if (root === null || !isDrawnInside(root, next)) close(false);
      }}
      onFocus={() => {
        // The focus is in the picker, so the last Tab press did not take it away.
        tabPressed.current = false;
      }}
      onKeyDown={(event) => {
        tabPressed.current = open && event.key === "Tab";
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
          {/* The style sheet takes the bullets off, and Safari then stops telling a screen
              reader that this is a list, and how many columns it holds. Naming the role
              keeps both. */}
          <ul
            className="fb-columns-list"
            data-dragging={drag.key === null ? undefined : ""}
            ref={listRef}
            // biome-ignore lint/a11y/noRedundantRoles: see the lines above the list
            role="list"
          >
            {orderedColumns.map((entry, index) => (
              <Row
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
                onToggle={toggle}
                renderRow={renderRow}
              />
            ))}
          </ul>
          <div className="fb-columns-footer">
            <FooterButton
              onPress={() => press("showAll")}
              unavailable={allVisible}
            >
              {labels.showAll}
            </FooterButton>
            <FooterButton
              onPress={() => press("reset")}
              unavailable={isDefault}
            >
              {labels.reset}
            </FooterButton>
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

/**
 * A button below the list. While it has nothing to do it is marked as unavailable, and a press
 * on it is ignored.
 *
 * It is marked with `aria-disabled`, not turned off with `disabled`. These buttons become
 * unavailable by being pressed, and a button that turns itself off loses the keyboard focus:
 * a person using the keyboard would be sent back to the top of the page.
 */
function FooterButton({
  unavailable,
  onPress,
  children,
}: {
  /** Whether a press would change nothing. */
  unavailable: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      aria-disabled={unavailable ? true : undefined}
      className="fb-button"
      onClick={unavailable ? undefined : onPress}
      type="button"
    >
      {children}
    </button>
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

/** Whether the element holds the keyboard focus. */
function holdsFocus(element: HTMLElement | null): boolean {
  if (element === null) return false;
  // Asked of the element's own tree, which is a shadow tree (a part of the page that hides
  // its insides) when the picker is drawn in one. The page would name the tree's host.
  const tree = element.getRootNode() as Document | ShadowRoot;
  return tree.activeElement === element;
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
  onDragStart: (event: PointerEvent<HTMLElement>, key: string) => void;
  onMove: (key: string, to: number) => void;
  onToggle: (key: Column["key"]) => void;
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
  onDragStart,
  onMove,
  onToggle,
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
      onChange: () => onToggle(column.key),
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

import {
  type ColumnDefinition,
  moveColumnAroundPinned,
  moveColumnGroupAroundPinned,
  type OrderedColumn,
  searchColumns,
  unpinnedRange,
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
import { measureGrid, placeBeside } from "./columnGrid";
import { isDrawnInside } from "./shadowTrees";
import type { FilterThemeStyle } from "./theme";
import { useColumnDrag } from "./useColumnDrag";
import { useKeepOnScreen } from "./useKeepOnScreen";
import { useOutsidePointerDown } from "./useOutsidePointerDown";

// A ready-made column picker with default styling: a button that opens a list of every column.
// Each row has a checkbox that shows or hides the column, and a handle that moves it. A pinned
// column has no handle: it stays at its end of the list. A long list has a search box above it.
// Below the list, "Show all" and "Hide all" tick or untick every column, and "Reset" puts the
// starting settings back.
//
// The list opens in a small popover below the button. Its "Dialog view" button opens the same
// list in a dialog in the middle of the screen, laid out in grid columns, for a long list.
// Its "Group drag" button lets a person select several rows and move them together.
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
   * The button that hides every column that may be hidden. It is unavailable while nothing
   * more can be hidden.
   */
  hideAll: string;
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
  /** Read out after the name of a pinned column, to say that it cannot be moved. */
  pinnedHint: string;
  /** The name of the search box, and the grey text shown in it while it is empty. */
  search: string;
  /**
   * Shown below the search box and read out, to say how many columns match. `count` is how
   * many are listed and `total` how many the table has.
   */
  searchCount: (count: number, total: number) => string;
  /** Shown after the count, to say why no column can be moved while a search is on. */
  searchMoveHint: string;
  /** Read out once the "show all" button has shown every column. */
  showAllDone: string;
  /** Read out once the "hide all" button has hidden every column that may be hidden. */
  hideAllDone: string;
  /** Read out once the "reset" button has put the starting settings back. */
  resetDone: string;
  /** The button in the popover that opens the list in a dialog. */
  dialogView: string;
  /** The button that closes the dialog. */
  closeDialog: string;
  /**
   * Read out after a handle's name in the dialog, in place of `moveHint`. The dialog lays
   * the columns out in grid columns, so the left and right arrow keys move a column too.
   */
  dialogMoveHint: string;
  /** The button that turns group drag on and off. */
  groupDrag: string;
  /** Read out after a handle's name while group drag is on, after the hint above. */
  groupDragHint: string;
  /** The name of the checkbox that selects a row for moving, read out by a screen reader. */
  select: (label: string) => string;
  /**
   * Read out after several columns moved together. `position` is the place of the first of
   * them, and counts from 1.
   */
  movedGroup: (count: number, position: number, total: number) => string;
}

/** The picker's wording in English. Pass `labels` to replace any of it. */
export const COLUMN_PICKER_LABELS: ColumnPickerLabels = {
  trigger: "Columns",
  hiddenCount: (count) => `${count} hidden`,
  title: "Columns",
  showAll: "Show all",
  hideAll: "Hide all",
  reset: "Reset",
  move: (label) => `Move ${label}`,
  moveHint:
    "Press the up or down arrow key to move the column, or Home or End to move it to either end.",
  moved: (label, position, total) =>
    `${label} moved to position ${position} of ${total}.`,
  pinnedHint: "This column is pinned in place and cannot be moved.",
  search: "Search columns",
  searchCount: (count, total) =>
    count === 0 ? "No columns match." : `${count} of ${total} columns match.`,
  searchMoveHint: "Clear the search to move columns.",
  showAllDone: "All columns are shown.",
  hideAllDone: "All columns that can be hidden are hidden.",
  resetDone: "The columns are back in their starting order and visibility.",
  dialogView: "Dialog view",
  closeDialog: "Close",
  dialogMoveHint:
    "Press the up or down arrow key to move the column by one place, the left or right arrow key to move it by one grid column, or Home or End to move it to either end.",
  groupDrag: "Group drag",
  groupDragHint:
    "Group drag is on. Moving a selected column moves every selected column with it.",
  select: (label) => `Select ${label} to move`,
  movedGroup: (count, position, total) =>
    `${count} columns moved to positions ${position} to ${position + count - 1} of ${total}.`,
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
  /** Whether this row is being dragged: the row held, or one of the group that moves with it. */
  isDragging: boolean;
  /**
   * Whether group drag is on. Draw the `selectProps` checkbox then, so a person can select
   * the row. `checkboxProps` is turned off for as long as it is on.
   */
  grouping: boolean;
  /** Whether the row is selected, and so moves with the other selected rows. */
  selected: boolean;
  /**
   * Whether a person may move the column now. It is false for a pinned column, and for every
   * column while a search narrows the list. Draw a handle only for a row that is movable, or
   * draw it and let `handleProps` turn it off.
   */
  movable: boolean;
  /**
   * For the `<input>` that shows or hides the column. Point the column's `<label>` at its
   * `id`, so a click on the name ticks the box. On a pinned column, `aria-describedby` tells
   * a screen reader that the column cannot be moved.
   */
  checkboxProps: {
    type: "checkbox";
    id: string;
    checked: boolean;
    disabled: boolean;
    /**
     * The column's name, while group drag is on. The row's `<label>` then belongs to the
     * `selectProps` checkbox, and this one would otherwise have no name.
     */
    "aria-label": string | undefined;
    "aria-describedby": string | undefined;
    onChange: () => void;
  };
  /**
   * For the `<input>` that selects the row for moving. Draw it while `grouping` is true, and
   * point the column's `<label>` at its `id` then, so a click on the name selects the row.
   *
   * `disabled` is true on a row that is not movable. A pinned column is never selected.
   */
  selectProps: {
    type: "checkbox";
    id: string;
    checked: boolean;
    disabled: boolean;
    "aria-label": string;
    onChange: () => void;
  };
  /**
   * For the `<button>` that moves the column, by dragging and by the arrow keys. Its `style`
   * stops a finger on the handle from scrolling the list. If you set a `style` of your own,
   * spread this one into it. Keep the same element while the row is dragged: a handle that is
   * replaced mid-drag ends the drag.
   *
   * `disabled` is true on a row that is not movable, where the handle does nothing.
   */
  handleProps: {
    type: "button";
    disabled: boolean;
    style: { touchAction: "none" };
    "aria-label": string;
    "aria-describedby": string;
    "data-fb-column-handle": "";
    onPointerDown: (event: PointerEvent<HTMLElement>) => void;
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  };
}

/**
 * With `search="auto"`, the picker has a search box when the table has more columns than this.
 * The list shows about ten rows before it scrolls, so the box appears once a person would
 * have to scroll to find a column.
 */
export const COLUMN_PICKER_SEARCH_THRESHOLD = 10;

/** Where the picker shows its list: in a popover below its button, or in a dialog. */
export type ColumnPickerView = "popover" | "dialog";

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
  /**
   * Whether the list has a search box that narrows it to the columns whose name matches.
   *
   * - `"auto"`, the default: only when the table has more than
   *   `COLUMN_PICKER_SEARCH_THRESHOLD` columns (10).
   * - `true`: always.
   * - `false`: never.
   *
   * The search follows `columnMatchesSearch` of `@arvilmena/filter-core`. While a search is
   * on, no column can be moved, because the rows between the listed ones are out of sight.
   * "Show all", "Hide all" and "Reset" still act on every column.
   */
  search?: boolean | "auto";
  /**
   * Whether the popover has a "Dialog view" button, which opens the list in a dialog in the
   * middle of the screen. The dialog lays the columns out in grid columns, read down each one
   * and then across, so a long list needs far less scrolling. Defaults to true.
   */
  dialogView?: boolean;
  /**
   * Where the picker's button opens the list: in the `"popover"` below the button, which is
   * the default, or straight in the `"dialog"`.
   *
   * `dialogView={false}` only takes the "Dialog view" button off the popover. So with
   * `defaultView="dialog"` the list still opens in the dialog.
   */
  defaultView?: ColumnPickerView;
  /**
   * Whether the list has a "Group drag" button. While it is on, a person selects rows with a
   * second checkbox and moves them together, and the show/hide checkboxes are turned off.
   * Defaults to true.
   *
   * A row drawn by `renderRow` must draw the `selectProps` checkbox while `grouping` is
   * true. Pass `false` here if it does not.
   */
  groupDrag?: boolean;
  /** Added to the picker's own class, for an app's extra styling. */
  className?: string;
  /**
   * An inline style for the picker's outer element. It also takes the `--fb-*` variables, to
   * change the look of this one picker: `style={{ "--fb-radius": "0" }}`.
   */
  style?: FilterThemeStyle;
}

/**
 * A button that opens a list of a table's columns. A person ticks a column to show it, and
 * drags its handle to move it. With a keyboard, the arrow keys on a handle move the column.
 *
 * A column the app pinned (`pinned: "start"` or `"end"`) is listed at its end with no handle.
 * The other columns move between the pinned ones.
 *
 * A long list has a search box that narrows it by column name (see `search`).
 *
 * "Dialog view" opens the list in a dialog in the middle of the screen, laid out in grid
 * columns (see `dialogView` and `defaultView`). "Group drag" lets a person select several
 * columns and move them together (see `groupDrag`).
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
  search: searchMode = "auto",
  dialogView: hasDialogView = true,
  defaultView = "popover",
  groupDrag: hasGroupDrag = true,
  className,
  style,
}: ColumnPickerProps<Column>) {
  const { orderedColumns, allVisible, allHidden, isDefault, actions } = state;
  const [open, setOpen] = useState(false);
  // Which of the two the open list is shown in.
  const [view, setView] = useState<ColumnPickerView>(defaultView);
  const isDialog = view === "dialog";
  // Whether group drag is on. It stays on until its button is pressed again.
  const [isGroupDragOn, setGroupDragOn] = useState(false);
  const grouping = hasGroupDrag && isGroupDragOn;
  // The keys of the rows a person selected for moving. It is emptied when the picker closes.
  const [selected, setSelected] = useState(NONE_SELECTED);
  // What a screen reader is told. `count` goes up with every message, so that the same text
  // said twice is still a new message.
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  const announce = useCallback((text: string) => {
    setAnnouncement((was) => ({ text, count: was.count + 1 }));
  }, []);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Whether the pointer was last pressed on the dimmed page around the dialog.
  const pressedOutside = useRef(false);
  const listRef = useRef<HTMLUListElement>(null);
  const popoverId = useId();
  const hintId = useId();
  const pinnedHintId = useId();
  const searchHintId = useId();
  const titleId = useId();

  // What a person typed in the search box. It starts empty each time the picker opens.
  const [typed, setTyped] = useState("");
  // The popover's width when the search began. It is as wide as its longest name, so it
  // would otherwise jump narrower and wider as the list changes under the typing.
  const [widthAtSearch, setWidthAtSearch] = useState<number>();
  const hasSearch =
    searchMode === true ||
    (searchMode === "auto" &&
      orderedColumns.length > COLUMN_PICKER_SEARCH_THRESHOLD);
  // A box that went away, as when the app's list became short, no longer narrows the list.
  const query = hasSearch ? typed : "";
  // The rows drawn. With no search this is the hook's own list, so nothing is copied.
  const listedColumns = useMemo(
    () => searchColumns(orderedColumns, query),
    [orderedColumns, query],
  );
  const isSearching = listedColumns !== orderedColumns;

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
    setTyped("");
    setSelected(NONE_SELECTED);
    pendingMove.current = null;
    pendingButton.current = null;
    // An open modal dialog keeps the focus from every element outside it, the picker's own
    // button among them. So the dialog is closed first, and not only taken off the page
    // when React next draws.
    const dialog = dialogRef.current;
    if (dialog?.open && typeof dialog.close === "function") dialog.close();
    if (returnFocus) triggerRef.current?.focus();
  };
  // The dialog is modal (nothing else on the page can be pressed while it is open), so there
  // is no press outside it to hear, and it is placed by the style sheet alone.
  const isPopoverOpen = open && !isDialog;
  useOutsidePointerDown(rootRef, isPopoverOpen, () => close(false));
  // The list lines up with the side of the button that `align` names. On a narrow screen that
  // may leave it too little room, so it is moved back inside the screen.
  useKeepOnScreen(popoverRef, isPopoverOpen);

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
    if (!open) return;
    if (!isDialog) {
      popoverRef.current?.focus();
      return;
    }
    const dialog = dialogRef.current;
    if (dialog === null) return;
    // Shown as a modal dialog: the browser keeps the focus inside it, and Escape closes it.
    // A page that cannot do that, such as a simulated one, shows it as a plain dialog.
    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    // The browser puts the focus on the first control. It goes to the box itself, as in the
    // popover, so that a screen reader reads out the dialog's name first.
    dialog.focus();
  }, [open, isDialog]);

  const keys = useMemo(
    () => orderedColumns.map((entry) => entry.column.key),
    [orderedColumns],
  );
  // Each column's place in the whole list. A listed row is told its real place, which is not
  // its place among the listed rows while a search is on. It is only worked out then.
  const placeByKey = useMemo(
    () =>
      isSearching ? new Map(keys.map((key, index) => [key, index])) : null,
    [isSearching, keys],
  );
  // How many columns match, as text. It is read out whenever it changes.
  const searchStatus = isSearching
    ? labels.searchCount(listedColumns.length, orderedColumns.length)
    : "";
  useEffect(() => {
    if (searchStatus !== "") announce(searchStatus);
  }, [searchStatus, announce]);

  // The rows between the pinned ones. A dragged row may only be dropped among them.
  const free = useMemo(
    () =>
      unpinnedRange(
        orderedColumns.map((entry) => entry.column),
        keys,
      ),
    [orderedColumns, keys],
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
    /** The keys of the columns that move, in the order they have. */
    group: readonly string[];
    /** Whether the selection is emptied once the move has happened, as after a drop. */
    clearsSelection: boolean;
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
    // Sideways too, as the dialog's grid needs: the browser takes the nearest way there
    // unless told otherwise.
    if (holdsFocus(handle)) handle?.scrollIntoView({ block: "nearest" });
    const total = orderedColumns.length;
    if (pending.group.length === 1) {
      announce(labels.moved(entry.column.label, pending.to + 1, total));
    } else {
      // The group stands side by side, so its first column's place says where it all is.
      const first = keys.indexOf(pending.group[0] as string);
      announce(labels.movedGroup(pending.group.length, first + 1, total));
    }
    if (pending.clearsSelection) setSelected(NONE_SELECTED);
  });

  // The "show all", "hide all" or "reset" press that is still to be read out. Like a move, it waits here
  // until it has really happened, because an app that owns the settings may apply it later, or
  // turn it down. A tick or a move asked for in the meantime ends the wait: the press cannot
  // tell its own result from theirs.
  const pendingButton = useRef<{
    button: FooterAction;
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
    // settings of its own. "Hide all" is told the same way. "Reset" gives the starting
    // settings, which is all `isDefault` says.
    const keptOrder = isSameOrder(keys, pending.order);
    const landed: Record<FooterAction, boolean> = {
      showAll: allVisible && keptOrder,
      hideAll: allHidden && keptOrder,
      reset: isDefault,
    };
    if (landed[pending.button]) {
      pendingButton.current = null;
      // The button stays where it is and the list may barely change, so without this a
      // screen reader would say nothing.
      announce(labels[`${pending.button}Done`]);
    } else if (orderedColumns !== pending.list) {
      // The list changed to something else: the app turned the press down and applied
      // another change. That is not this press's to speak for.
      pendingButton.current = null;
    }
  });

  const press = (button: FooterAction) => {
    // Each of these buttons can change the list. A move still waiting must not take the credit.
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
  // The selected rows that may move now, which is what a group move takes with it. A column
  // that the app has pinned or taken away since it was selected is left out.
  const group = useMemo(() => {
    if (!grouping || selected.size === 0) return NONE_SELECTED;
    const movable = new Set<string>();
    for (let place = free.first; place <= free.last; place++) {
      const key = keys[place] as string;
      if (selected.has(key)) movable.add(key);
    }
    return movable;
  }, [grouping, selected, keys, free]);
  const latestGroup = useRef(group);
  useEarlyEffect(() => {
    latestColumns.current = orderedColumns;
    latestGroup.current = group;
  });

  // Columns are named by their keys, not their places: the list may have changed since the
  // row that asks for the move was drawn or picked up.
  /**
   * Asks for the columns in `moved` to go together to the place `to`. `held` is the key of
   * the row whose handle asked, which keeps the keyboard focus through the move.
   */
  const moveTo = useCallback(
    (
      moved: readonly string[],
      to: number,
      held: string,
      clearsSelection: boolean,
    ) => {
      const columns = latestColumns.current.map((item) => item.column);
      const before = columns.map((column) => column.key);
      const settings = { order: before, hidden: [] };
      const [only] = moved;
      const isOne = moved.length === 1 && only !== undefined;
      // The move itself says what it would do, so the picker holds no copy of its rules. It
      // is the hook's own move, which leaves pinned columns in place.
      const after = (
        isOne
          ? moveColumnAroundPinned(columns, settings, only, to)
          : moveColumnGroupAroundPinned(columns, settings, moved, to)
      ).order;
      // The same list back means the move changes nothing.
      if (after === before) return;
      // A "show all", "hide all" or "reset" press still waiting gives up. What the list becomes next is
      // this move's doing, and the press must not be read out for it.
      pendingButton.current = null;
      pendingMove.current = {
        from: before.indexOf(held),
        to: after.indexOf(held),
        before,
        after,
        group: moved,
        clearsSelection,
      };
      if (isOne) actions.move(only, to);
      else actions.moveGroup(moved, to);
    },
    [actions],
  );
  const drag = useColumnDrag({
    listRef,
    keys,
    // The rows on the page are not the whole list while a search is on, so nothing is dragged.
    active: open && !isSearching,
    free,
    selected: group,
    onDrop: (key, to) => moveTo([key], to, key, false),
    // A group that was dropped has done its work, so its rows are no longer selected.
    onDropGroup: (moved, to, held) => moveTo(moved, to, held, true),
  });

  // A key press on the handle of the row with this key. The arrow keys move the row, or the
  // whole group when the row is one of the selected ones.
  const moveByKey = useCallback(
    (event: KeyboardEvent<HTMLElement>, key: string) => {
      const order = latestColumns.current.map((item) => item.column.key);
      const index = order.indexOf(key);
      if (index === -1) return;
      const selection = latestGroup.current;
      const moved = selection.has(key)
        ? order.filter((other) => selection.has(other))
        : [key];
      // The places of the first and the last of the columns that move.
      const first = order.indexOf(moved[0] as string);
      const last = order.indexOf(moved[moved.length - 1] as string);
      // How many places the columns go: up the list when it is below 0, and down otherwise.
      let step: number;
      if (event.key === "ArrowUp") step = -1;
      else if (event.key === "ArrowDown") step = 1;
      else if (event.key === "Home") step = -order.length;
      else if (event.key === "End") step = order.length;
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        const list = listRef.current;
        if (list === null) return;
        // The rows are measured once per key press, to find the row beside this one.
        const beside = placeBeside(
          measureGrid(list),
          index,
          event.key === "ArrowLeft" ? -1 : 1,
        );
        // The popover's list has one grid column, so these two keys are not the picker's.
        if (beside === undefined) return;
        step = beside - index;
      } else return;
      // The arrow keys would otherwise scroll the list.
      event.preventDefault();
      if (step === 0) return;
      // Going up, the group's first column leads. Going down, its last one does, and the
      // place asked for is the first column's, which stands that many places before it.
      const to = step < 0 ? first + step : last + step - (moved.length - 1);
      moveTo(moved, to, key, false);
    },
    [moveTo],
  );

  // Selects a row for moving, or takes it out of the selection.
  const toggleSelected = useCallback((key: string) => {
    setSelected((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

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
    onClick: () => {
      if (open) {
        close(false);
        return;
      }
      setView(defaultView);
      setOpen(true);
    },
  };

  const groupDragButton = hasGroupDrag && (
    <button
      aria-pressed={grouping}
      className="fb-button fb-columns-tool"
      onClick={() => {
        // Turning it off lets the selection go, so that it is not found again later.
        if (grouping) setSelected(NONE_SELECTED);
        setGroupDragOn(!grouping);
      }}
      type="button"
    >
      {labels.groupDrag}
    </button>
  );

  // What the popover and the dialog both hold: the search box, the list and the buttons.
  const content = (
    <>
      {hasSearch && (
        <div className="fb-columns-search">
          <input
            aria-describedby={isSearching ? searchHintId : undefined}
            aria-label={labels.search}
            autoComplete="off"
            className="fb-control fb-columns-search-input"
            enterKeyHint="search"
            onChange={(event) => {
              if (!isSearching) {
                setWidthAtSearch(
                  popoverRef.current?.getBoundingClientRect().width,
                );
              }
              setTyped(event.target.value);
            }}
            onKeyDown={(event) => {
              // Escape first clears a search. Pressed again, it closes the picker.
              if (event.key !== "Escape" || typed === "") return;
              event.preventDefault();
              event.stopPropagation();
              setTyped("");
            }}
            placeholder={labels.search}
            spellCheck={false}
            type="search"
            value={typed}
          />
          {isSearching && (
            <p className="fb-columns-search-status">
              {searchStatus}{" "}
              <span id={searchHintId}>{labels.searchMoveHint}</span>
            </p>
          )}
        </div>
      )}
      {/* Read out after a handle's name. It is hidden, but a handle can still point at it. */}
      <span hidden id={hintId}>
        {isDialog ? labels.dialogMoveHint : labels.moveHint}
        {grouping && ` ${labels.groupDragHint}`}
      </span>
      <span hidden id={pinnedHintId}>
        {labels.pinnedHint}
      </span>
      {/* The style sheet takes the bullets off, and Safari then stops telling a screen
          reader that this is a list, and how many columns it holds. Naming the role
          keeps both. */}
      <ul
        className="fb-columns-list"
        data-dragging={drag.key === null ? undefined : ""}
        data-grouping={grouping ? "" : undefined}
        ref={listRef}
        // biome-ignore lint/a11y/noRedundantRoles: see the lines above the list
        role="list"
      >
        {listedColumns.map((entry, listedIndex) => {
          const { key, label } = entry.column;
          const index = placeByKey?.get(key) ?? listedIndex;
          return (
            <Row
              drop={dropMark(drag, index)}
              entry={entry}
              grouping={grouping}
              hintId={hintId}
              index={index}
              isDragging={drag.moving.has(key)}
              isSearching={isSearching}
              isSelected={group.has(key)}
              key={key}
              moveLabel={labels.move(label)}
              onDragStart={drag.start}
              onMoveKey={moveByKey}
              onSelect={toggleSelected}
              onToggle={toggle}
              pinnedHintId={pinnedHintId}
              renderRow={renderRow}
              // Only worked out while it is drawn.
              selectLabel={grouping ? labels.select(label) : ""}
            />
          );
        })}
      </ul>
      <div className="fb-columns-footer">
        <FooterButton onPress={() => press("showAll")} unavailable={allVisible}>
          {labels.showAll}
        </FooterButton>
        <FooterButton onPress={() => press("hideAll")} unavailable={allHidden}>
          {labels.hideAll}
        </FooterButton>
        {/* "Reset" stands apart at the far side: it undoes moves too, not only ticks. */}
        <FooterButton
          className="fb-columns-footer-end"
          onPress={() => press("reset")}
          unavailable={isDefault}
        >
          {labels.reset}
        </FooterButton>
      </div>
    </>
  );

  return (
    // It only hears the keys, the focus and the blur of the controls inside it. A person never
    // acts on it directly.
    // biome-ignore lint/a11y/noStaticElementInteractions: see the lines above
    <div
      className={className ? `fb-columns ${className}` : "fb-columns"}
      // Tab moves the focus on past the list, which would otherwise stay open over the page.
      // A click on something that takes no focus is left to the outside-click check above.
      onBlur={(event) => {
        // The dialog keeps the focus inside it, so there it never moves on past the list.
        if (!isPopoverOpen) return;
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
      style={style}
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

      {isPopoverOpen && (
        <div
          aria-label={labels.title}
          className="fb-columns-popover"
          data-align={align}
          id={popoverId}
          ref={popoverRef}
          role="dialog"
          style={isSearching ? { minWidth: widthAtSearch } : undefined}
          tabIndex={-1}
        >
          {(hasGroupDrag || hasDialogView) && (
            <div className="fb-columns-tools">
              {groupDragButton}
              {hasDialogView && (
                <button
                  className="fb-button fb-columns-tool"
                  onClick={() => setView("dialog")}
                  type="button"
                >
                  {labels.dialogView}
                </button>
              )}
            </div>
          )}
          {content}
        </div>
      )}

      {open && isDialog && (
        // The browser's own dialog element. Shown as a modal, it keeps the focus inside it
        // and stands in the middle of the screen, over everything else on the page.
        // The click it hears is one on the dimmed page around it. The keyboard has Escape
        // and the "Close" button for that.
        // biome-ignore lint/a11y/useKeyWithClickEvents: see the lines above
        <dialog
          aria-labelledby={titleId}
          className="fb-columns-dialog"
          id={popoverId}
          // The browser asks to close the dialog, as for the back button of a phone. The
          // picker closes it itself, so that its own state follows.
          onCancel={(event) => {
            event.preventDefault();
            close(true);
          }}
          // The browser closed the dialog all the same, which it may do when asked twice.
          onClose={() => close(true)}
          // A click on the dimmed page around the dialog closes it. The dialog closes when
          // the button is let go, not when it is pressed: the browser moves the focus on
          // the press, and would take it off the picker's button again.
          onClick={(event) => {
            if (pressedOutside.current && isOutsideBox(event)) close(true);
            pressedOutside.current = false;
          }}
          // A press that began inside the dialog and is let go outside it closes nothing,
          // as when a person selects text and overshoots.
          onPointerDown={(event) => {
            pressedOutside.current = isOutsideBox(event);
          }}
          ref={dialogRef}
          tabIndex={-1}
        >
          <div className="fb-columns-tools">
            <p className="fb-columns-title" id={titleId}>
              {labels.title}
            </p>
            {groupDragButton}
            <button
              className="fb-button fb-columns-tool"
              onClick={() => close(true)}
              type="button"
            >
              {labels.closeDialog}
            </button>
          </div>
          {content}
        </dialog>
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
  className,
  children,
}: {
  /** Whether a press would change nothing. */
  unavailable: boolean;
  onPress: () => void;
  /** Added to the button's own class. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      aria-disabled={unavailable ? true : undefined}
      className={className ? `fb-button ${className}` : "fb-button"}
      onClick={unavailable ? undefined : onPress}
      type="button"
    >
      {children}
    </button>
  );
}

/** A button below the list, by the name of the action it calls. */
type FooterAction = "showAll" | "hideAll" | "reset";

/** The handle of the row at `index` of the list, if the list is open and has such a row. */
function handleAt(list: HTMLElement | null, index: number): HTMLElement | null {
  return (
    list?.children[index]?.querySelector<HTMLElement>(
      "[data-fb-column-handle]",
    ) ?? null
  );
}

/**
 * Whether a pointer is on the dimmed page around a dialog. The dialog itself hears such a
 * press or click, and also one on its own padding, so the place is checked against the box
 * the dialog draws.
 */
function isOutsideBox(event: {
  target: EventTarget;
  currentTarget: Element;
  clientX: number;
  clientY: number;
}): boolean {
  if (event.target !== event.currentTarget) return false;
  const box = event.currentTarget.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
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

/** No row is selected. One empty set for every picker, so that it never counts as a change. */
const NONE_SELECTED: ReadonlySet<string> = new Set<string>();

/** Where the line that marks a drop is drawn on a row: above it, below it, or not at all. */
type DropMark = "before" | "after" | undefined;

/**
 * The drop line of the row at `index`. It is drawn above the row the drop lands before. At
 * the foot of a grid column, and after the last row, it is drawn below the row before that.
 */
function dropMark(
  { slot, after }: { slot: number | null; after: boolean },
  index: number,
): DropMark {
  if (slot === null) return undefined;
  if (after) return index === slot - 1 ? "after" : undefined;
  return index === slot ? "before" : undefined;
}

interface RowProps<Column extends ColumnDefinition> {
  entry: OrderedColumn<Column>;
  index: number;
  isDragging: boolean;
  /** Whether group drag is on. */
  grouping: boolean;
  /** Whether the row is selected for moving. */
  isSelected: boolean;
  /** The name of the row's selection checkbox, as finished text like `moveLabel`. */
  selectLabel: string;
  /** Whether a search narrows the list. No row can be moved then. */
  isSearching: boolean;
  drop: DropMark;
  /**
   * The name of the row's handle. It is text, not the wording object, because text compares
   * equal from one render to the next and so does not make the row redraw.
   */
  moveLabel: string;
  hintId: string;
  /** Points at the text that says a pinned column cannot be moved. */
  pinnedHintId: string;
  onDragStart: (event: PointerEvent<HTMLElement>, key: string) => void;
  /** A key was pressed on the row's handle. */
  onMoveKey: (event: KeyboardEvent<HTMLElement>, key: string) => void;
  onSelect: (key: string) => void;
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
  isDragging,
  grouping,
  isSelected,
  selectLabel,
  isSearching,
  drop,
  moveLabel,
  hintId,
  pinnedHintId,
  onDragStart,
  onMoveKey,
  onSelect,
  onToggle,
  renderRow,
}: RowProps<Column>) {
  const { column, visible, hideable, pinned } = entry;
  const checkboxId = useId();
  const selectId = useId();
  const movable = pinned === undefined && !isSearching;

  const row: ColumnPickerRow<Column> = {
    column,
    visible,
    hideable,
    pinned,
    index,
    isDragging,
    grouping,
    selected: isSelected,
    movable,
    checkboxProps: {
      type: "checkbox",
      id: checkboxId,
      checked: visible,
      // While group drag is on, the box only shows whether the column is shown.
      disabled: !hideable || grouping,
      "aria-label": grouping ? column.label : undefined,
      "aria-describedby": pinned === undefined ? undefined : pinnedHintId,
      onChange: () => onToggle(column.key),
    },
    selectProps: {
      type: "checkbox",
      id: selectId,
      checked: isSelected,
      disabled: !movable,
      "aria-label": selectLabel,
      onChange: () => {
        if (movable) onSelect(column.key);
      },
    },
    handleProps: {
      type: "button",
      disabled: !movable,
      style: HANDLE_STYLE,
      "aria-label": moveLabel,
      "aria-describedby": hintId,
      "data-fb-column-handle": "",
      // A handle that an app's own row draws on a row that is not movable does nothing.
      onPointerDown: (event) => {
        if (movable) onDragStart(event, column.key);
      },
      onKeyDown: (event) => {
        if (movable) onMoveKey(event, column.key);
      },
    },
  };

  return (
    <li
      className="fb-columns-row"
      data-dragging={isDragging ? "" : undefined}
      data-drop={drop}
      data-fixed={hideable ? undefined : ""}
      data-pinned={pinned}
      data-selected={isSelected ? "" : undefined}
    >
      {renderRow ? (
        renderRow(row)
      ) : (
        <>
          {/* The box that selects the row comes first: it is the one in use while group
              drag is on. A pinned column has a gap there, so the names line up. */}
          {grouping &&
            (pinned === undefined ? (
              <input
                className="fb-columns-checkbox fb-columns-select"
                {...row.selectProps}
              />
            ) : (
              <span className="fb-columns-select" />
            ))}
          <input className="fb-columns-checkbox" {...row.checkboxProps} />
          {pinned === undefined ? (
            <button className="fb-columns-handle" {...row.handleProps}>
              <span aria-hidden="true">⠿</span>
            </button>
          ) : (
            // A pinned column has no handle. A pin stands in its place, so the names line up.
            <span className="fb-columns-pin">
              <PinIcon />
            </span>
          )}
          <label
            className="fb-columns-label"
            // A click on the name works the box that is in use.
            htmlFor={grouping && pinned === undefined ? selectId : checkboxId}
          >
            {column.label}
          </label>
        </>
      )}
    </li>
  );
  // `memo` drops the row's type parameter, so it is put back here.
}) as <Column extends ColumnDefinition>(props: RowProps<Column>) => ReactNode;

/** A small drawing of a pin, in the colour of the text around it. A screen reader skips it. */
function PinIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      width="14"
    >
      <path d="M5 2h6M6 2v5l-2 3h8l-2-3V2M8 10v4" />
    </svg>
  );
}

/**
 * Without this a finger on a handle scrolls the list, and the drag never starts. It is set on
 * the handle itself, not only in the style sheet, so that a row an app draws has it too.
 */
const HANDLE_STYLE = { touchAction: "none" } as const;

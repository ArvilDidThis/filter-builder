import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useEarlyEffect } from "../useEarlyEffect";
import { type GridColumn, measureGrid, slotAtPoint } from "./columnGrid";

// Kept here too, where the tests of the drag look for it.
export { slotAt } from "./columnGrid";

import { listenForScrollAround } from "./scrollAround";

// Dragging a row of the column picker to a new place. It uses Pointer Events (one set of
// browser events for mouse, touch and pen), because the browser's own drag and drop does not
// work on most touch screens.
//
// While a row is held, only this hook's state changes, so only the picker's list redraws. The
// app hears about the move once, on drop.
//
// The list may lay its rows out in several grid columns, as the picker's dialog does, so the
// drop place is found from both the pointer's height and how far across it is. Several rows
// can move together: the ones `selected` names, when one of them is the row held.

/** What the column picker's list needs to drag its rows. */
export interface ColumnDrag {
  /** The key of the row being dragged, or `null` when none is. */
  key: string | null;
  /** The keys of every row that moves with this drag. It is empty when no row is dragged. */
  moving: ReadonlySet<string>;
  /**
   * Where a drop would land: before the row at this position, or after the last row when it
   * equals the number of rows. It is `null` when a drop would change nothing.
   */
  slot: number | null;
  /**
   * Whether the drop line belongs below the row before `slot`, not above the row at it. That
   * is so at the foot of a grid column, and after the last row.
   */
  after: boolean;
  /** Call from the `onPointerDown` of the handle of the row with this key. */
  start: (event: ReactPointerEvent<HTMLElement>, key: string) => void;
}

/** How close to an edge of the list the pointer scrolls the list, in pixels. */
const SCROLL_EDGE = 28;
/** How far the list scrolls on each screen frame while the pointer is at an edge, in pixels. */
const SCROLL_STEP = 10;
/**
 * How far the pointer must travel over the list before a drop counts, in pixels. A handle let
 * go where it was pressed, as in a click, moves nothing. That matters for a group: its rows
 * may stand apart, and a drop in place would still gather them.
 */
const DRAG_THRESHOLD = 4;

/** One drag, from the press on a handle to the drop. */
interface DragSession {
  /**
   * The key of the row held. The row is known by its key, not its place, because the app may
   * change the list while the row is held, and then the same place means another row.
   */
  key: string;
  /** The keys of the rows that move: the held row alone, or its whole group. */
  keys: readonly string[];
  /** The places in the list, as it is now, of the rows that move, from the first down. */
  places: readonly number[];
  /** The pointer's last known place on the screen. */
  clientX: number;
  clientY: number;
  /** Where the press was, on the list's whole content. */
  pressedAt: { x: number; y: number };
  /** Whether the pointer has gone `DRAG_THRESHOLD` from the press. Once it has, it is a drag. */
  hasLeftPress: boolean;
  /** Where each row stands, measured from the corner of the list's whole content. */
  grid: readonly GridColumn[];
  /** The screen frame waiting to scroll the list, if any. */
  frame: number | null;
  /** Watches the rows the list has now for a change of size, in place of the rows before. */
  watchRows: () => void;
  /** Stops listening for this drag. */
  stop: () => void;
}

/** What `useColumnDrag` needs from the list it serves. */
export interface ColumnDragOptions {
  /** Points at the list. Each child of the list must be one row. */
  listRef: RefObject<HTMLElement | null>;
  /**
   * The key of each row, in the order the rows are drawn. Keep the same list between renders
   * until the rows change (see `useMemo`).
   */
  keys: readonly string[];
  /** Whether the list is on the page. A drag ends when this turns false. */
  active: boolean;
  /**
   * The places a row may be dropped in: from `first` to `last`, counting from 0. The rows
   * before and after them are pinned, and a drop aimed past them lands at the nearest place.
   * Leave it out when every row may move.
   */
  free?: FreePlaces;
  /**
   * The keys of the rows that move together. Dragging one of them moves them all, and they
   * land side by side in the order they had. Dragging any other row moves that row alone.
   * Name only rows that may move. Leave it out when rows only ever move one at a time.
   */
  selected?: ReadonlySet<string>;
  /**
   * Called once per drag of one row, with the row's key and its new place, and only when the
   * row landed in a new place.
   */
  onDrop: (key: string, to: number) => void;
  /**
   * Called in place of `onDrop` when several rows moved together, and only when the drop
   * changes the order. `keys` holds the rows that moved, in the order they had, and `to` is
   * the place the first of them lands in. `held` is the key of the row whose handle was
   * dragged. It is needed only with `selected`.
   */
  onDropGroup?: (keys: readonly string[], to: number, held: string) => void;
}

/** The places of a list that a row may be dropped in, from `first` to `last`. */
export interface FreePlaces {
  first: number;
  last: number;
}

/** Keeps track of a drag in a list of rows. */
export function useColumnDrag({
  listRef,
  keys,
  active,
  free,
  selected,
  onDrop,
  onDropGroup,
}: ColumnDragOptions): ColumnDrag {
  const [held, setHeld] = useState<Held>(IDLE);
  const session = useRef<DragSession | null>(null);

  // Read through a ref, so `start` can stay the same function between renders.
  const latest = useRef({ keys, free, selected, onDrop, onDropGroup });
  useEarlyEffect(() => {
    latest.current = { keys, free, selected, onDrop, onDropGroup };
  });

  const end = useCallback(() => {
    session.current?.stop();
    session.current = null;
    setHeld(IDLE);
  }, []);

  // The list goes away when the picker closes, and the drag goes with it. Otherwise letting go
  // of the pointer after the list has closed would still move the column.
  useEffect(() => {
    if (!active) end();
  }, [active, end]);

  // A picker that leaves the page mid-drag must not leave listeners behind.
  useEffect(() => () => session.current?.stop(), []);

  /** Works out where a drop would land now, and shows it. */
  const showSlot = useCallback(() => {
    const drag = session.current;
    const list = listRef.current;
    if (drag === null || list === null) return;
    // One read of the list's place per pointer move, and a second one only until the pointer
    // leaves the press. The rows were measured already, so no row is measured here. They are
    // measured again only when one of them changes size.
    const { slot, after } = dropSlot(
      drag.grid,
      list,
      drag,
      latest.current.free,
    );
    const shown =
      isStillPressed(drag, list, drag) || staysPut(drag.places, slot)
        ? null
        : slot;
    // The pointer moves many times a second, so the state changes only when the slot does.
    setHeld((was) =>
      was.slot === shown && (shown === null || was.after === after)
        ? was
        : { ...was, slot: shown, after: shown !== null && after },
    );
  }, [listRef]);

  /** Shows where a drop would land now, and scrolls the list when the pointer is at an edge. */
  const follow = useCallback(() => {
    showSlot();
    const drag = session.current;
    const list = listRef.current;
    if (drag === null || list === null || drag.frame !== null) return;
    if (!isAtEdge(edgeDirections(drag, list))) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = null;
      // The way to scroll is worked out now, not when the frame was asked for. The pointer
      // may have crossed to the other edge since, and a scroll the old way could find the
      // list at its end and stop the scrolling for good.
      const direction = edgeDirections(drag, list);
      if (!isAtEdge(direction)) return;
      const before = { left: list.scrollLeft, top: list.scrollTop };
      list.scrollTop += direction.down * SCROLL_STEP;
      // A list that is no wider than its box, as the popover's is, has nowhere to go.
      list.scrollLeft += direction.across * SCROLL_STEP;
      // Stops once the list has reached its end. Otherwise it follows again, which keeps the
      // list scrolling for as long as the pointer rests at the edge.
      const hasScrolled =
        list.scrollTop !== before.top || list.scrollLeft !== before.left;
      if (hasScrolled) follow();
    });
  }, [listRef, showSlot]);

  // The app changed the list while a row was held, for example by taking a column away. A
  // place only means something in the list it was measured in, so the held row is found again
  // by its key and the rows are measured again.
  useEffect(() => {
    const drag = session.current;
    const list = listRef.current;
    if (drag === null || list === null) return;
    if (!keys.includes(drag.key)) {
      // The held column itself is gone.
      end();
      return;
    }
    drag.places = placesOf(drag.keys, keys);
    drag.grid = measureGrid(list);
    drag.watchRows();
    follow();
  }, [keys, listRef, follow, end]);

  const start = useCallback<ColumnDrag["start"]>(
    (event, key) => {
      const list = listRef.current;
      const from = latest.current.keys.indexOf(key);
      // Only the main mouse button, a finger or a pen tip starts a drag.
      if (list === null || from === -1 || event.button !== 0) return;
      // A drag still held here never heard its pointer let go. The new press replaces it,
      // so one lost event cannot leave the list stuck.
      end();
      const { pointerId } = event;
      const handle = event.currentTarget;
      // Pointer capture (the browser sends every later event of this pointer to the handle)
      // lets the release be heard even when it happens outside the window.
      try {
        handle.setPointerCapture(pointerId);
      } catch {
        // The pointer is gone already, or the browser has no capture. The checks below still
        // end the drag.
      }

      const onMove = (moved: PointerEvent) => {
        const drag = session.current;
        if (drag === null || moved.pointerId !== pointerId) return;
        // A mouse that moves with no button held was let go where this page could not hear
        // it, for example over a menu that the system opened. Nobody chose a place to drop,
        // so the drag is given up.
        if (moved.pointerType === "mouse" && moved.buttons === 0) {
          end();
          return;
        }
        drag.clientX = moved.clientX;
        drag.clientY = moved.clientY;
        follow();
      };
      const onUp = (released: PointerEvent) => {
        const drag = session.current;
        if (drag === null || released.pointerId !== pointerId) return;
        end();
        // A drop means nothing once the list it was aimed at has left the page.
        if (listRef.current !== list) return;
        // Let go where it was pressed. The release's own place counts too, as a pointer can
        // travel and let go with no move reported in between.
        if (isStillPressed(drag, list, released)) return;
        // The place is worked out here, from where the pointer was let go and the list as it
        // is now. The last move heard may be out of date: a pointer can travel and let go
        // with no move reported in between, and the list can change under a still pointer.
        const order = latest.current.keys;
        if (!order.includes(drag.key)) return;
        const places = placesOf(drag.keys, order);
        const { slot } = dropSlot(
          measureGrid(list),
          list,
          released,
          latest.current.free,
        );
        if (staysPut(places, slot)) return;
        const to = groupPlaceFromSlot(places, slot);
        if (places.length === 1) {
          latest.current.onDrop(drag.key, to);
          return;
        }
        latest.current.onDropGroup?.(
          places.map((place) => order[place] as string),
          to,
          drag.key,
        );
      };
      // The browser took the pointer away, for example to scroll the page, or took the
      // capture away without a release.
      const onCancel = (cancelled: PointerEvent) => {
        if (cancelled.pointerId === pointerId) end();
      };
      const onKeyDown = (pressed: KeyboardEvent) => {
        if (pressed.key !== "Escape") return;
        // Escape gives up the drag only. It must not also close the picker. That includes
        // the browser's own closing of a dialog, which the key would otherwise bring on.
        pressed.stopPropagation();
        pressed.preventDefault();
        end();
      };

      // The list's own document, which is not the global one when the picker is drawn inside
      // a frame (a page within the page). The pointer's events are heard only there.
      const page = list.ownerDocument;
      // Every one is heard in the capture phase (on the event's way down to its target,
      // before any element hears it). An element around the picker that stops an event from
      // spreading, as a toolbar might, then cannot hide it from the drag and leave the drag
      // unfinished. It also lets Escape be heard here before the picker hears it.
      // Each call hands back how to stop listening, so both use the same phase.
      const listen = <Type extends keyof DocumentEventMap>(
        type: Type,
        listener: (event: DocumentEventMap[Type]) => void,
      ) => {
        page.addEventListener(type, listener, true);
        return () => page.removeEventListener(type, listener, true);
      };
      const stopListening = [
        listen("pointermove", onMove),
        listen("pointerup", onUp),
        listen("pointercancel", onCancel),
        listen("lostpointercapture", onCancel),
        listen("keydown", onKeyDown),
      ];
      // A mouse wheel can scroll the list under a pointer that stays still.
      list.addEventListener("scroll", follow);

      // A box around the picker, or the page itself, can scroll too. That moves the whole
      // list under a still pointer, so the drop line would show a place the drop does not
      // land in. A scroll is reported many times a second, so the line is worked out at
      // most once per screen frame.
      let lineFrame: number | null = null;
      const onScrollAround = (scrolled: Event) => {
        // The list's own scroll is followed above.
        if (scrolled.target === list || lineFrame !== null) return;
        lineFrame = requestAnimationFrame(() => {
          lineFrame = null;
          // Only the drop line follows. The list does not start to scroll, as for a change
          // of size below: a row that is only held at the list's edge must not move it.
          showSlot();
        });
      };
      // Heard on the page and in every shadow tree the list is drawn in.
      stopListening.push(listenForScrollAround(list, onScrollAround));

      // A row can change height while another is held, such as a row an app draws that opens
      // up. The measured middles are then out of date, and the drop line would show a place
      // the drop does not land in. So the browser is asked to say when a row changes size,
      // and the rows are measured again only then. It reports once per screen frame, however
      // many rows changed, and once for the rows as they are first watched.
      // An older browser has no such watcher. The drop itself still measures afresh there.
      const SizeWatcher = page.defaultView?.ResizeObserver;
      const sizeWatcher = SizeWatcher
        ? new SizeWatcher(() => {
            const drag = session.current;
            if (drag === null) return;
            drag.grid = measureGrid(list);
            // Only the drop line follows a change of size. The list does not start to
            // scroll: the first report comes with the press itself, and a row that is
            // only pressed at the list's edge must not move the list.
            showSlot();
          })
        : null;
      const watchRows = () => {
        if (sizeWatcher === null) return;
        sizeWatcher.disconnect();
        for (const row of Array.from(list.children)) sizeWatcher.observe(row);
      };
      // The rows that move with this one: its whole group when it is one of the selected
      // rows, and otherwise the row alone.
      const { keys: order, selected: group } = latest.current;
      const moving = group?.has(key)
        ? order.filter((other) => group.has(other))
        : [key];
      session.current = {
        key,
        keys: moving,
        places: placesOf(moving, order),
        clientX: event.clientX,
        clientY: event.clientY,
        pressedAt: pointOnList(list, event),
        hasLeftPress: false,
        // Every row is measured once, here, and not again while the list stays as it is.
        grid: measureGrid(list),
        frame: null,
        watchRows,
        stop: () => {
          for (const stopOne of stopListening) stopOne();
          try {
            handle.releasePointerCapture(pointerId);
          } catch {
            // The capture was never taken, or is gone already.
          }
          list.removeEventListener("scroll", follow);
          if (lineFrame !== null) cancelAnimationFrame(lineFrame);
          sizeWatcher?.disconnect();
          const frame = session.current?.frame;
          if (frame != null) cancelAnimationFrame(frame);
        },
      };
      watchRows();
      setHeld({ key, moving: new Set(moving), slot: null, after: false });
    },
    [listRef, follow, showSlot, end],
  );

  return { ...held, start };
}

/** What the hook's state holds: everything about the drag but how to start one. */
type Held = Omit<ColumnDrag, "start">;

const IDLE: Held = {
  key: null,
  moving: new Set<string>(),
  slot: null,
  after: false,
};

/** The places in `order` of the rows named, from the first down. A row that is gone is left out. */
function placesOf(keys: readonly string[], order: readonly string[]): number[] {
  const named = new Set(keys);
  const places: number[] = [];
  order.forEach((key, index) => {
    if (named.has(key)) places.push(index);
  });
  return places;
}

/**
 * The gap a drop would land in for a pointer at this place on the screen, kept to the gaps
 * that `free` allows.
 */
function dropSlot(
  grid: readonly GridColumn[],
  list: HTMLElement,
  pointer: { clientX: number; clientY: number },
  free: FreePlaces | undefined,
): { slot: number; after: boolean } {
  // One read of the list's place. No row is measured here.
  const box = list.getBoundingClientRect();
  const aimed = slotAtPoint(
    grid,
    pointer.clientX - box.left + list.scrollLeft,
    pointer.clientY - box.top + list.scrollTop,
  );
  const slot = slotWithin(aimed.slot, free);
  // A gap the pointer did not aim at is beside a pinned row, and is marked above that row.
  return { slot, after: aimed.after && slot === aimed.slot };
}

/**
 * The slot nearest to `slot` that a drop may land in. A slot is the gap before a row, so the
 * free places from `first` to `last` have one more slot than rows: the last is after `last`.
 */
export function slotWithin(slot: number, free: FreePlaces | undefined): number {
  if (free === undefined) return slot;
  return Math.min(Math.max(slot, free.first), free.last + 1);
}

/**
 * The place a row ends up at when it is dropped into `slot`. Taking the row out first moves
 * every later row up one, so a slot below the row counts one less.
 */
export function placeFromSlot(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

/**
 * The place the first of several rows ends up at when they are dropped together into `slot`.
 * `places` holds the rows' places now. Taking them out first moves every later row up, so
 * each of them that stands before the slot counts one less.
 */
export function groupPlaceFromSlot(
  places: readonly number[],
  slot: number,
): number {
  return slot - places.filter((place) => place < slot).length;
}

/**
 * Whether the pointer is still within `DRAG_THRESHOLD` of the press, and has never left it.
 * Once it has left, it is a drag, even back where it began.
 */
function isStillPressed(
  drag: DragSession,
  list: HTMLElement,
  pointer: { clientX: number; clientY: number },
): boolean {
  if (drag.hasLeftPress) return false;
  const now = pointOnList(list, pointer);
  const { x, y } = drag.pressedAt;
  if (Math.hypot(now.x - x, now.y - y) < DRAG_THRESHOLD) return true;
  drag.hasLeftPress = true;
  return false;
}

/**
 * The pointer's place on the list's whole content. It stays the same when the list or the
 * page scrolls under a still pointer, which is a way to drag too.
 */
function pointOnList(
  list: HTMLElement,
  pointer: { clientX: number; clientY: number },
): { x: number; y: number } {
  const box = list.getBoundingClientRect();
  return {
    x: pointer.clientX - box.left + list.scrollLeft,
    y: pointer.clientY - box.top + list.scrollTop,
  };
}

/** Whether a drop into `slot` leaves the rows at `places` where they are, side by side. */
function staysPut(places: readonly number[], slot: number): boolean {
  const to = groupPlaceFromSlot(places, slot);
  return places.every((place, index) => place === to + index);
}

/** Which way to scroll a list: -1 towards its start, 1 towards its end, 0 for not at all. */
type Direction = -1 | 0 | 1;

/** Which way a pointer near the list's edges scrolls it, across and down. */
function edgeDirections(
  pointer: { clientX: number; clientY: number },
  list: HTMLElement,
): { across: Direction; down: Direction } {
  const box = list.getBoundingClientRect();
  return {
    // Only a list that is wider than its box scrolls sideways, as the dialog's grid can be.
    // Without this check a pointer at the side of the popover's list would ask for a new
    // frame on every move, to scroll a list that cannot.
    across:
      list.scrollWidth > list.clientWidth
        ? edgeDirection(pointer.clientX, box.left, box.right)
        : 0,
    down: edgeDirection(pointer.clientY, box.top, box.bottom),
  };
}

/** Whether the pointer is near an edge that scrolls the list. */
function isAtEdge(direction: { across: Direction; down: Direction }): boolean {
  return direction.across !== 0 || direction.down !== 0;
}

/** -1 near the `start` edge, 1 near the `end` edge, else 0. */
function edgeDirection(at: number, start: number, end: number): Direction {
  if (at < start + SCROLL_EDGE) return -1;
  if (at > end - SCROLL_EDGE) return 1;
  return 0;
}

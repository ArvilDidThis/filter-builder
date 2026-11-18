import {
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useEarlyEffect } from "../useEarlyEffect";

// Dragging a row of the column picker to a new place. It uses Pointer Events (one set of
// browser events for mouse, touch and pen), because the browser's own drag and drop does not
// work on most touch screens.
//
// While a row is held, only this hook's state changes, so only the picker's list redraws. The
// app hears about the move once, on drop.

/** What the column picker's list needs to drag its rows. */
export interface ColumnDrag {
  /** The key of the row being dragged, or `null` when none is. */
  key: string | null;
  /**
   * Where a drop would land: before the row at this position, or after the last row when it
   * equals the number of rows. It is `null` when a drop would change nothing.
   */
  slot: number | null;
  /** Call from the `onPointerDown` of the handle of the row with this key. */
  start: (event: ReactPointerEvent<HTMLElement>, key: string) => void;
}

/** How close to the list's top or bottom edge the pointer scrolls the list, in pixels. */
const SCROLL_EDGE = 28;
/** How far the list scrolls on each screen frame while the pointer is at an edge, in pixels. */
const SCROLL_STEP = 10;

/** One drag, from the press on a handle to the drop. */
interface DragSession {
  /**
   * The key of the row held. The row is known by its key, not its place, because the app may
   * change the list while the row is held, and then the same place means another row.
   */
  key: string;
  /** The row's place in the list as it is now. */
  from: number;
  /** The place the row would end up at if dropped now. */
  to: number;
  pointerId: number;
  /** The pointer's last known height on the screen. */
  clientY: number;
  /** The middle of each row, measured from the top of the list's whole content. */
  middles: readonly number[];
  /** The screen frame waiting to scroll the list, if any. */
  frame: number | null;
  /** Stops listening for this drag. */
  stop: () => void;
}

/**
 * Keeps track of a drag in the list `listRef` points at. Each child of the list must be one
 * row, and `keys` must name the rows in the order they are drawn. Keep the same `keys` list
 * between renders until the rows change (see `useMemo`).
 *
 * `onDrop` is called once, with the row's key and its new place, and only when the row landed
 * in a new place.
 */
export function useColumnDrag(
  listRef: RefObject<HTMLElement | null>,
  keys: readonly string[],
  onDrop: (key: string, to: number) => void,
): ColumnDrag {
  const [held, setHeld] = useState<Pick<ColumnDrag, "key" | "slot">>(IDLE);
  const session = useRef<DragSession | null>(null);

  // Read through a ref, so `start` can stay the same function between renders.
  const latest = useRef({ keys, onDrop });
  useEarlyEffect(() => {
    latest.current = { keys, onDrop };
  });

  const end = useCallback(() => {
    session.current?.stop();
    session.current = null;
    setHeld(IDLE);
  }, []);

  // A picker that closes mid-drag must not leave listeners behind.
  useEffect(() => () => session.current?.stop(), []);

  /** Works out where a drop would land now, and scrolls the list when the pointer is at an edge. */
  const follow = useCallback(() => {
    const drag = session.current;
    const list = listRef.current;
    if (drag === null || list === null) return;
    // One read of the list's place per pointer move. The rows were measured already, so no
    // row is measured here.
    const box = list.getBoundingClientRect();
    const slot = slotAt(drag.middles, drag.clientY - box.top + list.scrollTop);
    drag.to = placeFromSlot(drag.from, slot);
    const shown = drag.to === drag.from ? null : slot;
    // The pointer moves many times a second, so the state changes only when the slot does.
    setHeld((was) =>
      was.slot === shown ? was : { key: drag.key, slot: shown },
    );

    const direction = edgeDirection(drag.clientY, box);
    if (direction === 0 || drag.frame !== null) return;
    drag.frame = requestAnimationFrame(() => {
      drag.frame = null;
      const before = list.scrollTop;
      list.scrollTop += direction * SCROLL_STEP;
      // Stops once the list has reached its end. Otherwise it follows again, which keeps the
      // list scrolling for as long as the pointer rests at the edge.
      if (list.scrollTop !== before) follow();
    });
  }, [listRef]);

  // The app changed the list while a row was held, for example by taking a column away. A
  // place only means something in the list it was measured in, so the held row is found again
  // by its key and the rows are measured again.
  useEffect(() => {
    const drag = session.current;
    const list = listRef.current;
    if (drag === null || list === null) return;
    const from = keys.indexOf(drag.key);
    if (from === -1) {
      // The held column itself is gone.
      end();
      return;
    }
    drag.from = from;
    drag.middles = measureMiddles(list);
    follow();
  }, [keys, listRef, follow, end]);

  const start = useCallback<ColumnDrag["start"]>(
    (event, key) => {
      const list = listRef.current;
      const from = latest.current.keys.indexOf(key);
      // Only the main mouse button, a finger or a pen tip starts a drag.
      if (
        list === null ||
        from === -1 ||
        event.button !== 0 ||
        session.current !== null
      ) {
        return;
      }
      const { pointerId } = event;

      const onMove = (moved: PointerEvent) => {
        const drag = session.current;
        if (drag === null || moved.pointerId !== pointerId) return;
        drag.clientY = moved.clientY;
        follow();
      };
      const onUp = (released: PointerEvent) => {
        const drag = session.current;
        if (drag === null || released.pointerId !== pointerId) return;
        end();
        if (drag.to !== drag.from) latest.current.onDrop(drag.key, drag.to);
      };
      // The browser took the pointer away, for example to scroll the page.
      const onCancel = (cancelled: PointerEvent) => {
        if (cancelled.pointerId === pointerId) end();
      };
      const onKeyDown = (pressed: KeyboardEvent) => {
        if (pressed.key !== "Escape") return;
        // Escape gives up the drag only. It must not also close the picker.
        pressed.stopPropagation();
        end();
      };

      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onCancel);
      // `true` lets this hear the key before the picker does.
      document.addEventListener("keydown", onKeyDown, true);
      // A mouse wheel can scroll the list under a pointer that stays still.
      list.addEventListener("scroll", follow);
      session.current = {
        key,
        from,
        to: from,
        pointerId,
        clientY: event.clientY,
        // Every row is measured once, here, and not again while the list stays as it is.
        middles: measureMiddles(list),
        frame: null,
        stop: () => {
          document.removeEventListener("pointermove", onMove);
          document.removeEventListener("pointerup", onUp);
          document.removeEventListener("pointercancel", onCancel);
          document.removeEventListener("keydown", onKeyDown, true);
          list.removeEventListener("scroll", follow);
          const frame = session.current?.frame;
          if (frame != null) cancelAnimationFrame(frame);
        },
      };
      setHeld({ key, slot: null });
    },
    [listRef, follow, end],
  );

  return { key: held.key, slot: held.slot, start };
}

const IDLE: Pick<ColumnDrag, "key" | "slot"> = { key: null, slot: null };

/** The middle of each row of the list, measured from the top of the list's whole content. */
function measureMiddles(list: HTMLElement): number[] {
  const box = list.getBoundingClientRect();
  return Array.from(list.children, (row) => {
    const rowBox = row.getBoundingClientRect();
    return rowBox.top + rowBox.height / 2 - box.top + list.scrollTop;
  });
}

/**
 * The slot a pointer at height `y` is over: the number of rows whose middle is above it. So a
 * drop lands before a row while the pointer is over its top half, and after it otherwise.
 */
export function slotAt(middles: readonly number[], y: number): number {
  let slot = 0;
  while (slot < middles.length && (middles[slot] as number) < y) slot++;
  return slot;
}

/**
 * The place a row ends up at when it is dropped into `slot`. Taking the row out first moves
 * every later row up one, so a slot below the row counts one less.
 */
export function placeFromSlot(from: number, slot: number): number {
  return slot > from ? slot - 1 : slot;
}

/** Which way to scroll the list: -1 near its top edge, 1 near its bottom edge, else 0. */
function edgeDirection(clientY: number, box: DOMRect): -1 | 0 | 1 {
  if (clientY < box.top + SCROLL_EDGE) return -1;
  if (clientY > box.bottom - SCROLL_EDGE) return 1;
  return 0;
}

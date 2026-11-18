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
  /** The pointer's last known height on the screen. */
  clientY: number;
  /** The middle of each row, measured from the top of the list's whole content. */
  middles: readonly number[];
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
   * Called once per drag, with the row's key and its new place, and only when the row landed
   * in a new place.
   */
  onDrop: (key: string, to: number) => void;
}

/** Keeps track of a drag in a list of rows. */
export function useColumnDrag({
  listRef,
  keys,
  active,
  onDrop,
}: ColumnDragOptions): ColumnDrag {
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

  // The list goes away when the picker closes, and the drag goes with it. Otherwise letting go
  // of the pointer after the list has closed would still move the column.
  useEffect(() => {
    if (!active) end();
  }, [active, end]);

  // A picker that leaves the page mid-drag must not leave listeners behind.
  useEffect(() => () => session.current?.stop(), []);

  /** Works out where a drop would land now, and scrolls the list when the pointer is at an edge. */
  const follow = useCallback(() => {
    const drag = session.current;
    const list = listRef.current;
    if (drag === null || list === null) return;
    // One read of the list's place per pointer move. The rows were measured already, so no
    // row is measured here. They are measured again only when one of them changes size.
    const box = list.getBoundingClientRect();
    const slot = slotAt(drag.middles, drag.clientY - box.top + list.scrollTop);
    const shown = placeFromSlot(drag.from, slot) === drag.from ? null : slot;
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
        drag.clientY = moved.clientY;
        follow();
      };
      const onUp = (released: PointerEvent) => {
        const drag = session.current;
        if (drag === null || released.pointerId !== pointerId) return;
        end();
        // A drop means nothing once the list it was aimed at has left the page.
        if (listRef.current !== list) return;
        // The place is worked out here, from where the pointer was let go and the list as it
        // is now. The last move heard may be out of date: a pointer can travel and let go
        // with no move reported in between, and the list can change under a still pointer.
        const from = latest.current.keys.indexOf(drag.key);
        if (from === -1) return;
        const y =
          released.clientY - list.getBoundingClientRect().top + list.scrollTop;
        const to = placeFromSlot(from, slotAt(measureMiddles(list), y));
        if (to !== from) latest.current.onDrop(drag.key, to);
      };
      // The browser took the pointer away, for example to scroll the page, or took the
      // capture away without a release.
      const onCancel = (cancelled: PointerEvent) => {
        if (cancelled.pointerId === pointerId) end();
      };
      const onKeyDown = (pressed: KeyboardEvent) => {
        if (pressed.key !== "Escape") return;
        // Escape gives up the drag only. It must not also close the picker.
        pressed.stopPropagation();
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
            drag.middles = measureMiddles(list);
            follow();
          })
        : null;
      const watchRows = () => {
        if (sizeWatcher === null) return;
        sizeWatcher.disconnect();
        for (const row of Array.from(list.children)) sizeWatcher.observe(row);
      };
      session.current = {
        key,
        from,
        clientY: event.clientY,
        // Every row is measured once, here, and not again while the list stays as it is.
        middles: measureMiddles(list),
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
          sizeWatcher?.disconnect();
          const frame = session.current?.frame;
          if (frame != null) cancelAnimationFrame(frame);
        },
      };
      watchRows();
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

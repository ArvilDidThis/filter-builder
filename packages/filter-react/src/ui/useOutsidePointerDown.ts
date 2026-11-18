import { type RefObject, useEffect, useRef } from "react";
import { useEarlyEffect } from "../useEarlyEffect";

/**
 * Calls `onOutside` when a person clicks or taps anywhere outside `rootRef` while `active` is
 * true. A popover uses it to close.
 */
export function useOutsidePointerDown(
  rootRef: RefObject<HTMLElement | null>,
  active: boolean,
  onOutside: () => void,
): void {
  // Read through a ref, so a new function on every render does not re-attach the listener.
  const latest = useRef(onOutside);
  useEarlyEffect(() => {
    latest.current = onOutside;
  });

  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) latest.current();
    };
    // The picker's own document, which is not the global one when the picker is drawn inside
    // a frame (a page within the page). A press there is never heard on the outer page.
    const page = rootRef.current?.ownerDocument ?? document;
    page.addEventListener("pointerdown", onPointerDown);
    return () => page.removeEventListener("pointerdown", onPointerDown);
  }, [active, rootRef]);
}

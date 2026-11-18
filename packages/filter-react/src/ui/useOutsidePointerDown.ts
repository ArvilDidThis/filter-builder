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
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [active, rootRef]);
}

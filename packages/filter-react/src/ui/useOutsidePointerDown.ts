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
      const root = rootRef.current;
      // Inside a shadow tree (a part of the page that hides its insides from the rest), the
      // press is reported as a press on the tree's host, which the root does not contain. The
      // event's path still lists every element the press went through.
      const isInside =
        root !== null &&
        (root.contains(event.target as Node) ||
          event.composedPath().includes(root));
      if (!isInside) latest.current();
    };
    // The picker's own document, which is not the global one when the picker is drawn inside
    // a frame (a page within the page). A press there is never heard on the outer page.
    const page = rootRef.current?.ownerDocument ?? document;
    // `true` hears the press on its way down to the pressed element, before any handler of
    // the app. A handler that stops the press from spreading would otherwise hide it from
    // here, and the popover would stay open.
    page.addEventListener("pointerdown", onPointerDown, true);
    return () => page.removeEventListener("pointerdown", onPointerDown, true);
  }, [active, rootRef]);
}

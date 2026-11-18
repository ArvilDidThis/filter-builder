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
    const startRoot = rootRef.current;
    // The picker's own document, which is not the global one when the picker is drawn inside
    // a frame (a page within the page). A press there is never heard on the outer page.
    const page = startRoot?.ownerDocument ?? document;
    // A shadow tree is a part of the page that hides its insides from the rest. A listener
    // outside it is told that a press inside it was a press on the tree's host. A closed
    // tree hides the event's path as well. So every shadow tree around the root gets a
    // listener of its own, which is told of the real element.
    const heardOn: (Document | ShadowRoot)[] = [page];
    const hosts = new Set<EventTarget>();
    for (
      let tree = startRoot?.getRootNode();
      isShadowTree(tree);
      tree = tree.host.getRootNode()
    ) {
      heardOn.push(tree);
      hosts.add(tree.host);
    }

    const onPointerDown = (event: Event) => {
      // The press is in a shadow tree around the root. Only the listener on that tree can
      // tell which side of the root it is on, and it hears this press next. A press on the
      // bare host, such as on its padding, looks the same from here and is left alone too.
      if (event.target !== null && hosts.has(event.target)) return;
      // Read now, not when the popover opened: the root may be a new element since then.
      const root = rootRef.current;
      // An open shadow tree inside the root reports a press on its host, which the root
      // contains. The event's path covers a root that is itself inside a tree.
      const isInside =
        root !== null &&
        (root.contains(event.target as Node) ||
          event.composedPath().includes(root));
      if (!isInside) latest.current();
    };
    // `true` hears the press on its way down to the pressed element, before any handler of
    // the app. A handler that stops the press from spreading would otherwise hide it from
    // here, and the popover would stay open.
    for (const place of heardOn) {
      place.addEventListener("pointerdown", onPointerDown, true);
    }
    return () => {
      for (const place of heardOn) {
        place.removeEventListener("pointerdown", onPointerDown, true);
      }
    };
  }, [active, rootRef]);
}

/**
 * Whether a node is the top of a shadow tree. It is told by its shape and not by
 * `instanceof`, because a tree in a frame is built from the frame's own classes.
 */
function isShadowTree(node: Node | undefined): node is ShadowRoot {
  return node !== undefined && node.nodeType === 11 && "host" in node;
}

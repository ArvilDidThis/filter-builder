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
    /** Each shadow tree around the root, by its host. */
    const treeOfHost = new Map<EventTarget, ShadowRoot>();
    for (
      let tree = startRoot?.getRootNode();
      isShadowTree(tree);
      tree = tree.host.getRootNode()
    ) {
      heardOn.push(tree);
      treeOfHost.set(tree.host, tree);
    }
    /** The last press that each place's own listener heard. */
    const heardIn = new Map<EventTarget, Event>();
    /** The last press that passed a closed tree's host on its way down. */
    let passedHost: Event | null = null;

    const onPointerDown = (event: Event) => {
      if (event.currentTarget !== null) heardIn.set(event.currentTarget, event);
      const tree =
        event.target === null ? undefined : treeOfHost.get(event.target);
      if (tree !== undefined) {
        // The press is told as one on the host of a shadow tree around the root. It is
        // either inside that tree, or on the bare host, such as on its padding. A press
        // inside is left to the tree's own listener, which hears it next and can tell which
        // side of the root it is on. A press on the bare host is outside the root, and no
        // listener inside the tree hears it.
        // An open tree shows the event's whole path, which starts at the host only for a
        // press on the host itself. A closed tree is settled by `afterHost` below.
        const isOnHost = event.composedPath()[0] === event.target;
        if (tree.mode === "open" && isOnHost) latest.current();
        return;
      }
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

    // A closed tree hides whether a press was on its bare host or inside it. The only sign
    // is whether the tree's own listener heard the press. So the host listens too, for the
    // press on its way back up, after every listener inside the tree has had its turn.
    const beforeHost = (event: Event) => {
      passedHost = event;
    };
    const afterHost = (event: Event) => {
      const host = event.currentTarget;
      const tree = host === null ? undefined : treeOfHost.get(host);
      // A press on something the app put inside the host is told with that element.
      if (tree === undefined || event.target !== host) return;
      // Some older browsers call a host's listeners in the order they were added, not the
      // way-down ones first. This one would then run before the tree's listener, and could
      // not tell the two kinds of press apart. `beforeHost` is added after it, so it has
      // run by now only in a browser that keeps the proper order. Without that proof the
      // press is left alone, and the popover stays open.
      if (passedHost !== event) return;
      if (heardIn.get(tree) !== event) latest.current();
    };
    const closedHosts = [...treeOfHost]
      .filter(([, tree]) => tree.mode === "closed")
      .map(([host]) => host);

    // `true` hears the press on its way down to the pressed element, before any handler of
    // the app. A handler that stops the press from spreading would otherwise hide it from
    // here, and the popover would stay open.
    for (const place of heardOn) {
      place.addEventListener("pointerdown", onPointerDown, true);
    }
    for (const host of closedHosts) {
      // In this order: see `afterHost`.
      host.addEventListener("pointerdown", afterHost);
      host.addEventListener("pointerdown", beforeHost, true);
    }
    return () => {
      for (const place of heardOn) {
        place.removeEventListener("pointerdown", onPointerDown, true);
      }
      for (const host of closedHosts) {
        host.removeEventListener("pointerdown", afterHost);
        host.removeEventListener("pointerdown", beforeHost, true);
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

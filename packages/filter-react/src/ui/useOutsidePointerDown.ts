import { type RefObject, useEffect, useRef } from "react";
import { useEarlyEffect } from "../useEarlyEffect";
import { isShadowTree } from "./shadowTrees";

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
    // outside it is told that a press inside it was a press on the tree's host. The event's
    // path still lists what is inside an open tree. A closed tree hides that as well. So
    // every shadow tree around the root gets a listener of its own, which sees further in.
    /** The shadow trees around the root, from the root's own tree outwards. */
    const trees: ShadowRoot[] = [];
    /** Each of those trees, by its host. */
    const treeOfHost = new Map<EventTarget, ShadowRoot>();
    for (
      let tree = startRoot?.getRootNode();
      isShadowTree(tree);
      tree = tree.host.getRootNode()
    ) {
      trees.push(tree);
      treeOfHost.set(tree.host, tree);
    }
    const heardOn: (Document | ShadowRoot)[] = [page, ...trees];
    // How far in each place's listener can see, on the way to the root: the host of the
    // nearest closed tree between that place and the root. A place with no entry has only
    // open trees between, or none, and sees the root itself.
    const closedHostSeenFrom = new Map<EventTarget, Element>();
    let nearestClosedHost: Element | undefined;
    for (const tree of trees) {
      // The trees are met from the inside out, so this is the nearest one found so far.
      if (nearestClosedHost) closedHostSeenFrom.set(tree, nearestClosedHost);
      if (tree.mode === "closed") nearestClosedHost = tree.host;
    }
    if (nearestClosedHost) closedHostSeenFrom.set(page, nearestClosedHost);

    /** The last press that each place's own listener heard. */
    const heardIn = new Map<EventTarget, Event>();
    /** The last press that passed a closed tree's host on its way down. */
    let passedHost: Event | null = null;
    /** The last press that a listener could tell was inside or outside the root. */
    let settled: Event | null = null;

    const onPointerDown = (event: Event) => {
      const place = event.currentTarget;
      if (place === null) return;
      heardIn.set(place, event);
      // A listener further out has told this press apart already. A press is heard in
      // every place it passes, and must close the popover once.
      if (settled === event) return;
      const path = event.composedPath();
      const closedHost = closedHostSeenFrom.get(place);
      if (closedHost !== undefined) {
        // A closed tree hides the root from here. A press that went into that tree is told
        // as one on its host, and may be on either side of the root or on the bare host,
        // such as on its padding. A press on an element the app keeps in the host, and
        // shows through a slot (a gap in the tree, which may be in a row of the picker), is
        // told with that element, and the path hides which slot shows it. Both have the
        // host in their path. They are left to the listeners further in, which hear them
        // next, and to `afterHost` below.
        if (path.includes(closedHost)) return;
        // Any other press did not go into the tree that holds the root.
        settled = event;
        latest.current();
        return;
      }
      // The root is in sight from here: every tree between is open, and shows its insides
      // in the event's path. So the press is told apart here, and not left to a listener
      // further in. An app may stop the press on its way down, and that listener would
      // never hear it.
      settled = event;
      // Read now, not when the popover opened: the root may be a new element since then.
      const root = rootRef.current;
      // The path covers a press told as one on a tree's host: on the host of an open tree
      // inside the root, or of an open tree that the root is inside.
      const isInside =
        root !== null &&
        (root.contains(event.target as Node) || path.includes(root));
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

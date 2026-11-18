import { shadowTreesAround } from "./shadowTrees";

// Hearing the scroll of anything around an element: the page itself, or a scrolling box that
// the element is drawn in. Such a scroll moves the element on the screen without drawing
// anything again.

/**
 * Calls `listener` when anything around `element` scrolls: the page, or a box the element is
 * drawn in. It also hears boxes that are not around the element, and the element's own
 * scroll, so the listener checks the event's target where that matters. Gives back how to
 * stop listening.
 *
 * A scroll is reported many times a second. The listener decides how often to act on it.
 */
export function listenForScrollAround(
  element: Element,
  listener: (event: Event) => void,
): () => void {
  // A box's scroll does not spread up to the page as other events do. Heard in the capture
  // phase (on the event's way down to its target), the scroll of any box is heard on the
  // page. A scroll inside a shadow tree does not leave that tree at all, even on its way
  // down, so each tree the element is drawn in is listened to as well.
  const heardOn: (Document | ShadowRoot)[] = [
    element.ownerDocument,
    ...shadowTreesAround(element),
  ];
  for (const place of heardOn) {
    place.addEventListener("scroll", listener, true);
  }
  return () => {
    for (const place of heardOn) {
      place.removeEventListener("scroll", listener, true);
    }
  };
}

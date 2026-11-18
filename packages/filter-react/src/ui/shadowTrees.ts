// Shadow trees: parts of the page that hide their insides from the rest, as a web component
// has. An event inside one is told differently, or not at all, to a listener outside it, so
// the hooks that listen around a popover need to know which trees it is drawn in.

/**
 * Whether a node is the top of a shadow tree (a part of the page that hides its insides from
 * the rest). It is told by its shape and not by `instanceof`, because a tree in a frame (a
 * page within the page) is built from the frame's own classes.
 */
export function isShadowTree(
  node: Node | null | undefined,
): node is ShadowRoot {
  return node != null && node.nodeType === 11 && "host" in node;
}

/**
 * The shadow trees that `element` is drawn in, from the nearest outwards. A tree counts when
 * the element is inside it, and also when the element is shown through one of its slots (a
 * gap in a tree that shows an element the page keeps outside it).
 *
 * A closed tree does not tell which of its slots shows an element. So a closed tree that
 * only shows the element through a slot is not found.
 */
export function shadowTreesAround(element: Element): ShadowRoot[] {
  const trees: ShadowRoot[] = [];
  let node: Node | null = element;
  while (node !== null) {
    if (isShadowTree(node)) {
      if (!trees.includes(node)) trees.push(node);
      node = node.host;
      continue;
    }
    // The way up as the page is drawn: through the slot that shows this node, if any, and
    // then through that slot's own tree.
    const slot: Node | null | undefined = (node as Partial<Element>)
      .assignedSlot;
    node = slot ?? node.parentNode;
  }
  return trees;
}

/**
 * Whether `node` is drawn inside `root`: it is inside it on the page, or it is shown through
 * a slot inside it. An app's own row may hold a slot, and the element it shows is kept
 * outside the tree, as a child of the tree's host. On the page that element is not inside
 * the root, though a person sees it there.
 *
 * It asks each slot what it shows, which a slot tells even in a closed tree.
 */
export function isDrawnInside(root: Element, node: Node): boolean {
  if (root.contains(node)) return true;
  for (const slot of root.querySelectorAll("slot")) {
    // Flattened: a slot may show another slot, and then shows what that one shows.
    const shown = slot.assignedElements({ flatten: true });
    if (shown.some((element) => element.contains(node))) return true;
  }
  return false;
}

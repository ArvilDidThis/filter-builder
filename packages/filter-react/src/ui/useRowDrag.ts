import {
  type FilterDefinition,
  type FilterPath,
  isSamePath,
} from "@arvilmena/filter-core";
import { type DragEvent, useState } from "react";
import type { FilterBuilderActions } from "../useFilterBuilder";

// Dragging a row or a group to a new place with the mouse. It uses the browser's own drag and
// drop, so it adds no package. Most touch screens do not support that, and a keyboard cannot
// use it at all, which is why every move also has a button.

/** A place a dragged item can land: in the group at `groupPath`, before the item at `index`. */
export interface DropSlot {
  groupPath: FilterPath;
  /** Equal to the number of rows in the group for "at the end". */
  index: number;
}

/** The attributes that make an element a place to drop. Spread them onto the element. */
export interface DropTargetProps {
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}

/** What the builder's rows need to be dragged and dropped. */
export interface RowDrag {
  /** Whether the item at `path` is the one being dragged. */
  isDragging: (path: FilterPath) => boolean;
  /** Whether a drop would land in this slot. The builder draws a line there. */
  isDropSlot: (groupPath: FilterPath, index: number) => boolean;
  /** Put on the drag handle of the item at `path`. */
  handleProps: (path: FilterPath) => {
    draggable: true;
    onDragStart: (event: DragEvent<HTMLElement>) => void;
    onDragEnd: () => void;
  };
  /**
   * For an item's own element: a drop lands before the item when the pointer is over its top
   * half, and after it when over its bottom half.
   */
  dropAroundProps: (path: FilterPath) => DropTargetProps;
  /** For a group's footer: a drop lands at the end of that group. */
  dropAtEndProps: (groupPath: FilterPath, rowCount: number) => DropTargetProps;
}

const sameSlot = (a: DropSlot | null, b: DropSlot): boolean =>
  a !== null && a.index === b.index && isSamePath(a.groupPath, b.groupPath);

/**
 * Keeps track of a drag: which item is held, and where it would land.
 *
 * A slot is offered only when dropping there would change the filter. So a group cannot be
 * dropped into itself, nothing lands deeper than the depth limit, and an item's own place is
 * not offered back to it.
 */
export function useRowDrag(
  actions: Pick<FilterBuilderActions, "move" | "canMove">,
  value: FilterDefinition,
): RowDrag {
  // The item held, with the filter it was picked up from. A path only means something in the
  // filter it was read from. So if the app changes the filter during a drag, the drag is over:
  // the same path could by then lead to another row.
  const [held, setHeld] = useState<{
    path: FilterPath;
    value: FilterDefinition;
  } | null>(null);
  const [slot, setSlot] = useState<DropSlot | null>(null);
  const from = held !== null && held.value === value ? held.path : null;

  const end = () => {
    setHeld(null);
    setSlot(null);
  };

  /** Offers a slot while the pointer is over it, and tells the browser a drop is allowed. */
  const over = (event: DragEvent<HTMLElement>, next: DropSlot) => {
    // Something else is being dragged over the builder, such as a file. Leave it alone.
    if (from === null) return;
    if (!actions.canMove(from, next.groupPath, next.index)) {
      setSlot(null);
      return;
    }
    // Without this the browser refuses the drop.
    event.preventDefault();
    // This event fires many times a second, so the state changes only when the slot does.
    setSlot((was) => (sameSlot(was, next) ? was : next));
  };

  const drop = (event: DragEvent<HTMLElement>) => {
    if (from === null || slot === null) return;
    event.preventDefault();
    actions.move(from, slot.groupPath, slot.index);
    end();
  };

  return {
    isDragging: (path) => from !== null && isSamePath(from, path),
    isDropSlot: (groupPath, index) =>
      from !== null && sameSlot(slot, { groupPath, index }),
    handleProps: (path) => ({
      draggable: true,
      onDragStart: (event) => {
        // `dataTransfer` is missing only in a test's made-up event.
        const transfer = event.dataTransfer as DataTransfer | null;
        if (transfer) {
          transfer.effectAllowed = "move";
          // Firefox starts a drag only when it carries some data.
          transfer.setData("text/plain", "");
          // Show the whole row or group under the pointer, not only the small handle.
          const item = event.currentTarget.closest("[data-fb-item]");
          if (item) transfer.setDragImage?.(item, 0, 0);
        }
        setHeld({ path, value });
      },
      onDragEnd: end,
    }),
    dropAroundProps: (path) => ({
      onDragOver: (event) => {
        const box = event.currentTarget.getBoundingClientRect();
        const isLowerHalf = event.clientY > box.top + box.height / 2;
        const index = path[path.length - 1] as number;
        over(event, {
          groupPath: path.slice(0, -1),
          index: isLowerHalf ? index + 1 : index,
        });
      },
      onDrop: drop,
    }),
    dropAtEndProps: (groupPath, rowCount) => ({
      onDragOver: (event) => over(event, { groupPath, index: rowCount }),
      onDrop: drop,
    }),
  };
}

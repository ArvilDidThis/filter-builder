// Where the rows of the column picker's list stand. In the popover the rows stand one below
// the other. In the dialog they are laid out in grid columns, read down each one and then
// across. Both are measured the same way here: a plain list is a grid of one column.
//
// Every place is measured from the top left corner of the list's whole content, so it stays
// true while the list scrolls.

/** One grid column of a list: a run of rows that stand one below the other. */
export interface GridColumn {
  /** The place in the list of the column's first row, from 0. */
  first: number;
  /** The column's left and right edges. */
  left: number;
  right: number;
  /** The top edge of each row of the column, from the top row down. */
  tops: number[];
  /** The middle of each row of the column, from the top row down. */
  middles: number[];
}

/** How far apart two rows' left edges may be for the rows to count as one grid column. */
const SAME_EDGE = 1;

/**
 * The grid columns of a list whose every child is one row. It reads the place of every row
 * once, so call it when the rows change, not on each pointer move.
 */
export function measureGrid(list: HTMLElement): GridColumn[] {
  const box = list.getBoundingClientRect();
  const grid: GridColumn[] = [];
  let column: GridColumn | undefined;
  Array.from(list.children).forEach((row, index) => {
    const rowBox = row.getBoundingClientRect();
    const left = rowBox.left - box.left + list.scrollLeft;
    const top = rowBox.top - box.top + list.scrollTop;
    // A row that starts further left or right than the one before starts a new grid column.
    if (column === undefined || Math.abs(left - column.left) > SAME_EDGE) {
      column = {
        first: index,
        left,
        right: left + rowBox.width,
        tops: [],
        middles: [],
      };
      grid.push(column);
    }
    column.tops.push(top);
    column.middles.push(top + rowBox.height / 2);
  });
  return grid;
}

/** Where a drop would land, as the pointer's place says. */
export interface GridSlot {
  /**
   * The gap the drop lands in: before the row at this place, or after the last row when it
   * equals the number of rows.
   */
  slot: number;
  /**
   * Whether the pointer is below every row of its grid column. The gap is then the same one
   * as before the next grid column's first row, but the pointer is at the foot of this one,
   * so the drop line belongs below the row before the gap.
   */
  after: boolean;
}

/**
 * The gap a pointer at `x`, `y` is over. The pointer's grid column is the one it is in, or
 * the nearest one. In that column, a drop lands before a row while the pointer is over its
 * top half, and after it otherwise.
 */
export function slotAtPoint(
  grid: readonly GridColumn[],
  x: number,
  y: number,
): GridSlot {
  const column = columnAt(grid, x);
  if (column === undefined) return { slot: 0, after: false };
  const rowsAbove = slotAt(column.middles, y);
  return {
    slot: column.first + rowsAbove,
    after: rowsAbove === column.middles.length,
  };
}

/**
 * The slot a pointer at height `y` is over in one run of rows: the number of rows whose
 * middle is above it. So a drop lands before a row while the pointer is over its top half,
 * and after it otherwise.
 */
export function slotAt(middles: readonly number[], y: number): number {
  let slot = 0;
  while (slot < middles.length && (middles[slot] as number) < y) slot++;
  return slot;
}

/** The grid column that `x` is in, or the nearest one. `undefined` for a list with no rows. */
function columnAt(
  grid: readonly GridColumn[],
  x: number,
): GridColumn | undefined {
  // The first column to begin with, so that a list measured with no widths, as in a
  // simulated page, still has a column to drop into.
  let nearest = grid[0];
  let nearestGap = Number.POSITIVE_INFINITY;
  for (const column of grid) {
    // How far `x` is outside the column, or 0 when it is inside.
    const gap = Math.max(column.left - x, x - column.right, 0);
    if (gap < nearestGap) {
      nearest = column;
      nearestGap = gap;
    }
  }
  return nearest;
}

/**
 * The place of the row that stands beside the row at `index`, one grid column to the left
 * (`direction` -1) or to the right (1): the row at the same height, or the column's last row
 * when the column is shorter.
 *
 * It is `index` itself when there is no grid column on that side, and `undefined` when the
 * list has one grid column only, so the keys for left and right mean nothing in it.
 */
export function placeBeside(
  grid: readonly GridColumn[],
  index: number,
  direction: -1 | 1,
): number | undefined {
  if (grid.length < 2) return undefined;
  const at = grid.findIndex(
    (column) =>
      index >= column.first && index < column.first + column.tops.length,
  );
  const from = grid[at];
  const beside = grid[at + direction];
  if (from === undefined || beside === undefined) return index;
  const top = from.tops[index - from.first] as number;
  let nearest = 0;
  beside.tops.forEach((otherTop, row) => {
    const isNearer =
      Math.abs(otherTop - top) <
      Math.abs((beside.tops[nearest] as number) - top);
    if (isNearer) nearest = row;
  });
  return beside.first + nearest;
}

import type { ColumnDefinition, ColumnSettings } from "@arvilmena/filter-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useColumnSettings } from "../useColumnSettings";
import { ColumnPicker, type ColumnPickerProps } from "./ColumnPicker";
import {
  type GridColumn,
  measureGrid,
  placeBeside,
  slotAtPoint,
} from "./columnGrid";
import { groupPlaceFromSlot } from "./useColumnDrag";

// The picker's dialog view and its group drag, on the simulated page. That page lays nothing
// out, so the tests give the rows their places. The real-browser tests check the real layout:
// `browser/picker-dialog.test.tsx` and `browser/picker-group-drag.test.tsx`.

const COLUMNS: readonly ColumnDefinition[] = [
  { key: "symbol", label: "Symbol", pinned: "start", hideable: false },
  { key: "company", label: "Company" },
  { key: "industry", label: "Industry" },
  { key: "cap", label: "Cap" },
  { key: "return", label: "Return" },
  { key: "age", label: "Age" },
  { key: "release", label: "Release" },
  { key: "beta", label: "Beta" },
];

/** Counts the changes the picker asks for. */
const changed = vi.fn();

/** An app around the picker, with a line of text that follows the order. */
function App({ extra = {} }: { extra?: Partial<ColumnPickerProps> }) {
  const state = useColumnSettings({ columns: COLUMNS, onChange: changed });
  return (
    <>
      <ColumnPicker state={state} {...extra} />
      <p data-testid="order">{state.settings.order.join(" ")}</p>
    </>
  );
}

/** An app that owns the settings, and applies a change only when "Apply" is pressed. */
function OwningApp() {
  const [value, setValue] = useState<ColumnSettings | null>(null);
  const [waiting, setWaiting] = useState<ColumnSettings | null>(null);
  const state = useColumnSettings({
    columns: COLUMNS,
    value,
    onChange: setWaiting,
  });
  return (
    <>
      <ColumnPicker state={state} />
      <button onClick={() => setValue(waiting)} type="button">
        Apply
      </button>
      <p data-testid="order">{state.settings.order.join(" ")}</p>
    </>
  );
}

/** Draws the app and opens its picker. */
function renderPicker(extra: Partial<ColumnPickerProps> = {}) {
  changed.mockClear();
  const rendered = render(<App extra={extra} />);
  fireEvent.click(trigger());
  return rendered;
}

const trigger = () => screen.getByRole("button", { name: /^Columns/ });
const order = (): string => screen.getByTestId("order").textContent ?? "";
const rows = (): HTMLElement[] => screen.getAllByRole("listitem");
const handle = (label: string) =>
  screen.getByRole("button", { name: `Move ${label}` });
const checkbox = (label: string) =>
  screen.getByRole<HTMLInputElement>("checkbox", { name: label });
const selectBox = (label: string) =>
  screen.getByRole<HTMLInputElement>("checkbox", {
    name: `Select ${label} to move`,
  });
const groupDrag = () => screen.getByRole("button", { name: "Group drag" });
const dialogView = () => screen.getByRole("button", { name: "Dialog view" });
const announced = (): string =>
  document.querySelector("[aria-live]")?.textContent ?? "";
/** The labels of the selected rows, in order. */
const selectedRows = (): string[] =>
  rows()
    .filter((row) => row.hasAttribute("data-selected"))
    .map((row) => row.querySelector("label")?.textContent ?? "");

/** Turns group drag on and selects the rows named. */
function select(...labels: string[]) {
  fireEvent.click(groupDrag());
  for (const label of labels) fireEvent.click(selectBox(label));
}

/** How tall a row is laid out, and how wide a grid column, in pixels. */
const ROW = 30;
const WIDE = 200;

/**
 * Lays the open list out in grid columns of `perColumn` rows, as the dialog does. The first
 * row starts at the list's top left corner.
 */
function layOutGrid(perColumn: number) {
  const place = (element: Element, left: number, top: number) => {
    element.getBoundingClientRect = () =>
      ({
        left,
        top,
        width: WIDE,
        height: ROW,
        right: left + WIDE,
        bottom: top + ROW,
      }) as DOMRect;
  };
  screen.getByRole("list").getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 1000, bottom: 1000 }) as DOMRect;
  rows().forEach((row, index) => {
    place(row, Math.floor(index / perColumn) * WIDE, (index % perColumn) * ROW);
  });
}

/** A pointer at a place on the screen. */
const pointer = (clientX: number, clientY: number) => ({
  button: 0,
  pointerId: 1,
  clientX,
  clientY,
});

afterEach(cleanup);

describe("ColumnPicker group drag", () => {
  it("should turn the show and hide boxes off, and give each movable row a box to select it", () => {
    renderPicker();
    expect(groupDrag().getAttribute("aria-pressed")).toBe("false");
    expect(checkbox("Company").disabled).toBe(false);
    fireEvent.click(groupDrag());
    expect(groupDrag().getAttribute("aria-pressed")).toBe("true");
    // Each box still says whether its column is shown, under the column's own name.
    expect(checkbox("Company").disabled).toBe(true);
    expect(checkbox("Company").checked).toBe(true);
    expect(selectBox("Company").checked).toBe(false);
    // A pinned column cannot be selected.
    expect(
      screen.queryByRole("checkbox", { name: "Select Symbol to move" }),
    ).toBeNull();
    // A press on a box that is turned off changes nothing.
    fireEvent.click(checkbox("Company"));
    expect(changed).not.toHaveBeenCalled();
  });

  it("should select a row by a click on its name", () => {
    renderPicker();
    fireEvent.click(groupDrag());
    fireEvent.click(screen.getByText("Cap"));
    expect(selectBox("Cap").checked).toBe(true);
    expect(selectedRows()).toEqual(["Cap"]);
    fireEvent.click(screen.getByText("Cap"));
    expect(selectedRows()).toEqual([]);
  });

  it("should move every selected row together when one of them is dragged", () => {
    renderPicker();
    select("Cap", "Return", "Beta");
    layOutGrid(100);
    // Held by "Return", and let go over the top half of "Company".
    fireEvent.pointerDown(handle("Return"), pointer(10, 4 * ROW + 15));
    // Every row of the group is drawn as dragged.
    expect(
      rows().filter((row) => row.hasAttribute("data-dragging")),
    ).toHaveLength(3);
    fireEvent.pointerMove(document, pointer(10, ROW + 5));
    expect(rows()[1]?.getAttribute("data-drop")).toBe("before");
    fireEvent.pointerUp(document, pointer(10, ROW + 5));
    expect(order()).toBe("symbol cap return beta company industry age release");
    expect(changed).toHaveBeenCalledTimes(1);
    expect(announced()).toBe("3 columns moved to positions 2 to 4 of 8.");
  });

  it("should empty the selection after a drop, and stay on", () => {
    renderPicker();
    select("Cap", "Beta");
    layOutGrid(100);
    fireEvent.pointerDown(handle("Cap"), pointer(10, 3 * ROW + 15));
    fireEvent.pointerUp(document, pointer(10, ROW + 5));
    expect(order()).toBe("symbol cap beta company industry return age release");
    expect(selectedRows()).toEqual([]);
    expect(groupDrag().getAttribute("aria-pressed")).toBe("true");
    expect(checkbox("Company").disabled).toBe(true);
  });

  it("should never take a group past a pinned column", () => {
    renderPicker();
    select("Return", "Beta");
    layOutGrid(100);
    fireEvent.pointerDown(handle("Beta"), pointer(10, 7 * ROW + 15));
    // Let go above the pinned first row.
    fireEvent.pointerUp(document, pointer(10, 2));
    expect(order()).toBe("symbol return beta company industry cap age release");
  });

  it("should show no drop line where a drop would leave the group as it stands", () => {
    renderPicker();
    select("Cap", "Return");
    layOutGrid(100);
    fireEvent.pointerDown(handle("Cap"), pointer(10, 3 * ROW + 15));
    // Between the two selected rows.
    fireEvent.pointerMove(document, pointer(10, 4 * ROW + 2));
    expect(rows().some((row) => row.hasAttribute("data-drop"))).toBe(false);
    fireEvent.pointerUp(document, pointer(10, 4 * ROW + 2));
    expect(changed).not.toHaveBeenCalled();
    // Nothing was dropped anywhere new, so the rows stay selected.
    expect(selectedRows()).toEqual(["Cap", "Return"]);
  });

  it("should move only the dragged row when that row is not selected", () => {
    renderPicker();
    select("Cap", "Return");
    layOutGrid(100);
    fireEvent.pointerDown(handle("Beta"), pointer(10, 7 * ROW + 15));
    fireEvent.pointerUp(document, pointer(10, ROW + 5));
    expect(order()).toBe("symbol beta company industry cap return age release");
    expect(announced()).toBe("Beta moved to position 2 of 8.");
    expect(selectedRows()).toEqual(["Cap", "Return"]);
  });

  it("should move the whole selection with the arrow keys, and keep it selected", () => {
    renderPicker();
    select("Cap", "Return");
    handle("Return").focus();
    fireEvent.keyDown(handle("Return"), { key: "ArrowUp" });
    expect(order()).toBe("symbol company cap return industry age release beta");
    expect(announced()).toBe("2 columns moved to positions 3 to 4 of 8.");
    expect(document.activeElement).toBe(handle("Return"));
    fireEvent.keyDown(handle("Return"), { key: "ArrowDown" });
    fireEvent.keyDown(handle("Return"), { key: "ArrowDown" });
    expect(order()).toBe("symbol company industry age cap return release beta");
    expect(selectedRows()).toEqual(["Cap", "Return"]);
  });

  it("should move the selection to either end with Home and End, short of a pinned column", () => {
    renderPicker();
    select("Industry", "Age");
    fireEvent.keyDown(handle("Age"), { key: "Home" });
    expect(order()).toBe("symbol industry age company cap return release beta");
    fireEvent.keyDown(handle("Age"), { key: "End" });
    expect(order()).toBe("symbol company cap return release beta industry age");
    expect(announced()).toBe("2 columns moved to positions 7 to 8 of 8.");
  });

  it("should bring rows that stand apart together on the first key press", () => {
    renderPicker();
    select("Company", "Beta");
    fireEvent.keyDown(handle("Company"), { key: "ArrowDown" });
    // The last of them cannot go further down, so the first joins it.
    expect(order()).toBe("symbol industry cap return age release company beta");
  });

  it("should move one row with the keys when that row is not selected", () => {
    renderPicker();
    select("Cap", "Return");
    fireEvent.keyDown(handle("Beta"), { key: "ArrowUp" });
    expect(order()).toBe("symbol company industry cap return age beta release");
  });

  it("should let the selection go when it is turned off", () => {
    renderPicker();
    select("Cap", "Return");
    fireEvent.click(groupDrag());
    expect(checkbox("Company").disabled).toBe(false);
    expect(screen.queryByRole("checkbox", { name: /^Select / })).toBeNull();
    fireEvent.click(groupDrag());
    expect(selectedRows()).toEqual([]);
  });

  it("should let the selection go when the picker closes, and stay on", () => {
    renderPicker();
    select("Cap");
    fireEvent.click(trigger());
    fireEvent.click(trigger());
    expect(groupDrag().getAttribute("aria-pressed")).toBe("true");
    expect(selectedRows()).toEqual([]);
  });

  it("should read out a group move only once the app has applied it", () => {
    render(<OwningApp />);
    fireEvent.click(trigger());
    select("Cap", "Return");
    fireEvent.keyDown(handle("Cap"), { key: "Home" });
    expect(announced()).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(order()).toBe("symbol cap return company industry age release beta");
    expect(announced()).toBe("2 columns moved to positions 2 to 3 of 8.");
  });

  it("should have no button with groupDrag turned off", () => {
    renderPicker({ groupDrag: false });
    expect(screen.queryByRole("button", { name: "Group drag" })).toBeNull();
  });

  it("should use the app's wording", () => {
    renderPicker({
      labels: {
        groupDrag: "Move several",
        select: (label) => `Pick ${label}`,
        movedGroup: (count, position) => `${count} moved to ${position}.`,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Move several" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pick Cap" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Pick Age" }));
    fireEvent.keyDown(handle("Age"), { key: "Home" });
    expect(announced()).toBe("2 moved to 2.");
  });

  it("should tell a row an app draws whether it is selected", () => {
    const seen = new Map<string, { grouping: boolean; selected: boolean }>();
    const renderRow: ColumnPickerProps["renderRow"] = (row) => {
      seen.set(row.column.key, {
        grouping: row.grouping,
        selected: row.selected,
      });
      return (
        <>
          {row.grouping && <input {...row.selectProps} />}
          <input {...row.checkboxProps} />
          <button {...row.handleProps}>grip</button>
        </>
      );
    };
    renderPicker({ renderRow });
    expect(seen.get("cap")).toEqual({ grouping: false, selected: false });
    select("Cap");
    expect(seen.get("cap")).toEqual({ grouping: true, selected: true });
    expect(seen.get("age")).toEqual({ grouping: true, selected: false });
    // The show and hide box keeps a name of its own while the label is not its.
    expect(checkbox("Cap").disabled).toBe(true);
  });
});

describe("ColumnPicker dialog view", () => {
  const dialog = () => document.querySelector("dialog");
  const popover = () => document.querySelector(".fb-columns-popover");

  it("should open the same list in a dialog from the popover's button", () => {
    renderPicker();
    expect(dialog()).toBeNull();
    fireEvent.click(dialogView());
    expect(popover()).toBeNull();
    expect(dialog()?.open).toBe(true);
    expect(screen.getByRole("dialog", { name: "Columns" })).toBe(dialog());
    expect(rows()).toHaveLength(COLUMNS.length);
    expect(document.activeElement).toBe(dialog());
    // The dialog has a button to close it, and none to open itself.
    expect(screen.queryByRole("button", { name: "Dialog view" })).toBeNull();
    expect(trigger().getAttribute("aria-controls")).toBe(dialog()?.id);
  });

  it("should close on its button, and return the focus to the picker's button", () => {
    renderPicker();
    fireEvent.click(dialogView());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(dialog()).toBeNull();
    expect(popover()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("should close on Escape, and return the focus to the picker's button", () => {
    renderPicker();
    fireEvent.click(dialogView());
    fireEvent.keyDown(handle("Cap"), { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("should close when the browser asks it to, as for a phone's back button", () => {
    renderPicker();
    fireEvent.click(dialogView());
    fireEvent(
      dialog() as HTMLElement,
      new Event("cancel", { cancelable: true }),
    );
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("should open in the popover again the next time", () => {
    renderPicker();
    fireEvent.click(dialogView());
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(trigger());
    expect(dialog()).toBeNull();
    expect(popover()).not.toBeNull();
  });

  it("should open straight in the dialog with defaultView", () => {
    renderPicker({ defaultView: "dialog", dialogView: false });
    expect(popover()).toBeNull();
    expect(dialog()?.open).toBe(true);
  });

  it("should have no button with dialogView turned off", () => {
    renderPicker({ dialogView: false });
    expect(screen.queryByRole("button", { name: "Dialog view" })).toBeNull();
    expect(popover()).not.toBeNull();
  });

  it("should use the app's wording", () => {
    renderPicker({
      labels: {
        dialogView: "Full screen",
        closeDialog: "Done",
        title: "Fields",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("dialog", { name: "Fields" })).toBe(dialog());
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(dialog()).toBeNull();
  });

  it("should tick, show all and reset in the dialog", () => {
    renderPicker({ defaultView: "dialog" });
    fireEvent.click(checkbox("Cap"));
    expect(checkbox("Cap").checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(checkbox("Cap").checked).toBe(true);
    fireEvent.keyDown(handle("Cap"), { key: "End" });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(order()).toBe("symbol company industry cap return age release beta");
    expect(dialog()?.open).toBe(true);
  });

  it("should hide all in the dialog, also while group drag is on", () => {
    renderPicker({ defaultView: "dialog" });
    fireEvent.click(groupDrag());
    fireEvent.click(screen.getByRole("button", { name: "Hide all" }));
    // The pinned "Symbol" must stay shown.
    expect(checkbox("Symbol").checked).toBe(true);
    expect(checkbox("Cap").checked).toBe(false);
    expect(announced()).toBe("All columns that can be hidden are hidden.");
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(checkbox("Cap").checked).toBe(true);
    expect(dialog()?.open).toBe(true);
  });

  it("should clear a search on the first Escape, and close on the second", () => {
    renderPicker({ defaultView: "dialog", search: true });
    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "ca" } });
    expect(rows()).toHaveLength(1);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(rows()).toHaveLength(COLUMNS.length);
    expect(dialog()?.open).toBe(true);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(dialog()).toBeNull();
  });

  it("should tell a screen reader about the left and right keys only in the dialog", () => {
    renderPicker();
    const hint = () =>
      document.getElementById(
        handle("Cap").getAttribute("aria-describedby") as string,
      )?.textContent;
    expect(hint()).not.toContain("grid column");
    fireEvent.click(dialogView());
    expect(hint()).toContain("grid column");
    fireEvent.click(groupDrag());
    expect(hint()).toContain("Group drag is on.");
  });

  it("should move a column by one grid column with the left and right arrow keys", () => {
    renderPicker({ defaultView: "dialog" });
    // Three rows to a grid column: symbol company industry | cap return age | release beta.
    layOutGrid(3);
    fireEvent.keyDown(handle("Company"), { key: "ArrowRight" });
    expect(order()).toBe("symbol industry cap return company age release beta");
    expect(announced()).toBe("Company moved to position 5 of 8.");
    layOutGrid(3);
    fireEvent.keyDown(handle("Company"), { key: "ArrowLeft" });
    expect(order()).toBe("symbol company industry cap return age release beta");
  });

  it("should take a column to the foot of a shorter grid column beside it", () => {
    renderPicker({ defaultView: "dialog" });
    layOutGrid(3);
    // "Age" is third in its grid column, and the last one has two rows.
    fireEvent.keyDown(handle("Age"), { key: "ArrowRight" });
    expect(order()).toBe("symbol company industry cap return release beta age");
  });

  it("should do nothing at the last grid column, and still keep the key from scrolling", () => {
    renderPicker({ defaultView: "dialog" });
    layOutGrid(3);
    const stayed = fireEvent.keyDown(handle("Beta"), { key: "ArrowRight" });
    // `fireEvent` hands back false when the key press was claimed.
    expect(stayed).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  it("should leave the left and right keys alone in a list of one grid column", () => {
    renderPicker();
    layOutGrid(100);
    const untouched = fireEvent.keyDown(handle("Cap"), { key: "ArrowRight" });
    expect(untouched).toBe(true);
    expect(changed).not.toHaveBeenCalled();
  });

  it("should move a selection by one grid column", () => {
    renderPicker({ defaultView: "dialog" });
    select("Company", "Industry");
    layOutGrid(3);
    fireEvent.keyDown(handle("Company"), { key: "ArrowRight" });
    expect(order()).toBe("symbol cap return age company industry release beta");
  });

  it("should drop a dragged row in the grid column under the pointer", () => {
    renderPicker({ defaultView: "dialog" });
    layOutGrid(3);
    fireEvent.pointerDown(handle("Company"), pointer(10, ROW + 15));
    // Over the top half of "Return", the second row of the second grid column.
    fireEvent.pointerMove(document, pointer(WIDE + 10, ROW + 5));
    expect(rows()[4]?.getAttribute("data-drop")).toBe("before");
    fireEvent.pointerUp(document, pointer(WIDE + 10, ROW + 5));
    expect(order()).toBe("symbol industry cap company return age release beta");
  });

  it("should draw the drop line at the foot of the grid column the pointer is in", () => {
    renderPicker({ defaultView: "dialog" });
    layOutGrid(3);
    fireEvent.pointerDown(handle("Release"), pointer(2 * WIDE + 10, 15));
    // Below every row of the first grid column.
    fireEvent.pointerMove(document, pointer(10, 5 * ROW));
    expect(rows()[2]?.getAttribute("data-drop")).toBe("after");
    expect(rows()[3]?.hasAttribute("data-drop")).toBe(false);
    fireEvent.pointerUp(document, pointer(10, 5 * ROW));
    expect(order()).toBe("symbol company industry release cap return age beta");
  });
});

describe("the grid of a list", () => {
  /** Two grid columns of three and two rows, each row 30 tall and 200 wide. */
  const grid: GridColumn[] = [
    {
      first: 0,
      left: 0,
      right: 200,
      tops: [0, 30, 60],
      middles: [15, 45, 75],
    },
    { first: 3, left: 210, right: 410, tops: [0, 30], middles: [15, 45] },
  ];

  it("should find the gap under the pointer in the grid column it is in", () => {
    expect(slotAtPoint(grid, 50, 10)).toEqual({ slot: 0, after: false });
    expect(slotAtPoint(grid, 50, 50)).toEqual({ slot: 2, after: false });
    expect(slotAtPoint(grid, 300, 10)).toEqual({ slot: 3, after: false });
    expect(slotAtPoint(grid, 300, 20)).toEqual({ slot: 4, after: false });
  });

  it("should mark the foot of a grid column as after its last row", () => {
    // The same gap as before the next grid column's first row, marked on this side.
    expect(slotAtPoint(grid, 50, 500)).toEqual({ slot: 3, after: true });
    expect(slotAtPoint(grid, 300, 500)).toEqual({ slot: 5, after: true });
  });

  it("should take the nearest grid column for a pointer beside them all", () => {
    expect(slotAtPoint(grid, -80, 50)).toEqual({ slot: 2, after: false });
    expect(slotAtPoint(grid, 204, 10)).toEqual({ slot: 0, after: false });
    expect(slotAtPoint(grid, 207, 10)).toEqual({ slot: 3, after: false });
    expect(slotAtPoint(grid, 900, 20)).toEqual({ slot: 4, after: false });
  });

  it("should give the first gap for a list with no rows", () => {
    expect(slotAtPoint([], 10, 10)).toEqual({ slot: 0, after: false });
  });

  it("should find the row beside a row, one grid column over", () => {
    expect(placeBeside(grid, 1, 1)).toBe(4);
    expect(placeBeside(grid, 4, -1)).toBe(1);
    // The grid column beside it is shorter, so its last row is the nearest.
    expect(placeBeside(grid, 2, 1)).toBe(4);
  });

  it("should give the row itself where no grid column is on that side", () => {
    expect(placeBeside(grid, 1, -1)).toBe(1);
    expect(placeBeside(grid, 3, 1)).toBe(3);
  });

  it("should say that left and right mean nothing in one grid column", () => {
    expect(placeBeside(grid.slice(0, 1), 1, 1)).toBeUndefined();
  });

  it("should measure rows that stand beside each other as grid columns", () => {
    const list = document.createElement("ul");
    const box = (left: number, top: number) =>
      ({ left, top, width: 100, height: 20 }) as DOMRect;
    list.getBoundingClientRect = () => box(50, 40);
    [
      [50, 40],
      [50, 60],
      [160, 40],
    ].forEach(([left, top]) => {
      const row = list.appendChild(document.createElement("li"));
      row.getBoundingClientRect = () => box(left as number, top as number);
    });
    expect(measureGrid(list)).toEqual([
      { first: 0, left: 0, right: 100, tops: [0, 20], middles: [10, 30] },
      { first: 2, left: 110, right: 210, tops: [0], middles: [10] },
    ]);
  });
});

describe("groupPlaceFromSlot", () => {
  it("should count the rows of the group that stand before the gap", () => {
    // Rows 3, 4 and 7 dropped into the gap before row 1.
    expect(groupPlaceFromSlot([3, 4, 7], 1)).toBe(1);
    // Dropped after row 5: two of them stood before that gap.
    expect(groupPlaceFromSlot([3, 4, 7], 6)).toBe(4);
    expect(groupPlaceFromSlot([3, 4, 7], 8)).toBe(5);
  });

  it("should agree with one row's own place", () => {
    expect(groupPlaceFromSlot([1], 3)).toBe(2);
    expect(groupPlaceFromSlot([2], 0)).toBe(0);
  });
});

import { readFileSync } from "node:fs";
import type { ColumnDefinition } from "@arvilmena/filter-core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { memo } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useColumnSettings } from "../useColumnSettings";
import { ColumnPicker, type ColumnPickerProps } from "./ColumnPicker";
import { placeFromSlot, slotAt } from "./useColumnDrag";

const COLUMNS: readonly ColumnDefinition[] = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "stock", label: "Stock" },
  { key: "notes", label: "Notes", defaultHidden: true },
];

/** Counts how often the table is drawn, to prove a drag does not redraw it. */
const tableDrawn = vi.fn();

/** A stand-in for an app's table. It is memoised, as a large table would be. */
const Table = memo(function Table({
  columns,
}: {
  columns: readonly ColumnDefinition[];
}) {
  tableDrawn();
  return (
    <p data-testid="table">{columns.map((column) => column.key).join(" ")}</p>
  );
});

/** An app around the picker: a table that follows it, and something else to click on. */
function App({ extra }: { extra: Partial<ColumnPickerProps> }) {
  const state = useColumnSettings({ columns: COLUMNS });
  return (
    <>
      <ColumnPicker state={state} {...extra} />
      <Table columns={state.visibleColumns} />
      <button type="button">Elsewhere</button>
    </>
  );
}

/** A column list as long as a wide table's. */
const MANY: readonly ColumnDefinition[] = Array.from(
  { length: 200 },
  (_, index) => ({ key: `c${index}`, label: `Column ${index}` }),
);
/** Counts which rows the picker draws, to prove the others are left alone. */
const drawn = vi.fn();
// One function for every render, as the picker asks for.
const renderRow: ColumnPickerProps["renderRow"] = (row) => {
  drawn(row.column.key);
  return (
    <>
      <input {...row.checkboxProps} />
      <button {...row.handleProps}>grip</button>
      <label htmlFor={row.checkboxProps.id}>{row.column.label}</label>
    </>
  );
};
/** An app with the long column list. With `inlineLabels`, it writes its wording in place. */
function ManyApp({ inlineLabels = false }: { inlineLabels?: boolean }) {
  const state = useColumnSettings({ columns: MANY });
  return (
    <ColumnPicker
      // A new object, holding a new function, on every render.
      labels={
        inlineLabels
          ? { title: "Table columns", move: (label) => `Move ${label}` }
          : undefined
      }
      renderRow={renderRow}
      state={state}
    />
  );
}

/** Draws the app. With `open`, it also opens the picker, as most tests need. */
function renderPicker(extra: Partial<ColumnPickerProps> = {}, open = true) {
  tableDrawn.mockClear();
  const rendered = render(<App extra={extra} />);
  if (open) fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
  return rendered;
}

const table = (): string => screen.getByTestId("table").textContent ?? "";
const rows = (): HTMLElement[] => screen.getAllByRole("listitem");
/** The names in the picker's list, in order. */
const listed = (): string =>
  rows()
    .map((row) => row.textContent)
    .join(" ");
const checkbox = (label: string) =>
  screen.getByRole<HTMLInputElement>("checkbox", { name: label });
const handle = (label: string) =>
  screen.getByRole("button", { name: `Move ${label}` });
const announced = (): string =>
  document.querySelector("[aria-live]")?.textContent ?? "";

/** Gives a row of the list a place on the screen: 30 pixels tall, from `top` down. */
function placeAt(element: Element, top: number, height: number) {
  element.getBoundingClientRect = () =>
    ({ top, height, bottom: top + height }) as DOMRect;
}

/**
 * Lays the open list out as a browser would, which the test page does not do itself. The first
 * row starts 100 pixels down, and each row is 30 pixels tall.
 */
function layOutList() {
  placeAt(screen.getByRole("list"), 0, 1000);
  rows().forEach((row, index) => {
    placeAt(row, 100 + index * 30, 30);
  });
}

const pointer = (clientY: number) => ({ button: 0, pointerId: 1, clientY });

afterEach(cleanup);

describe("ColumnPicker", () => {
  it("should show only the button until it is opened", () => {
    renderPicker({}, false);
    const trigger = screen.getByRole("button", { name: /^Columns/ });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("dialog", { name: "Columns" })).toBeTruthy();
  });

  it("should list every column as a checkbox, a handle and a name, in that order", () => {
    renderPicker();
    expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
    const [first] = rows();
    const parts = Array.from((first as HTMLElement).children);
    expect(parts.map((part) => part.tagName)).toEqual([
      "INPUT",
      "BUTTON",
      "LABEL",
    ]);
  });

  it("should tick the shown columns and leave the hidden ones unticked", () => {
    renderPicker();
    expect(checkbox("Price").checked).toBe(true);
    expect(checkbox("Notes").checked).toBe(false);
  });

  it("should hide and show a column in the table at once", () => {
    renderPicker();
    expect(table()).toBe("name price stock");
    fireEvent.click(checkbox("Price"));
    expect(table()).toBe("name stock");
    expect(checkbox("Price").checked).toBe(false);
    fireEvent.click(checkbox("Notes"));
    expect(table()).toBe("name stock notes");
  });

  it("should toggle a column by a click on its name", () => {
    renderPicker();
    fireEvent.click(screen.getByText("Stock"));
    expect(table()).toBe("name price");
  });

  it("should turn off the checkbox of a column that must stay shown", () => {
    renderPicker();
    expect(checkbox("Name").disabled).toBe(true);
    expect(checkbox("Name").checked).toBe(true);
    expect(checkbox("Price").disabled).toBe(false);
  });

  it("should say on the button how many columns are hidden", () => {
    renderPicker();
    const trigger = screen.getByRole("button", { name: /^Columns/ });
    expect(trigger.textContent).toBe("Columns (1 hidden)");
    fireEvent.click(checkbox("Notes"));
    expect(trigger.textContent).toBe("Columns");
  });

  it("should show every column with Show all, keeping the order", () => {
    renderPicker();
    fireEvent.click(checkbox("Price"));
    fireEvent.keyDown(handle("Stock"), { key: "Home" });
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(table()).toBe("stock name price notes");
  });

  it("should put back the starting order and visibility with Reset", () => {
    renderPicker();
    fireEvent.click(checkbox("Price"));
    fireEvent.click(checkbox("Notes"));
    fireEvent.keyDown(handle("Stock"), { key: "Home" });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(table()).toBe("name price stock");
    expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
    expect(checkbox("Notes").checked).toBe(false);
  });

  describe("moving with the keyboard", () => {
    it("should move a column down and up with the arrow keys", () => {
      renderPicker();
      fireEvent.keyDown(handle("Name"), { key: "ArrowDown" });
      expect(listed()).toBe("⠿Price ⠿Name ⠿Stock ⠿Notes");
      expect(table()).toBe("price name stock");
      fireEvent.keyDown(handle("Stock"), { key: "ArrowUp" });
      expect(listed()).toBe("⠿Price ⠿Stock ⠿Name ⠿Notes");
    });

    it("should move a column to either end with Home and End", () => {
      renderPicker();
      fireEvent.keyDown(handle("Price"), { key: "End" });
      expect(listed()).toBe("⠿Name ⠿Stock ⠿Notes ⠿Price");
      fireEvent.keyDown(handle("Notes"), { key: "Home" });
      expect(listed()).toBe("⠿Notes ⠿Name ⠿Stock ⠿Price");
    });

    it("should announce each move with the column's new position", () => {
      renderPicker();
      expect(announced()).toBe("");
      fireEvent.keyDown(handle("Name"), { key: "ArrowDown" });
      expect(announced()).toBe("Name moved to position 2 of 4.");
      fireEvent.keyDown(handle("Name"), { key: "ArrowDown" });
      expect(announced()).toBe("Name moved to position 3 of 4.");
    });

    it("should keep the focus on the moved column's handle", () => {
      renderPicker();
      handle("Name").focus();
      fireEvent.keyDown(handle("Name"), { key: "ArrowDown" });
      expect(document.activeElement).toBe(handle("Name"));
      fireEvent.keyDown(handle("Name"), { key: "End" });
      expect(document.activeElement).toBe(handle("Name"));
    });

    it("should do nothing at either end of the list, or for another key", () => {
      renderPicker();
      fireEvent.keyDown(handle("Name"), { key: "ArrowUp" });
      fireEvent.keyDown(handle("Notes"), { key: "ArrowDown" });
      fireEvent.keyDown(handle("Price"), { key: "a" });
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
      expect(announced()).toBe("");
    });

    it("should tell a screen reader which keys move a column", () => {
      renderPicker();
      const hintId = handle("Price").getAttribute("aria-describedby") as string;
      expect(document.getElementById(hintId)?.textContent).toContain(
        "arrow key",
      );
    });
  });

  describe("dragging with a pointer", () => {
    it("should move a column to where its handle is dropped", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      // Over the lower half of "Stock", the third row.
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.pointerUp(document, pointer(180));
      expect(listed()).toBe("⠿Price ⠿Stock ⠿Name ⠿Notes");
      expect(table()).toBe("price stock name");
      expect(announced()).toBe("Name moved to position 3 of 4.");
    });

    it("should move a column up, and below the last row", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Stock"), pointer(175));
      // Over the upper half of "Name", the first row.
      fireEvent.pointerMove(document, pointer(105));
      fireEvent.pointerUp(document, pointer(105));
      expect(listed()).toBe("⠿Stock ⠿Name ⠿Price ⠿Notes");

      layOutList();
      fireEvent.pointerDown(handle("Stock"), pointer(115));
      fireEvent.pointerMove(document, pointer(400));
      fireEvent.pointerUp(document, pointer(400));
      expect(listed()).toBe("⠿Name ⠿Price ⠿Notes ⠿Stock");
    });

    it("should mark the dragged row and the place it would land", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      const [name, price, stock, notes] = rows();
      expect(name?.hasAttribute("data-dragging")).toBe(true);
      fireEvent.pointerMove(document, pointer(180));
      expect(notes?.getAttribute("data-drop")).toBe("before");
      fireEvent.pointerMove(document, pointer(400));
      expect(notes?.getAttribute("data-drop")).toBe("after");
      // Its own place, and the gap just below it, would change nothing.
      fireEvent.pointerMove(document, pointer(140));
      expect(
        [name, price, stock, notes].some((row) =>
          row?.hasAttribute("data-drop"),
        ),
      ).toBe(false);
      fireEvent.pointerUp(document, pointer(140));
      expect(name?.hasAttribute("data-dragging")).toBe(false);
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
    });

    it("should redraw the table once, on drop, and not while dragging", () => {
      renderPicker();
      layOutList();
      tableDrawn.mockClear();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(150));
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.pointerMove(document, pointer(210));
      expect(tableDrawn).not.toHaveBeenCalled();
      fireEvent.pointerUp(document, pointer(210));
      expect(tableDrawn).toHaveBeenCalledTimes(1);
    });

    it("should give up the drag on Escape, and keep the picker open", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.keyDown(handle("Name"), { key: "Escape" });
      fireEvent.pointerUp(document, pointer(180));
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("should give up the drag when the browser takes the pointer away", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.pointerCancel(document, pointer(180));
      fireEvent.pointerUp(document, pointer(180));
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
    });

    it("should ignore a press that is not the main button, and another pointer", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Name"), { ...pointer(115), button: 2 });
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.pointerUp(document, pointer(180));
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");

      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, { ...pointer(180), pointerId: 2 });
      fireEvent.pointerUp(document, { ...pointer(180), pointerId: 2 });
      expect(rows()[0]?.hasAttribute("data-dragging")).toBe(true);
      fireEvent.pointerUp(document, pointer(115));
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
    });
  });

  describe("inside the filter builder", () => {
    /** Loads the real style sheet and draws the open picker inside a builder's own element. */
    function renderInBuilder() {
      const sheet = document.createElement("style");
      sheet.textContent = readFileSync(
        `${import.meta.dirname}/../../styles.css`,
        "utf8",
      );
      document.head.append(sheet);
      const rendered = render(
        <div className="fb">
          <App extra={{}} />
        </div>,
      );
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      layOutList();
      return { ...rendered, sheet };
    }

    it("should fade only the dragged row, not the whole list", () => {
      const { sheet } = renderInBuilder();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      // The builder fades its own dragged item. That rule must not also fade the list.
      expect(getComputedStyle(screen.getByRole("list")).opacity).not.toBe(
        "0.4",
      );
      expect(getComputedStyle(rows()[0] as HTMLElement).opacity).toBe("0.4");
      sheet.remove();
    });

    it("should leave the drop line to the picker's own rules", () => {
      const { sheet } = renderInBuilder();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(400));
      const last = rows()[3] as HTMLElement;
      expect(last.getAttribute("data-drop")).toBe("after");
      // The test page does not draw the line itself (it is a `::before` part). So this reads
      // the style sheet: every drop-line rule that reaches this row must be the picker's.
      const lineRules = Array.from(sheet.sheet?.cssRules ?? [])
        .flatMap(
          (rule) => (rule as CSSStyleRule).selectorText?.split(",") ?? [],
        )
        .map((selector) => selector.trim())
        .filter(
          (selector) =>
            selector.includes("[data-drop") &&
            selector.endsWith("::before") &&
            last.matches(selector.slice(0, -"::before".length)),
        );
      expect(lineRules.length).toBeGreaterThan(0);
      expect(
        lineRules.filter((selector) => !selector.startsWith(".fb-columns-row")),
      ).toEqual([]);
      sheet.remove();
    });
  });

  describe("closing", () => {
    it("should close on Escape and return the focus to the button", () => {
      renderPicker();
      fireEvent.keyDown(checkbox("Price"), { key: "Escape" });
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /^Columns/ }),
      );
    });

    it("should close on a click outside it, and stay open on a click inside", () => {
      renderPicker();
      fireEvent.pointerDown(screen.getByText("Stock"));
      expect(screen.getByRole("dialog")).toBeTruthy();
      fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("should close when Tab moves the focus out of it", () => {
      renderPicker();
      fireEvent.blur(screen.getByRole("button", { name: "Reset" }), {
        relatedTarget: screen.getByRole("button", { name: "Elsewhere" }),
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("should stay open when the focus moves within it", () => {
      renderPicker();
      fireEvent.blur(checkbox("Price"), { relatedTarget: handle("Price") });
      expect(screen.getByRole("dialog")).toBeTruthy();
    });

    it("should close on a second click on the button", () => {
      renderPicker();
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("should move the focus into the list when it opens", () => {
      renderPicker();
      expect(document.activeElement).toBe(screen.getByRole("dialog"));
    });
  });

  describe("replacing parts", () => {
    it("should use the app's wording", () => {
      renderPicker(
        {
          labels: {
            trigger: "Spalten",
            title: "Spalten wählen",
            showAll: "Alle zeigen",
            reset: "Zurücksetzen",
            hiddenCount: (count) => `${count} versteckt`,
            move: (label) => `${label} verschieben`,
            moved: (label, position, total) =>
              `${label}: ${position} von ${total}`,
          },
        },
        false,
      );
      const trigger = screen.getByRole("button", { name: /^Spalten/ });
      expect(trigger.textContent).toBe("Spalten (1 versteckt)");
      fireEvent.click(trigger);
      expect(
        screen.getByRole("dialog", { name: "Spalten wählen" }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Alle zeigen" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Zurücksetzen" })).toBeTruthy();
      const grip = screen.getByRole("button", { name: "Price verschieben" });
      fireEvent.keyDown(grip, { key: "ArrowDown" });
      expect(announced()).toBe("Price: 3 von 4");
    });

    it("should draw the app's own trigger", () => {
      renderPicker(
        {
          renderTrigger: (props, { open, hiddenCount }) => (
            <button {...props} data-open={open}>
              Edit columns, {hiddenCount} hidden
            </button>
          ),
        },
        false,
      );
      const trigger = screen.getByRole("button", {
        name: "Edit columns, 1 hidden",
      });
      expect(trigger.getAttribute("data-open")).toBe("false");
      fireEvent.click(trigger);
      expect(trigger.getAttribute("data-open")).toBe("true");
      fireEvent.keyDown(checkbox("Price"), { key: "Escape" });
      expect(document.activeElement).toBe(trigger);
    });

    it("should draw the app's own rows, which still toggle and move", () => {
      renderPicker({
        renderRow: (row) => (
          <>
            <input {...row.checkboxProps} />
            <button {...row.handleProps}>grip</button>
            <label htmlFor={row.checkboxProps.id}>
              {row.index + 1}. {row.column.label}
              {row.visible ? "" : " (off)"}
            </label>
          </>
        ),
      });
      expect(
        rows().map((row) => within(row).getByText(/\d\./).textContent),
      ).toEqual(["1. Name", "2. Price", "3. Stock", "4. Notes (off)"]);
      fireEvent.click(checkbox("2. Price"));
      expect(table()).toBe("name stock");
      fireEvent.keyDown(handle("Stock"), { key: "Home" });
      expect(table()).toBe("stock name");
    });

    it("should let a finger drag the handle of the app's own row", () => {
      renderPicker({
        renderRow: (row) => (
          <>
            <input {...row.checkboxProps} />
            <button {...row.handleProps}>grip</button>
            <label htmlFor={row.checkboxProps.id}>{row.column.label}</label>
          </>
        ),
      });
      // The app's button has none of the picker's classes, so the style sheet cannot reach
      // it. Without this style the browser scrolls the list and the drag never starts.
      expect(handle("Price").style.touchAction).toBe("none");
    });

    it("should add the app's class to its own", () => {
      const { container } = renderPicker({ className: "toolbar-item" });
      expect(container.firstElementChild?.className).toBe(
        "fb-columns toolbar-item",
      );
    });

    it("should line the list up with the edge the app asks for", () => {
      renderPicker({ align: "end" });
      expect(screen.getByRole("dialog").getAttribute("data-align")).toBe("end");
    });
  });

  describe("with many columns", () => {
    it("should redraw only the row that was ticked", () => {
      drawn.mockClear();
      render(<ManyApp />);
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      expect(drawn).toHaveBeenCalledTimes(200);
      drawn.mockClear();
      fireEvent.click(checkbox("Column 7"));
      expect(drawn.mock.calls).toEqual([["c7"]]);
    });

    it("should redraw only the changed rows when the wording is written in place", () => {
      render(<ManyApp inlineLabels />);
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      layOutList();
      drawn.mockClear();
      fireEvent.click(checkbox("Column 7"));
      expect(drawn.mock.calls).toEqual([["c7"]]);
      drawn.mockClear();
      fireEvent.pointerDown(handle("Column 0"), pointer(115));
      fireEvent.pointerMove(document, pointer(180));
      expect(drawn.mock.calls).toEqual([["c0"], ["c3"]]);
    });

    it("should redraw only the rows whose drop line changes during a drag", () => {
      render(<ManyApp />);
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      layOutList();
      drawn.mockClear();
      fireEvent.pointerDown(handle("Column 0"), pointer(115));
      expect(drawn.mock.calls).toEqual([["c0"]]);
      drawn.mockClear();
      // The line moves from above "Column 3" to above "Column 4".
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.pointerMove(document, pointer(185));
      fireEvent.pointerMove(document, pointer(210));
      expect(drawn.mock.calls).toEqual([["c3"], ["c3"], ["c4"]]);
    });
  });
});

describe("slotAt", () => {
  // Three rows of 30 pixels, so their middles are 15, 45 and 75 pixels down.
  const middles = [15, 45, 75];

  it("should land before a row over its top half, and after it over its bottom half", () => {
    expect(slotAt(middles, 0)).toBe(0);
    expect(slotAt(middles, 14)).toBe(0);
    expect(slotAt(middles, 16)).toBe(1);
    expect(slotAt(middles, 44)).toBe(1);
    expect(slotAt(middles, 46)).toBe(2);
  });

  it("should land first above the list and last below it", () => {
    expect(slotAt(middles, -50)).toBe(0);
    expect(slotAt(middles, 500)).toBe(3);
    expect(slotAt([], 10)).toBe(0);
  });
});

describe("placeFromSlot", () => {
  it("should keep a row in place for the slots on either side of it", () => {
    expect(placeFromSlot(1, 1)).toBe(1);
    expect(placeFromSlot(1, 2)).toBe(1);
  });

  it("should count one less for a slot below the row", () => {
    expect(placeFromSlot(0, 3)).toBe(2);
    expect(placeFromSlot(2, 0)).toBe(0);
  });
});

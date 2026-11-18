import { readFileSync } from "node:fs";
import type { ColumnDefinition, ColumnSettings } from "@arvilmena/filter-core";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { memo, useRef, useState } from "react";
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

/** An app whose column list changes while the picker is open. */
function ChangingApp() {
  const [columns, setColumns] = useState(COLUMNS);
  const state = useColumnSettings({ columns });
  return (
    <>
      <ColumnPicker state={state} />
      <Table columns={state.visibleColumns} />
      <button onClick={() => setColumns(COLUMNS.slice(1))} type="button">
        Remove name
      </button>
    </>
  );
}

/**
 * An app that owns the settings and applies a change late: only when "Apply" is pressed. A
 * change that is never applied is one the app turned down.
 */
function OwningApp() {
  const [value, setValue] = useState<ColumnSettings | null>(null);
  const waiting = useRef<ColumnSettings | null>(null);
  const state = useColumnSettings({
    columns: COLUMNS,
    value,
    onChange: (next) => {
      waiting.current = next;
    },
  });
  return (
    <>
      <ColumnPicker state={state} />
      <button onClick={() => setValue(waiting.current)} type="button">
        Apply
      </button>
      <button
        onClick={() =>
          setValue({
            order: ["notes", "name", "price", "stock"],
            hidden: ["notes"],
          })
        }
        type="button"
      >
        Put notes first
      </button>
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

  it("should tell a screen reader what Show all and Reset did", () => {
    renderPicker();
    fireEvent.click(checkbox("Price"));
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(announced()).toBe("All columns are shown.");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(announced()).toBe(
      "The columns are back in their starting order and visibility.",
    );
  });

  it("should announce the same message again as a new one", () => {
    renderPicker();
    const message = () => document.querySelector("[aria-live]")?.firstChild;
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    const first = message();
    fireEvent.click(checkbox("Price"));
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(announced()).toBe("All columns are shown.");
    // A screen reader reads out what is added to the page, so the text is put in afresh.
    expect(message()).not.toBe(first);
  });

  it("should use the app's wording for what Show all and Reset did", () => {
    renderPicker({
      labels: { showAllDone: "Alle sichtbar.", resetDone: "Zurückgesetzt." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(announced()).toBe("Alle sichtbar.");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(announced()).toBe("Zurückgesetzt.");
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

    it("should drop where the pointer is let go when no move was heard first", () => {
      renderPicker();
      layOutList();
      // A pointer can travel and let go with no move reported in between.
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerUp(document, pointer(180));
      expect(listed()).toBe("⠿Price ⠿Stock ⠿Name ⠿Notes");
    });

    it("should leave a column in place when its handle is only pressed", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Price"), pointer(145));
      fireEvent.pointerUp(document, pointer(145));
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
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

    it("should move the held column when the list changes during the drag", () => {
      render(<ChangingApp />);
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      layOutList();
      fireEvent.pointerDown(handle("Stock"), pointer(175));
      // "Stock" was the third row, and is now the second.
      fireEvent.click(screen.getByRole("button", { name: "Remove name" }));
      expect(listed()).toBe("⠿Price ⠿Stock ⠿Notes");
      expect(rows()[1]?.hasAttribute("data-dragging")).toBe(true);
      fireEvent.pointerMove(document, pointer(400));
      expect(rows()[2]?.getAttribute("data-drop")).toBe("after");
      fireEvent.pointerUp(document, pointer(400));
      // A drop that went by the old place would have moved "Notes", or nothing.
      expect(listed()).toBe("⠿Price ⠿Notes ⠿Stock");
      expect(announced()).toBe("Stock moved to position 3 of 3.");
    });

    it("should give up the drag when the held column leaves the list", () => {
      render(<ChangingApp />);
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.click(screen.getByRole("button", { name: "Remove name" }));
      fireEvent.pointerUp(document, pointer(180));
      expect(listed()).toBe("⠿Price ⠿Stock ⠿Notes");
      expect(rows().some((row) => row.hasAttribute("data-dragging"))).toBe(
        false,
      );
      expect(screen.getByRole("list").hasAttribute("data-dragging")).toBe(
        false,
      );
    });

    it("should give up the drag when Tab closes the picker", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.blur(handle("Name"), {
        relatedTarget: screen.getByRole("button", { name: "Elsewhere" }),
      });
      expect(screen.queryByRole("dialog")).toBeNull();
      // The pointer is let go only after the list has closed.
      fireEvent.pointerUp(document, pointer(180));
      expect(table()).toBe("name price stock");
      expect(announced()).toBe("");
      // The picker opens again with nothing held.
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
      expect(document.querySelector("[data-dragging]")).toBeNull();
    });

    it("should give up the drag when a second finger taps outside the picker", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.pointerDown(screen.getByRole("button", { name: "Elsewhere" }), {
        ...pointer(500),
        pointerId: 2,
      });
      fireEvent.pointerUp(document, pointer(180));
      expect(table()).toBe("name price stock");
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

    it("should give up the drag when the mouse moves with no button held", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(180));
      // The button was let go where the page could not hear it, such as over a system menu.
      fireEvent.pointerMove(document, {
        ...pointer(180),
        pointerType: "mouse",
        buttons: 0,
      });
      expect(document.querySelector("[data-dragging]")).toBeNull();
      fireEvent.pointerUp(document, pointer(180));
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
    });

    it("should keep the drag while a finger moves, which holds no button", () => {
      renderPicker();
      layOutList();
      const finger = { ...pointer(180), pointerType: "touch", buttons: 0 };
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, finger);
      fireEvent.pointerUp(document, finger);
      expect(listed()).toBe("⠿Price ⠿Stock ⠿Name ⠿Notes");
    });

    it("should give up the drag when the browser takes the capture away", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.lostPointerCapture(handle("Name"), pointer(180));
      expect(document.querySelector("[data-dragging]")).toBeNull();
      fireEvent.pointerUp(document, pointer(180));
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
    });

    it("should let a new press replace a drag that never heard its release", () => {
      renderPicker();
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      // No release arrives. The next press starts a fresh drag of another column.
      fireEvent.pointerDown(handle("Stock"), pointer(175));
      const [name, , stock] = rows();
      expect(name?.hasAttribute("data-dragging")).toBe(false);
      expect(stock?.hasAttribute("data-dragging")).toBe(true);
      fireEvent.pointerMove(document, pointer(105));
      fireEvent.pointerUp(document, pointer(105));
      expect(listed()).toBe("⠿Stock ⠿Name ⠿Price ⠿Notes");
    });

    it("should capture the pointer on the handle, and let it go after the drag", () => {
      renderPicker();
      layOutList();
      const grip = handle("Name");
      const capture = vi.spyOn(grip, "setPointerCapture");
      const release = vi.spyOn(grip, "releasePointerCapture");
      fireEvent.pointerDown(grip, pointer(115));
      expect(capture).toHaveBeenCalledWith(1);
      expect(release).not.toHaveBeenCalled();
      fireEvent.pointerUp(document, pointer(115));
      expect(release).toHaveBeenCalledWith(1);
    });

    it("should still drag in a browser that cannot capture the pointer", () => {
      renderPicker();
      layOutList();
      vi.spyOn(handle("Name"), "setPointerCapture").mockImplementation(() => {
        throw new Error("no capture");
      });
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.pointerUp(document, pointer(180));
      expect(listed()).toBe("⠿Price ⠿Stock ⠿Name ⠿Notes");
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
    // Taken off the page after every test, passed or failed. A style sheet left behind by a
    // failed test would change what the later tests measure.
    let loadedSheet: HTMLStyleElement | null = null;
    afterEach(() => {
      loadedSheet?.remove();
      loadedSheet = null;
    });

    /** Loads the real style sheet and draws the open picker inside a builder's own element. */
    function renderInBuilder() {
      const sheet = document.createElement("style");
      loadedSheet = sheet;
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
      renderInBuilder();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      // The builder fades its own dragged item. That rule must not also fade the list.
      expect(getComputedStyle(screen.getByRole("list")).opacity).not.toBe(
        "0.4",
      );
      expect(getComputedStyle(rows()[0] as HTMLElement).opacity).toBe("0.4");
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
    });
  });

  describe("inside a frame", () => {
    /**
     * Draws the app with the open picker in a document of its own, as a frame (a page within
     * the page) has. The test page cannot load a real frame. What matters is the same: what
     * happens in that document is not heard on the outer page's document.
     */
    function renderInFrame() {
      const page = document.implementation.createHTMLDocument();
      // A frame's document has a window. The test helpers need one to build an event.
      Object.defineProperty(page, "defaultView", { value: window });
      const container = page.body.appendChild(page.createElement("div"));
      render(<App extra={{}} />, { container, baseElement: page.body });
      const inside = within(page.body);
      fireEvent.click(inside.getByRole("button", { name: /^Columns/ }));
      return { page, inside };
    }

    it("should close on a click outside it", () => {
      const { inside } = renderInFrame();
      fireEvent.pointerDown(inside.getByRole("button", { name: "Elsewhere" }));
      expect(inside.queryByRole("dialog")).toBeNull();
    });

    it("should move a column to where its handle is dropped", () => {
      const { page, inside } = renderInFrame();
      placeAt(inside.getByRole("list"), 0, 1000);
      inside.getAllByRole("listitem").forEach((row, index) => {
        placeAt(row, 100 + index * 30, 30);
      });
      const name = inside.getByRole("button", { name: "Move Name" });
      fireEvent.pointerDown(name, pointer(115));
      fireEvent.pointerMove(page, pointer(180));
      fireEvent.pointerUp(page, pointer(180));
      expect(inside.getByTestId("table").textContent).toBe("price stock name");
    });
  });

  describe("in an app that owns the settings", () => {
    const openOwningApp = () => {
      render(<OwningApp />);
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
    };
    const apply = () =>
      fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    it("should not announce a move that the app turns down", () => {
      openOwningApp();
      fireEvent.keyDown(handle("Name"), { key: "ArrowDown" });
      expect(listed()).toBe("⠿Name ⠿Price ⠿Stock ⠿Notes");
      expect(announced()).toBe("");
      // Something else redraws the picker. The move is still not there, so still no word.
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      expect(announced()).toBe("");
    });

    it("should announce a move, and keep the focus, once the app applies it", () => {
      openOwningApp();
      handle("Name").focus();
      fireEvent.keyDown(handle("Name"), { key: "End" });
      expect(announced()).toBe("");
      // The browser drops the focus when the row is moved in the page.
      handle("Name").blur();
      expect(document.activeElement).toBe(document.body);
      apply();
      expect(listed()).toBe("⠿Price ⠿Stock ⠿Notes ⠿Name");
      expect(announced()).toBe("Name moved to position 4 of 4.");
      expect(document.activeElement).toBe(handle("Name"));
    });

    it("should leave the focus where the person has put it since the move", () => {
      openOwningApp();
      handle("Name").focus();
      fireEvent.keyDown(handle("Name"), { key: "End" });
      // The person goes on to another control of the picker before the app applies the move.
      checkbox("Price").focus();
      apply();
      expect(listed()).toBe("⠿Price ⠿Stock ⠿Notes ⠿Name");
      expect(document.activeElement).toBe(checkbox("Price"));
    });

    it("should not take the focus back once the person has moved it on", () => {
      openOwningApp();
      handle("Name").focus();
      fireEvent.keyDown(handle("Name"), { key: "ArrowDown" });
      // The person goes on to another control, and that control then gives the focus up.
      // Nothing holds the focus now, but the move is not what took it away.
      checkbox("Price").focus();
      checkbox("Price").blur();
      expect(document.activeElement).toBe(document.body);
      apply();
      expect(listed()).toBe("⠿Price ⠿Name ⠿Stock ⠿Notes");
      expect(document.activeElement).toBe(document.body);
      // The move itself is still read out.
      expect(announced()).toBe("Name moved to position 2 of 4.");
    });

    it("should not give the focus to a handle that did not have it", () => {
      openOwningApp();
      // The focus is on the list's box, where opening put it, not on the handle.
      const before = document.activeElement;
      fireEvent.keyDown(handle("Name"), { key: "End" });
      apply();
      expect(listed()).toBe("⠿Price ⠿Stock ⠿Notes ⠿Name");
      expect(document.activeElement).toBe(before);
    });

    it("should not announce a move when the app changes the list some other way", () => {
      openOwningApp();
      fireEvent.keyDown(handle("Name"), { key: "ArrowDown" });
      // The app turns the move down, and then changes the order itself. That happens to put
      // the name second, where the move had asked for it. It is still not that move.
      fireEvent.click(screen.getByRole("button", { name: "Put notes first" }));
      expect(listed()).toBe("⠿Notes ⠿Name ⠿Price ⠿Stock");
      expect(announced()).toBe("");
    });

    it("should announce a late drop the same way", () => {
      openOwningApp();
      layOutList();
      fireEvent.pointerDown(handle("Name"), pointer(115));
      fireEvent.pointerMove(document, pointer(180));
      fireEvent.pointerUp(document, pointer(180));
      expect(announced()).toBe("");
      apply();
      expect(announced()).toBe("Name moved to position 3 of 4.");
    });

    it("should forget a waiting move when the picker closes", () => {
      openOwningApp();
      fireEvent.keyDown(handle("Name"), { key: "ArrowDown" });
      const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
      fireEvent.pointerDown(elsewhere);
      elsewhere.focus();
      apply();
      // The person has moved on. Their focus stays put, and nothing is read out.
      expect(announced()).toBe("");
      expect(document.activeElement).toBe(elsewhere);
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

    it("should close on a click outside it that the app stops from spreading", () => {
      render(
        <>
          <App extra={{}} />
          <button
            onPointerDown={(event) => event.stopPropagation()}
            type="button"
          >
            Keeps to itself
          </button>
        </>,
      );
      fireEvent.click(screen.getByRole("button", { name: /^Columns/ }));
      fireEvent.pointerDown(
        screen.getByRole("button", { name: "Keeps to itself" }),
      );
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("should stay open on a click inside it when it is drawn in a shadow tree", () => {
      // A shadow tree is a part of the page that hides its insides from the rest. A press
      // inside it reaches the page as a press on the tree's host. Only the event's path
      // still lists the elements inside.
      const host = document.createElement("div");
      document.body.append(host);
      const container = document.createElement("div");
      host.attachShadow({ mode: "open" }).append(container);
      const { unmount } = render(<App extra={{}} />, { container });
      const inside = within(container);
      fireEvent.click(inside.getByRole("button", { name: /^Columns/ }));
      // The test page does not hide the pressed element as a browser does, so the press is
      // built by hand: sent from the host, with the path a browser would give.
      const press = new Event("pointerdown", { bubbles: true });
      const path: EventTarget[] = [];
      for (
        let node: Node | null = inside.getByText("Stock");
        node !== null;
        node = node.parentNode ?? (node as Partial<ShadowRoot>).host ?? null
      ) {
        path.push(node);
      }
      press.composedPath = () => path;
      fireEvent(host, press);
      expect(inside.queryByRole("dialog")).not.toBeNull();
      fireEvent.pointerDown(document.body);
      expect(inside.queryByRole("dialog")).toBeNull();
      unmount();
      host.remove();
    });

    it("should stay open on a click inside it when it is drawn in a closed shadow tree", () => {
      // A closed shadow tree hides its insides from the page altogether. The page hears a
      // press inside it as a press on the tree's host, and the event's path stops there too.
      const host = document.createElement("div");
      document.body.append(host);
      const container = document.createElement("div");
      const beside = document.createElement("button");
      const tree = host.attachShadow({ mode: "closed" });
      tree.append(container, beside);
      const { unmount } = render(<App extra={{}} />, { container });
      const inside = within(container);
      fireEvent.click(inside.getByRole("button", { name: /^Columns/ }));

      // The test page does not hide the pressed element as a browser does. So the press
      // answers by hand, as a browser would: a listener outside the tree is told of the
      // host, and a listener inside the tree is told of the pressed element.
      const press = (pressed: Element) => {
        const event = new Event("pointerdown", {
          bubbles: true,
          composed: true,
        });
        const isHeardInside = () =>
          event.currentTarget instanceof Node &&
          tree.contains(event.currentTarget);
        Object.defineProperty(event, "target", {
          get: () => (isHeardInside() ? pressed : host),
          set: () => {},
        });
        // The test page asks the event for its path to know where to send it, before any
        // listener is called. That first answer must be the real path.
        const realPath = event.composedPath.bind(event);
        event.composedPath = () => {
          if (event.currentTarget === null) return realPath();
          return isHeardInside()
            ? [pressed, tree, host, document.body, document]
            : [host, document.body, document];
        };
        fireEvent(pressed, event);
      };
      press(inside.getByText("Stock"));
      expect(inside.queryByRole("dialog")).not.toBeNull();
      // Inside the same tree, but outside the picker.
      press(beside);
      expect(inside.queryByRole("dialog")).toBeNull();
      fireEvent.click(inside.getByRole("button", { name: /^Columns/ }));
      fireEvent.pointerDown(document.body);
      expect(inside.queryByRole("dialog")).toBeNull();
      unmount();
      host.remove();
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

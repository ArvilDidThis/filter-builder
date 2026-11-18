import type {
  ColumnDefinition,
  FieldDefinition,
  FilterDefinition,
} from "@arvilmena/filter-core";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { ColumnPicker } from "../src/ui/ColumnPicker";
import { FilterBuilder } from "../src/ui/FilterBuilder";
import { useColumnSettings } from "../src/useColumnSettings";
import styles from "../styles.css?inline";
import {
  COLUMNS,
  type Counter,
  openPicker,
  PickerApp,
  type PickerParts,
} from "./support/apps";
import { mount } from "./support/mount";
import {
  clickOn,
  moveTo,
  type Point,
  pointOn,
  pressOn,
  release,
} from "./support/pointer";

// The picker in the places an app may put it: a closed shadow tree, a frame, a phone-sized
// screen and the filter builder.

/** Just below the middle of a row: a drop here lands after that row. */
const lowerHalf = (row: Element): Point => pointOn(row, 0.5, 0.9);

/**
 * Adds the picker's style sheet to a shadow tree or to a frame's `<head>`. The page's own
 * copy does not reach into either.
 */
function addStyles(to: ShadowRoot | HTMLHeadElement): void {
  const sheet = document.createElement("style");
  sheet.textContent = styles;
  to.append(sheet);
}

/** Column names far longer than a phone is wide. */
const LONG: readonly ColumnDefinition[] = [
  { key: "name", label: "Name of the product as the supplier wrote it down" },
  {
    key: "price",
    label: "Price per unit before tax, in the shop's currency",
  },
  { key: "stock", label: "Units left in the warehouse at the last count" },
];
const PHONE = { width: 320, height: 568 };

/** A page header with the picker at one end, as an app's toolbar has it. */
function Toolbar({
  align,
  place = align === "end" ? "flex-end" : "flex-start",
}: {
  align: "start" | "end";
  /** Where in the header the picker's button sits. Defaults to the end it lines up with. */
  place?: "flex-start" | "center" | "flex-end";
}) {
  const state = useColumnSettings({ columns: LONG });
  return (
    <div style={{ display: "flex", justifyContent: place }}>
      <ColumnPicker align={align} state={state} />
    </div>
  );
}

const FIELDS: FieldDefinition[] = [
  { key: "name", label: "Name", type: "string" },
  { key: "amount", label: "Amount", type: "num" },
];
const FILTER: FilterDefinition = {
  logic: "AND",
  criteria: [
    {
      condition: "=",
      data: "Name",
      origData: "name",
      type: "string",
      value: ["A"],
    },
    {
      condition: ">",
      data: "Amount",
      origData: "amount",
      type: "num",
      value: ["1"],
    },
  ],
};

/** A real builder with the picker in its header, so the builder's styles are all around it. */
function BuilderWithPicker() {
  const [filter, setFilter] = useState(FILTER);
  const state = useColumnSettings({ columns: COLUMNS });
  return (
    <FilterBuilder
      fields={FIELDS}
      headerActions={<ColumnPicker align="end" state={state} />}
      onChange={setFilter}
      value={filter}
    />
  );
}

describe("the picker inside a closed shadow tree (item 6)", () => {
  /**
   * Draws the app inside a closed shadow tree: a part of the page that hides its insides,
   * even from scripts. Only this test keeps a way in.
   */
  async function openInShadow(changed?: Counter): Promise<{
    picker: PickerParts;
    shadow: ShadowRoot;
    outside: HTMLButtonElement;
  }> {
    const outside = document.createElement("button");
    outside.textContent = "Outside the tree";
    const host = document.createElement("div");
    host.style.padding = "16px";
    document.body.append(outside, host);
    const shadow = host.attachShadow({ mode: "closed" });
    addStyles(shadow);
    mount(
      <PickerApp changed={changed} />,
      shadow.appendChild(document.createElement("div")),
    );
    // The page cannot see into the tree.
    expect(host.shadowRoot).toBeNull();
    return { picker: await openPicker(shadow), shadow, outside };
  }

  test("stays open for a click inside it, and closes for one outside", async () => {
    const { picker, outside } = await openInShadow();
    await clickOn(picker.row("Price").querySelector("label") as Element);
    await expect.poll(picker.table).toBe("name stock");
    expect(picker.popover()).not.toBeNull();
    await clickOn(picker.handle("Stock"));
    expect(picker.popover()).not.toBeNull();

    // Outside the picker, but inside the same shadow tree. The text takes no focus, so
    // only the place of the click can tell the picker to close.
    await clickOn(picker.plainText());
    await expect.poll(picker.popover).toBeNull();

    // A click on a button there closes it too.
    await clickOn(picker.trigger());
    await expect.poll(picker.popover).not.toBeNull();
    await clickOn(picker.elsewhere());
    await expect.poll(picker.popover).toBeNull();

    // Outside the shadow tree altogether.
    await clickOn(picker.trigger());
    await expect.poll(picker.popover).not.toBeNull();
    await clickOn(outside);
    await expect.poll(picker.popover).toBeNull();
  });

  test("moves a column by a real drag", async () => {
    const changed: Counter = { count: 0 };
    const { picker } = await openInShadow(changed);
    await pressOn(picker.handle("Name"));
    await moveTo(lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
    await release();
    await expect.poll(picker.table).toBe("price stock name");
    expect(changed.count).toBe(1);
    expect(picker.popover()).not.toBeNull();
  });

  test("keeps the focus on the handle after a move by keyboard", async () => {
    const { picker, shadow } = await openInShadow();
    picker.handle("Price").focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .poll(picker.listed)
      .toEqual(["Name", "Stock", "Price", "Notes"]);
    await expect.poll(() => shadow.activeElement).toBe(picker.handle("Price"));
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .poll(picker.listed)
      .toEqual(["Name", "Stock", "Notes", "Price"]);
    await expect.poll(() => shadow.activeElement).toBe(picker.handle("Price"));
    expect(picker.announced()).toBe("Price moved to position 4 of 4.");

    // Escape closes the picker and hands the focus back to its button.
    await userEvent.keyboard("{Escape}");
    await expect.poll(picker.popover).toBeNull();
    expect(shadow.activeElement).toBe(picker.trigger());
  });
});

describe("the picker inside an embedded page (item 6)", () => {
  /**
   * Draws the app into a frame (a page within the page) from the outer page, as an app does
   * that draws into a preview pane. The frame has a document of its own.
   */
  async function openInFrame(changed?: Counter): Promise<{
    picker: PickerParts;
    frame: HTMLIFrameElement;
    inner: Document;
    outside: HTMLButtonElement;
  }> {
    const outside = document.createElement("button");
    outside.textContent = "Outside the frame";
    const frame = document.createElement("iframe");
    frame.title = "Embedded page";
    frame.style.cssText =
      "display: block; width: 480px; height: 400px; margin: 24px;";
    frame.src = "/__fixtures__/blank";
    document.body.append(outside, frame);
    // A frame starts with a throwaway empty page. The real one is there once it has loaded.
    await expect
      .poll(
        () =>
          frame.contentDocument?.readyState === "complete" &&
          frame.contentWindow?.location.pathname === "/__fixtures__/blank",
      )
      .toBe(true);
    const inner = frame.contentDocument as Document;
    addStyles(inner.head);
    mount(
      <PickerApp changed={changed} />,
      inner.body.appendChild(inner.createElement("div")),
    );
    return { picker: await openPicker(inner), frame, inner, outside };
  }

  test("stays open for a click inside it, and closes for one outside", async () => {
    const { picker } = await openInFrame();
    await clickOn(picker.row("Price").querySelector("label") as Element);
    await expect.poll(picker.table).toBe("name stock");
    expect(picker.popover()).not.toBeNull();

    // The text takes no focus, so only the place of the click can tell the picker to close.
    await clickOn(picker.plainText());
    await expect.poll(picker.popover).toBeNull();

    await clickOn(picker.trigger());
    await expect.poll(picker.popover).not.toBeNull();
    await clickOn(picker.elsewhere());
    await expect.poll(picker.popover).toBeNull();
  });

  test("moves a column by a real drag", async () => {
    const changed: Counter = { count: 0 };
    const { picker } = await openInFrame(changed);
    await pressOn(picker.handle("Name"));
    await moveTo(lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
    await release();
    await expect.poll(picker.table).toBe("price stock name");
    expect(changed.count).toBe(1);
  });

  test("gives a drag up on Escape, and closes on the next Escape", async () => {
    const changed: Counter = { count: 0 };
    const { picker, inner } = await openInFrame(changed);
    await pressOn(picker.handle("Name"));
    await moveTo(lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => picker.list().hasAttribute("data-dragging"))
      .toBe(false);
    expect(picker.popover()).not.toBeNull();
    await release();

    picker.handle("Price").focus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .poll(picker.listed)
      .toEqual(["Name", "Stock", "Price", "Notes"]);
    await expect.poll(() => inner.activeElement).toBe(picker.handle("Price"));
    expect(changed.count).toBe(1);

    await userEvent.keyboard("{Escape}");
    await expect.poll(picker.popover).toBeNull();
    expect(inner.activeElement).toBe(picker.trigger());
  });
});

describe("the picker on a phone-sized screen (item 7)", () => {
  test.each(["start", "end"] as const)(
    "keeps the popover inside the screen, lined up with the %s of its button",
    async (align) => {
      await page.viewport(PHONE.width, PHONE.height);
      await expect.poll(() => window.innerWidth).toBe(PHONE.width);
      mount(<Toolbar align={align} />);
      const picker = await openPicker();

      const screenWidth = document.documentElement.clientWidth;
      const box = (picker.popover() as HTMLElement).getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(screenWidth);
      expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
      // Never wider than nine tenths of the screen, however long the names are.
      expect(box.width).toBeLessThanOrEqual(screenWidth * 0.9 + 0.5);
      // The page cannot be scrolled sideways to find a cut-off part.
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        screenWidth,
      );
      // A name that does not fit is cut short inside its row, and the row stays inside the box.
      for (const row of picker.rows()) {
        expect(row.getBoundingClientRect().right).toBeLessThanOrEqual(
          box.right,
        );
      }

      // It still works at this size: a tap ticks a column, and a drag moves one.
      await commands.tap(pointOn(picker.checkbox(LONG[1]?.label as string)));
      await expect
        .poll(() => picker.checkbox(LONG[1]?.label as string).checked)
        .toBe(false);
      await pressOn(
        picker.rows()[0]?.querySelector("[data-fb-column-handle]") as Element,
      );
      await moveTo(lowerHalf(picker.rows()[2] as Element));
      await release();
      await expect
        .poll(() => picker.rows()[2]?.textContent)
        .toContain("Name of the product");
    },
  );
});

describe("the picker inside the filter builder (item 8)", () => {
  test("takes its drag styles from its own rules, not the builder's", async () => {
    mount(<BuilderWithPicker />);
    const picker = await openPicker();
    // The picker really is inside the builder's own element.
    expect(picker.list().closest(".fb")).not.toBeNull();

    await pressOn(picker.handle("Name"));
    await moveTo(lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");

    // Only the held row fades. The list and the other rows keep their full colour.
    expect(getComputedStyle(picker.row("Name")).opacity).toBe("0.4");
    expect(getComputedStyle(picker.list()).opacity).toBe("1");
    expect(getComputedStyle(picker.row("Price")).opacity).toBe("1");

    // The drop line sits on the row's own edge. The builder's line sits in the gap above
    // its rows, several pixels higher.
    const line = getComputedStyle(picker.row("Notes"), "::before");
    expect(line.content).toBe('""');
    expect(line.height).toBe("2px");
    expect(line.top).toBe("-1px");
    // A row with no drop mark draws no line at all.
    expect(getComputedStyle(picker.row("Price"), "::before").content).toBe(
      "none",
    );

    // Below the last row, the line hangs from the row's bottom edge.
    await moveTo(pointOn(picker.row("Notes"), 0.5, 0.95));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("after");
    const lastLine = getComputedStyle(picker.row("Notes"), "::before");
    expect(lastLine.bottom).toBe("-1px");
    expect(lastLine.height).toBe("2px");

    await release();
    await expect
      .poll(picker.listed)
      .toEqual(["Price", "Stock", "Notes", "Name"]);
    // Nothing of the drag is left on the builder's own rows either.
    expect(
      document.querySelectorAll(".fb [data-fb-item][data-dragging]").length,
    ).toBe(0);
  });
});

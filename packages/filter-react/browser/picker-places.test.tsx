import type {
  ColumnDefinition,
  ColumnSettings,
  FieldDefinition,
  FilterDefinition,
} from "@arvilmena/filter-core";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { describe, expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { ColumnPicker, type ColumnPickerProps } from "../src/ui/ColumnPicker";
import { FilterBuilder } from "../src/ui/FilterBuilder";
import { useColumnSettings } from "../src/useColumnSettings";
import { BLANK_PAGE_PATH } from "./fixture-paths";
import {
  COLUMNS,
  type Counter,
  manyColumns,
  openPicker,
  PickerApp,
  type PickerParts,
} from "./support/apps";
import { untilBlank } from "./support/fixture-page";
import { mount } from "./support/mount";
import {
  clickOn,
  lowerHalf,
  moveTo,
  pointOn,
  pressOn,
  release,
} from "./support/pointer";
import { addStyles, shadowStage } from "./support/shadow";
import { VIEWPORT } from "./viewport";

// The picker in the places an app may put it: a closed shadow tree, a frame, a phone-sized
// screen and the filter builder.

/** Checks that a tap still ticks a column of `LONG`, and that a drag still moves one. */
async function tapAndDragStillWork(picker: PickerParts): Promise<void> {
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

/** The gap the picker keeps between its popover and the edge of the screen, in pixels. */
const MARGIN = 8;

/**
 * Whether the popover lies inside the visible part of its own page, sideways, with the margin
 * kept on both sides. A browser may round a place by part of a pixel, so half a pixel is let
 * through.
 */
function isInsideScreen(popover: HTMLElement | null): boolean {
  if (popover === null) return false;
  const box = popover.getBoundingClientRect();
  const screenWidth = popover.ownerDocument.documentElement.clientWidth;
  return box.left >= MARGIN - 0.5 && box.right <= screenWidth - MARGIN + 0.5;
}

/** Whether the page can be scrolled sideways, as it can when something runs past its edge. */
function scrollsSideways(page: Document = document): boolean {
  return page.documentElement.scrollWidth > page.documentElement.clientWidth;
}

/** Changes the size of the test page's window, and waits until the page has that size. */
async function resizeTo(size: { width: number; height: number }) {
  await page.viewport(size.width, size.height);
  await expect.poll(() => window.innerWidth).toBe(size.width);
  await expect.poll(() => window.innerHeight).toBe(size.height);
}

/** A page header with the picker at one end, as an app's toolbar has it. */
function Toolbar({
  align,
  place = align === "end" ? "flex-end" : "flex-start",
  columns = LONG,
}: {
  align: "start" | "end";
  /** Where in the header the picker's button sits. Defaults to the end it lines up with. */
  place?: "flex-start" | "center" | "flex-end";
  columns?: readonly ColumnDefinition[];
}) {
  const state = useColumnSettings({ columns });
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

/** Lets a test apply the change that `LateApp` is holding back. */
interface LateControl {
  apply: () => void;
  /** How many changes the picker has asked for. */
  asked: number;
}

/**
 * An app that owns the column settings, and applies a change only when the test says so. An
 * app does this when it saves a change first, and draws it once the save has answered.
 */
function LateApp({
  control,
  renderTrigger,
}: {
  control: LateControl;
  renderTrigger?: ColumnPickerProps["renderTrigger"];
}) {
  const [value, setValue] = useState<ColumnSettings | null>(null);
  const waiting = useRef<ColumnSettings | null>(null);
  const state = useColumnSettings({
    columns: COLUMNS,
    value,
    onChange: (next) => {
      waiting.current = next;
      control.asked += 1;
    },
  });
  useEffect(() => {
    control.apply = () => setValue(waiting.current);
  }, [control]);
  return <ColumnPicker renderTrigger={renderTrigger} state={state} />;
}

/**
 * The picker's button with plain text beside it, inside the picker's own element. A click on
 * the text is a click inside the picker, so the list stays open, and the text takes no focus.
 */
const triggerWithText: ColumnPickerProps["renderTrigger"] = (props) => (
  <>
    <button className="fb-button fb-columns-trigger" {...props}>
      Columns
    </button>
    <span data-testid="beside-trigger"> of the table</span>
  </>
);

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

describe.each(["open", "closed"] as const)(
  "the picker inside a shadow tree that is %s (item 6)",
  (mode) => {
    /**
     * Draws the app inside a shadow tree: a part of the page that hides its insides. A closed
     * one hides them even from scripts, and only this test keeps a way in.
     */
    async function openInShadow(
      changed?: Counter,
      /** Drawn in the tree in place of the usual app around the picker. */
      app?: ReactNode,
    ): Promise<{
      picker: PickerParts;
      shadow: ShadowRoot;
      outside: HTMLButtonElement;
    }> {
      const { host, shadow, container, outside } = shadowStage(mode);
      mount(app ?? <PickerApp changed={changed} />, container);
      // The page cannot see into a closed tree.
      expect(host.shadowRoot).toBe(mode === "open" ? shadow : null);
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

    // Moving a row takes it off the page and puts it back, which loses the keyboard focus. On
    // a plain page and in a frame React itself puts the focus back, so the tests there pass
    // with or without the picker's own code for it. React does not look inside a shadow tree.
    // So these two tests are the ones that fail when the picker's code is taken out.
    test("keeps the focus on the handle after a move by keyboard", async () => {
      const { picker, shadow } = await openInShadow();
      picker.handle("Price").focus();
      await userEvent.keyboard("{ArrowDown}");
      await expect
        .poll(picker.listed)
        .toEqual(["Name", "Stock", "Price", "Notes"]);
      await expect
        .poll(() => shadow.activeElement)
        .toBe(picker.handle("Price"));
      await userEvent.keyboard("{ArrowDown}");
      await expect
        .poll(picker.listed)
        .toEqual(["Name", "Stock", "Notes", "Price"]);
      await expect
        .poll(() => shadow.activeElement)
        .toBe(picker.handle("Price"));
      expect(picker.announced()).toBe("Price moved to position 4 of 4.");

      // Escape closes the picker and hands the focus back to its button.
      await userEvent.keyboard("{Escape}");
      await expect.poll(picker.popover).toBeNull();
      expect(shadow.activeElement).toBe(picker.trigger());
    });

    test("keeps the focus on the handle when the app applies the move late", async () => {
      const control: LateControl = { apply: () => {}, asked: 0 };
      const { picker, shadow } = await openInShadow(
        undefined,
        <LateApp control={control} />,
      );
      const before = ["Name", "Price", "Stock", "Notes"];
      const after = ["Name", "Stock", "Price", "Notes"];

      picker.handle("Price").focus();
      await userEvent.keyboard("{ArrowDown}");
      await expect.poll(() => control.asked).toBe(1);
      // The app has the move and has not applied it: nothing on the page has changed.
      expect(picker.listed()).toEqual(before);
      expect(picker.announced()).toBe("");

      control.apply();
      await expect.poll(picker.listed).toEqual(after);
      await expect
        .poll(() => shadow.activeElement)
        .toBe(picker.handle("Price"));
      expect(picker.announced()).toBe("Price moved to position 3 of 4.");
      // The key can be pressed again, and moves the same column.
      await userEvent.keyboard("{ArrowUp}");
      await expect.poll(() => control.asked).toBe(2);
      control.apply();
      await expect.poll(picker.listed).toEqual(before);
      await expect
        .poll(() => shadow.activeElement)
        .toBe(picker.handle("Price"));

      // A person who went on to another control meanwhile keeps their place.
      await userEvent.keyboard("{ArrowDown}");
      await expect.poll(() => control.asked).toBe(3);
      picker.reset().focus();
      control.apply();
      await expect.poll(picker.listed).toEqual(after);
      expect(shadow.activeElement).toBe(picker.reset());
    });

    test("leaves the focus alone when a click took it from the handle before a late move", async () => {
      const control: LateControl = { apply: () => {}, asked: 0 };
      const { picker, shadow } = await openInShadow(
        undefined,
        <LateApp control={control} renderTrigger={triggerWithText} />,
      );
      picker.handle("Price").focus();
      await userEvent.keyboard("{ArrowDown}");
      await expect.poll(() => control.asked).toBe(1);

      // The person clicks plain text while the app still holds the move. Nothing holds the
      // focus afterwards, and the list is still open.
      await clickOn(
        shadow.querySelector('[data-testid="beside-trigger"]') as Element,
      );
      await expect.poll(() => shadow.activeElement).toBeNull();
      expect(picker.popover()).not.toBeNull();

      control.apply();
      await expect
        .poll(picker.listed)
        .toEqual(["Name", "Stock", "Price", "Notes"]);
      // The move is read out in the same step that would give the focus back. So once it has
      // been read out, the focus is where that step left it.
      await expect
        .poll(picker.announced)
        .toBe("Price moved to position 3 of 4.");
      // The move did not take the focus away, so the handle does not take it back.
      expect(shadow.activeElement).toBeNull();
      expect(document.activeElement).toBe(document.body);
    });
  },
);

describe("the picker inside an embedded page (item 6)", () => {
  /**
   * Draws the app into a frame (a page within the page) from the outer page, as an app does
   * that draws into a preview pane. The frame has a document of its own.
   */
  async function openInFrame(
    changed?: Counter,
    /** Drawn in the frame in place of the usual app around the picker. */
    app?: ReactNode,
  ): Promise<{
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
    frame.src = BLANK_PAGE_PATH;
    document.body.append(outside, frame);
    // A frame starts with a throwaway empty page. The real one is there once it has loaded.
    await untilBlank(frame);
    const inner = frame.contentDocument as Document;
    addStyles(inner.head);
    mount(
      app ?? <PickerApp changed={changed} />,
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
    await expect.poll(picker.isDragging).toBe(false);
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

  test("keeps the popover inside the frame's own screen, as the frame changes size", async () => {
    // The button is at the frame's right edge, and the popover lines up with the button's
    // left edge. So the popover would run past the right edge of the frame.
    const { picker, frame, inner } = await openInFrame(
      undefined,
      <Toolbar align="start" place="flex-end" />,
    );
    // The frame is far narrower than the test page, which has room to spare on the right.
    // Only a popover measured against the frame's own screen is moved.
    expect(inner.documentElement.clientWidth).toBeLessThan(
      document.documentElement.clientWidth / 2,
    );
    expect(isInsideScreen(picker.popover())).toBe(true);
    expect(scrollsSideways(inner)).toBe(false);

    // The frame's window changes size, and the test page's window does not.
    frame.style.width = "330px";
    await expect.poll(() => inner.documentElement.clientWidth).toBe(330);
    await expect.poll(() => isInsideScreen(picker.popover())).toBe(true);
    expect(scrollsSideways(inner)).toBe(false);
  });
});

describe("the picker's popover in a closed shadow tree (item 6)", () => {
  test("stays inside the screen", async () => {
    await resizeTo(PHONE);
    const { shadow, container } = shadowStage("closed");
    mount(<Toolbar align="start" place="center" />, container);
    const picker = await openPicker(shadow);
    expect(isInsideScreen(picker.popover())).toBe(true);
    expect(scrollsSideways()).toBe(false);
  });
});

describe("the picker on a phone-sized screen (item 7)", () => {
  test.each(["start", "end"] as const)(
    "keeps the popover inside the screen, lined up with the %s of its button",
    async (align) => {
      await resizeTo(PHONE);
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
      await tapAndDragStillWork(picker);
    },
  );

  // With the button in the middle of the screen, a popover with long names is wider than the
  // room on either side of the button. So the picker moves it back inside the screen.
  test.each(["start", "end"] as const)(
    "keeps the popover inside the screen when its button is in the middle (align %s)",
    async (align) => {
      await resizeTo(PHONE);
      mount(<Toolbar align={align} place="center" />);
      const picker = await openPicker();

      const screenWidth = document.documentElement.clientWidth;
      const box = (picker.popover() as HTMLElement).getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(screenWidth);
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
        screenWidth,
      );
      expect(isInsideScreen(picker.popover())).toBe(true);

      // A tick makes the button wider ("1 hidden"), which moves the button's edges. The
      // popover is still inside the screen afterwards.
      const before = picker.trigger().getBoundingClientRect().width;
      await commands.tap(pointOn(picker.checkbox(LONG[1]?.label as string)));
      await expect
        .poll(() => picker.trigger().getBoundingClientRect().width)
        .toBeGreaterThan(before);
      expect(isInsideScreen(picker.popover())).toBe(true);
      expect(scrollsSideways()).toBe(false);
    },
  );

  // The side `align` names is the wrong one for where the button is: the popover would open
  // away from the screen.
  test.each([
    { align: "start", place: "flex-end", where: "far right" },
    { align: "end", place: "flex-start", where: "far left" },
  ] as const)(
    "keeps the popover inside the screen with its button at the $where and align $align",
    async ({ align, place }) => {
      await resizeTo(PHONE);
      mount(<Toolbar align={align} place={place} />);
      const picker = await openPicker();
      expect(isInsideScreen(picker.popover())).toBe(true);
      expect(scrollsSideways()).toBe(false);

      // It still works where it was moved to: a tap ticks a column, and a drag moves one.
      await tapAndDragStillWork(picker);
      expect(isInsideScreen(picker.popover())).toBe(true);
    },
  );

  test.each(["start", "end"] as const)(
    "moves the popover only as far as it must (align %s)",
    async (align) => {
      // On the usual wide screen there is room on the side `align` names.
      mount(<Toolbar align={align} place="center" />);
      const picker = await openPicker();
      const edge = align === "start" ? "left" : "right";
      // How far the popover's edge is from the button's edge. A browser may round a place
      // by part of a pixel, so under half a pixel counts as lined up.
      const isLinedUp = (): boolean =>
        Math.abs(
          (picker.popover() as HTMLElement).getBoundingClientRect()[edge] -
            picker.trigger().getBoundingClientRect()[edge],
        ) < 0.5;
      // The popover's edge is on the button's edge: it was not moved.
      expect(isLinedUp()).toBe(true);

      // The window is made narrow while the picker is open.
      await resizeTo(PHONE);
      await expect.poll(() => isInsideScreen(picker.popover())).toBe(true);
      expect(scrollsSideways()).toBe(false);
      // It moved towards the middle, and stopped at the margin: no further than needed.
      const box = (picker.popover() as HTMLElement).getBoundingClientRect();
      const gap =
        align === "start"
          ? document.documentElement.clientWidth - box.right
          : box.left;
      expect(Math.abs(gap - MARGIN)).toBeLessThanOrEqual(0.5);
      expect(picker.popover()).not.toBeNull();

      // Wide again: the popover goes back to the button's edge.
      await resizeTo(VIEWPORT);
      await expect.poll(isLinedUp).toBe(true);
    },
  );

  test("keeps the buttons below a long list in reach on a short screen", async () => {
    await resizeTo({ width: 480, height: 260 });
    mount(<Toolbar align="start" columns={manyColumns(40)} />);
    const picker = await openPicker();

    const screenHeight = document.documentElement.clientHeight;
    const popover = picker.popover() as HTMLElement;
    expect(popover.getBoundingClientRect().bottom).toBeLessThanOrEqual(
      screenHeight,
    );
    expect(picker.reset().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      screenHeight,
    );
    // The list gave up the height, and scrolls to its other rows.
    const list = picker.list();
    expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(
      screenHeight,
    );

    // A taller window gives the list its usual height back, while the picker is open.
    const short = list.clientHeight;
    await resizeTo({ width: 480, height: 700 });
    await expect.poll(() => list.clientHeight).toBeGreaterThan(short);
  });
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

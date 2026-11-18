import type { FieldDefinition, FilterDefinition } from "@arvilmena/filter-core";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import type { ColumnPickerProps } from "../src/ui/ColumnPicker";
import { FilterBuilder } from "../src/ui/FilterBuilder";
import { openPicker, PickerApp, standardRow } from "./support/apps";
import { mount } from "./support/mount";
import { clickAt, clickOn } from "./support/pointer";
import { barePadding, shadowStage } from "./support/shadow";

// A press on the bare host of a shadow tree (a part of the page that hides its insides): on
// the host's own padding, where nothing inside the tree is drawn. It is outside the picker, so
// the picker closes.
//
// Only a real browser can settle this. The page is told of such a press exactly as it is told
// of a press inside the tree, and a closed tree hides the difference altogether. The picker
// tells the two apart by the order in which the browser calls the host's listeners.

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
  ],
};

/** A filter builder with one condition, whose field picker a test opens. */
function BuilderApp() {
  const [filter, setFilter] = useState(FILTER);
  return <FilterBuilder fields={FIELDS} onChange={setFilter} value={filter} />;
}

describe.each(["open", "closed"] as const)(
  "a press on the bare host of a %s shadow tree",
  (mode) => {
    test("closes the column picker, which a press inside keeps open", async () => {
      const { host, shadow, container } = shadowStage(mode);
      mount(<PickerApp />, container);
      const picker = await openPicker(shadow);

      // A press inside: the column is hidden, and the list is still there.
      await clickOn(picker.row("Price").querySelector("label") as Element);
      await expect.poll(picker.table).toBe("name stock");
      expect(picker.popover()).not.toBeNull();

      await clickAt(barePadding(host));
      await expect.poll(picker.popover).toBeNull();

      // The picker still works afterwards: it opens, and closes the same way again.
      await clickOn(picker.trigger());
      await expect.poll(picker.popover).not.toBeNull();
      await clickAt(barePadding(host));
      await expect.poll(picker.popover).toBeNull();
    });

    test("closes the builder's field picker, which a press inside keeps open", async () => {
      const { host, shadow, container } = shadowStage(mode);
      // The field picker also closes when its search box loses the focus, which a press on
      // the padding would cause. This host keeps the focus where it is, as an app's own
      // handler may. So only the place of the press can close the picker here.
      host.addEventListener("mousedown", (event) => {
        if (event.target === host) event.preventDefault();
      });
      mount(<BuilderApp />, container);
      const popover = () => shadow.querySelector(".fb-picker-popover");
      const options = () => shadow.querySelectorAll(".fb-picker-option").length;
      await expect
        .poll(() => shadow.querySelector(".fb-picker-button"))
        .not.toBeNull();
      await clickOn(shadow.querySelector(".fb-picker-button") as Element);
      await expect.poll(popover).not.toBeNull();

      // A press inside, on the search box. Typing then narrows the list, which shows that the
      // list is still open and in use.
      await clickOn(shadow.querySelector(".fb-picker-search") as Element);
      await userEvent.keyboard("amo");
      await expect.poll(options).toBe(1);
      expect(popover()).not.toBeNull();

      await clickAt(barePadding(host));
      await expect.poll(popover).toBeNull();
    });
  },
);

/** Stops every press at `element` on its way down, as an app's own code around a picker may. */
function stopPressesAt(element: EventTarget): () => void {
  const stop = (press: Event): void => press.stopPropagation();
  element.addEventListener("pointerdown", stop, true);
  return () => element.removeEventListener("pointerdown", stop, true);
}

describe("a press in an open shadow tree whose host stops presses on their way down", () => {
  // No listener inside the tree hears a press here. The page's own listener does, and an
  // open tree shows it the whole path of the press, so it tells the press apart itself.
  test("closes the column picker beside it, and keeps it open inside it", async () => {
    const { host, shadow, container } = shadowStage("open");
    stopPressesAt(host);
    mount(<PickerApp />, container);
    const picker = await openPicker(shadow);

    // A press inside: the column is hidden, and the list is still there.
    await clickOn(picker.row("Price").querySelector("label") as Element);
    await expect.poll(picker.table).toBe("name stock");
    expect(picker.popover()).not.toBeNull();

    // Beside the picker, inside the same tree. The text takes no focus, so only the place
    // of the press can tell the picker to close.
    await clickOn(picker.plainText());
    await expect.poll(picker.popover).toBeNull();

    // On the host's bare padding.
    await clickOn(picker.trigger());
    await expect.poll(picker.popover).not.toBeNull();
    await clickAt(barePadding(host));
    await expect.poll(picker.popover).toBeNull();
  });
});

describe("a press in a closed shadow tree that is stopped on its way down", () => {
  // The limit that has no fix. A closed tree hides from the page whether a press inside it
  // was on the picker or beside it. Only the picker's listener inside the tree can tell, and
  // a press that is stopped before it gets there never reaches that listener. The picker
  // stays open: closing on a guess would also close it for a press on its own rows.
  test.each([
    { where: "at the tree's host", above: false },
    { where: "above the tree's host", above: true },
  ])(
    "keeps the column picker open for a press beside it, stopped $where",
    async ({ above }) => {
      const { host, shadow, container } = shadowStage("closed");
      const letThrough = stopPressesAt(above ? document.body : host);
      mount(<PickerApp />, container);
      const picker = await openPicker(shadow);

      await clickOn(picker.plainText());
      // A click on a name comes after that press, and still ticks the box. So the press has
      // been dealt with by the time the table changes, and the list is still there.
      await clickOn(picker.row("Price").querySelector("label") as Element);
      await expect.poll(picker.table).toBe("name stock");
      expect(picker.popover()).not.toBeNull();

      // The same press closes the picker once nothing stops it.
      letThrough();
      await clickOn(picker.plainText());
      await expect.poll(picker.popover).toBeNull();
    },
  );
});

/**
 * A row with a slot after its name: a gap that shows an element the app keeps outside the
 * tree, as a child of the tree's host. The slot is named after the column.
 */
const rowWithSlot: NonNullable<ColumnPickerProps["renderRow"]> = (row) => (
  <>
    {standardRow(row)}
    <slot name={row.column.key} />
  </>
);

describe("a press on an element shown through a slot of a closed shadow tree", () => {
  // The page sees such an element, so a press on it is not told as a press on the host,
  // and its path outside the tree does not say which slot shows it.
  test("keeps the picker open on a button in a row, and closes it on one beside the picker", async () => {
    const { host, shadow, container } = shadowStage("closed");
    // Above the picker, so the open list never covers what it shows.
    const besideSlot = shadow.insertBefore(
      document.createElement("slot"),
      container,
    );
    besideSlot.name = "beside";
    const inRow = host.appendChild(document.createElement("button"));
    inRow.slot = "price";
    inRow.textContent = "Details";
    const beside = host.appendChild(document.createElement("button"));
    beside.slot = "beside";
    beside.textContent = "Beside the picker";
    let details = 0;
    inRow.addEventListener("click", () => {
      details += 1;
    });
    mount(<PickerApp picker={{ renderRow: rowWithSlot }} />, container);
    const picker = await openPicker(shadow);
    // The button is drawn inside the row of its column.
    const row = picker.row("Price").getBoundingClientRect();
    const button = inRow.getBoundingClientRect();
    expect(button.width).toBeGreaterThan(0);
    expect(button.left).toBeGreaterThanOrEqual(row.left);
    expect(button.right).toBeLessThanOrEqual(row.right);
    expect(button.top).toBeGreaterThanOrEqual(row.top);
    expect(button.bottom).toBeLessThanOrEqual(row.bottom);

    await clickOn(inRow);
    await expect.poll(() => details).toBe(1);
    expect(picker.popover()).not.toBeNull();
    // The picker still works, and is still open, after another click inside it.
    await clickOn(picker.row("Stock").querySelector("label") as Element);
    await expect.poll(picker.table).toBe("name price");
    expect(picker.popover()).not.toBeNull();

    await clickOn(beside);
    await expect.poll(picker.popover).toBeNull();
  });
});

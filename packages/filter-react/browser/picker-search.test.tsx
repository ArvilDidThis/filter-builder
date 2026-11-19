import type { ColumnDefinition } from "@arvilmena/filter-core";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import {
  COLUMNS,
  type Counter,
  manyColumns,
  mountOpenPicker,
  type PickerParts,
} from "./support/apps";
import { clickOn, moveTo, pointOn, pressOn, release } from "./support/pointer";

// The picker's search box under a real keyboard: what is listed while a person types, where
// the focus stays, and what the handles do meanwhile.

/** Forty columns, the first three hidden at the start. */
const LONG: readonly ColumnDefinition[] = manyColumns(40).map(
  (column, index) => (index < 3 ? { ...column, defaultHidden: true } : column),
);

const searchBox = (): HTMLInputElement =>
  document.querySelector(".fb-columns-search-input") as HTMLInputElement;
const status = (): string | undefined =>
  document.querySelector(".fb-columns-search-status")?.textContent ?? undefined;

/** Puts the focus in the search box with a real click, and types into it. */
async function typeSearch(text: string): Promise<void> {
  await clickOn(searchBox());
  await expect.poll(() => document.activeElement).toBe(searchBox());
  await userEvent.keyboard(text);
}

/** The width of the open list's box, in whole pixels. */
const popoverWidth = (picker: PickerParts): number =>
  Math.round((picker.popover() as HTMLElement).getBoundingClientRect().width);

describe("the search box of the picker", () => {
  test("is there for a long list and not for a short one", async () => {
    await mountOpenPicker({ columns: LONG });
    expect(searchBox()).not.toBeNull();
  });

  test("is not there for a short list, unless the app asks for it", async () => {
    await mountOpenPicker({ columns: COLUMNS });
    expect(searchBox()).toBeNull();
  });

  test("is there for a short list when the app asks for it", async () => {
    await mountOpenPicker({ columns: COLUMNS, picker: { search: true } });
    expect(searchBox()).not.toBeNull();
  });

  test("narrows the list as a person types, and keeps the focus in the box", async () => {
    const picker = await mountOpenPicker({ columns: LONG });
    const widthBefore = popoverWidth(picker);
    await typeSearch("column 1");
    // "Column 1", "Column 10" to "Column 19", "Column 21" and "Column 31".
    await expect.poll(() => picker.listed().length).toBe(13);
    expect(document.activeElement).toBe(searchBox());
    expect(status()).toBe(
      "13 of 40 columns match. Clear the search to move columns.",
    );
    expect(picker.announced()).toBe("13 of 40 columns match.");

    await userEvent.keyboard("9");
    await expect.poll(picker.listed).toEqual(["Column 19"]);
    expect(document.activeElement).toBe(searchBox());
    expect(picker.announced()).toBe("1 of 40 columns match.");
    // The box does not jump narrower while the list is short.
    expect(popoverWidth(picker)).toBe(widthBefore);

    await userEvent.keyboard("zz");
    await expect.poll(() => picker.listed().length).toBe(0);
    expect(picker.announced()).toBe("No columns match.");
  });

  test("turns the handles off while a search is on, and on again after", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ columns: LONG, changed });
    await typeSearch("column 2");
    // "Column 2", "Column 12", "Column 20" to "Column 29" and "Column 32".
    await expect.poll(() => picker.listed().length).toBe(13);
    const handle = picker.handle("Column 20");
    expect(handle.disabled).toBe(true);
    // A real drag on a handle that is turned off moves nothing.
    await pressOn(handle);
    await moveTo(pointOn(picker.row("Column 29"), 0.5, 0.9));
    expect(picker.isDragging()).toBe(false);
    await release();
    expect(picker.listed()[0]).toBe("Column 2");
    expect(changed.count).toBe(0);

    // Escape in the box clears the search and keeps the picker open.
    await typeSearch("{Escape}");
    await expect.poll(() => picker.listed().length).toBe(40);
    expect(searchBox().value).toBe("");
    expect(status()).toBeUndefined();
    expect(picker.handle("Column 20").disabled).toBe(false);

    picker.handle("Column 20").focus();
    await userEvent.keyboard("{Home}");
    await expect.poll(() => picker.listed()[0]).toBe("Column 20");
    expect(changed.count).toBe(1);
  });

  test("lets a person tick a listed column, and Show all reach the ones not listed", async () => {
    const picker = await mountOpenPicker({ columns: LONG });
    await typeSearch("column 39");
    await expect.poll(picker.listed).toEqual(["Column 39"]);
    await clickOn(picker.checkbox("Column 39"));
    await expect.poll(() => picker.table()?.includes("c39")).toBe(false);

    // "Column 0" to "Column 2" start hidden and are not listed. "Show all" shows them too.
    await clickOn(picker.showAll());
    await expect.poll(() => picker.table()?.split(" ").length).toBe(40);
    expect(picker.table()?.startsWith("c0 c1 c2 ")).toBe(true);
    expect(picker.announced()).toBe("All columns are shown.");
    // The search is still as typed.
    expect(picker.listed()).toEqual(["Column 39"]);
  });

  test("lets Hide all reach the columns that are not listed", async () => {
    const picker = await mountOpenPicker({ columns: LONG });
    await typeSearch("column 39");
    await expect.poll(picker.listed).toEqual(["Column 39"]);
    await clickOn(picker.hideAll());
    await expect.poll(picker.table).toBe("");
    expect(picker.announced()).toBe(
      "All columns that can be hidden are hidden.",
    );
    // The search is still as typed.
    expect(picker.listed()).toEqual(["Column 39"]);
  });

  test("closes the picker on Escape once the box is empty", async () => {
    const picker = await mountOpenPicker({ columns: LONG });
    await typeSearch("x");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => searchBox().value).toBe("");
    expect(picker.popover()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(picker.popover).toBeNull();
    await expect.poll(() => document.activeElement).toBe(picker.trigger());
  });
});

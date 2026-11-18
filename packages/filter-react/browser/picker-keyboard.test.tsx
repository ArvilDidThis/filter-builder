import type { ColumnSettings } from "@arvilmena/filter-core";
import { useEffect, useState } from "react";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { ColumnPicker } from "../src/ui/ColumnPicker";
import { useColumnSettings } from "../src/useColumnSettings";
import {
  COLUMNS,
  type Counter,
  manyColumns,
  mountOpenPicker,
  openPicker,
} from "./support/apps";
import { mount } from "./support/mount";
import { clickOn } from "./support/pointer";

// The picker under a real keyboard: which element holds the focus after a key press is
// something only a real browser decides.
//
// These tests check what a person gets on a plain page: the focus stays on the moved handle.
// React puts the focus back there itself, so they do not guard the picker's own code for it.
// The tests that do are in `picker-places.test.tsx`, inside a closed shadow tree, where React
// does not put the focus back.

/** Whether `row` is wholly inside the visible part of `list`. */
function isInView(row: Element, list: Element): boolean {
  const rowBox = row.getBoundingClientRect();
  const listBox = list.getBoundingClientRect();
  // Half a pixel of slack, for places a browser rounds.
  return (
    rowBox.top >= listBox.top - 0.5 && rowBox.bottom <= listBox.bottom + 0.5
  );
}

describe("moving a column with the keyboard (item 4)", () => {
  test("keeps the focus on the handle, so the key can be pressed again", async () => {
    const picker = await mountOpenPicker();
    picker.handle("Price").focus();

    await userEvent.keyboard("{ArrowDown}");
    await expect
      .poll(picker.listed)
      .toEqual(["Name", "Stock", "Price", "Notes"]);
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Price"));
    expect(picker.announced()).toBe("Price moved to position 3 of 4.");

    await userEvent.keyboard("{ArrowDown}");
    await expect
      .poll(picker.listed)
      .toEqual(["Name", "Stock", "Notes", "Price"]);
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Price"));

    await userEvent.keyboard("{Home}");
    await expect
      .poll(picker.listed)
      .toEqual(["Price", "Name", "Stock", "Notes"]);
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Price"));

    await userEvent.keyboard("{ArrowUp}");
    // Already first: nothing moves, and the focus stays.
    await userEvent.keyboard("{End}");
    await expect
      .poll(picker.listed)
      .toEqual(["Name", "Stock", "Notes", "Price"]);
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Price"));
    expect(picker.table()).toBe("name stock price");
  });

  test("keeps the moved row in view in a long list", async () => {
    const picker = await mountOpenPicker({ columns: manyColumns(40) });
    const list = picker.list();
    picker.handle("Column 0").focus();

    await userEvent.keyboard("{End}");
    await expect.poll(() => picker.listed().at(-1)).toBe("Column 0");
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Column 0"));
    await expect.poll(() => isInView(picker.row("Column 0"), list)).toBe(true);
    expect(list.scrollTop).toBeGreaterThan(0);

    await userEvent.keyboard("{Home}");
    await expect.poll(() => picker.listed()[0]).toBe("Column 0");
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Column 0"));
    await expect.poll(() => isInView(picker.row("Column 0"), list)).toBe(true);

    // One step at a time, past the bottom of what is shown: the row stays in view.
    for (let step = 1; step <= 12; step++) {
      await userEvent.keyboard("{ArrowDown}");
      await expect.poll(() => picker.listed()[step]).toBe("Column 0");
    }
    await expect.poll(() => isInView(picker.row("Column 0"), list)).toBe(true);
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Column 0"));
    // The arrow keys moved the column. They did not scroll the page behind the picker.
    expect(window.scrollY).toBe(0);
  });
});

describe("the Show all and Reset buttons (item 5)", () => {
  const isUnavailable = (button: Element): boolean =>
    button.getAttribute("aria-disabled") === "true";

  test("are unavailable exactly while they would change nothing", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ changed });
    // "Notes" starts hidden, and nothing has been changed yet.
    expect(isUnavailable(picker.showAll())).toBe(false);
    expect(isUnavailable(picker.reset())).toBe(true);

    // A real click on the unavailable button does nothing, and the picker stays open.
    await clickOn(picker.reset());
    await clickOn(picker.checkbox("Price"));
    await expect.poll(picker.table).toBe("name stock");
    expect(changed.count).toBe(1);
    expect(picker.announced()).toBe("");
    expect(isUnavailable(picker.reset())).toBe(false);

    await clickOn(picker.showAll());
    await expect.poll(picker.table).toBe("name price stock notes");
    expect(isUnavailable(picker.showAll())).toBe(true);
    expect(picker.popover()).not.toBeNull();
    // The click did not throw the focus out of the picker.
    expect(picker.popover()?.contains(document.activeElement)).toBe(true);

    await clickOn(picker.reset());
    await expect.poll(picker.table).toBe("name price stock");
    expect(isUnavailable(picker.reset())).toBe(true);
    expect(isUnavailable(picker.showAll())).toBe(false);
    expect(picker.popover()?.contains(document.activeElement)).toBe(true);
  });

  test("keep the focus when a key press makes them unavailable", async () => {
    const picker = await mountOpenPicker();

    picker.showAll().focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(picker.table).toBe("name price stock notes");
    await expect.poll(() => isUnavailable(picker.showAll())).toBe(true);
    expect(document.activeElement).toBe(picker.showAll());
    await expect.poll(picker.announced).toBe("All columns are shown.");

    // Pressing it again changes nothing, and still keeps the focus.
    await userEvent.keyboard("{Enter}");
    picker.reset().focus();
    await userEvent.keyboard(" ");
    await expect.poll(picker.table).toBe("name price stock");
    await expect.poll(() => isUnavailable(picker.reset())).toBe(true);
    expect(document.activeElement).toBe(picker.reset());
    await expect
      .poll(picker.announced)
      .toBe("The columns are back in their starting order and visibility.");
  });
});

/** Lets a test see what `OwningApp` was asked for, and apply settings of its choice. */
interface OwnerControl {
  /** Every change the picker has asked for, oldest first. */
  asked: ColumnSettings[];
  apply: (settings: ColumnSettings) => void;
}

/**
 * An app that owns the column settings. It applies nothing by itself: the test decides
 * what is applied and when, as an app does that saves a change first, or turns it down.
 */
function OwningApp({ control }: { control: OwnerControl }) {
  const [value, setValue] = useState<ColumnSettings | null>(null);
  const state = useColumnSettings({
    columns: COLUMNS,
    value,
    onChange: (next) => control.asked.push(next),
  });
  useEffect(() => {
    control.apply = setValue;
  }, [control]);
  return (
    <>
      <ColumnPicker state={state} />
      <p data-testid="table">
        {state.visibleColumns.map((column) => column.key).join(" ")}
      </p>
    </>
  );
}

describe("what Show all tells a screen reader in an app that owns the settings", () => {
  const isUnavailable = (button: Element): boolean =>
    button.getAttribute("aria-disabled") === "true";

  test("says nothing when the app turns it down and shows every column in another order", async () => {
    const control: OwnerControl = { asked: [], apply: () => {} };
    mount(<OwningApp control={control} />);
    const picker = await openPicker();

    await clickOn(picker.showAll());
    await expect.poll(() => control.asked.length).toBe(1);
    // The app has the press and has not applied it: nothing on the page has changed.
    expect(picker.table()).toBe("name price stock");

    // The app applies settings of its own instead. They show every column too, in another
    // order, so they are not what the press asked for.
    control.apply({ order: ["price", "name", "stock", "notes"], hidden: [] });
    await expect.poll(picker.table).toBe("price name stock notes");
    await expect.poll(() => isUnavailable(picker.showAll())).toBe(true);
    // A message is put on the page in the same step as the button's new state. So once the
    // button shows it, a message would be there.
    expect(picker.announced()).toBe("");
  });

  test("says that every column is shown once the app applies the press late, unchanged", async () => {
    const control: OwnerControl = { asked: [], apply: () => {} };
    mount(<OwningApp control={control} />);
    const picker = await openPicker();

    await clickOn(picker.showAll());
    await expect.poll(() => control.asked.length).toBe(1);
    expect(picker.announced()).toBe("");

    control.apply(control.asked[0] as ColumnSettings);
    await expect.poll(picker.table).toBe("name price stock notes");
    await expect.poll(picker.announced).toBe("All columns are shown.");
  });
});

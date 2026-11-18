import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import type { ColumnPickerProps } from "../src/ui/ColumnPicker";
import { PickerApp, type PickerParts } from "./support/apps";
import { openInFrame } from "./support/frame";
import { clickOn } from "./support/pointer";

// The picker in a frame (a page within the page) when the keyboard focus leaves it for
// somewhere the picker cannot name. Tab from the frame's last control takes the focus to the
// page around the frame, and the picker closes. The focus leaving for any other reason keeps
// it open.
//
// Only a real browser moves the focus out of a frame, and says whether the frame's page still
// holds it.
//
// One case is out of reach: a person who switches to another window or tab. No browser tells
// the page that it lost the focus when a test brings another tab to the front, so the tests
// below take the focus from the frame by script instead. The frame is told the same things:
// its control loses the focus, no next element is named, and its page no longer holds it.

/**
 * A row whose checkbox and handle have a place in the Tab order spelled out. Safari on a Mac
 * leaves both out of that order unless a system setting is on, and Tab would then leave the
 * frame from any row.
 */
const tabbableRow: NonNullable<ColumnPickerProps["renderRow"]> = (row) => (
  <>
    <input
      className="fb-columns-checkbox"
      {...row.checkboxProps}
      tabIndex={0}
    />
    <button className="fb-columns-handle" {...row.handleProps} tabIndex={0}>
      <span aria-hidden="true">⠿</span>
    </button>
    <label className="fb-columns-label" htmlFor={row.checkboxProps.id}>
      {row.column.label}
    </label>
  </>
);

/** The usual app around the picker, with rows that Tab stops at in every browser. */
function TabbableApp() {
  return <PickerApp picker={{ renderRow: tabbableRow }} />;
}

describe("the picker in an embedded page, when the focus leaves it", () => {
  test("closes when Tab from the frame's last control leaves the frame", async () => {
    const { picker, inner, after } = await openInFrame();
    // "Reset" is the last control in the frame that takes the focus.
    picker.reset().focus();
    await expect.poll(() => inner.activeElement).toBe(picker.reset());
    expect(inner.hasFocus()).toBe(true);

    await userEvent.keyboard("{Tab}");
    await expect.poll(picker.popover).toBeNull();
    // The focus is on the page around the frame, on the next control there.
    expect(inner.hasFocus()).toBe(false);
    await expect.poll(() => document.activeElement).toBe(after);
  });

  test("stays open when Tab moves the focus on inside it", async () => {
    const { picker, inner } = await openInFrame(undefined, <TabbableApp />);
    picker.checkbox("Price").focus();
    await userEvent.keyboard("{Tab}");
    await expect.poll(() => inner.activeElement).toBe(picker.handle("Price"));
    expect(picker.popover()).not.toBeNull();
  });

  test("stays open when the focus leaves the frame with no Tab pressed", async () => {
    const { picker, inner, after } = await openInFrame();
    picker.handle("Price").focus();
    await expect.poll(() => inner.hasFocus()).toBe(true);

    // The focus is taken from the frame, as a switch to another window takes it.
    const lost = untilFocusLost(inner);
    after.focus();
    await lost;
    expect(inner.hasFocus()).toBe(false);
    await stillOpenAndWorking(picker, inner);
  });

  test("stays open when the focus leaves the frame after a Tab that stayed inside", async () => {
    const { picker, inner, after } = await openInFrame(
      undefined,
      <TabbableApp />,
    );
    picker.checkbox("Price").focus();
    await userEvent.keyboard("{Tab}");
    await expect.poll(() => inner.activeElement).toBe(picker.handle("Price"));

    // Tab was the last key pressed, but it did not take the focus away. This does.
    const lost = untilFocusLost(inner);
    after.focus();
    await lost;
    expect(inner.hasFocus()).toBe(false);
    await stillOpenAndWorking(picker, inner);
  });

  test("stays open when a control drops the focus after Tab, and the frame still holds it", async () => {
    const { picker, inner } = await openInFrame();
    // An app that keeps Tab from moving the focus, as one that handles the key itself.
    inner.addEventListener("keydown", (event) => {
      if (event.key === "Tab") event.preventDefault();
    });
    const handle = picker.handle("Price");
    handle.focus();
    await userEvent.keyboard("{Tab}");
    expect(inner.activeElement).toBe(handle);

    // The control gives the focus up, and names no next element. The frame's page keeps it.
    const lost = untilFocusLost(inner);
    handle.blur();
    await lost;
    expect(inner.activeElement).toBe(inner.body);
    expect(inner.hasFocus()).toBe(true);
    await stillOpenAndWorking(picker, inner);
  });
});

/** Waits until a control in the frame has been told that it lost the focus. */
function untilFocusLost(inner: Document): Promise<void> {
  return new Promise((done) => {
    inner.addEventListener("focusout", () => done(), {
      capture: true,
      once: true,
    });
  });
}

/**
 * Checks that the picker is open after it has looked where the focus went, by using it: a
 * real click on a column's name hides that column. A picker that had closed has no such name
 * to click.
 *
 * The picker looks in a task that it queues in the frame's own window when a control loses
 * the focus. Tasks of one window run in the order they were queued, so the task queued here
 * runs after the picker's. The click then takes several screen frames, in which a picker
 * that had decided to close would be drawn closed.
 */
async function stillOpenAndWorking(
  picker: PickerParts,
  inner: Document,
): Promise<void> {
  await new Promise((done) => {
    (inner.defaultView as Window).setTimeout(done, 0);
  });
  expect(picker.popover()).not.toBeNull();
  await clickOn(picker.row("Stock").querySelector("label") as Element);
  await expect.poll(picker.table).toBe("name price");
  expect(picker.popover()).not.toBeNull();
}

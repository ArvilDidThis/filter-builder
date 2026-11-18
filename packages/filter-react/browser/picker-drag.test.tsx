import { useCallback, useEffect, useState } from "react";
import { describe, expect, onTestFinished, test } from "vitest";
import { commands, server, userEvent } from "vitest/browser";
import type { ColumnPickerProps } from "../src/ui/ColumnPicker";
import {
  type Counter,
  manyColumns,
  mountOpenPicker,
  openPicker,
  PickerApp,
  type PickerParts,
  standardRow,
} from "./support/apps";
import { mount } from "./support/mount";
import {
  lowerHalf,
  moveTo,
  type Point,
  pointOn,
  pressOn,
  release,
  upperHalf,
} from "./support/pointer";

// Dragging a column in the picker with a real pointer, at places read from the real layout.

/** Lets a test tell `ReplacingApp` to draw every handle anew. */
interface HandleControl {
  replaceHandles: () => void;
}

/**
 * An app that draws its own rows, and can replace every handle with a new element while the
 * picker stays open. The picker's notes ask an app not to do this to a row that is held.
 */
function ReplacingApp({
  control,
  changed,
}: {
  control: HandleControl;
  changed: Counter;
}) {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    control.replaceHandles = () => setVersion((was) => was + 1);
  }, [control]);
  const renderRow = useCallback<NonNullable<ColumnPickerProps["renderRow"]>>(
    // A new key for the handle makes React put a new element in the old one's place.
    (row) => standardRow(row, version),
    [version],
  );
  return <PickerApp changed={changed} picker={{ renderRow }} />;
}

/**
 * Sends the page one of the events a finger would cause, at a real place on the screen. The
 * browser knows of no such finger, so it gives the handle no pointer capture (the browser
 * sending every later event of a pointer to one element), and never takes one away.
 */
function sendTouch(target: EventTarget, type: string, at: Point): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 7,
      pointerType: "touch",
      isPrimary: true,
      button: type === "pointermove" ? -1 : 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: at.x,
      clientY: at.y,
    }),
  );
}

describe("dragging a column by mouse (item 1)", () => {
  test("moves the column to where it is dropped", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ changed });

    await pressOn(picker.handle("Name"));
    await moveTo(lowerHalf(picker.row("Stock")));
    // The line that marks the drop is drawn above the next row.
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
    expect(picker.isDragging()).toBe(true);
    expect(getComputedStyle(picker.row("Name")).opacity).toBe("0.4");
    // Nothing is asked of the app while the row is held.
    expect(changed.count).toBe(0);

    await release();
    await expect.poll(picker.table).toBe("price stock name");
    expect(picker.listed()).toEqual(["Price", "Stock", "Name", "Notes"]);
    expect(picker.isDragging()).toBe(false);
    expect(changed.count).toBe(1);
  });

  test("moves a column up the list", async () => {
    const picker = await mountOpenPicker();
    await pressOn(picker.handle("Stock"));
    await moveTo(upperHalf(picker.row("Name")));
    await expect.poll(() => picker.row("Name").dataset.drop).toBe("before");
    await release();
    await expect.poll(picker.table).toBe("stock name price");
  });

  test("changes nothing when the column is dropped where it was", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ changed });
    await pressOn(picker.handle("Price"));
    await moveTo(lowerHalf(picker.row("Price")));
    await expect.poll(() => picker.isDragging()).toBe(true);
    await release();
    await expect.poll(() => picker.isDragging()).toBe(false);
    expect(changed.count).toBe(0);
    expect(picker.table()).toBe("name price stock");
  });

  test("gives the drag up on Escape, and keeps the picker open", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ changed });
    await pressOn(picker.handle("Name"));
    await moveTo(lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");

    await userEvent.keyboard("{Escape}");
    await expect.poll(() => picker.isDragging()).toBe(false);
    expect(picker.popover()).not.toBeNull();
    await release();
    // A drag that works again proves the release above was dealt with, and moved nothing.
    await pressOn(picker.handle("Price"));
    await moveTo(lowerHalf(picker.row("Stock")));
    await release();
    await expect.poll(picker.table).toBe("name stock price");
    expect(changed.count).toBe(1);
  });
});

describe("dragging a column by touch (item 1)", () => {
  test("stops a finger on a handle from scrolling the list", async () => {
    const picker = await mountOpenPicker();
    expect(getComputedStyle(picker.handle("Name")).touchAction).toBe("none");
  });

  test("answers a real tap on the button, a name and the page", async () => {
    const picker = await mountOpenPicker();
    await commands.tap(
      pointOn(picker.row("Price").querySelector("label") as Element),
    );
    await expect.poll(picker.table).toBe("name stock");
    expect(picker.popover()).not.toBeNull();
    // A tap outside the picker closes it.
    await commands.tap(pointOn(picker.elsewhere()));
    await expect.poll(picker.popover).toBeNull();
    await commands.tap(pointOn(picker.trigger()));
    await expect.poll(picker.popover).not.toBeNull();
  });

  if (server.browser === "chromium") {
    // Only Chromium lets a test put a real finger down, move it and lift it.
    test("moves the column under a real finger", async () => {
      const picker = await mountOpenPicker({ columns: manyColumns(40) });
      const list = picker.list();
      const kinds: string[] = [];
      document.addEventListener(
        "pointerdown",
        (event) => kinds.push(event.pointerType),
        { capture: true, once: true },
      );

      await commands.touch("start", pointOn(picker.handle("Column 0")));
      await commands.touch("move", pointOn(picker.row("Column 1")));
      await commands.touch("move", lowerHalf(picker.row("Column 3")));
      await expect
        .poll(() => picker.row("Column 4").dataset.drop)
        .toBe("before");
      await commands.touch("end");

      await expect
        .poll(() => picker.listed().slice(0, 5))
        .toEqual(["Column 1", "Column 2", "Column 3", "Column 0", "Column 4"]);
      expect(kinds).toEqual(["touch"]);
      // The finger dragged the row. It did not scroll the list.
      expect(list.scrollTop).toBe(0);
    });
  } else {
    // Playwright can only tap in Firefox and WebKit. So here the page is sent the events a
    // finger would cause, at the real places of the rows.
    test("moves the column under touch events sent to the page", async () => {
      const picker = await mountOpenPicker();
      const handle = picker.handle("Name");
      sendTouch(handle, "pointerdown", pointOn(handle));
      sendTouch(handle, "pointermove", lowerHalf(picker.row("Stock")));
      await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
      sendTouch(handle, "pointerup", lowerHalf(picker.row("Stock")));
      await expect.poll(picker.table).toBe("price stock name");
    });
  }
});

describe("a drag that reaches the list's edge (item 2)", () => {
  test("scrolls the list down by itself, and up again", async () => {
    const picker = await mountOpenPicker({ columns: manyColumns(40) });
    const list = picker.list();
    // The furthest the list scrolls. A browser may round it up or down by part of a pixel.
    const furthest = list.scrollHeight - list.clientHeight;
    expect(furthest).toBeGreaterThan(0);
    const isAtEnd = (): boolean => Math.abs(list.scrollTop - furthest) <= 1;

    await pressOn(picker.handle("Column 0"));
    const bottom = pointOn(list, 0.5, 1);
    await moveTo({ x: bottom.x, y: bottom.y - 6 });
    // The mouse now rests. The list goes on scrolling until it reaches its end.
    await expect.poll(isAtEnd).toBe(true);
    await release();
    await expect.poll(() => picker.listed().at(-1)).toBe("Column 0");

    // The dropped row is last now. WebKit can leave it just below what the list shows, so
    // it is brought into view, as a person would scroll to it.
    picker.handle("Column 0").scrollIntoView({ block: "nearest" });
    await pressOn(picker.handle("Column 0"));
    await expect
      .poll(() => picker.row("Column 0").hasAttribute("data-dragging"))
      .toBe(true);
    const top = pointOn(list, 0.5, 0);
    await moveTo({ x: top.x, y: top.y + 6 });
    await expect.poll(() => list.scrollTop).toBe(0);
    await release();
    await expect.poll(() => picker.listed()[0]).toBe("Column 0");
  });

  test("leaves the list still while the pointer is away from its edges", async () => {
    const picker = await mountOpenPicker({ columns: manyColumns(40) });
    const list = picker.list();
    // The list starts part of the way down, so it has room to scroll either way. At its
    // top, a list that wrongly tried to scroll up would look the same as one that kept still.
    const scrolled = new Promise((done) => {
      list.addEventListener("scroll", done, { once: true });
    });
    list.scrollTop = 200;
    await scrolled;
    const start = list.scrollTop;
    // Counts every scroll of the list from here to the drop. So nothing depends on looking
    // at the right moment: a list that moved at any time is found out.
    let scrolls = 0;
    list.addEventListener("scroll", () => {
      scrolls += 1;
    });

    // The first row that is wholly in view, and two places near the list's middle.
    const top = list.getBoundingClientRect().top;
    const held = picker
      .rows()
      .find((row) => row.getBoundingClientRect().top >= top) as HTMLElement;
    const order = picker.listed();
    await pressOn(held.querySelector("[data-fb-column-handle]") as Element);
    for (const down of [0.4, 0.6]) {
      const before = picker.rows().findIndex((row) => row.dataset.drop);
      await moveTo(pointOn(list, 0.5, down));
      await expect
        .poll(() => picker.rows().findIndex((row) => row.dataset.drop))
        .toBeGreaterThan(before);
    }
    await release();
    // The drop is done once the list shows a new order.
    await expect.poll(picker.listed).not.toEqual(order);
    expect(scrolls).toBe(0);
    expect(list.scrollTop).toBe(start);
  });
});

describe("a drag that does not end with a drop (item 3)", () => {
  // The picker has three ways to end a drag that does not end with a drop on its list. Each
  // has a test of its own, which fails when that way alone is taken out:
  //
  // 1. The list closing ends the drag: "holds nothing when it opens again before the release".
  // 2. The browser taking the capture away ends it: "ends when its handle is replaced".
  // 3. A release is ignored once its list has left the page. No real pointer reaches this one
  //    alone, because ways 1 and 2 always come first. `ColumnPicker.test.tsx` guards it, in
  //    "should ignore a release once the list it was aimed at is gone".
  //
  // This first test is the outcome a person sees. Any one of the three is enough for it.
  test("ends when the popover closes, and moves nothing", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ changed });
    await pressOn(picker.handle("Name"));
    await moveTo(lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");

    // The keyboard focus leaves the picker while the row is held, which closes it.
    picker.elsewhere().focus();
    await expect.poll(picker.popover).toBeNull();
    await release();

    // Opening it again comes after the release, so the release has been dealt with by now.
    await mountedAgain(picker);
    expect(changed.count).toBe(0);
    expect(picker.table()).toBe("name price stock");
    expect(picker.listed()).toEqual(["Name", "Price", "Stock", "Notes"]);
    expect(picker.isDragging()).toBe(false);
    expect(picker.rows().some((row) => row.dataset.drop)).toBe(false);
  });

  test("holds nothing when it opens again before the release", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ changed });
    // A finger the browser gives no capture for. So closing the list takes no capture away,
    // and only the picker itself can end the drag.
    const handle = picker.handle("Name");
    sendTouch(handle, "pointerdown", pointOn(handle));
    sendTouch(handle, "pointermove", lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");

    picker.elsewhere().focus();
    await expect.poll(picker.popover).toBeNull();
    // The finger is still down when the picker opens again.
    await mountedAgain(picker);
    expect(picker.isDragging()).toBe(false);
    expect(picker.rows().some((row) => row.hasAttribute("data-dragging"))).toBe(
      false,
    );
    expect(picker.rows().some((row) => row.dataset.drop)).toBe(false);

    // Lifting the finger over the new list moves nothing.
    sendTouch(document, "pointerup", lowerHalf(picker.row("Stock")));
    await drag(picker, "Price", "Stock");
    expect(picker.table()).toBe("name stock price");
    expect(changed.count).toBe(1);
  });

  test("ends when its handle is replaced while the row is held", async () => {
    const changed: Counter = { count: 0 };
    const control: HandleControl = { replaceHandles: () => {} };
    mount(<ReplacingApp changed={changed} control={control} />);
    const picker = await openPicker();

    const held = picker.handle("Name");
    await pressOn(held);
    await moveTo(lowerHalf(picker.row("Price")));
    await expect.poll(() => picker.row("Stock").dataset.drop).toBe("before");

    // The app draws every handle anew. The browser had captured the pointer on the old
    // handle, and takes the capture away now that the handle is off the page.
    control.replaceHandles();
    await expect.poll(() => picker.handle("Name") !== held).toBe(true);
    // The picker stays open: only the drag ends. The browser tells the page of the lost
    // capture when the pointer next moves.
    await moveTo(lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.isDragging()).toBe(false);
    expect(picker.popover()).not.toBeNull();
    expect(picker.rows().some((row) => row.dataset.drop)).toBe(false);

    await release();
    // A drag that works again proves the release above was dealt with, and moved nothing.
    await drag(picker, "Price", "Stock");
    expect(picker.table()).toBe("name stock price");
    expect(changed.count).toBe(1);
  });

  /** Drags the row named `from` to just below the row named `to` with the real mouse. */
  async function drag(
    picker: PickerParts,
    from: string,
    to: string,
  ): Promise<void> {
    const before = picker.table();
    await pressOn(picker.handle(from));
    await moveTo(lowerHalf(picker.row(to)));
    await release();
    await expect.poll(picker.table).not.toBe(before);
  }

  /** Opens the same picker again with a real click. */
  async function mountedAgain(picker: PickerParts): Promise<void> {
    await moveTo(pointOn(picker.trigger()));
    await commands.mouseDown();
    await commands.mouseUp();
    await expect.poll(picker.popover).not.toBeNull();
  }

  /**
   * Keeps the page from hearing that the pointer was let go, as happens when the release
   * lands where the page cannot hear it. Gives back what was kept from the page, and a way to
   * let the page hear again.
   */
  function loseRelease(): { lost: string[]; restore: () => void } {
    const lost: string[] = [];
    const swallow = (event: Event): void => {
      lost.push(event.type);
      event.stopImmediatePropagation();
    };
    const kinds = ["pointerup", "pointercancel", "lostpointercapture"];
    const restore = (): void => {
      for (const kind of kinds) window.removeEventListener(kind, swallow, true);
    };
    for (const kind of kinds) window.addEventListener(kind, swallow, true);
    onTestFinished(restore);
    return { lost, restore };
  }

  test("ends on the next mouse move after its release was lost", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ changed });
    await pressOn(picker.handle("Name"));
    await moveTo(lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");

    const { lost, restore } = loseRelease();
    await release();
    await expect.poll(() => lost).toContain("pointerup");
    // The button is up, and the picker does not know.
    expect(picker.isDragging()).toBe(true);
    restore();

    // A mouse that moves with no button held shows that the release was missed.
    await moveTo(pointOn(picker.row("Price")));
    await expect.poll(() => picker.isDragging()).toBe(false);
    expect(changed.count).toBe(0);
    expect(picker.table()).toBe("name price stock");
  });

  test("drags as usual on the next press after its release was lost", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ changed });
    const handle = picker.handle("Name");
    await pressOn(handle);
    // A small move that stays on the handle, so the next press needs no move before it.
    await moveTo(pointOn(handle, 0.6, 0.6));
    await expect.poll(() => picker.isDragging()).toBe(true);

    const { lost, restore } = loseRelease();
    await release();
    await expect.poll(() => lost).toContain("pointerup");
    expect(picker.isDragging()).toBe(true);
    restore();

    // The picker is not stuck: the next press on the handle drags as any other.
    await commands.mouseDown();
    await moveTo(lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
    await release();
    await expect.poll(picker.table).toBe("price stock name");
    expect(changed.count).toBe(1);
    expect(picker.isDragging()).toBe(false);
  });
  if (server.browser === "chromium") {
    // A finger gets a new number each time it touches the screen, so the next touch is not
    // taken for the lost one. Only Chromium lets a test send such a touch.
    test("is replaced by the next touch after its release was lost", async () => {
      const changed: Counter = { count: 0 };
      const picker = await mountOpenPicker({ changed });
      await commands.touch("start", pointOn(picker.handle("Name")));
      await expect.poll(() => picker.isDragging()).toBe(true);

      const { lost, restore } = loseRelease();
      await commands.touch("end");
      await expect.poll(() => lost).toContain("pointerup");
      expect(picker.isDragging()).toBe(true);
      restore();

      // Another row, under another touch. It moves, and the row held before does not.
      await commands.touch("start", pointOn(picker.handle("Price")));
      await commands.touch("move", pointOn(picker.row("Stock")));
      await commands.touch("move", lowerHalf(picker.row("Stock")));
      await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
      await commands.touch("end");
      await expect.poll(picker.table).toBe("name stock price");
      expect(changed.count).toBe(1);
      expect(picker.isDragging()).toBe(false);
    });
  }
});

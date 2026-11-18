import { describe, expect, onTestFinished, test } from "vitest";
import { commands, server, userEvent } from "vitest/browser";
import {
  type Counter,
  manyColumns,
  mountOpenPicker,
  type PickerParts,
} from "./support/apps";
import {
  moveTo,
  type Point,
  pointOn,
  pressOn,
  release,
} from "./support/pointer";

// Dragging a column in the picker with a real pointer, at places read from the real layout.

/** Just below the middle of a row: a drop here lands after that row. */
const lowerHalf = (row: Element): Point => pointOn(row, 0.5, 0.9);
/** Just above the middle of a row: a drop here lands before that row. */
const upperHalf = (row: Element): Point => pointOn(row, 0.5, 0.1);

/** Whether a drag is under way in the picker's list. */
const isDragging = (picker: PickerParts): boolean =>
  picker.list().hasAttribute("data-dragging");

/** Resolves once the browser has drawn two more screen frames. */
const twoFrames = (): Promise<void> =>
  new Promise((done) => {
    requestAnimationFrame(() => requestAnimationFrame(() => done()));
  });

describe("dragging a column by mouse (item 1)", () => {
  test("moves the column to where it is dropped", async () => {
    const changed: Counter = { count: 0 };
    const picker = await mountOpenPicker({ changed });

    await pressOn(picker.handle("Name"));
    await moveTo(lowerHalf(picker.row("Stock")));
    // The line that marks the drop is drawn above the next row.
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
    expect(isDragging(picker)).toBe(true);
    expect(getComputedStyle(picker.row("Name")).opacity).toBe("0.4");
    // Nothing is asked of the app while the row is held.
    expect(changed.count).toBe(0);

    await release();
    await expect.poll(picker.table).toBe("price stock name");
    expect(picker.listed()).toEqual(["Price", "Stock", "Name", "Notes"]);
    expect(isDragging(picker)).toBe(false);
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
    await expect.poll(() => isDragging(picker)).toBe(true);
    await release();
    await expect.poll(() => isDragging(picker)).toBe(false);
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
    await expect.poll(() => isDragging(picker)).toBe(false);
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
      const send = (target: EventTarget, type: string, at: Point): void => {
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
      };
      const handle = picker.handle("Name");
      send(handle, "pointerdown", pointOn(handle));
      send(handle, "pointermove", lowerHalf(picker.row("Stock")));
      await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
      send(handle, "pointerup", lowerHalf(picker.row("Stock")));
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
    await pressOn(picker.handle("Column 0"));
    await moveTo(pointOn(list));
    await expect
      .poll(() => picker.rows().some((row) => row.dataset.drop))
      .toBe(true);
    await twoFrames();
    expect(list.scrollTop).toBe(0);
  });
});

describe("a drag that does not end with a drop (item 3)", () => {
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
    expect(isDragging(picker)).toBe(false);
    expect(picker.rows().some((row) => row.dataset.drop)).toBe(false);
  });

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
    expect(isDragging(picker)).toBe(true);
    restore();

    // A mouse that moves with no button held shows that the release was missed.
    await moveTo(pointOn(picker.row("Price")));
    await expect.poll(() => isDragging(picker)).toBe(false);
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
    await expect.poll(() => isDragging(picker)).toBe(true);

    const { lost, restore } = loseRelease();
    await release();
    await expect.poll(() => lost).toContain("pointerup");
    expect(isDragging(picker)).toBe(true);
    restore();

    // The picker is not stuck: the next press on the handle drags as any other.
    await commands.mouseDown();
    await moveTo(lowerHalf(picker.row("Stock")));
    await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
    await release();
    await expect.poll(picker.table).toBe("price stock name");
    expect(changed.count).toBe(1);
    expect(isDragging(picker)).toBe(false);
  });
  if (server.browser === "chromium") {
    // A finger gets a new number each time it touches the screen, so the next touch is not
    // taken for the lost one. Only Chromium lets a test send such a touch.
    test("is replaced by the next touch after its release was lost", async () => {
      const changed: Counter = { count: 0 };
      const picker = await mountOpenPicker({ changed });
      await commands.touch("start", pointOn(picker.handle("Name")));
      await expect.poll(() => isDragging(picker)).toBe(true);

      const { lost, restore } = loseRelease();
      await commands.touch("end");
      await expect.poll(() => lost).toContain("pointerup");
      expect(isDragging(picker)).toBe(true);
      restore();

      // Another row, under another touch. It moves, and the row held before does not.
      await commands.touch("start", pointOn(picker.handle("Price")));
      await commands.touch("move", pointOn(picker.row("Stock")));
      await commands.touch("move", lowerHalf(picker.row("Stock")));
      await expect.poll(() => picker.row("Notes").dataset.drop).toBe("before");
      await commands.touch("end");
      await expect.poll(picker.table).toBe("name stock price");
      expect(changed.count).toBe(1);
      expect(isDragging(picker)).toBe(false);
    });
  }
});

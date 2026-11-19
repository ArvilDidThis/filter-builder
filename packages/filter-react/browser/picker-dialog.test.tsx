import axe from "axe-core";
import { describe, expect, onTestFinished, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { addAppCss } from "./support/app-css";
import {
  manyColumns,
  mountOpenDialog,
  mountOpenPicker,
  PickerApp,
  type PickerParts,
  pickerParts,
} from "./support/apps";
import { mount } from "./support/mount";
import {
  clickAt,
  clickOn,
  lowerHalf,
  moveTo,
  pointOn,
  pressOn,
  release,
  upperHalf,
} from "./support/pointer";
import { VIEWPORT } from "./viewport";

// The picker's dialog view in a real browser: a modal dialog in the middle of the screen,
// with the columns laid out in grid columns. Only a real browser lays the grid out, keeps
// the focus inside a modal dialog, and says where a pointer is over the grid.

/** The left edge of each row, rounded, in the order of the list. */
const lefts = (picker: PickerParts): number[] =>
  picker.rows().map((row) => Math.round(row.getBoundingClientRect().left));

/** How many rows the first grid column holds. */
const rowsInFirstGridColumn = (picker: PickerParts): number => {
  const [first] = lefts(picker);
  return lefts(picker).filter((left) => left === first).length;
};

/** Half a pixel of slack, for sizes a browser rounds. */
const SLACK = 1;

describe("opening and closing the dialog", () => {
  test("opens in the middle of the screen, about nine tenths of its height", async () => {
    const picker = await mountOpenDialog();
    const dialog = picker.dialog() as HTMLDialogElement;
    // A real modal dialog, and the popover is gone.
    expect(dialog.matches(":modal")).toBe(true);
    expect(picker.popover()).toBeNull();
    const box = dialog.getBoundingClientRect();
    expect(Math.abs(box.height - VIEWPORT.height * 0.9)).toBeLessThan(2);
    expect(
      Math.abs((box.left + box.right) / 2 - VIEWPORT.width / 2),
    ).toBeLessThan(2);
    expect(
      Math.abs((box.top + box.bottom) / 2 - VIEWPORT.height / 2),
    ).toBeLessThan(2);
    // The focus is on the dialog itself, so its name is read out first.
    await expect.poll(() => document.activeElement).toBe(dialog);
    expect(dialog.getAttribute("aria-labelledby")).toBe(
      dialog.querySelector(".fb-columns-title")?.id,
    );
  });

  test("closes on Escape, and the focus returns to the picker's button", async () => {
    const picker = await mountOpenDialog();
    await userEvent.keyboard("{Escape}");
    await expect.poll(picker.dialog).toBeNull();
    expect(picker.popover()).toBeNull();
    await expect.poll(() => document.activeElement).toBe(picker.trigger());
  });

  test("closes on its Close button, and the focus returns to the picker's button", async () => {
    const picker = await mountOpenDialog();
    await clickOn(picker.closeDialog());
    await expect.poll(picker.dialog).toBeNull();
    await expect.poll(() => document.activeElement).toBe(picker.trigger());
  });

  test("closes on a press on the dimmed page around it", async () => {
    const picker = await mountOpenDialog();
    await clickAt({ x: 6, y: 6 });
    await expect.poll(picker.dialog).toBeNull();
    await expect.poll(() => document.activeElement).toBe(picker.trigger());
  });

  test("stays open on a press on its own edge", async () => {
    const picker = await mountOpenDialog();
    const dialog = picker.dialog() as HTMLDialogElement;
    // Its padding, which belongs to no control inside it.
    await clickAt(pointOn(dialog, 0.5, 0.003));
    await clickAt(pointOn(dialog, 0.002, 0.5));
    expect(picker.dialog()).not.toBeNull();
  });

  test("keeps the rest of the page out of reach", async () => {
    const picker = await mountOpenDialog();
    const elsewhere = picker.elsewhere();
    const { x, y } = pointOn(elsewhere);
    // The button on the page is under the dimmed layer, where a pointer cannot find it.
    expect(document.elementFromPoint(x, y)).not.toBe(elsewhere);
    // Tab goes round the dialog's own controls, and never out to the page.
    for (let press = 0; press < 12; press++) {
      await userEvent.keyboard("{Tab}");
      expect(document.activeElement).not.toBe(elsewhere);
      expect(document.activeElement).not.toBe(picker.trigger());
    }
    expect(picker.dialog()).not.toBeNull();
  });

  test("opens straight in the dialog when the app asks for that", async () => {
    mount(<PickerApp picker={{ defaultView: "dialog", dialogView: false }} />);
    const picker = pickerParts();
    await expect
      .poll(() => document.querySelector(".fb-columns-trigger"))
      .not.toBeNull();
    await clickOn(picker.trigger());
    await expect.poll(picker.dialog).not.toBeNull();
    expect(picker.dialog()?.matches(":modal")).toBe(true);
    expect(picker.popover()).toBeNull();
    // Closed, the focus is back on the button, and the next press opens the dialog again.
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.activeElement).toBe(picker.trigger());
    await clickOn(picker.trigger());
    await expect.poll(picker.dialog).not.toBeNull();
  });

  test("has no Dialog view button when the app turns it off", async () => {
    const picker = await mountOpenPicker({ picker: { dialogView: false } });
    expect(() => picker.dialogView()).toThrow();
    expect(picker.groupDrag()).not.toBeNull();
  });

  test("uses the app's wording", async () => {
    const picker = await mountOpenPicker({
      picker: { labels: { dialogView: "Wide view", closeDialog: "Done" } },
    });
    const button = (name: string) =>
      Array.from(document.querySelectorAll("button")).find(
        (item) => item.textContent === name,
      ) as HTMLButtonElement;
    await clickOn(button("Wide view"));
    await expect.poll(picker.dialog).not.toBeNull();
    await clickOn(button("Done"));
    await expect.poll(picker.dialog).toBeNull();
  });
});

describe("the grid in the dialog", () => {
  test("reads down each grid column and then across, for a long list", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(60) });
    const rows = picker.rows();
    const perColumn = rowsInFirstGridColumn(picker);
    expect(new Set(lefts(picker)).size).toBeGreaterThan(1);
    expect(perColumn).toBeGreaterThan(1);
    const place = (index: number) =>
      (rows[index] as HTMLElement).getBoundingClientRect();
    // The second row is below the first, in the same grid column.
    expect(place(1).left).toBeCloseTo(place(0).left, 0);
    expect(place(1).top).toBeGreaterThan(place(0).top);
    // The row after the last of the first grid column starts the next one, at the top.
    expect(place(perColumn).left).toBeGreaterThan(place(0).right - SLACK);
    expect(place(perColumn).top).toBeCloseTo(place(0).top, 0);
    // Every grid column but the last is full.
    expect(place(perColumn - 1).left).toBeCloseTo(place(0).left, 0);
  });

  test("starts every grid column at the same height, in an app that gives list items a margin", async () => {
    // A style sheet for running text often spaces list items out like this. Between two
    // grid columns the browser drops such a margin, and keeps it above the very first row.
    addAppCss("li { margin-top: 0.5em; margin-bottom: 0.5em; }");
    const picker = await mountOpenDialog({
      // The first row is a pinned one, which is drawn with other parts than the rest.
      columns: [
        { key: "id", label: "Id", pinned: "start", hideable: false },
        ...manyColumns(60),
      ],
    });
    // The top of the first row of each grid column, by the grid column's left edge.
    const tops = new Map<number, number>();
    for (const row of picker.rows()) {
      const box = row.getBoundingClientRect();
      const left = Math.round(box.left);
      if (!tops.has(left)) tops.set(left, box.top);
    }
    expect(tops.size).toBeGreaterThan(1);
    const [first, ...others] = [...tops.values()] as [number, ...number[]];
    for (const top of others) expect(Math.abs(top - first)).toBeLessThan(SLACK);
    // The rows stand one right below the other, with no gap between them.
    const [one, two] = picker.rows().map((row) => row.getBoundingClientRect());
    expect(
      Math.abs((two as DOMRect).top - (one as DOMRect).bottom),
    ).toBeLessThan(SLACK);
  });

  test("has no scrollbar while the grid columns fit", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(60) });
    const list = picker.list();
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + SLACK);
    expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight + SLACK);
    // Every row is inside the dialog.
    const box = (picker.dialog() as Element).getBoundingClientRect();
    for (const row of picker.rows()) {
      const rowBox = row.getBoundingClientRect();
      expect(rowBox.right).toBeLessThanOrEqual(box.right + SLACK);
      expect(rowBox.bottom).toBeLessThanOrEqual(box.bottom + SLACK);
    }
  });

  test("scrolls sideways, and only sideways, when the grid columns do not fit", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(300) });
    const list = picker.list();
    expect(list.scrollWidth).toBeGreaterThan(list.clientWidth + SLACK);
    expect(list.scrollHeight).toBeLessThanOrEqual(list.clientHeight + SLACK);
    // The dialog itself keeps its size and does not scroll.
    const dialog = picker.dialog() as HTMLDialogElement;
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + SLACK);
    expect(dialog.scrollHeight).toBeLessThanOrEqual(
      dialog.clientHeight + SLACK,
    );
  });

  test("is one grid column for a short list", async () => {
    const picker = await mountOpenDialog();
    expect(new Set(lefts(picker)).size).toBe(1);
    const list = picker.list();
    expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth + SLACK);
  });

  test("fits more grid columns in a wider window", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(300) });
    const inView = () => {
      const box = picker.list().getBoundingClientRect();
      return new Set(
        picker
          .rows()
          .map((row) => row.getBoundingClientRect())
          .filter((row) => row.right <= box.right + SLACK)
          .map((row) => Math.round(row.left)),
      ).size;
    };
    const before = inView();
    await page.viewport(1600, VIEWPORT.height);
    await expect.poll(inView).toBeGreaterThan(before);
  });
});

describe("using the list in the dialog", () => {
  test("ticks, searches, shows all, hides all and resets", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(40) });
    await clickOn(picker.checkbox("Column 3"));
    await expect.poll(picker.table).not.toContain("c3 ");
    await clickOn(picker.showAll());
    await expect.poll(picker.table).toContain("c3 ");
    await clickOn(picker.hideAll());
    await expect.poll(picker.table).toBe("");
    await clickOn(picker.showAll());
    await expect.poll(picker.table).toContain("c3 ");

    const search = document.querySelector(
      ".fb-columns-search-input",
    ) as HTMLInputElement;
    await userEvent.type(search, "column 1");
    // Every name with a 1 in it: "Column 1", "Column 10" to "Column 19", and two more.
    await expect.poll(() => picker.rows().length).toBe(13);
    // Escape first clears the search, and the dialog stays open.
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => picker.rows().length).toBe(40);
    expect(picker.dialog()?.matches(":modal")).toBe(true);

    picker.handle("Column 5").focus();
    await userEvent.keyboard("{Home}");
    await expect.poll(() => picker.listed()[0]).toBe("Column 5");
    await clickOn(picker.reset());
    await expect.poll(() => picker.listed()[0]).toBe("Column 0");
    expect(picker.dialog()).not.toBeNull();
  });

  test("drags a column across grid columns with the pointer", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(60) });
    const perColumn = rowsInFirstGridColumn(picker);
    // The third row of the second grid column.
    const target = perColumn + 2;
    await pressOn(picker.handle("Column 1"));
    await moveTo(upperHalf(picker.row(`Column ${target}`)));
    // The line is drawn above the row under the pointer.
    await expect
      .poll(() => picker.row(`Column ${target}`).getAttribute("data-drop"))
      .toBe("before");
    await release();
    await expect
      .poll(() => picker.listed().slice(target - 2, target + 1))
      .toEqual([`Column ${target - 1}`, "Column 1", `Column ${target}`]);
    expect(picker.announced()).toBe(
      `Column 1 moved to position ${target} of 60.`,
    );
    // The table follows.
    expect(picker.table()?.split(" ")[target - 1]).toBe("c1");
  });

  test("drags a column back to an earlier grid column", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(60) });
    const perColumn = rowsInFirstGridColumn(picker);
    const moved = `Column ${perColumn * 2 + 1}`;
    await pressOn(picker.handle(moved));
    await moveTo(lowerHalf(picker.row("Column 0")));
    await release();
    await expect
      .poll(() => picker.listed().slice(0, 3))
      .toEqual(["Column 0", moved, "Column 1"]);
  });

  test("marks the foot of a grid column, and drops there", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(60) });
    const perColumn = rowsInFirstGridColumn(picker);
    const foot = picker.row(`Column ${perColumn - 1}`);
    const moved = `Column ${perColumn + 4}`;
    await pressOn(picker.handle(moved));
    await moveTo(lowerHalf(foot));
    // Below the last row of the first grid column, not above the first of the second.
    await expect.poll(() => foot.getAttribute("data-drop")).toBe("after");
    expect(picker.row(`Column ${perColumn}`).hasAttribute("data-drop")).toBe(
      false,
    );
    await release();
    await expect.poll(() => picker.listed()[perColumn]).toBe(moved);
  });

  test("gives up a drag on Escape, and stays open", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(60) });
    await pressOn(picker.handle("Column 1"));
    await moveTo(upperHalf(picker.row("Column 20")));
    await expect.poll(picker.isDragging).toBe(true);
    await userEvent.keyboard("{Escape}");
    await expect.poll(picker.isDragging).toBe(false);
    await release();
    expect(picker.dialog()?.matches(":modal")).toBe(true);
    expect(picker.listed()[1]).toBe("Column 1");
  });

  test("scrolls sideways while a held row rests at the side of the grid", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(300) });
    const list = picker.list();
    expect(list.scrollLeft).toBe(0);
    await pressOn(picker.handle("Column 1"));
    await moveTo(pointOn(list, 0.995, 0.5));
    await expect.poll(() => list.scrollLeft).toBeGreaterThan(100);
    await release();
  });

  test("moves a column by one place with up and down, and by one grid column with left and right", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(60) });
    const perColumn = rowsInFirstGridColumn(picker);
    const handle = picker.handle("Column 2");
    handle.focus();
    const place = () => picker.listed().indexOf("Column 2");

    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(place).toBe(3);
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(place).toBe(3 + perColumn);
    expect(picker.announced()).toBe(
      `Column 2 moved to position ${4 + perColumn} of 60.`,
    );
    // The focus stays on the handle, so the key can be pressed again.
    await expect
      .poll(() => document.activeElement)
      .toBe(picker.handle("Column 2"));
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(place).toBe(3 + perColumn * 2);
    await userEvent.keyboard("{ArrowLeft}");
    await expect.poll(place).toBe(3 + perColumn);
    await userEvent.keyboard("{ArrowUp}");
    await expect.poll(place).toBe(2 + perColumn);
    // It stands at the same height as where it started, one grid column over.
    expect(Math.round(picker.row("Column 2").getBoundingClientRect().top)).toBe(
      Math.round(picker.row("Column 1").getBoundingClientRect().top) +
        Math.round(picker.row("Column 1").getBoundingClientRect().height),
    );
  });

  test("brings a column moved out of view back into view", async () => {
    const picker = await mountOpenDialog({ columns: manyColumns(300) });
    const list = picker.list();
    picker.handle("Column 2").focus();
    await userEvent.keyboard("{End}");
    await expect.poll(() => picker.listed().at(-1)).toBe("Column 2");
    await expect.poll(() => list.scrollLeft).toBeGreaterThan(0);
    const box = list.getBoundingClientRect();
    const rowBox = picker.handle("Column 2").getBoundingClientRect();
    expect(rowBox.left).toBeGreaterThanOrEqual(box.left - SLACK);
    expect(rowBox.right).toBeLessThanOrEqual(box.right + SLACK);
  });
});

describe("an accessibility scan of the dialog", () => {
  /** Each broken rule with the elements that break it. */
  async function violations(): Promise<string[]> {
    const picker = document.querySelector(".fb-columns") as Element;
    const results = await axe.run(picker, { resultTypes: ["violations"] });
    return results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes
          .map((node) => node.target.join(" "))
          .join(", ")})`,
    );
  }

  /** Opens the dialog on a light or a dark page. */
  async function openOn(scheme: "light" | "dark"): Promise<PickerParts> {
    await commands.colorScheme(scheme);
    document.documentElement.style.colorScheme = "light dark";
    onTestFinished(() => {
      document.documentElement.style.colorScheme = "";
    });
    return mountOpenDialog({ columns: manyColumns(40) });
  }

  test.each(["light", "dark"] as const)(
    "finds nothing wrong with the open dialog on a %s page",
    async (scheme) => {
      await openOn(scheme);
      expect(await violations()).toEqual([]);
    },
  );

  test.each(["light", "dark"] as const)(
    "finds nothing wrong with group drag on and rows selected, on a %s page",
    async (scheme) => {
      const picker = await openOn(scheme);
      await clickOn(picker.groupDrag());
      await clickOn(picker.selectBox("Column 2"));
      await clickOn(picker.selectBox("Column 5"));
      picker.handle("Column 5").focus();
      expect(await violations()).toEqual([]);
    },
  );
});

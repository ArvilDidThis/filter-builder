import axe from "axe-core";
import { describe, expect, onTestFinished, test } from "vitest";
import { commands, page, server, userEvent } from "vitest/browser";
import type { ReaderNode } from "./commands";
import {
  mountOpenPicker,
  openPicker,
  PickerApp,
  type PickerParts,
  pickerParts,
} from "./support/apps";
import { mount } from "./support/mount";

// How the open picker looks, and whether it passes an accessibility scan, on a light page and
// on a dark one.

const SCHEMES = ["light", "dark"] as const;

/**
 * Draws the open picker on a small stage of a fixed size, on a light or a dark page. The
 * picker has one hidden column, so its button shows a count and "Reset" has nothing to do.
 */
async function openOnStage(
  scheme: (typeof SCHEMES)[number],
): Promise<PickerParts> {
  await commands.colorScheme(scheme);
  // Lets the page follow the device's theme, as the picker's colours are worked out from
  // the page's own.
  document.documentElement.style.colorScheme = "light dark";
  onTestFinished(() => {
    document.documentElement.style.colorScheme = "";
  });
  mount(
    <div
      data-testid="stage"
      style={{
        boxSizing: "border-box",
        width: 360,
        height: 320,
        padding: 16,
        background: "Canvas",
        color: "CanvasText",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <PickerApp />
    </div>,
  );
  const picker = await openPicker();
  // Away from the picker, so no row is drawn as hovered over.
  await commands.mouseMove({ x: 0, y: 0 });
  return picker;
}

/** Whether this run was asked to store new screenshots: `pnpm test:browser:update`. */
const isUpdating = server.config.snapshotOptions.updateSnapshot === "all";

describe("the open picker's look (item 14)", () => {
  test.each(SCHEMES)(
    "matches the stored screenshot on a %s page",
    async (scheme) => {
      const name = `open-picker-${scheme}`;
      await openOnStage(scheme);
      const background = getComputedStyle(
        page.getByTestId("stage").element(),
      ).backgroundColor;
      // The page really is light or dark, so the two screenshots are not the same picture.
      if (scheme === "dark") expect(background).not.toBe("rgb(255, 255, 255)");
      else expect(background).toBe("rgb(255, 255, 255)");

      // Text is drawn differently on each system, so a screenshot is compared only with one
      // stored on the same system. Where none is stored yet, there is nothing to compare.
      if (!isUpdating && !(await commands.hasBaseline(name))) {
        // Linux screenshots are kept in the repository, and CI runs on Linux. A missing one
        // there means the look is no longer checked, so it fails and does not pass quietly.
        if (server.platform === "linux") {
          throw new Error(
            `The stored screenshot "${name}" for ${server.browser} on Linux is missing. ` +
              "Store it with `pnpm test:browser:update:linux` and commit it.",
          );
        }
        console.warn(
          `No stored screenshot "${name}" for ${server.browser} on ${server.platform}. ` +
            "Nothing was compared. Store one with `pnpm test:browser:update`.",
        );
        return;
      }
      await expect.element(page.getByTestId("stage")).toMatchScreenshot(name);
    },
  );
});

describe("an accessibility scan of the picker (item 15)", () => {
  /** Each broken rule with the elements that break it, short enough to read in a failure. */
  async function violations(): Promise<string[]> {
    // The picker only. The plain button beside it is the test app's own, and a browser's
    // unstyled button is not the library's to answer for.
    const picker = document.querySelector(".fb-columns") as Element;
    const results = await axe.run(picker, {
      resultTypes: ["violations"],
    });
    return results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes
          .map((node) => node.target.join(" "))
          .join(", ")})`,
    );
  }

  test.each(SCHEMES)(
    "finds nothing wrong with the open picker on a %s page",
    async (scheme) => {
      await openOnStage(scheme);
      expect(await violations()).toEqual([]);
    },
  );

  test.each(SCHEMES)(
    "finds nothing wrong with every column shown and a handle focused, on a %s page",
    async (scheme) => {
      const picker = await openOnStage(scheme);
      // "Show all" becomes unavailable and "Reset" available, the reverse of the start.
      picker.showAll().click();
      await expect.poll(picker.table).toBe("name price stock notes");
      picker.handle("Price").focus();
      expect(await violations()).toEqual([]);
    },
  );
});

describe("the picker's list, as a screen reader is told of it", () => {
  // The style sheet takes the bullets off the list. Safari then stops telling a screen
  // reader that it is a list, unless the list names its role. What a browser really tells a
  // screen reader is its accessibility tree, and Playwright can read only Chromium's.
  // Firefox's and WebKit's are out of reach, so the Safari fault itself is not checked here:
  // both tests below pass with or without the role, and fail once the list is no list.

  // In every browser, Playwright's own reading of the page. It follows the rules browsers
  // are meant to follow, so it shows that the page is marked up as a list of four items.
  // It cannot show a browser that departs from those rules, as Safari does.
  test("is marked up as a list of its columns, as Playwright reads the page", async () => {
    await mountOpenPicker();
    const lines = (await commands.ariaSnapshot(".fb-columns-popover"))
      .split("\n")
      .map((line) => line.trim());
    expect(lines.filter((line) => line === "- list:")).toHaveLength(1);
    expect(lines.filter((line) => line === "- listitem:")).toHaveLength(4);
    // The items hold the columns' controls.
    expect(lines).toContain('- checkbox "Price" [checked]');
    expect(lines).toContain('- button "Move Price"');
  });

  test.runIf(server.browser === "chromium")(
    "is a list of its columns in Chromium's own accessibility tree",
    async () => {
      await mountOpenPicker();
      const find = (node: ReaderNode, role: string): ReaderNode | undefined =>
        node.role === role
          ? node
          : node.children
              .map((child) => find(child, role))
              .find((found) => found !== undefined);
      const dialog = find(await commands.readerTree(), "dialog");
      expect(dialog?.name).toBe("Columns");
      const list = find(dialog as ReaderNode, "list");
      expect(list?.children.map((item) => item.role)).toEqual([
        "listitem",
        "listitem",
        "listitem",
        "listitem",
      ]);
      // Each item holds its column's checkbox and handle, by name.
      expect(
        list?.children.map((item) =>
          item.children.map((part) => `${part.role} ${part.name}`),
        ),
      ).toEqual(
        ["Name", "Price", "Stock", "Notes"].map((label) => [
          `checkbox ${label}`,
          `button Move ${label}`,
        ]),
      );
    },
  );
});

describe("the focus ring on the open list", () => {
  // Opening the picker moves the focus to the list's box. Whether a ring is then drawn
  // depends on how the browser judges the way the focus got there: by a key or by a click.
  // Only a real browser makes that judgement.

  /** The outline drawn around the list's box, once the box holds the focus. */
  async function outlineOf(picker: PickerParts): Promise<CSSStyleDeclaration> {
    await expect.poll(() => document.activeElement).toBe(picker.popover());
    return getComputedStyle(picker.popover() as HTMLElement);
  }

  test("is drawn when Enter on the button opens the list", async () => {
    mount(
      <PickerApp
        picker={{
          // The picker's own button, with a place in the Tab order spelled out. Safari on
          // a Mac leaves a plain button out of that order unless a system setting is on.
          renderTrigger: (props) => (
            <button
              className="fb-button fb-columns-trigger"
              tabIndex={0}
              {...props}
            >
              Columns
            </button>
          ),
        }}
      />,
    );
    const picker = pickerParts();
    await expect
      .poll(() => document.querySelector(".fb-columns-trigger"))
      .not.toBeNull();
    // Tab brings the focus to the button, as a person at the keyboard would. A script that
    // put the focus there after a click elsewhere would not count as the keyboard in every
    // browser, and the list's box takes after the button.
    picker.elsewhere().focus();
    await userEvent.keyboard("{Tab}");
    await expect.poll(() => document.activeElement).toBe(picker.trigger());
    await userEvent.keyboard("{Enter}");
    await expect.poll(picker.popover).not.toBeNull();

    const outline = await outlineOf(picker);
    expect(outline.outlineStyle).toBe("solid");
    expect(outline.outlineWidth).toBe("2px");
    // The same colour as the ring of a control inside the list.
    picker.handle("Price").focus();
    expect(outline.outlineStyle).toBe("none");
    const control = getComputedStyle(picker.handle("Price"));
    expect(control.outlineStyle).toBe("solid");
  });

  test("is not drawn when a click on the button opens the list", async () => {
    const picker = await mountOpenPicker();
    const outline = await outlineOf(picker);
    expect(outline.outlineStyle).toBe("none");
  });
});

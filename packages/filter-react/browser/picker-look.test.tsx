import axe from "axe-core";
import { describe, expect, onTestFinished, test } from "vitest";
import { commands, page, server } from "vitest/browser";
import { openPicker, PickerApp, type PickerParts } from "./support/apps";
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

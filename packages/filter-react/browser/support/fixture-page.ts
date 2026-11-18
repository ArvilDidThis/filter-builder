import { expect } from "vitest";
import { BLANK_PAGE_PATH, tablePagePath } from "../fixture-paths";
import type { FixtureNotes } from "../fixtures/start-in-browser";

// Opens a fixture page in a frame (a page within the page) of the test page. The frame holds
// a whole page of its own, which can be loaded again or left, while the test keeps running.

/** A fixture page a test has opened. */
export interface FixturePage {
  /** The page's document. It is a new one after every load. */
  document: () => Document;
  /** What the page noted down about itself. */
  notes: () => FixtureNotes;
  /** One table on the page, by its id. */
  table: (id: string) => FixtureTable;
  /** Loads the page again, as the browser's reload button does. */
  reload: () => Promise<void>;
  /** Leaves the page for an empty one, which closes it. */
  leave: () => Promise<void>;
}

/** The parts of one saved table on a fixture page. */
export interface FixtureTable {
  /** The column keys the table shows, in order. */
  shown: () => string;
  status: () => string;
  button: (action: "hide-price" | "stock-first") => HTMLButtonElement;
  element: () => HTMLElement;
}

/**
 * Waits until the frame has loaded the empty fixture page. A frame starts with a throwaway
 * empty page of its own, so the address is checked as well.
 */
export async function untilBlank(frame: HTMLIFrameElement): Promise<void> {
  await expect
    .poll(
      () =>
        frame.contentDocument?.readyState === "complete" &&
        frame.contentWindow?.location.pathname === BLANK_PAGE_PATH,
    )
    .toBe(true);
}

/** Waits until the frame has loaded a page that says it is ready. */
async function untilReady(frame: HTMLIFrameElement): Promise<void> {
  await expect
    .poll(
      () =>
        frame.contentDocument?.documentElement.hasAttribute("data-ready") ??
        false,
    )
    .toBe(true);
}

/** Opens the fixture page with tables, and waits until it is ready. */
export async function openTablePage(query: string): Promise<FixturePage> {
  const frame = document.createElement("iframe");
  frame.title = "Fixture page";
  frame.style.cssText = "width: 640px; height: 480px; border: 0;";
  frame.src = tablePagePath(query);
  document.body.append(frame);
  await untilReady(frame);

  const pageDocument = (): Document => {
    if (frame.contentDocument === null) throw new Error("The frame is empty.");
    return frame.contentDocument;
  };
  const find = <Found extends Element>(
    within: ParentNode,
    selector: string,
  ): Found => {
    const found = within.querySelector<Found>(selector);
    if (found === null) throw new Error(`Nothing matches ${selector}`);
    return found;
  };

  return {
    document: pageDocument,
    notes: () => (frame.contentWindow as Window).fixture,
    table(id) {
      const element = () =>
        find<HTMLElement>(pageDocument(), `[data-table="${id}"]`);
      return {
        element,
        shown: () => find(element(), "[data-shown]").textContent ?? "",
        status: () => find(element(), "[data-status]").textContent ?? "",
        button: (action) => find(element(), `[data-action="${action}"]`),
      };
    },
    async reload() {
      const before = frame.contentDocument;
      frame.contentWindow?.location.reload();
      // The old page is gone once the frame holds another document.
      await expect.poll(() => frame.contentDocument !== before).toBe(true);
      await untilReady(frame);
    },
    async leave() {
      const before = frame.contentDocument;
      (frame.contentWindow as Window).location.href = BLANK_PAGE_PATH;
      // The old page is gone once the frame holds another document.
      await expect.poll(() => frame.contentDocument !== before).toBe(true);
      await untilBlank(frame);
    },
  };
}

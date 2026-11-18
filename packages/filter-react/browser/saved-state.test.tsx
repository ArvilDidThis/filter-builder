import { describe, expect, test } from "vitest";
import { commands, server } from "vitest/browser";
import type { Held } from "./commands";
import { openTablePage, tablePagePath } from "./support/fixture-page";
import { clickOn } from "./support/pointer";

// Saved table state in a whole page of its own: loaded again, closed, and drawn by a server.
// Local storage and cookies are the browser's real ones.

/**
 * What the browser holds for a table, as text: its local storage entry, or its cookie.
 * Without `held` it is read from the browser now.
 */
function stored(
  store: "local" | "cookie",
  id: string,
  held: Held = { local: { ...localStorage }, cookie: document.cookie },
): string {
  if (store === "local") return held.local[`table-state.${id}`] ?? "";
  const cookie = held.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`table-state.${id}=`));
  return cookie === undefined
    ? ""
    : decodeURIComponent(cookie.slice(cookie.indexOf("=") + 1));
}

/** The saved text of a table whose "price" column is hidden. */
const PRICE_HIDDEN = '"hidden":["price"]';
/** The saved text of a table whose "stock" column comes first. */
const STOCK_FIRST = '"order":["stock","name","price"]';

/**
 * How long the table takes to draw, in milliseconds. It is several times the 5 milliseconds
 * after which React gives the browser a turn before it runs its late effects. So state that
 * was loaded in a late effect would be on the page a moment after the starting columns, and
 * the page would note both.
 */
const SLOW_DRAW = 40;

/** A delay so long that a change is never saved by the clock within a test. */
const NEVER = 600_000;

describe.each(["local", "cookie"] as const)("state saved in %s", (store) => {
  test("survives a reload of the page (item 10)", async () => {
    const page = await openTablePage(
      `store=${store}&tables=orders&slow=${SLOW_DRAW}`,
    );
    const orders = page.table("orders");
    await expect.poll(orders.status).toBe("ready");
    expect(orders.shown()).toBe("name price stock");

    await clickOn(orders.button("hide-price"));
    await clickOn(orders.button("stock-first"));
    await expect.poll(orders.shown).toBe("stock name");
    await expect.poll(() => stored(store, "orders")).toContain(PRICE_HIDDEN);
    await expect.poll(() => stored(store, "orders")).toContain(STOCK_FIRST);

    await page.reload();
    await expect.poll(page.table("orders").status).toBe("ready");
    expect(page.table("orders").shown()).toBe("stock name");
    // The saved state is read before the browser can paint. The page's scripts never came
    // to rest with the starting columns on the page, so the browser had no chance to show
    // them.
    expect(page.notes().rested.orders).toEqual(["stock name"]);
    // And the page did not hold them when any screen frame began.
    await expect
      .poll(() => page.notes().painted.orders)
      .toEqual(["stock name"]);
    expect(page.notes().problems).toEqual([]);
  });

  test("keeps the state of two tables apart (item 13)", async () => {
    const page = await openTablePage(`store=${store}&tables=orders,customers`);
    await expect.poll(page.table("customers").status).toBe("ready");

    await clickOn(page.table("orders").button("hide-price"));
    await clickOn(page.table("customers").button("stock-first"));
    await expect.poll(() => stored(store, "orders")).toContain(PRICE_HIDDEN);
    await expect.poll(() => stored(store, "customers")).toContain(STOCK_FIRST);
    // Neither table saved the other's change under its own key.
    expect(stored(store, "orders")).not.toContain(STOCK_FIRST);
    expect(stored(store, "customers")).not.toContain(PRICE_HIDDEN);

    await page.reload();
    await expect.poll(page.table("customers").status).toBe("ready");
    expect(page.table("orders").shown()).toBe("name stock");
    expect(page.table("customers").shown()).toBe("stock name price");
    expect(page.notes().problems).toEqual([]);
  });

  test("writes a waiting save when the page is left (item 11)", async () => {
    const page = await openTablePage(
      `store=${store}&tables=orders&delay=${NEVER}`,
    );
    const orders = page.table("orders");
    await expect.poll(orders.status).toBe("ready");
    await clickOn(orders.button("hide-price"));
    await expect.poll(orders.shown).toBe("name stock");
    // The change is on screen and still waiting: nothing has been written.
    expect(stored(store, "orders")).toBe("");

    await page.leave();
    expect(stored(store, "orders")).toContain(PRICE_HIDDEN);
  });

  // Playwright's Firefox does not reliably tell a page that its tab is closing: a page with
  // nothing but its own "pagehide" listener hears nothing. That is the test tool, not the
  // library, so in Firefox the tab is left by going to another address only.
  const waysToLeave =
    server.browser === "firefox"
      ? (["navigate"] as const)
      : (["close", "navigate"] as const);

  test.each(waysToLeave)(
    "writes a waiting save when its tab is left by %s (item 11)",
    async (leave) => {
      const heldBeforeLeaving = await commands.visitAndLeave(
        tablePagePath(`store=${store}&tables=orders&delay=${NEVER}`),
        [
          { click: '[data-action="hide-price"]' },
          // The change is on screen before the tab is left.
          { waitFor: "[data-shown]", toHoldText: "name stock" },
        ],
        leave,
      );
      // And it was still waiting then: nothing had been written. So the save below was made
      // as the tab was left, not before.
      expect(stored(store, "orders", heldBeforeLeaving)).toBe("");
      // The tab shares this page's local storage and cookies.
      await expect.poll(() => stored(store, "orders")).toContain(PRICE_HIDDEN);
    },
  );
});

describe("a page the server drew from saved state (item 12)", () => {
  const query = "store=cookie&tables=orders&ssr=1";

  /** Saves a changed table in the cookie, through a page of its own. */
  async function saveChangedTable(): Promise<void> {
    const page = await openTablePage("store=cookie&tables=orders");
    await expect.poll(page.table("orders").status).toBe("ready");
    await clickOn(page.table("orders").button("hide-price"));
    await clickOn(page.table("orders").button("stock-first"));
    await expect.poll(() => stored("cookie", "orders")).toContain(STOCK_FIRST);
    await expect.poll(() => stored("cookie", "orders")).toContain(PRICE_HIDDEN);
    await page.leave();
  }

  /** What the server sends for the page, before any script has run. */
  async function serverShown(): Promise<string | null | undefined> {
    const html = await (await fetch(tablePagePath(query))).text();
    return new DOMParser()
      .parseFromString(html, "text/html")
      .querySelector('[data-table="orders"] [data-shown]')?.textContent;
  }

  test("shows the saved state at once, with no jump and no warning", async () => {
    await saveChangedTable();
    // The server read the cookie the browser sent, and drew the saved columns.
    expect(await serverShown()).toBe("stock name");

    const page = await openTablePage(query);
    const orders = page.table("orders");
    expect(orders.status()).toBe("ready");
    expect(orders.shown()).toBe("stock name");
    // React took the server's page over as it was: it changed nothing and warned of nothing.
    expect(page.notes().changes).toEqual([]);
    expect(page.notes().problems).toEqual([]);
    await expect
      .poll(() => page.notes().painted.orders)
      .toEqual(["stock name"]);

    // The page is live: a change is drawn, and saved over what the server read.
    await clickOn(orders.button("stock-first"));
    await clickOn(orders.pickerTrigger());
    await expect
      .poll(() => page.document().querySelector(".fb-columns-popover"))
      .not.toBeNull();
    const price = page
      .document()
      .querySelectorAll<HTMLInputElement>(".fb-columns-checkbox")[2];
    await clickOn(price as HTMLInputElement);
    await expect.poll(orders.shown).toBe("stock name price");
    await expect
      .poll(() => stored("cookie", "orders"))
      .toContain('"hidden":[]');
  });

  test("shows the starting state when nothing is saved, with no warning", async () => {
    expect(await serverShown()).toBe("name price stock");
    const page = await openTablePage(query);
    expect(page.table("orders").status()).toBe("ready");
    expect(page.table("orders").shown()).toBe("name price stock");
    expect(page.notes().changes).toEqual([]);
    expect(page.notes().problems).toEqual([]);
  });
});

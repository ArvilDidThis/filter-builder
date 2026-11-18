import { afterEach } from "vitest";
import { commands, page } from "vitest/browser";
import "../styles.css";
import { unmountAll } from "./support/mount";
import { VIEWPORT } from "./viewport";

// Runs before every test file. Each test starts from the same page: nothing drawn, the usual
// window size, a light theme, and the mouse parked away from anything it could hover over.

afterEach(async () => {
  try {
    unmountAll();
    // A test that failed mid-drag would otherwise leave the button held, or a finger on the
    // screen, for the next test.
    await commands.mouseUp();
    await commands.liftFinger();
    // A tab that a failed test left open would stay in front of the test page.
    await commands.closePickerTab();
    await commands.mouseMove({ x: 0, y: 0 });
    await commands.colorScheme("light");
    await page.viewport(VIEWPORT.width, VIEWPORT.height);
  } finally {
    // Emptied even when a step above failed, so one test's saved state never reaches the
    // next. The failure itself still fails the test.
    clearStorage();
  }
});

/** Empties the browser's local storage and deletes every cookie the page can see. */
function clearStorage(): void {
  localStorage.clear();
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    // The cookie store under test writes this way too, and it works in every browser.
    // biome-ignore lint/suspicious/noDocumentCookie: see the line above
    if (name) document.cookie = `${name}=; Max-Age=0; Path=/`;
  }
}

import { onTestFinished } from "vitest";

/**
 * Adds an app's own CSS to the page, BEFORE the library's style sheet, and takes it off when
 * the test ends. A later rule wins over an earlier one of the same weight, so this is the
 * order in which an app's rule could lose.
 */
export function addAppCss(css: string): void {
  const sheet = document.createElement("style");
  sheet.textContent = css;
  document.head.prepend(sheet);
  onTestFinished(() => sheet.remove());
}

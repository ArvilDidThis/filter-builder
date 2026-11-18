import { createRoot, hydrateRoot } from "react-dom/client";
import "../../styles.css";
import { type InitialSaved, readSetup, TablePage } from "./table-page";

// Starts a fixture page in the browser, and keeps notes for the test that opened it.

/** What a fixture page notes down about itself. A test reads it from the page's window. */
export interface FixtureNotes {
  /** Every error and warning logged, and every error React recovered from. */
  problems: string[];
  /**
   * Every change made to what the server drew, from before React took the page over. An
   * empty list means the page did not jump.
   */
  changes: string[];
  /**
   * What each table showed on each screen frame, by table id, with repeats left out. A
   * value appears here only if the browser was about to paint it.
   */
  painted: Record<string, string[]>;
  /**
   * What each table showed each time the page's scripts came to rest after a change, by
   * table id, with repeats left out. The browser can paint only while scripts rest. So a
   * value that is missing here was never on screen, and a value that is here could have been.
   */
  rested: Record<string, string[]>;
}

declare global {
  interface Window {
    fixture: FixtureNotes;
  }
}

const notes: FixtureNotes = {
  problems: [],
  changes: [],
  painted: {},
  rested: {},
};
window.fixture = notes;

// React reports a hydration problem (the browser's first draw differing from the server's)
// through the console.
for (const level of ["error", "warn"] as const) {
  const original = console[level];
  console[level] = (...parts: unknown[]) => {
    notes.problems.push(parts.map(String).join(" "));
    original(...parts);
  };
}
window.addEventListener("error", (event) => {
  notes.problems.push(event.message);
});

const root = document.getElementById("root") as HTMLElement;
const setup = readSetup(new URLSearchParams(location.search));

/** Adds what each table shows now to `seen`, by table id, unless it is what it showed last. */
function noteShown(seen: Record<string, string[]>): void {
  for (const table of root.querySelectorAll("[data-table]")) {
    const id = table.getAttribute("data-table") as string;
    const shown = table.querySelector("[data-shown]")?.textContent ?? "";
    seen[id] ??= [];
    if (seen[id].at(-1) !== shown) seen[id].push(shown);
  }
}

/** Notes what each table shows now. Runs once per screen frame, just before the paint. */
function notePainted(): void {
  noteShown(notes.painted);
  requestAnimationFrame(notePainted);
}
requestAnimationFrame(notePainted);

// Whether a screen frame falls between two changes is up to the machine's timing, so the
// frames above can miss a value that was on the page for a moment. This cannot: the browser
// calls an observer as soon as the scripts that changed the page have come to rest, before
// it does anything else. Changes made in one go, such as a draw and the early effects that
// follow it, are seen together, as their end result. Changes with a rest in between, such as
// a draw and a late effect, are seen one by one.
noteShown(notes.rested);
new MutationObserver(() => noteShown(notes.rested)).observe(root, {
  subtree: true,
  childList: true,
  characterData: true,
});

if (setup.ssr) {
  new MutationObserver((records) => {
    for (const record of records) {
      notes.changes.push(`${record.type} in <${record.target.nodeName}>`);
    }
  }).observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  const initialSaved = JSON.parse(
    document.getElementById("initial-saved")?.textContent ?? "{}",
  ) as InitialSaved;
  hydrateRoot(root, <TablePage initialSaved={initialSaved} setup={setup} />, {
    onRecoverableError: (error) => {
      notes.problems.push(String(error));
    },
  });
} else {
  createRoot(root).render(<TablePage setup={setup} />);
}

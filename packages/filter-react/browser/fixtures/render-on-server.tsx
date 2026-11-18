import { readCookieState } from "@arvilmena/filter-core";
import { renderToString } from "react-dom/server";
import { type InitialSaved, readSetup, TablePage } from "./table-page";

// Runs in Node, inside the server that serves the fixture pages. It stands in for an app's
// own server: it reads the saved state from the request's cookies and draws the page with it.

/** The id of the element that holds what the server read, as JSON, for the browser to use. */
export const INITIAL_SAVED_ID = "initial-saved";

/** The inside of the page's `<body>`, before the script that starts it in the browser. */
export function renderPage(request: {
  search: URLSearchParams;
  /** The request's `Cookie` header. */
  cookies: string;
}): string {
  const setup = readSetup(request.search);
  if (!setup.ssr) return '<div id="root"></div>';

  const initialSaved: InitialSaved = Object.fromEntries(
    setup.tables.map((id) => [
      id,
      readCookieState(request.cookies, id) ?? null,
    ]),
  );
  const html = renderToString(
    <TablePage initialSaved={initialSaved} setup={setup} />,
  );
  // "<" is written as a code, so that saved text can never end the script element early.
  const json = JSON.stringify(initialSaved).replaceAll("<", "\\u003c");
  return (
    `<div id="root">${html}</div>` +
    `<script id="${INITIAL_SAVED_ID}" type="application/json">${json}</script>`
  );
}

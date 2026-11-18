// The addresses of the fixture pages. They are kept apart from the server that serves them,
// so that the tests in the page can use them too: the server's file loads Node-only code.

/** Where the fixture pages are served from. */
export const FIXTURE_ROUTE = "/__fixtures__/";

/** The name of the empty page, to go to when leaving another one. */
export const BLANK_PAGE = "blank";

/** The name of the page with saved tables. */
export const TABLE_PAGE = "table";

/** The address of the empty page. */
export const BLANK_PAGE_PATH = `${FIXTURE_ROUTE}${BLANK_PAGE}`;

/** The address of the fixture page with tables, for a query such as "store=cookie". */
export function tablePagePath(query: string): string {
  return `${FIXTURE_ROUTE}${TABLE_PAGE}?${query}`;
}

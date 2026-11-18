import type { Plugin } from "vitest/config";
import { createViteServer } from "vitest/node";

// Whole pages for the tests that need one: a page that is loaded again, a page that is closed,
// and a page that a server draws first. They are served by the same server as the tests, so
// they share its address, and with it the browser's local storage and cookies.

/** Where the fixture pages are served from. */
export const FIXTURE_ROUTE = "/__fixtures__/";

/** The module that draws a table on the server, and the one that starts it in the browser. */
const SERVER_MODULE = "/browser/fixtures/render-on-server.tsx";
const BROWSER_MODULE = "/browser/fixtures/start-in-browser.tsx";

/** A whole HTML page around `body`. */
function htmlPage(body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Fixture</title>
  </head>
  <body>${body}</body>
</html>`;
}

/** What the server module hands back. */
interface ServerRender {
  renderPage(options: { search: URLSearchParams; cookies: string }): string;
}

/**
 * A Vite plugin (an add-on to the server that runs the tests) that serves the fixture pages:
 *
 * - `/__fixtures__/blank`: an empty page, to go to when leaving another one.
 * - `/__fixtures__/table?…`: a page with saved tables. With `ssr=1` the server draws the
 *   tables first, from the cookies the browser sent, as an app's own server would.
 */
export function fixturePages(options: {
  /** The same stand-in paths as the test server uses, so both draw from one source. */
  alias: Record<string, string>;
}): Plugin {
  // A second, plain Vite server that only loads the module that draws on the server. The
  // test server cannot do it: it runs every package through Vite, and React's server code
  // is written for Node to load itself. It is started on the first page that needs it.
  let renderer: ReturnType<typeof createViteServer> | undefined;
  const startRenderer = (root: string) => {
    if (renderer === undefined) {
      const starting = createViteServer({
        root,
        configFile: false,
        appType: "custom",
        resolve: { alias: options.alias },
        server: { middlewareMode: true, ws: false, watch: null },
        optimizeDeps: { noDiscovery: true },
        logLevel: "error",
      });
      renderer = starting;
      // A start that failed is forgotten, so the next page tries again instead of being
      // handed the same failure for the rest of the run.
      starting.catch(() => {
        if (renderer === starting) renderer = undefined;
      });
    }
    return renderer;
  };

  return {
    name: "fixture-pages",
    async closeBundle() {
      // A start that failed left nothing to close.
      const started = await renderer?.catch(() => undefined);
      await started?.close();
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url ?? "/", "http://fixture");
        if (!url.pathname.startsWith(FIXTURE_ROUTE)) {
          next();
          return;
        }
        try {
          const name = url.pathname.slice(FIXTURE_ROUTE.length);
          let body = "";
          if (name === "table") {
            // Loaded through Vite, so the server draws with the same source as the browser.
            const loader = await startRenderer(server.config.root);
            const module = (await loader.ssrLoadModule(
              SERVER_MODULE,
            )) as ServerRender;
            body = module.renderPage({
              search: url.searchParams,
              cookies: request.headers.cookie ?? "",
            });
            body += `<script type="module" src="${BROWSER_MODULE}"></script>`;
          } else if (name !== "blank") {
            response.statusCode = 404;
          }
          response.setHeader("content-type", "text/html; charset=utf-8");
          // Every visit draws the page anew, so a reload never shows a kept copy.
          response.setHeader("cache-control", "no-store");
          response.end(htmlPage(body));
        } catch (error) {
          next(error);
        }
      });
    },
  };
}

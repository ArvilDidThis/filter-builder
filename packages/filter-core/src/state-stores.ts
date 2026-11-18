// Where a table's state is kept between visits. A store is a small object with `load`, `save`
// and `remove`, and an app can write its own. Three are built in: local storage, a cookie, and
// the app's own server.
//
// Each built-in store is a plain function that touches nothing until it is called, so a store
// an app does not use is left out of its bundle, and making one on a server is safe.
//
// This file names no browser types, because the package runs anywhere JavaScript runs. It
// describes the few browser features it uses itself.

/**
 * Keeps one JSON value per key. Each method may answer at once or with a promise.
 *
 * @example
 * const memory = new Map<string, unknown>();
 * const store: StateStore = {
 *   load: (key) => memory.get(key),
 *   save: (key, value) => void memory.set(key, value),
 *   remove: (key) => void memory.delete(key),
 * };
 */
export interface StateStore {
  /** The value saved under `key`. `null` or `undefined` means nothing is saved. */
  load(key: string): unknown;
  /** Saves `value`, which is plain JSON, under `key`. */
  save(key: string, value: unknown): void | Promise<void>;
  /** Forgets what is saved under `key`. */
  remove(key: string): void | Promise<void>;
}

/** What goes in front of every key, so a table's state cannot clash with an app's own data. */
const DEFAULT_PREFIX = "table-state.";

/** Options shared by the stores that keep state in the browser. */
export interface StorePrefixOptions {
  /** Goes in front of every key. Defaults to "table-state.". */
  prefix?: string;
}

/**
 * Keeps state in the browser's local storage. It stays on one device and one browser.
 *
 * Where there is no local storage (on a server, or in a browser that blocks it), `load` finds
 * nothing and `save` and `remove` do nothing. A stored value that is not JSON counts as nothing
 * saved. `save` throws what the browser throws when the storage is full.
 *
 * @example
 * const store = localStorageStore({ prefix: "my-app." });
 */
export function localStorageStore(
  options: StorePrefixOptions = {},
): StateStore {
  const prefix = options.prefix ?? DEFAULT_PREFIX;
  return {
    load(key) {
      const text = findLocalStorage()?.getItem(prefix + key);
      return typeof text === "string" ? parseJson(text) : undefined;
    },
    save(key, value) {
      findLocalStorage()?.setItem(prefix + key, JSON.stringify(value));
    },
    remove(key) {
      findLocalStorage()?.removeItem(prefix + key);
    },
  };
}

/** The part of the browser's storage that `localStorageStore` uses. */
interface TextStorage {
  getItem(name: string): string | null;
  setItem(name: string, text: string): void;
  removeItem(name: string): void;
}

function findLocalStorage(): TextStorage | undefined {
  try {
    return (
      (globalThis as { localStorage?: TextStorage | null }).localStorage ??
      undefined
    );
  } catch {
    // A browser that blocks storage throws as soon as the code asks for it.
    return undefined;
  }
}

/** The most bytes a browser keeps for one cookie, counting its name and its value. */
const COOKIE_SIZE_LIMIT = 4096;

const SECONDS_PER_DAY = 86_400;

/** How `cookieStore` writes its cookies. */
export interface CookieStoreOptions extends StorePrefixOptions {
  /** How many days the cookie lasts. Defaults to 365. Browsers keep a cookie 400 days at most. */
  maxAgeDays?: number;
  /** The pages the cookie belongs to. Defaults to "/", the whole site. */
  path?: string;
  /** When the browser sends the cookie along with a request from another site. Defaults to "lax". */
  sameSite?: "lax" | "strict" | "none";
  /**
   * Whether the cookie is only sent over HTTPS. Defaults to true on an HTTPS page, and always
   * true with `sameSite: "none"`, which browsers require.
   */
  secure?: boolean;
  /**
   * The most bytes one cookie may take, counting its name and its encoded value. Defaults to
   * 4096, the most a browser keeps, and a larger number is cut down to that. Lower it when
   * several tables save cookies, because every cookie is sent with every request and a server
   * refuses a request whose headers grow too large.
   */
  maxBytes?: number;
}

/** The state does not fit in a cookie, so nothing was written. */
export class CookieTooLargeError extends Error {
  override name = "CookieTooLargeError";
  /** The key the state was to be saved under. */
  readonly key: string;
  /** The bytes the cookie would have taken. */
  readonly size: number;
  /** The bytes the cookie may hold: the store's `maxBytes`. */
  readonly limit: number;

  constructor(key: string, size: number, limit: number = COOKIE_SIZE_LIMIT) {
    super(
      `The saved state for "${key}" takes ${size} bytes as a cookie, and the cookie may hold ${limit}. Nothing was saved. Save fewer parts, or use another store.`,
    );
    this.key = key;
    this.size = size;
    this.limit = limit;
  }
}

/**
 * Keeps state in a cookie, so the app's server can read it with `readCookieState` and draw the
 * page with it.
 *
 * A cookie holds about 4 KB. `save` throws a `CookieTooLargeError` for a larger value and
 * writes nothing, so a value that was saved before stays as it was.
 *
 * Only a small state fits. The value is encoded to be safe in a cookie, which makes the JSON
 * about twice as long, so about 2 KB of state fills the cookie. Each key is a cookie of its
 * own, and the browser sends them all with every request. Several of them can pass the size a
 * server accepts for a request's headers (often 8 KB to 16 KB in total), and the server then
 * refuses every request. Give each table a `name` or an `id`, so that the page path is not used as the
 * key: that adds a cookie per page. Lower `maxBytes` to cap each cookie. For a larger state,
 * use `fetchStore` or `localStorageStore`.
 *
 * Where there is no `document` (on a server), `load` finds nothing and `save` and `remove` do
 * nothing.
 *
 * @example
 * const store = cookieStore({ maxAgeDays: 30, sameSite: "strict" });
 */
export function cookieStore(options: CookieStoreOptions = {}): StateStore {
  const { maxAgeDays = 365, path = "/", sameSite = "lax" } = options;
  // Anything that is not a smaller number leaves the browser's limit in place. That covers
  // `NaN`, which would switch the size check off: no size is larger than `NaN`.
  const { maxBytes } = options;
  const limit =
    maxBytes !== undefined && maxBytes < COOKIE_SIZE_LIMIT
      ? maxBytes
      : COOKIE_SIZE_LIMIT;

  const write = (name: string, value: string, maxAgeSeconds: number): void => {
    const page = findDocument();
    if (page === undefined) return;
    const secure =
      sameSite === "none" ||
      (options.secure ??
        (globalThis as { location?: { protocol?: string } }).location
          ?.protocol === "https:");
    page.cookie = [
      `${name}=${value}`,
      `Max-Age=${maxAgeSeconds}`,
      `Path=${path}`,
      `SameSite=${SAME_SITE_NAMES[sameSite]}`,
      ...(secure ? ["Secure"] : []),
    ].join("; ");
  };

  return {
    load(key) {
      const page = findDocument();
      return page === undefined
        ? undefined
        : readCookieState(page.cookie, key, options);
    },
    save(key, value) {
      // On a server nothing is written, so no value is too large to "save" there.
      if (findDocument() === undefined) return;
      const name = cookieName(key, options);
      const text = encodeURIComponent(JSON.stringify(value));
      // Encoded text is plain ASCII, so its length is its size in bytes. The 1 is the "=".
      const size = name.length + 1 + text.length;
      if (size > limit) throw new CookieTooLargeError(key, size, limit);
      write(name, text, Math.round(maxAgeDays * SECONDS_PER_DAY));
    },
    remove(key) {
      // A cookie with no time left is deleted by the browser.
      write(cookieName(key, options), "", 0);
    },
  };
}

/**
 * Reads the state that `cookieStore` saved out of a cookie list, such as the `Cookie` header
 * of a request or `document.cookie`. Use it on a server. It gives `undefined` when nothing
 * usable is saved, and never throws.
 *
 * @example
 * const saved = readCookieState(request.headers.get("cookie") ?? "", "orders");
 * const state = readSavedState(saved, parts);
 */
export function readCookieState(
  cookies: string,
  key: string,
  options: StorePrefixOptions = {},
): unknown {
  const start = `${cookieName(key, options)}=`;
  for (const pair of cookies.split(";")) {
    const cookie = pair.trim();
    if (!cookie.startsWith(start)) continue;
    try {
      return parseJson(decodeURIComponent(cookie.slice(start.length)));
    } catch {
      // The value was cut off or edited by hand, so it cannot be decoded.
      return undefined;
    }
  }
  return undefined;
}

const SAME_SITE_NAMES = { lax: "Lax", strict: "Strict", none: "None" } as const;

/** The part of the browser's page that `cookieStore` uses. */
interface CookiePage {
  cookie: string;
}

function findDocument(): CookiePage | undefined {
  return (globalThis as { document?: CookiePage }).document;
}

/** The cookie's name: the prefix and the key, with every character a name may not hold encoded. */
function cookieName(key: string, options: StorePrefixOptions): string {
  // `encodeURIComponent` leaves brackets alone, and a cookie name may not hold them.
  return encodeURIComponent((options.prefix ?? DEFAULT_PREFIX) + key).replace(
    /[()]/g,
    (bracket) => (bracket === "(" ? "%28" : "%29"),
  );
}

/** The request `fetchStore` hands to `fetch`, beside the app's own `init`. */
export interface StateFetchRequest {
  /** "GET", "PUT" or "DELETE". */
  method: string;
  /** The request's headers, with lower-case names. */
  headers: Record<string, string>;
  /** The state as JSON text. Only a save has one. */
  body?: string;
}

/** The part of a server's answer that `fetchStore` reads. */
export interface StateFetchResponse {
  /** Whether the status is in the 200s. */
  ok: boolean;
  /** The HTTP status, such as 200 or 404. */
  status: number;
  /** Reads the body as JSON. */
  json(): Promise<unknown>;
  /**
   * Reads the body as text. The browser's `fetch` has it. When it is there, a load uses it to
   * tell an empty body, which means nothing is saved, from a body that is not JSON.
   */
  text?(): Promise<string>;
}

/** A function that sends a request, such as the browser's `fetch`. */
export type StateFetch = (
  url: string,
  init: StateFetchRequest,
) => Promise<StateFetchResponse>;

/** Headers by name. */
export type StateFetchHeaders = Readonly<Record<string, string>>;

/** How `fetchStore` reaches the app's server. */
export interface FetchStoreOptions {
  /**
   * The address to load from and save to. Text gets the key added as a `key` query parameter:
   * "/api/table-state" becomes "/api/table-state?key=orders". A function builds the address
   * from the key itself.
   */
  url: string | ((key: string) => string);
  /**
   * Extra headers, such as a sign-in token. A function is called for every request, so it can
   * hand out a fresh token, and may answer with a promise.
   *
   * The request starts only once that promise has settled. A promise that waits for something
   * slow, such as a request for a new token, can therefore lose the save a closing page makes,
   * even with `keepalive`. Answer at once from a token the app already holds where you can.
   */
  headers?:
    | StateFetchHeaders
    | (() => StateFetchHeaders | Promise<StateFetchHeaders>);
  /**
   * Extra request details passed to `fetch` as they are, such as `{ credentials: "include" }`
   * or `{ keepalive: true }`. The method, headers and body cannot be set here.
   */
  init?: Readonly<Record<string, unknown>>;
  /** The function that sends the request. Defaults to the global `fetch`. */
  fetch?: StateFetch;
}

/** What a store can be asked to do. */
type StoreAction = "load" | "save" | "remove";

/** A request to the app's server failed, or the server turned it down. */
export class FetchStoreError extends Error {
  override name = "FetchStoreError";
  /** What the store was doing. */
  readonly action: StoreAction;
  /** The HTTP status the server answered with, or `undefined` when no answer came. */
  readonly status: number | undefined;

  constructor(
    action: StoreAction,
    status: number | undefined,
    reason: string,
    cause?: unknown,
  ) {
    super(`Could not ${action} the saved state: ${reason}.`, { cause });
    this.action = action;
    this.status = status;
  }
}

/**
 * Keeps state on the app's own server:
 *
 * - `load` sends a GET and reads the answer as JSON. A 404, a 204 or an empty body means
 *   nothing is saved.
 * - `save` sends a PUT with the state as a JSON body.
 * - `remove` sends a DELETE. A 404 counts as done.
 *
 * Any other failure rejects with a `FetchStoreError`.
 *
 * The store sends a request only to the address the app gives, and adds no credentials of its
 * own. It sets the `accept` and `content-type` headers, and everything else comes from
 * `headers` and `init`. To let a save finish while the page closes, pass
 * `init: { keepalive: true }`.
 *
 * Making the store sends nothing, so it is safe on a server.
 *
 * @example
 * const store = fetchStore({
 *   url: (key) => `/api/table-state/${encodeURIComponent(key)}`,
 *   headers: () => ({ authorization: `Bearer ${token()}` }),
 * });
 */
export function fetchStore(options: FetchStoreOptions): StateStore {
  const send = async (
    action: StoreAction,
    method: string,
    key: string,
    body?: string,
  ): Promise<StateFetchResponse | undefined> => {
    const sendRequest =
      options.fetch ?? (globalThis as { fetch?: StateFetch }).fetch;
    if (sendRequest === undefined) {
      throw new FetchStoreError(action, undefined, "there is no `fetch` here");
    }
    let response: StateFetchResponse;
    try {
      const headers: Record<string, string> = { accept: "application/json" };
      if (body !== undefined) headers["content-type"] = "application/json";
      const extra =
        typeof options.headers === "function"
          ? await options.headers()
          : options.headers;
      // Lower-case names, so an app's own "Content-Type" replaces the one above.
      for (const [name, value] of Object.entries(extra ?? {})) {
        headers[name.toLowerCase()] = value;
      }
      const request: StateFetchRequest = { ...options.init, method, headers };
      // A body among the app's request details is never sent: a browser refuses a GET that
      // has one.
      if (body === undefined) delete request.body;
      else request.body = body;
      response = await sendRequest(addressFor(options.url, key), request);
    } catch (cause) {
      throw new FetchStoreError(action, undefined, "the request failed", cause);
    }
    // Nothing saved under this key: fine for a load and for a remove, a failure for a save.
    if (response.status === 404 && action !== "save") return undefined;
    if (!response.ok) {
      throw new FetchStoreError(
        action,
        response.status,
        `the server answered ${response.status}`,
      );
    }
    return response;
  };

  return {
    async load(key) {
      const response = await send("load", "GET", key);
      // 204 means "no content".
      if (response === undefined || response.status === 204) return undefined;
      try {
        if (response.text === undefined) return await response.json();
        const text = await response.text();
        // Some servers answer 200 with no body when nothing is saved.
        return text.trim() === "" ? undefined : JSON.parse(text);
      } catch (cause) {
        throw new FetchStoreError(
          "load",
          response.status,
          "the answer was not JSON",
          cause,
        );
      }
    },
    async save(key, value) {
      await send("save", "PUT", key, JSON.stringify(value));
    },
    async remove(key) {
      await send("remove", "DELETE", key);
    },
  };
}

/** The address for a key. Text gets the key as a `key` query parameter. */
function addressFor(url: FetchStoreOptions["url"], key: string): string {
  if (typeof url === "function") return url(key);
  // A fragment (the "#top" at the end of an address) is never sent to the server, so the key
  // goes in front of it.
  const fragmentStart = url.indexOf("#");
  const address = fragmentStart === -1 ? url : url.slice(0, fragmentStart);
  const fragment = fragmentStart === -1 ? "" : url.slice(fragmentStart);
  const joiner = address.includes("?") ? "&" : "?";
  return `${address}${joiner}key=${encodeURIComponent(key)}${fragment}`;
}

/** The JSON value in `text`, or `undefined` when the text is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CookieTooLargeError,
  cookieStore,
  FetchStoreError,
  fetchStore,
  localStorageStore,
  readCookieState,
  type StateFetchRequest,
  type StateFetchResponse,
  type StateStore,
} from "./state-stores";

const STATE = {
  version: 1,
  parts: { sort: { key: "price", note: 'a "quoted"; text, with = signs' } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a custom store", () => {
  it("should need only load, save and remove", () => {
    const memory = new Map<string, unknown>();
    const store: StateStore = {
      load: (key) => memory.get(key),
      save: (key, value) => void memory.set(key, value),
      remove: (key) => void memory.delete(key),
    };
    store.save("orders", STATE);
    expect(store.load("orders")).toBe(STATE);
    store.remove("orders");
    expect(store.load("orders")).toBeUndefined();
  });
});

describe("localStorageStore", () => {
  /** Stands in for the browser's local storage. */
  let items: Map<string, string>;

  beforeEach(() => {
    items = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (name: string) => items.get(name) ?? null,
      setItem: (name: string, text: string) => void items.set(name, text),
      removeItem: (name: string) => void items.delete(name),
    });
  });

  it("should save, load and remove a value", () => {
    const store = localStorageStore();
    store.save("orders", STATE);
    expect(store.load("orders")).toEqual(STATE);
    store.remove("orders");
    expect(store.load("orders")).toBeUndefined();
    expect(items.size).toBe(0);
  });

  it("should store JSON under the prefix and the key", () => {
    localStorageStore().save("orders", STATE);
    expect(items.get("table-state.orders")).toBe(JSON.stringify(STATE));
    localStorageStore({ prefix: "shop:" }).save("/orders", STATE);
    expect(items.has("shop:/orders")).toBe(true);
  });

  it("should keep each key apart", () => {
    const store = localStorageStore();
    store.save("orders", STATE);
    expect(store.load("products")).toBeUndefined();
  });

  it("should count a stored value that is not JSON as nothing saved", () => {
    items.set("table-state.orders", "{version: 1");
    expect(localStorageStore().load("orders")).toBeUndefined();
  });

  it("should pass on the browser's error when the storage is full", () => {
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("The quota has been exceeded.");
      },
    });
    expect(() => localStorageStore().save("orders", STATE)).toThrow("quota");
  });

  it("should do nothing where there is no local storage", () => {
    vi.stubGlobal("localStorage", undefined);
    const store = localStorageStore();
    expect(store.load("orders")).toBeUndefined();
    expect(() => store.save("orders", STATE)).not.toThrow();
    expect(() => store.remove("orders")).not.toThrow();
  });

  it("should do nothing in a browser that blocks storage", () => {
    vi.unstubAllGlobals();
    const blocked = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("Access is denied for this document.");
      },
    });
    try {
      const store = localStorageStore();
      expect(store.load("orders")).toBeUndefined();
      expect(() => store.save("orders", STATE)).not.toThrow();
    } finally {
      if (blocked) Object.defineProperty(globalThis, "localStorage", blocked);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});

/**
 * Stands in for `document`. Like a browser, it keeps one value per cookie name, lists only
 * `name=value` when read, and drops a cookie written with no time left.
 */
function stubDocument() {
  const jar = new Map<string, string>();
  const written: string[] = [];
  vi.stubGlobal("document", {
    get cookie() {
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set cookie(text: string) {
      written.push(text);
      const [pair = "", ...attributes] = text.split("; ");
      const name = pair.slice(0, pair.indexOf("="));
      if (attributes.includes("Max-Age=0")) jar.delete(name);
      else jar.set(name, pair.slice(name.length + 1));
    },
  });
  return { jar, written };
}

describe("cookieStore", () => {
  it("should save, load and remove a value", () => {
    const { jar } = stubDocument();
    const store = cookieStore();
    store.save("orders", STATE);
    expect(store.load("orders")).toEqual(STATE);
    store.remove("orders");
    expect(store.load("orders")).toBeUndefined();
    expect(jar.size).toBe(0);
  });

  it("should find its cookie among an app's other cookies", () => {
    const { jar } = stubDocument();
    jar.set("session", "abc");
    jar.set("table-state.orders-old", "%7B%7D");
    cookieStore().save("orders", STATE);
    jar.set("theme", "dark");
    expect(cookieStore().load("orders")).toEqual(STATE);
    expect(cookieStore().load("products")).toBeUndefined();
  });

  it("should write only characters a cookie may hold", () => {
    const { written } = stubDocument();
    cookieStore().save("/orders (all); x=1", STATE);
    const [pair = ""] = (written[0] ?? "").split("; ");
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(name.length + 1);
    expect(name).toBe("table-state.%2Forders%20%28all%29%3B%20x%3D1");
    expect(value).toMatch(/^[A-Za-z0-9%._~!*'()-]+$/);
    expect(cookieStore().load("/orders (all); x=1")).toEqual(STATE);
  });

  it("should last a year on the whole site by default", () => {
    const { written } = stubDocument();
    cookieStore().save("orders", STATE);
    expect(written[0]).toMatch(/; Max-Age=31536000; Path=\/; SameSite=Lax$/);
  });

  it("should write the attributes the app chooses", () => {
    const { written } = stubDocument();
    const store = cookieStore({
      prefix: "shop.",
      maxAgeDays: 30,
      path: "/admin",
      sameSite: "strict",
      secure: true,
    });
    store.save("orders", STATE);
    expect(written[0]).toMatch(
      /^shop\.orders=.+; Max-Age=2592000; Path=\/admin; SameSite=Strict; Secure$/,
    );
    store.remove("orders");
    expect(written[1]).toBe(
      "shop.orders=; Max-Age=0; Path=/admin; SameSite=Strict; Secure",
    );
  });

  it("should mark the cookie secure on an HTTPS page", () => {
    const { written } = stubDocument();
    vi.stubGlobal("location", { protocol: "https:" });
    cookieStore().save("orders", STATE);
    cookieStore({ secure: false }).save("orders", STATE);
    expect(written[0]).toMatch(/; Secure$/);
    expect(written[1]).not.toMatch(/Secure/);
  });

  it("should always mark a cookie sent from other sites as secure", () => {
    const { written } = stubDocument();
    cookieStore({ sameSite: "none", secure: false }).save("orders", STATE);
    expect(written[0]).toMatch(/; SameSite=None; Secure$/);
  });

  it("should refuse a value that does not fit and write nothing", () => {
    const { jar, written } = stubDocument();
    const store = cookieStore();
    store.save("orders", STATE);
    const before = jar.get("table-state.orders");
    const large = { version: 1, parts: { notes: "x".repeat(4096) } };

    let error: unknown;
    try {
      store.save("orders", large);
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(CookieTooLargeError);
    expect(error).toMatchObject({
      name: "CookieTooLargeError",
      key: "orders",
      limit: 4096,
    });
    expect((error as CookieTooLargeError).size).toBeGreaterThan(4096);
    expect((error as Error).message).toContain('"orders"');
    // The message must not quote the value: it may hold anything.
    expect((error as Error).message).not.toContain("xxx");
    expect(written).toHaveLength(1);
    expect(jar.get("table-state.orders")).toBe(before);
  });

  it("should count the name and the encoded value against the limit", () => {
    const { written } = stubDocument();
    const store = cookieStore({ prefix: "" });
    // The name "k", the "=" and a JSON text in quotes: 1 + 1 + (2 * 3 + length) bytes.
    const fits = "x".repeat(4096 - 8);
    store.save("k", fits);
    expect(written).toHaveLength(1);
    expect(() => store.save("k", `${fits}x`)).toThrow(CookieTooLargeError);
    // A character that needs encoding takes more room than it looks.
    expect(() => store.save("k", `${fits.slice(1)}é`)).toThrow(
      CookieTooLargeError,
    );
    expect(written).toHaveLength(1);
  });

  it("should refuse a value larger than the app allows", () => {
    const { written } = stubDocument();
    const store = cookieStore({ prefix: "", maxBytes: 100 });
    // The name "k", the "=" and a JSON text in quotes: 1 + 1 + (2 * 3 + length) bytes.
    store.save("k", "x".repeat(100 - 8));
    expect(written).toHaveLength(1);

    let error: unknown;
    try {
      store.save("k", "x".repeat(100 - 7));
    } catch (thrown) {
      error = thrown;
    }
    expect(error).toBeInstanceOf(CookieTooLargeError);
    expect(error).toMatchObject({ key: "k", size: 101, limit: 100 });
    expect((error as Error).message).toContain("may hold 100");
    expect(written).toHaveLength(1);
  });

  it("should never allow more than a browser keeps", () => {
    stubDocument();
    const store = cookieStore({ prefix: "", maxBytes: 10_000 });
    expect(() => store.save("k", "x".repeat(4096 - 7))).toThrow(
      expect.objectContaining({ limit: 4096 }),
    );
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    "should keep the browser's limit when the app's limit is %s",
    (maxBytes) => {
      const { written } = stubDocument();
      const store = cookieStore({ prefix: "", maxBytes });
      expect(() => store.save("k", "x".repeat(4096 - 7))).toThrow(
        expect.objectContaining({ limit: 4096 }),
      );
      expect(written).toHaveLength(0);
    },
  );

  it("should do nothing where there is no document", () => {
    const store = cookieStore();
    expect(store.load("orders")).toBeUndefined();
    expect(() => store.save("orders", STATE)).not.toThrow();
    expect(() => store.remove("orders")).not.toThrow();
  });

  it("should not refuse a value that is too large where there is no document", () => {
    const store = cookieStore();
    expect(() =>
      store.save("orders", { notes: "x".repeat(4096) }),
    ).not.toThrow();
  });
});

describe("readCookieState", () => {
  const header = `session=abc; table-state.orders=${encodeURIComponent(
    JSON.stringify(STATE),
  )}; theme=dark`;

  it("should read the state out of a request's cookie header", () => {
    expect(readCookieState(header, "orders")).toEqual(STATE);
  });

  it("should find nothing for another key or prefix", () => {
    expect(readCookieState(header, "order")).toBeUndefined();
    expect(readCookieState(header, "orders", { prefix: "shop." })).toBe(
      undefined,
    );
    expect(readCookieState("", "orders")).toBeUndefined();
  });

  it.each([
    ["cut off", "table-state.orders=%7B%22version%22%3A1%2C%22par"],
    ["badly encoded", "table-state.orders=%E0%A4%A"],
    ["empty", "table-state.orders="],
  ])("should find nothing in a value that is %s", (_label, cookies) => {
    expect(readCookieState(cookies, "orders")).toBeUndefined();
  });
});

/** A `fetch` stand-in that records each request and answers from `answer`. */
function stubFetch(
  answer: (url: string, init: StateFetchRequest) => Partial<StateFetchResponse>,
) {
  const requests: { url: string; init: StateFetchRequest }[] = [];
  const fetch = vi.fn(async (url: string, init: StateFetchRequest) => {
    requests.push({ url, init });
    const { status = 200, ...rest } = answer(url, init);
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => STATE,
      ...rest,
    };
  });
  return { fetch, requests };
}

describe("fetchStore", () => {
  it("should send nothing when it is made", () => {
    const { fetch } = stubFetch(() => ({}));
    fetchStore({ url: "/api/table-state", fetch });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("should load with a GET and read the answer as JSON", async () => {
    const { fetch, requests } = stubFetch(() => ({}));
    const store = fetchStore({ url: "/api/table-state", fetch });
    await expect(store.load("orders")).resolves.toEqual(STATE);
    expect(requests).toEqual([
      {
        url: "/api/table-state?key=orders",
        init: { method: "GET", headers: { accept: "application/json" } },
      },
    ]);
  });

  it("should save with a PUT and a JSON body", async () => {
    const { fetch, requests } = stubFetch(() => ({ status: 204 }));
    const store = fetchStore({ url: "/api/table-state", fetch });
    await expect(store.save("orders", STATE)).resolves.toBeUndefined();
    expect(requests[0]?.init).toEqual({
      method: "PUT",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(STATE),
    });
  });

  it("should remove with a DELETE", async () => {
    const { fetch, requests } = stubFetch(() => ({ status: 204 }));
    const store = fetchStore({ url: "/api/table-state", fetch });
    await expect(store.remove("orders")).resolves.toBeUndefined();
    expect(requests[0]?.init.method).toBe("DELETE");
    expect(requests[0]?.init.body).toBeUndefined();
  });

  it("should send a body only with a save, whatever the request details hold", async () => {
    const { fetch, requests } = stubFetch(() => ({ status: 204 }));
    const store = fetchStore({
      url: "/api/table-state",
      fetch,
      init: { body: "from the app", keepalive: true },
    });
    await store.load("orders");
    await store.remove("orders");
    await store.save("orders", STATE);
    // A browser refuses a GET that has a body.
    expect(requests.map(({ init }) => "body" in init)).toEqual([
      false,
      false,
      true,
    ]);
    expect(requests[2]?.init.body).toBe(JSON.stringify(STATE));
    expect(requests[0]?.init).toMatchObject({ keepalive: true });
  });

  it("should add the key to a text address, encoded", async () => {
    const { fetch, requests } = stubFetch(() => ({}));
    await fetchStore({ url: "/api/state?app=shop", fetch }).load("/orders&x=1");
    expect(requests[0]?.url).toBe("/api/state?app=shop&key=%2Forders%26x%3D1");
  });

  it.each([
    ["/api/state#top", "/api/state?key=orders#top"],
    ["/api/state?app=shop#top", "/api/state?app=shop&key=orders#top"],
    ["/api/state#top?x=1", "/api/state?key=orders#top?x=1"],
  ])("should put the key in front of the fragment of %s", async (url, sent) => {
    const { fetch, requests } = stubFetch(() => ({}));
    await fetchStore({ url, fetch }).load("orders");
    expect(requests[0]?.url).toBe(sent);
  });

  it("should let the app build the address from the key", async () => {
    const { fetch, requests } = stubFetch(() => ({}));
    const store = fetchStore({
      url: (key) => `https://example.com/state/${encodeURIComponent(key)}`,
      fetch,
    });
    await store.load("orders");
    expect(requests[0]?.url).toBe("https://example.com/state/orders");
  });

  it("should send the app's headers and request details", async () => {
    const { fetch, requests } = stubFetch(() => ({}));
    const store = fetchStore({
      url: "/api/table-state",
      headers: { Authorization: "Bearer abc", "Content-Type": "text/plain" },
      init: { credentials: "include", method: "POST", body: "ignored" },
      fetch,
    });
    await store.save("orders", STATE);
    expect(requests[0]?.init).toEqual({
      credentials: "include",
      method: "PUT",
      headers: {
        accept: "application/json",
        authorization: "Bearer abc",
        "content-type": "text/plain",
      },
      body: JSON.stringify(STATE),
    });
  });

  it("should ask for fresh headers on every request", async () => {
    const { fetch, requests } = stubFetch(() => ({}));
    let token = 0;
    const store = fetchStore({
      url: "/api/table-state",
      headers: async () => {
        token += 1;
        return { authorization: `Bearer ${token}` };
      },
      fetch,
    });
    await store.load("orders");
    await store.load("orders");
    expect(requests.map(({ init }) => init.headers.authorization)).toEqual([
      "Bearer 1",
      "Bearer 2",
    ]);
  });

  it("should add no credentials of its own", async () => {
    const { fetch, requests } = stubFetch(() => ({}));
    const store = fetchStore({ url: "/api/table-state", fetch });
    await store.load("orders");
    await store.save("orders", STATE);
    await store.remove("orders");
    for (const { init } of requests) {
      expect(Object.keys(init).sort()).toEqual(
        init.body === undefined
          ? ["headers", "method"]
          : ["body", "headers", "method"],
      );
      expect(Object.keys(init.headers)).not.toContain("authorization");
      expect(Object.keys(init.headers)).not.toContain("cookie");
    }
  });

  it("should use the global fetch by default", async () => {
    const { fetch } = stubFetch(() => ({}));
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchStore({ url: "/api/table-state" }).load("orders"),
    ).resolves.toEqual(STATE);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([404, 204])("should find nothing saved on a %i", async (status) => {
    const json = vi.fn();
    const { fetch } = stubFetch(() => ({ status, json }));
    const store = fetchStore({ url: "/api/table-state", fetch });
    await expect(store.load("orders")).resolves.toBeUndefined();
    expect(json).not.toHaveBeenCalled();
  });

  it("should count a 404 on remove as done", async () => {
    const { fetch } = stubFetch(() => ({ status: 404 }));
    const store = fetchStore({ url: "/api/table-state", fetch });
    await expect(store.remove("orders")).resolves.toBeUndefined();
  });

  it.each([
    ["load", 500],
    ["load", 401],
    ["save", 404],
    ["save", 413],
    ["remove", 403],
  ] as const)(
    "should reject a %s the server answers with %i",
    async (action, status) => {
      const { fetch } = stubFetch(() => ({ status }));
      const store = fetchStore({ url: "/api/table-state", fetch });
      const error = await Promise.resolve(store[action]("orders", STATE)).then(
        () => undefined,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(FetchStoreError);
      expect(error).toMatchObject({ name: "FetchStoreError", action, status });
      expect((error as Error).message).toBe(
        `Could not ${action} the saved state: the server answered ${status}.`,
      );
    },
  );

  it("should reject with the cause when the request fails", async () => {
    const cause = new TypeError("Failed to fetch");
    const store = fetchStore({
      url: "/api/table-state",
      fetch: () => Promise.reject(cause),
    });
    await expect(store.save("orders", STATE)).rejects.toMatchObject({
      name: "FetchStoreError",
      action: "save",
      status: undefined,
      message: "Could not save the saved state: the request failed.",
      cause,
    });
  });

  it("should reject a load whose answer is not JSON", async () => {
    const { fetch } = stubFetch(() => ({
      json: () => Promise.reject(new SyntaxError("Unexpected token <")),
    }));
    const store = fetchStore({ url: "/api/table-state", fetch });
    await expect(store.load("orders")).rejects.toMatchObject({
      action: "load",
      status: 200,
      message: "Could not load the saved state: the answer was not JSON.",
    });
  });

  it.each([
    ["no body", ""],
    ["only blank space", " \n"],
  ])("should count a 200 with %s as nothing saved", async (_label, body) => {
    const { fetch } = stubFetch(() => ({ text: async () => body }));
    const store = fetchStore({ url: "/api/table-state", fetch });
    await expect(store.load("orders")).resolves.toBeUndefined();
  });

  it("should reject a load whose text is not JSON", async () => {
    const { fetch } = stubFetch(() => ({ text: async () => "<html>" }));
    const store = fetchStore({ url: "/api/table-state", fetch });
    await expect(store.load("orders")).rejects.toMatchObject({
      name: "FetchStoreError",
      action: "load",
      status: 200,
      message: "Could not load the saved state: the answer was not JSON.",
    });
  });

  it("should reject clearly where there is no fetch", async () => {
    vi.stubGlobal("fetch", undefined);
    const store = fetchStore({ url: "/api/table-state" });
    await expect(store.load("orders")).rejects.toThrow(
      "Could not load the saved state: there is no `fetch` here.",
    );
  });
});

import {
  type ColumnDefinition,
  type ColumnSettings,
  CookieTooLargeError,
  columnStatePart,
  cookieStore,
  type FetchStoreOptions,
  type FilterDefinition,
  fetchStore,
  filterStatePart,
  type SavedState,
  type StatePart,
  type StateStore,
} from "@arvilmena/filter-core";
import { act, renderHook } from "@testing-library/react";
import { createElement, StrictMode } from "react";
import { renderToString } from "react-dom/server";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import { useColumnSettings } from "./useColumnSettings";
import { useFilterBuilder } from "./useFilterBuilder";
import {
  type SavedTableState,
  type UseSavedTableStateOptions,
  useSavedTableState,
} from "./useSavedTableState";

const COLUMNS = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "notes", label: "Notes", defaultHidden: true },
] as const satisfies readonly ColumnDefinition[];

const COLUMN_DEFAULTS: ColumnSettings = {
  order: ["name", "price", "notes"],
  hidden: ["notes"],
};

const EMPTY_FILTER: FilterDefinition = { criteria: [], logic: "AND" };

/** A filter with one condition on the price. */
const priceFilter = (least: string): FilterDefinition => ({
  logic: "AND",
  criteria: [
    {
      condition: ">=",
      data: "Price",
      origData: "price",
      type: "num",
      value: [least],
    },
  ],
});

interface Sort {
  key: string;
  direction: "asc" | "desc";
}

/** A part an app adds itself: the column the table is sorted by. */
const sortPart: StatePart<Sort | null> = {
  defaultValue: null,
  parse: (saved) => {
    const { key, direction } = saved as Partial<Sort>;
    if (typeof key !== "string") return undefined;
    return { key, direction: direction === "desc" ? "desc" : "asc" };
  },
};

const PARTS = {
  filter: filterStatePart(),
  columns: columnStatePart(COLUMNS),
  sort: sortPart,
};

type Values = {
  filter: FilterDefinition;
  columns: ColumnSettings;
  sort: Sort | null;
};

const PRICE_SORT: Sort = { key: "price", direction: "desc" };
const NAME_SORT: Sort = { key: "name", direction: "asc" };

const savedWith = (
  parts: Record<string, unknown>,
  version = 1,
): SavedState => ({
  version,
  parts,
});

/** A store that keeps its values in memory, answers at once and records every call. */
function memoryStore(initial: Record<string, unknown> = {}) {
  const items = new Map(Object.entries(initial));
  const store = {
    items,
    load: vi.fn((key: string): unknown => items.get(key)),
    save: vi.fn((key: string, value: unknown): void => {
      // A real store keeps text, so later changes to the value cannot reach it.
      items.set(key, JSON.parse(JSON.stringify(value)));
    }),
    remove: vi.fn((key: string): void => {
      items.delete(key);
    }),
  };
  return store satisfies StateStore;
}

/** A promise the test settles by hand. */
function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Value>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Lets promise callbacks that are ready run, inside React's `act`. */
const settle = () => act(async () => {});

type Options = Partial<UseSavedTableStateOptions<Values>>;

/** Runs the hook. `rerender` takes the options to change. */
function renderSaved(options: Options = {}) {
  return renderHook(
    (props: Options) =>
      useSavedTableState({ id: "orders", parts: PARTS, ...props }),
    { initialProps: options },
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useSavedTableState", () => {
  describe("loading", () => {
    it("should work with only an id and the parts, using local storage", () => {
      const { result } = renderHook(() =>
        useSavedTableState({ id: "orders", parts: PARTS }),
      );
      expect(result.current.status).toBe("ready");
      expect(result.current.values).toEqual({
        filter: EMPTY_FILTER,
        columns: COLUMN_DEFAULTS,
        sort: null,
      });

      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(
        JSON.parse(localStorage.getItem("table-state.orders") ?? "null"),
      ).toEqual(
        savedWith({
          filter: EMPTY_FILTER,
          columns: COLUMN_DEFAULTS,
          sort: PRICE_SORT,
        }),
      );
    });

    it("should hand out the saved parts", () => {
      const columns: ColumnSettings = {
        order: ["price", "name", "notes"],
        hidden: [],
      };
      const store = memoryStore({
        orders: savedWith({
          filter: priceFilter("10"),
          columns,
          sort: NAME_SORT,
        }),
      });
      const { result } = renderSaved({ store });
      expect(store.load).toHaveBeenCalledExactlyOnceWith("orders");
      expect(result.current.status).toBe("ready");
      expect(result.current.error).toBeUndefined();
      expect(result.current.values).toEqual({
        filter: priceFilter("10"),
        columns,
        sort: NAME_SORT,
      });
    });

    it("should give a broken part its default and still use the others", () => {
      const store = memoryStore({
        orders: savedWith({
          filter: "price >= 10",
          columns: { order: ["price", "gone"], hidden: "all" },
          sort: PRICE_SORT,
        }),
      });
      const { result } = renderSaved({ store });
      expect(result.current.status).toBe("ready");
      expect(result.current.values).toEqual({
        filter: EMPTY_FILTER,
        columns: { order: ["name", "price", "notes"], hidden: ["notes"] },
        sort: PRICE_SORT,
      });
    });

    it.each([
      ["text", "<html>"],
      ["a list", [1, 2]],
      ["a number", 7],
      ["an object of another shape", { filter: priceFilter("10") }],
    ])(
      "should start from the defaults when the store holds %s",
      (_label, stored) => {
        const { result } = renderSaved({
          store: memoryStore({ orders: stored }),
        });
        expect(result.current.status).toBe("ready");
        expect(result.current.values).toEqual({
          filter: EMPTY_FILTER,
          columns: COLUMN_DEFAULTS,
          sort: null,
        });
      },
    );

    it("should upgrade a value saved under an older version", () => {
      const store = memoryStore({
        orders: savedWith({ sort: { column: "price" } }, 1),
      });
      const migrate = vi.fn(
        (parts: Record<string, unknown>, _fromVersion: number) => ({
          ...parts,
          sort: { key: (parts.sort as { column: string }).column },
        }),
      );
      const { result } = renderSaved({ store, version: 2, migrate });
      expect(migrate).toHaveBeenCalledWith({ sort: { column: "price" } }, 1);
      expect(result.current.values.sort).toEqual({
        key: "price",
        direction: "asc",
      });

      act(() => result.current.set.sort(NAME_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toMatchObject({
        version: 2,
        parts: { sort: NAME_SORT },
      });
    });

    it("should not redraw the parts when nothing is saved", () => {
      const store = memoryStore();
      const seen: Values[] = [];
      const { result } = renderHook(() => {
        const saved = useSavedTableState({ id: "orders", parts: PARTS, store });
        seen.push(saved.values);
        return saved;
      });
      expect(result.current.status).toBe("ready");
      expect(new Set(seen).size).toBe(1);
    });

    it("should load once in strict mode and still save", () => {
      const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result } = renderHook(
        () => useSavedTableState({ id: "orders", parts: PARTS, store }),
        { wrapper: StrictMode },
      );
      expect(result.current.values.sort).toEqual(NAME_SORT);
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.save).toHaveBeenCalledOnce();
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: PRICE_SORT },
      });
    });
  });

  describe("the key", () => {
    it("should prefer the name over the id", () => {
      const store = memoryStore();
      renderSaved({ store, name: "orders-archive" });
      expect(store.load).toHaveBeenCalledExactlyOnceWith("orders-archive");
    });

    it("should fall back to the page's path", () => {
      const store = memoryStore();
      renderHook(() => useSavedTableState({ parts: PARTS, store }));
      expect(window.location.pathname.length).toBeGreaterThan(0);
      expect(store.load).toHaveBeenCalledExactlyOnceWith(
        window.location.pathname,
      );
    });
  });

  describe("types", () => {
    it("should infer each part's type from its definition", () => {
      const { result } = renderHook(() =>
        useSavedTableState({
          id: "orders",
          parts: {
            filter: filterStatePart(),
            columns: columnStatePart(COLUMNS),
            pageSize: {
              defaultValue: 25,
              parse: (saved: unknown) =>
                typeof saved === "number" ? saved : undefined,
            },
          },
        }),
      );
      const { values, set } = result.current;
      expectTypeOf(values.filter).toEqualTypeOf<FilterDefinition>();
      expectTypeOf(values.columns).toEqualTypeOf<ColumnSettings>();
      expectTypeOf(values.pageSize).toEqualTypeOf<number>();
      expectTypeOf(set.pageSize)
        .parameter(0)
        .toEqualTypeOf<number | ((before: number) => number)>();
      // @ts-expect-error A part the app did not name has no setter.
      expect(set.sort).toBeUndefined();
    });

    it("should plug into the builder hook and the column hook", () => {
      const fields = [{ key: "price", label: "Price", type: "num" }] as const;
      const { result } = renderHook(() => {
        const saved = useSavedTableState({
          id: "orders",
          parts: PARTS,
          store: memoryStore(),
        });
        const builder = useFilterBuilder({
          value: saved.values.filter,
          onChange: saved.set.filter,
          fields,
        });
        const table = useColumnSettings({
          columns: COLUMNS,
          value: saved.values.columns,
          onChange: saved.set.columns,
        });
        return { saved, builder, table };
      });

      act(() => result.current.builder.actions.addCondition([], "price"));
      act(() => result.current.table.actions.toggle("notes"));
      expect(result.current.saved.values.filter.criteria).toHaveLength(1);
      expect(result.current.builder.conditionCount).toBe(1);
      expect(result.current.saved.values.columns.hidden).toEqual([]);
      expect(
        result.current.table.visibleColumns.map((column) => column.key),
      ).toEqual(["name", "price", "notes"]);
    });
  });

  describe("identity", () => {
    it("should keep the setters and functions the same between renders", () => {
      const store = memoryStore();
      // The parts are a new object on every render, as when an app builds them inline.
      const { result, rerender } = renderHook(() =>
        useSavedTableState({
          id: "orders",
          store,
          parts: { filter: filterStatePart(), sort: sortPart },
        }),
      );
      const first = result.current;
      rerender();
      act(() => result.current.set.sort(PRICE_SORT));
      expect(result.current.set).toBe(first.set);
      expect(result.current.set.filter).toBe(first.set.filter);
      expect(result.current.flush).toBe(first.flush);
      expect(result.current.clear).toBe(first.clear);
    });

    it("should change only the part that was set", () => {
      const { result } = renderSaved({ store: memoryStore() });
      const before = result.current.values;
      act(() => result.current.set.filter(priceFilter("10")));
      expect(result.current.values.filter).not.toBe(before.filter);
      expect(result.current.values.columns).toBe(before.columns);
      expect(result.current.values.sort).toBe(before.sort);
    });

    it("should not redraw or save when a part is set to the value it has", () => {
      const store = memoryStore();
      let renders = 0;
      const { result } = renderHook(() => {
        renders += 1;
        return useSavedTableState({ id: "orders", parts: PARTS, store });
      });
      const before = renders;
      act(() => result.current.set.filter(result.current.values.filter));
      act(() => result.current.set.sort((sort) => sort));
      act(() => vi.advanceTimersByTime(300));
      expect(renders).toBe(before);
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should build a change on the one made just before it", () => {
      const { result } = renderHook(() =>
        useSavedTableState({
          id: "orders",
          store: memoryStore(),
          parts: { count: { defaultValue: 0, parse: Number } },
        }),
      );
      act(() => {
        result.current.set.count((count) => count + 1);
        result.current.set.count((count) => count + 1);
      });
      expect(result.current.values.count).toBe(2);
    });
  });

  describe("saving", () => {
    it("should save quick changes together, after the delay", () => {
      const store = memoryStore();
      const { result } = renderSaved({ store });
      act(() => result.current.set.filter(priceFilter("1")));
      act(() => vi.advanceTimersByTime(200));
      act(() => result.current.set.filter(priceFilter("10")));
      act(() => vi.advanceTimersByTime(200));
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(299));
      expect(store.save).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(1));
      expect(store.save).toHaveBeenCalledExactlyOnceWith(
        "orders",
        savedWith({
          filter: priceFilter("10"),
          columns: COLUMN_DEFAULTS,
          sort: PRICE_SORT,
        }),
      );
    });

    it("should wait as long as the app asks", () => {
      const store = memoryStore();
      const { result } = renderSaved({ store, saveDelayMs: 1000 });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(999));
      expect(store.save).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(store.save).toHaveBeenCalledOnce();
    });

    it("should not save the same value twice", () => {
      const store = memoryStore();
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      // There and back within one delay: the value is the one already saved.
      act(() => result.current.set.sort(NAME_SORT));
      act(() => result.current.set.sort({ ...PRICE_SORT }));
      act(() => vi.advanceTimersByTime(300));
      expect(store.save).toHaveBeenCalledOnce();

      act(() => result.current.set.sort(NAME_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.save).toHaveBeenCalledTimes(2);
    });

    it("should save at once on flush", () => {
      const store = memoryStore();
      const { result } = renderSaved({ store });
      act(() => result.current.flush());
      expect(store.save).not.toHaveBeenCalled();

      act(() => result.current.set.sort(PRICE_SORT));
      act(() => result.current.flush());
      expect(store.save).toHaveBeenCalledOnce();
      act(() => vi.advanceTimersByTime(300));
      expect(store.save).toHaveBeenCalledOnce();
    });

    it.each([
      ["closed", () => window.dispatchEvent(new Event("pagehide"))],
      [
        "hidden",
        () => {
          vi.spyOn(document, "visibilityState", "get").mockReturnValue(
            "hidden",
          );
          document.dispatchEvent(new Event("visibilitychange"));
        },
      ],
    ])("should save a waiting change when the page is %s", (_label, leave) => {
      const store = memoryStore();
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(leave);
      expect(store.save).toHaveBeenCalledExactlyOnceWith(
        "orders",
        expect.objectContaining({
          parts: expect.objectContaining({ sort: PRICE_SORT }),
        }),
      );
      vi.restoreAllMocks();
    });

    it("should not save when a hidden page is shown again", () => {
      const store = memoryStore();
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should save a waiting change on unmount", () => {
      const store = memoryStore();
      const { result, unmount } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      unmount();
      expect(store.save).toHaveBeenCalledOnce();
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: PRICE_SORT },
      });
      act(() => vi.advanceTimersByTime(300));
      expect(store.save).toHaveBeenCalledOnce();
    });

    it("should stop listening to the page on unmount", () => {
      const store = memoryStore();
      const { result, unmount } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      unmount();
      store.save.mockClear();
      window.dispatchEvent(new Event("pagehide"));
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should send one save at a time to a store that answers later", async () => {
      const answers = [deferred<void>(), deferred<void>()];
      const save = vi.fn((_key: string, _value: unknown) => {
        const answer = answers[save.mock.calls.length - 1];
        return answer ? answer.promise : Promise.resolve();
      });
      const store = { ...memoryStore(), save };
      const { result } = renderSaved({ store });

      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      act(() => result.current.set.sort(NAME_SORT));
      act(() => vi.advanceTimersByTime(300));
      // The first save has not been answered, so the second one waits.
      expect(save).toHaveBeenCalledOnce();

      answers[0]?.resolve();
      await settle();
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls[1]?.[1]).toMatchObject({
        parts: { sort: NAME_SORT },
      });
    });
  });

  describe("a store that answers later", () => {
    it("should show the defaults while loading, then the saved state", async () => {
      const load = deferred<unknown>();
      const store = { ...memoryStore(), load: () => load.promise };
      const { result } = renderSaved({ store });
      expect(result.current.status).toBe("loading");
      expect(result.current.values.sort).toBeNull();

      load.resolve(savedWith({ sort: NAME_SORT }));
      await settle();
      expect(result.current.status).toBe("ready");
      expect(result.current.values.sort).toEqual(NAME_SORT);
    });

    it("should not save before the load has finished", async () => {
      const load = deferred<unknown>();
      const store = { ...memoryStore(), load: () => load.promise };
      const { result } = renderSaved({ store });

      act(() => result.current.set.sort(PRICE_SORT));
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      act(() => vi.advanceTimersByTime(1000));
      act(() => result.current.flush());
      act(() => window.dispatchEvent(new Event("pagehide")));
      expect(store.save).not.toHaveBeenCalled();

      load.resolve(savedWith({ filter: priceFilter("10"), sort: NAME_SORT }));
      await settle();
      // The part changed while loading keeps the change. The others take the saved state.
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      expect(result.current.values.filter).toEqual(priceFilter("10"));
      expect(store.save).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(300));
      expect(store.save).toHaveBeenCalledExactlyOnceWith(
        "orders",
        savedWith({
          filter: priceFilter("10"),
          columns: COLUMN_DEFAULTS,
          sort: PRICE_SORT,
        }),
      );
    });

    it("should not save on unmount before the load has finished", () => {
      const store = { ...memoryStore(), load: () => new Promise(() => {}) };
      const { result, unmount } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      unmount();
      act(() => vi.advanceTimersByTime(1000));
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should ignore a load that answers after unmount", async () => {
      const load = deferred<unknown>();
      const store = { ...memoryStore(), load: () => load.promise };
      const onError = vi.fn();
      const { result, unmount } = renderSaved({ store, onError });
      const last = result.current;
      unmount();
      load.resolve(savedWith({ sort: NAME_SORT }));
      await settle();
      act(() => vi.advanceTimersByTime(1000));
      expect(result.current).toBe(last);
      expect(store.save).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
    });
  });

  describe("a change of key", () => {
    it("should load the new key and never show the old key's state under it", () => {
      const store = memoryStore({
        orders: savedWith({ sort: NAME_SORT }),
        products: savedWith({ sort: PRICE_SORT }),
      });
      const seen: [string, Sort | null][] = [];
      const { result, rerender } = renderHook(
        ({ id }) => {
          const saved = useSavedTableState({ id, parts: PARTS, store });
          seen.push([id, saved.values.sort]);
          return saved;
        },
        { initialProps: { id: "orders" } },
      );
      expect(result.current.values.sort).toEqual(NAME_SORT);

      rerender({ id: "products" });
      expect(result.current.status).toBe("ready");
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      expect(seen).not.toContainEqual(["products", NAME_SORT]);
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should save a waiting change under the key it was made for", () => {
      const store = memoryStore({ products: savedWith({ sort: NAME_SORT }) });
      const { result, rerender } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      rerender({ store, id: "products" });

      expect(store.save).toHaveBeenCalledExactlyOnceWith(
        "orders",
        expect.objectContaining({
          parts: expect.objectContaining({ sort: PRICE_SORT }),
        }),
      );
      expect(result.current.values.sort).toEqual(NAME_SORT);
      act(() => vi.advanceTimersByTime(1000));
      expect(store.save).toHaveBeenCalledOnce();
      expect(store.items.get("products")).toEqual(
        savedWith({ sort: NAME_SORT }),
      );
    });

    it("should save a later change under the new key only", () => {
      const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result, rerender } = renderSaved({ store });
      rerender({ store, name: "orders-archive" });
      act(() => result.current.set.filter(priceFilter("10")));
      act(() => vi.advanceTimersByTime(300));

      expect(store.save).toHaveBeenCalledExactlyOnceWith(
        "orders-archive",
        savedWith({
          filter: priceFilter("10"),
          columns: COLUMN_DEFAULTS,
          sort: null,
        }),
      );
      expect(store.items.get("orders")).toEqual(savedWith({ sort: NAME_SORT }));
    });

    it("should ignore the old key's load when it answers late", async () => {
      const loads: Record<string, ReturnType<typeof deferred<unknown>>> = {
        orders: deferred(),
        products: deferred(),
      };
      const store = {
        ...memoryStore(),
        load: (key: string) => loads[key]?.promise,
      };
      const { result, rerender } = renderSaved({ store });
      rerender({ store, id: "products" });

      loads.products?.resolve(savedWith({ sort: PRICE_SORT }));
      await settle();
      expect(result.current.values.sort).toEqual(PRICE_SORT);

      loads.orders?.resolve(savedWith({ sort: NAME_SORT }));
      await settle();
      expect(result.current.status).toBe("ready");
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      act(() => vi.advanceTimersByTime(1000));
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should not carry a change made while loading over to the new key", async () => {
      const loads: Record<string, ReturnType<typeof deferred<unknown>>> = {
        orders: deferred(),
        products: deferred(),
      };
      const store = {
        ...memoryStore(),
        load: (key: string) => loads[key]?.promise,
      };
      const { result, rerender } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      rerender({ store, id: "products" });
      expect(result.current.status).toBe("loading");
      expect(result.current.values.sort).toBeNull();

      loads.products?.resolve(undefined);
      loads.orders?.resolve(undefined);
      await settle();
      act(() => vi.advanceTimersByTime(1000));
      expect(result.current.values.sort).toBeNull();
      expect(store.save).not.toHaveBeenCalled();
    });
  });

  describe("failures", () => {
    it("should report a failed load and keep the table working", async () => {
      const failure = new Error("offline");
      const store = {
        ...memoryStore(),
        load: () => Promise.reject(failure),
      };
      const onError = vi.fn();
      const { result } = renderSaved({ store, onError });
      await settle();
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe(failure);
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure, "load");
      expect(result.current.values.sort).toBeNull();

      act(() => result.current.set.sort(PRICE_SORT));
      expect(result.current.values.sort).toEqual(PRICE_SORT);
    });

    it("should not overwrite the stored state after a failed load", async () => {
      const store = {
        ...memoryStore(),
        load: () => Promise.reject(new Error("offline")),
      };
      const { result, unmount } = renderSaved({ store });
      await settle();
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(1000));
      act(() => result.current.flush());
      unmount();
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should report a store that throws while loading", () => {
      const failure = new Error("blocked");
      const store = {
        ...memoryStore(),
        load: () => {
          throw failure;
        },
      };
      const onError = vi.fn();
      const { result } = renderSaved({ store, onError });
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe(failure);
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure, "load");
    });

    it("should report a failed save, and recover when the next one works", async () => {
      const failure = new Error("full");
      const store = memoryStore();
      store.save.mockImplementationOnce(() => {
        throw failure;
      });
      const onError = vi.fn();
      const { result } = renderSaved({ store, onError });

      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe(failure);
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure, "save");
      expect(result.current.values.sort).toEqual(PRICE_SORT);

      act(() => result.current.set.sort(NAME_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(result.current.status).toBe("ready");
      expect(result.current.error).toBeUndefined();
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: NAME_SORT },
      });
    });

    it("should try a failed save again when the same value is set", async () => {
      const store = memoryStore();
      const save = vi
        .fn<StateStore["save"]>()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue(undefined);
      const { result } = renderSaved({ store: { ...store, save } });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      await settle();
      expect(result.current.status).toBe("error");

      act(() => result.current.set.sort(NAME_SORT));
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      await settle();
      expect(save).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe("ready");
    });

    it("should report a value that cannot be written as JSON", () => {
      const store = memoryStore();
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useSavedTableState({
          id: "orders",
          store,
          onError,
          parts: {
            count: {
              defaultValue: 0n as unknown,
              parse: (saved: unknown) => saved,
            },
          },
        }),
      );
      act(() => result.current.set.count(1n));
      act(() => vi.advanceTimersByTime(300));
      expect(store.save).not.toHaveBeenCalled();
      expect(result.current.status).toBe("error");
      expect(onError).toHaveBeenCalledExactlyOnceWith(
        expect.any(TypeError),
        "save",
      );
    });

    it("should report a missing key and save nothing", () => {
      vi.stubGlobal("location", undefined);
      const store = memoryStore();
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useSavedTableState({ parts: PARTS, store, onError }),
      );
      expect(result.current.status).toBe("error");
      expect((result.current.error as Error).message).toBe(
        "There is no key to save the table state under. Pass `name` or `id`.",
      );
      expect(onError).toHaveBeenCalledOnce();
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      expect(store.load).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    });
  });

  describe("clear", () => {
    it("should forget the saved state and put the defaults back", () => {
      const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result } = renderSaved({ store });
      act(() => result.current.set.filter(priceFilter("10")));
      act(() => result.current.clear());

      expect(store.remove).toHaveBeenCalledExactlyOnceWith("orders");
      expect(store.items.has("orders")).toBe(false);
      expect(result.current.status).toBe("ready");
      expect(result.current.values).toEqual({
        filter: EMPTY_FILTER,
        columns: COLUMN_DEFAULTS,
        sort: null,
      });
      // The change that was waiting is dropped with the rest.
      act(() => vi.advanceTimersByTime(1000));
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should save changes made after it", () => {
      const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result } = renderSaved({ store });
      act(() => result.current.clear());
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: PRICE_SORT },
      });
    });

    it("should drop a load that is still on its way", async () => {
      const load = deferred<unknown>();
      const store = { ...memoryStore(), load: () => load.promise };
      const { result } = renderSaved({ store });
      act(() => result.current.clear());
      expect(result.current.status).toBe("ready");

      load.resolve(savedWith({ sort: NAME_SORT }));
      await settle();
      expect(result.current.values.sort).toBeNull();
    });

    it("should report a failed remove", async () => {
      const failure = new Error("offline");
      const store = {
        ...memoryStore(),
        remove: () => Promise.reject(failure),
      };
      const onError = vi.fn();
      const { result } = renderSaved({ store, onError });
      act(() => result.current.clear());
      await settle();
      expect(result.current.status).toBe("error");
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure, "remove");
    });
  });

  describe("the built-in stores", () => {
    it("should report a state too large for a cookie and keep working", () => {
      const onError = vi.fn();
      const { result } = renderHook(() =>
        useSavedTableState({
          id: "orders",
          store: cookieStore(),
          onError,
          parts: {
            note: {
              defaultValue: "",
              parse: (saved: unknown) =>
                typeof saved === "string" ? saved : undefined,
            },
          },
        }),
      );
      act(() => result.current.set.note("short"));
      act(() => vi.advanceTimersByTime(300));
      expect(result.current.status).toBe("ready");
      expect(document.cookie).toContain("table-state.orders=");

      const saved = document.cookie;
      act(() => result.current.set.note("x".repeat(5000)));
      act(() => vi.advanceTimersByTime(300));
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBeInstanceOf(CookieTooLargeError);
      expect(onError).toHaveBeenCalledOnce();
      expect(result.current.values.note).toHaveLength(5000);
      expect(document.cookie).toBe(saved);
      act(() => result.current.clear());
    });

    it("should accept the browser's fetch and its request details", async () => {
      const send = vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify(savedWith({ sort: NAME_SORT }))),
      );
      const store = fetchStore({
        url: "https://example.com/api/table-state",
        init: { credentials: "include", keepalive: true },
        fetch: send,
      });
      const { result } = renderSaved({ store });
      expect(result.current.status).toBe("loading");
      await settle();
      expect(result.current.values.sort).toEqual(NAME_SORT);
      expect(send).toHaveBeenCalledExactlyOnceWith(
        "https://example.com/api/table-state?key=orders",
        {
          credentials: "include",
          keepalive: true,
          method: "GET",
          headers: { accept: "application/json" },
        },
      );
      // The global `fetch` fits too.
      expectTypeOf(fetch).toExtend<NonNullable<FetchStoreOptions["fetch"]>>();
    });
  });

  describe("on a server", () => {
    it("should draw the defaults and not touch the store", () => {
      const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
      const drawn: SavedTableState<Values>[] = [];
      const page = createElement(ServerTable, { id: "orders", store, drawn });
      expect(renderToString(page)).toBe("<p>loading null</p>");
      expect(drawn[0]?.values).toEqual({
        filter: EMPTY_FILTER,
        columns: COLUMN_DEFAULTS,
        sort: null,
      });
      expect(store.load).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should draw without a page or browser storage", () => {
      vi.stubGlobal("location", undefined);
      vi.stubGlobal("localStorage", undefined);
      try {
        expect(renderToString(createElement(ServerTable, {}))).toBe(
          "<p>loading null</p>",
        );
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});

/** A page that draws the status and the sort, for the server tests. */
function ServerTable(props: Options & { drawn?: SavedTableState<Values>[] }) {
  const { drawn, ...options } = props;
  const saved = useSavedTableState({ parts: PARTS, ...options });
  drawn?.push(saved);
  return createElement(
    "p",
    null,
    `${saved.status} ${JSON.stringify(saved.values.sort)}`,
  );
}

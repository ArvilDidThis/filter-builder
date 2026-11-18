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
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { Activity, createElement, StrictMode, useEffect } from "react";
import { hydrateRoot } from "react-dom/client";
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

/**
 * A store that answers a save or a remove only when the test says so, in any order. A value
 * reaches `items` when its request is answered, as on a real server.
 */
function slowStore(initial: Record<string, unknown> = {}) {
  const memory = memoryStore(initial);
  const requests: {
    kind: "save" | "remove";
    key: string;
    answer: () => void;
    fail: (error: unknown) => void;
  }[] = [];
  const ask = (kind: "save" | "remove", key: string, apply: () => void) =>
    new Promise<void>((resolve, reject) => {
      const answer = () => {
        apply();
        resolve();
      };
      requests.push({ kind, key, answer, fail: reject });
    });
  const store = {
    items: memory.items,
    requests,
    load: memory.load,
    save: vi.fn((key: string, value: unknown) =>
      ask("save", key, () => memory.save(key, value)),
    ),
    remove: vi.fn((key: string) =>
      ask("remove", key, () => memory.remove(key)),
    ),
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
  // Vitest's `afterEach` is imported here, not a global, so Testing Library does not unmount
  // by itself. Without this a hook, and its `pagehide` listener, lives on into the next test.
  cleanup();
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

    it("should load a store that answers at once only once in strict mode, and still save", () => {
      const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result } = renderHook(
        () => useSavedTableState({ id: "orders", parts: PARTS, store }),
        { wrapper: StrictMode },
      );
      expect(store.load).toHaveBeenCalledOnce();
      expect(result.current.values.sort).toEqual(NAME_SORT);
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.save).toHaveBeenCalledOnce();
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: PRICE_SORT },
      });
    });
  });

  describe("when React runs the load again", () => {
    it("should load a store that answers later twice in strict mode, and ignore the first answer", async () => {
      // Strict mode (development only) starts every effect, stops it and starts it again.
      const answers = [deferred<unknown>(), deferred<unknown>()];
      const load = vi.fn(
        (_key: string) => answers[load.mock.calls.length - 1]?.promise,
      );
      const store = { ...memoryStore(), load };
      const { result } = renderHook(
        () => useSavedTableState({ id: "orders", parts: PARTS, store }),
        { wrapper: StrictMode },
      );
      expect(load).toHaveBeenCalledTimes(2);

      answers[0]?.resolve(savedWith({ sort: NAME_SORT }));
      await settle();
      expect(result.current.status).toBe("loading");
      expect(result.current.values.sort).toBeNull();

      answers[1]?.resolve(savedWith({ sort: PRICE_SORT }));
      await settle();
      expect(result.current.status).toBe("ready");
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      act(() => vi.advanceTimersByTime(1000));
      expect(store.save).not.toHaveBeenCalled();
    });

    /**
     * Whether this React has `Activity`, the part of the page that React can hide and show
     * again. React 18 has none, so the tests of a hidden table run from React 19 on.
     */
    const HAS_ACTIVITY = Activity !== undefined;

    /** Draws the hook inside a part of the page that React can hide and show again. */
    const renderHideable = (store: StateStore) => {
      const seen: { current?: SavedTableState<Values> } = {};
      const page = (mode: "visible" | "hidden") =>
        createElement(Activity, {
          mode,
          // biome-ignore lint/correctness/noChildrenProp: the types of `Activity` require `children` among the props.
          children: createElement(HideableTable, { store, seen }),
        });
      const { rerender } = render(page("visible"));
      const current = () => seen.current as SavedTableState<Values>;
      return {
        current,
        hide: () => rerender(page("hidden")),
        show: () => rerender(page("visible")),
      };
    };

    it.runIf(HAS_ACTIVITY)(
      "should not bring back older state when a hidden table is shown again",
      async () => {
        const store = slowStore({ orders: savedWith({ sort: NAME_SORT }) });
        const table = renderHideable(store);
        act(() => table.current().set.sort(PRICE_SORT));
        // Hiding saves the change. The store has not answered, so it still holds the old sort.
        table.hide();
        expect(store.save).toHaveBeenCalledOnce();
        table.show();
        expect(table.current().values.sort).toEqual(PRICE_SORT);
        expect(table.current().status).toBe("ready");
        expect(store.load).toHaveBeenCalledOnce();

        act(() => store.requests[0]?.answer());
        await settle();
        expect(table.current().values.sort).toEqual(PRICE_SORT);
        // Saving still works after the table is back.
        act(() => table.current().set.sort(null));
        act(() => vi.advanceTimersByTime(300));
        expect(store.save).toHaveBeenCalledTimes(2);
      },
    );

    it.runIf(HAS_ACTIVITY)(
      "should keep a change made while loading when a hidden table is shown again",
      async () => {
        const answers = [deferred<unknown>(), deferred<unknown>()];
        const load = vi.fn(
          (_key: string) => answers[load.mock.calls.length - 1]?.promise,
        );
        const store = { ...memoryStore(), load };
        const table = renderHideable(store);
        act(() => table.current().set.sort(PRICE_SORT));
        table.hide();
        table.show();
        expect(table.current().values.sort).toEqual(PRICE_SORT);

        answers[1]?.resolve(savedWith({ sort: NAME_SORT }));
        await settle();
        expect(table.current().status).toBe("ready");
        expect(table.current().values.sort).toEqual(PRICE_SORT);
      },
    );

    /** Mounts another table on "orders" that saves a page size of its own, and leaves. */
    const saveFromAnotherTable = (store: StateStore) => {
      const other = renderHook(() =>
        useSavedTableState({
          id: "orders",
          store,
          parts: { pageSize: { defaultValue: 25, parse: () => undefined } },
        }),
      );
      act(() => other.result.current.set.pageSize(50));
      other.unmount();
    };

    it.runIf(HAS_ACTIVITY)(
      "should read the store again when another table saved under the key meanwhile",
      () => {
        const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
        const table = renderHideable(store);
        table.hide();
        saveFromAnotherTable(store);
        expect(store.load).toHaveBeenCalledTimes(2);

        // What the hidden table knew about the store is out of date, so it reads again.
        table.show();
        expect(store.load).toHaveBeenCalledTimes(3);
        expect(table.current().status).toBe("ready");
        act(() => table.current().set.sort(PRICE_SORT));
        act(() => vi.advanceTimersByTime(300));
        // Its save keeps the part saved meanwhile.
        expect(store.items.get("orders")).toMatchObject({
          parts: { sort: PRICE_SORT, pageSize: 50 },
        });
      },
    );

    it.runIf(HAS_ACTIVITY)(
      "should not save from a hidden table over what another table saved meanwhile",
      () => {
        const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
        const table = renderHideable(store);
        table.hide();
        saveFromAnotherTable(store);

        // A change made while hidden waits: the hidden table no longer knows the other parts.
        act(() => table.current().set.sort(PRICE_SORT));
        act(() => vi.advanceTimersByTime(300));
        expect(store.items.get("orders")).toMatchObject({
          parts: { sort: NAME_SORT, pageSize: 50 },
        });

        // Shown again, it reads the store first and then saves the change with those parts.
        table.show();
        expect(table.current().values.sort).toEqual(PRICE_SORT);
        act(() => vi.advanceTimersByTime(300));
        expect(store.items.get("orders")).toMatchObject({
          parts: { sort: PRICE_SORT, pageSize: 50 },
        });
      },
    );

    it("should load a key again only after the saves on their way to it", async () => {
      const store = slowStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result, rerender } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      // Leaving the key saves the change. Coming back before the store has answered must
      // not read the state from before that save.
      rerender({ id: "archive", store });
      rerender({ id: "orders", store });
      expect(result.current.status).toBe("loading");

      act(() => store.requests[0]?.answer());
      await settle();
      expect(result.current.status).toBe("ready");
      expect(result.current.values.sort).toEqual(PRICE_SORT);
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

  describe("a part added while the table is on screen", () => {
    const countPart: StatePart<number> = {
      defaultValue: 25,
      parse: (saved) => (typeof saved === "number" ? saved : undefined),
    };
    type Grown = { sort: Sort | null; pageSize?: number };

    /** Starts with the sort only. `rerender(true)` adds the page size. */
    const renderGrowing = (store: StateStore) =>
      renderHook(
        (withPageSize: boolean) =>
          useSavedTableState<Grown>({
            id: "orders",
            store,
            // A new object on every render, as when an app builds the parts inline.
            parts: withPageSize
              ? { sort: sortPart, pageSize: countPart }
              : { sort: sortPart },
          }),
        { initialProps: false },
      );

    it("should get its default in the render that adds it", () => {
      const seen: (number | undefined)[] = [];
      const store = memoryStore();
      const { result, rerender } = renderHook(
        (withPageSize: boolean) => {
          const saved = useSavedTableState<Grown>({
            id: "orders",
            store,
            parts: withPageSize
              ? { sort: sortPart, pageSize: countPart }
              : { sort: sortPart },
          });
          if (withPageSize) seen.push(saved.values.pageSize);
          return saved;
        },
        { initialProps: false },
      );
      act(() => result.current.set.sort(PRICE_SORT));
      rerender(true);
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen)).toEqual(new Set([25]));
      expect(result.current.values.sort).toEqual(PRICE_SORT);
    });

    it("should build a change on its default, and save it", () => {
      const store = memoryStore();
      const { result, rerender } = renderGrowing(store);
      rerender(true);
      act(() => result.current.set.pageSize?.((before = 0) => before * 2));
      expect(result.current.values.pageSize).toBe(50);
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toEqual(
        savedWith({ sort: null, pageSize: 50 }),
      );
    });

    it("should get the value saved under its name", () => {
      const store = memoryStore({
        orders: savedWith({ sort: NAME_SORT, pageSize: 100 }),
      });
      const { result, rerender } = renderGrowing(store);
      rerender(true);
      expect(result.current.values.pageSize).toBe(100);
    });

    it("should keep the other parts the same objects", () => {
      const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result, rerender } = renderGrowing(store);
      const before = result.current.values.sort;
      rerender(true);
      const added = result.current.values;
      expect(added.sort).toBe(before);
      rerender(true);
      expect(result.current.values).toBe(added);
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
      expect(result.current.reload).toBe(first.reload);
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
      act(() => void result.current.flush());
      expect(store.save).not.toHaveBeenCalled();

      act(() => result.current.set.sort(PRICE_SORT));
      act(() => void result.current.flush());
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
      const listen = vi.spyOn(window, "addEventListener");
      const unlisten = vi.spyOn(window, "removeEventListener");
      const store = memoryStore();
      const { result, unmount } = renderSaved({ store });
      const added = listen.mock.calls.filter(([type]) => type === "pagehide");
      expect(added).toHaveLength(1);
      act(() => result.current.set.sort(PRICE_SORT));
      unmount();
      // The very function that was added: any other would leave the first one listening.
      expect(unlisten).toHaveBeenCalledWith("pagehide", added[0]?.[1]);
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

  describe("parts the hook does not own", () => {
    const numberPart: StatePart<number> = {
      defaultValue: 0,
      parse: (saved) => (typeof saved === "number" ? saved : undefined),
    };
    const PAGE_PARTS = { pageSize: numberPart };
    const OTHER_PARTS = { other: numberPart };

    it("should keep a stored part named like an object's prototype as a plain part", () => {
      // `JSON.parse` makes "__proto__" an ordinary key. Stored values are not to be trusted.
      const stored = JSON.parse(
        '{"version":1,"parts":{"__proto__":{"polluted":true},"pageSize":50}}',
      );
      const store = memoryStore({ orders: stored });
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));

      const sent = store.save.mock.calls[0]?.[1] as SavedState;
      // The parts sent are a plain object, and the odd part is still one of them.
      expect(Object.getPrototypeOf(sent.parts)).toBe(Object.prototype);
      expect(Object.hasOwn(sent.parts, "__proto__")).toBe(true);
      expect(sent.parts).toMatchObject({ pageSize: 50, sort: PRICE_SORT });
      expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    });

    it("should keep them when it saves", () => {
      const store = memoryStore({
        orders: savedWith({ sort: NAME_SORT, pageSize: 50, legacy: ["x"] }),
      });
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toEqual(
        savedWith({
          filter: EMPTY_FILTER,
          columns: COLUMN_DEFAULTS,
          sort: PRICE_SORT,
          pageSize: 50,
          legacy: ["x"],
        }),
      );
    });

    it("should keep them in today's shape after an upgrade", () => {
      const store = memoryStore({
        orders: savedWith({ rows: 50, sort: NAME_SORT }, 1),
      });
      const { result } = renderSaved({
        store,
        version: 2,
        migrate: ({ rows, ...rest }) => ({ ...rest, pageSize: rows }),
      });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toEqual(
        savedWith(
          {
            filter: EMPTY_FILTER,
            columns: COLUMN_DEFAULTS,
            sort: PRICE_SORT,
            pageSize: 50,
          },
          2,
        ),
      );
    });

    it("should drop them on clear", () => {
      const store = memoryStore({ orders: savedWith({ pageSize: 50 }) });
      const { result } = renderSaved({ store });
      act(() => result.current.clear());
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toEqual(
        savedWith({
          filter: EMPTY_FILTER,
          columns: COLUMN_DEFAULTS,
          sort: PRICE_SORT,
        }),
      );
    });

    it("should not carry them over to another key", () => {
      const store = memoryStore({ orders: savedWith({ pageSize: 50 }) });
      const { result, rerender } = renderSaved({ store });
      rerender({ id: "archive", store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("archive")).toEqual(
        savedWith({
          filter: EMPTY_FILTER,
          columns: COLUMN_DEFAULTS,
          sort: PRICE_SORT,
        }),
      );
    });

    /** Two hooks on screen that save different parts under one key, in one store. */
    const renderTwoOnOneKey = (id: string, store: StateStore) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const page = renderHook(() =>
        useSavedTableState({ id, store, parts: PAGE_PARTS }),
      );
      const other = renderHook(() =>
        useSavedTableState({ id, store, parts: OTHER_PARTS }),
      );
      return { warn, page, other };
    };

    it("should keep both hooks' parts when two hooks share a key", () => {
      const store = memoryStore();
      const { page, other } = renderTwoOnOneKey("shared-saves", store);
      act(() => page.result.current.set.pageSize(50));
      act(() => vi.advanceTimersByTime(300));
      act(() => other.result.current.set.other(7));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("shared-saves")).toEqual(
        savedWith({ pageSize: 50, other: 7 }),
      );

      act(() => page.result.current.set.pageSize(100));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("shared-saves")).toEqual(
        savedWith({ pageSize: 100, other: 7 }),
      );
    });

    it("should forget the other hook's parts when that hook clears", () => {
      const store = memoryStore();
      const { page, other } = renderTwoOnOneKey("shared-clear", store);
      act(() => page.result.current.set.pageSize(50));
      act(() => vi.advanceTimersByTime(300));
      act(() => page.result.current.clear());
      act(() => other.result.current.set.other(7));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("shared-clear")).toEqual(savedWith({ other: 7 }));
    });

    it("should warn once, in development, when two hooks share a key", () => {
      const store = memoryStore();
      const { warn } = renderTwoOnOneKey("shared-warned", store);
      renderHook(() =>
        useSavedTableState({ id: "shared-warned", store, parts: PAGE_PARTS }),
      );
      expect(warn).toHaveBeenCalledOnce();
      expect(warn.mock.calls[0]?.[0]).toContain('"shared-warned"');
      expect(warn.mock.calls[0]?.[0]).toContain("`id` or `name`");
    });

    it("should not warn in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      try {
        const { warn } = renderTwoOnOneKey("shared-production", memoryStore());
        expect(warn).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("should not warn, and not fail, where there is no `process`", () => {
      // A plain browser page with no bundler.
      vi.stubGlobal("process", undefined);
      try {
        const { warn } = renderTwoOnOneKey("shared-plain-page", memoryStore());
        expect(warn).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("should not warn about another key, another store or a hook that left", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const store = memoryStore();
      const first = renderSaved({ id: "alone", store });
      renderSaved({ id: "alone-too", store });
      renderSaved({ id: "alone", store: memoryStore() });
      first.unmount();
      renderSaved({ id: "alone", store });
      renderSaved({ id: "alone-strict", store });
      renderHook(
        () => useSavedTableState({ id: "strict", parts: PARTS, store }),
        { wrapper: StrictMode },
      );
      expect(warn).not.toHaveBeenCalled();
    });
  });

  describe("the order of saves", () => {
    /** Leaves one save unanswered and a newer change waiting out the delay. */
    const withSaveOnItsWay = (options: Options = {}) => {
      const store = slowStore();
      const hook = renderSaved({ store, ...options });
      act(() => hook.result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      act(() => hook.result.current.set.sort(NAME_SORT));
      expect(store.requests).toHaveLength(1);
      return { store, ...hook };
    };

    it.each([
      [
        "flush",
        ({ result }: ReturnType<typeof withSaveOnItsWay>) =>
          void result.current.flush(),
      ],
      [
        "a hidden page",
        () => {
          vi.spyOn(document, "visibilityState", "get").mockReturnValue(
            "hidden",
          );
          document.dispatchEvent(new Event("visibilitychange"));
        },
      ],
      [
        "a change of key",
        ({ rerender, store }: ReturnType<typeof withSaveOnItsWay>) =>
          rerender({ id: "archive", store }),
      ],
      [
        "unmount",
        ({ unmount }: ReturnType<typeof withSaveOnItsWay>) => unmount(),
      ],
    ])(
      "should not let %s overtake a save on its way",
      async (_label, leave) => {
        const hook = withSaveOnItsWay();
        const { store } = hook;
        act(() => leave(hook));
        // The first save has not been answered, so the newer one waits.
        expect(store.save).toHaveBeenCalledOnce();

        act(() => store.requests[0]?.answer());
        await settle();
        expect(store.save).toHaveBeenCalledTimes(2);
        act(() => store.requests[1]?.answer());
        await settle();
        expect(store.items.get("orders")).toMatchObject({
          parts: { sort: NAME_SORT },
        });
        vi.restoreAllMocks();
      },
    );

    it("should not wait for an answer when the page is closed", () => {
      const { store } = withSaveOnItsWay();
      act(() => window.dispatchEvent(new Event("pagehide")));
      expect(store.save).toHaveBeenCalledTimes(2);
      expect(store.save.mock.calls[1]?.[1]).toMatchObject({
        parts: { sort: NAME_SORT },
      });
    });

    it("should wait for the answer when the hidden page may come back", async () => {
      const { store } = withSaveOnItsWay();
      // `persisted` says the browser keeps the page, to show it again on "back".
      const kept = Object.assign(new Event("pagehide"), { persisted: true });
      act(() => window.dispatchEvent(kept));
      // The first save has not been answered, so the newer one waits.
      expect(store.save).toHaveBeenCalledOnce();

      act(() => store.requests[0]?.answer());
      await settle();
      expect(store.save).toHaveBeenCalledTimes(2);
      act(() => store.requests[1]?.answer());
      await settle();
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: NAME_SORT },
      });
    });

    it("should send one request for the final state when the page is closed", async () => {
      const store = slowStore({ orders: savedWith({ pageSize: 50 }) });
      const { result } = renderSaved({ store });
      // One save is on its way. A second save and a remove wait behind it, and a third
      // change still waits out the delay.
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => void result.current.flush());
      act(() => result.current.set.sort(NAME_SORT));
      act(() => void result.current.flush());
      act(() => result.current.clear());
      act(() => result.current.set.filter(priceFilter("10")));
      expect(store.requests).toHaveLength(1);

      act(() => window.dispatchEvent(new Event("pagehide")));
      // One request beside the one on its way, so the store has no order to get wrong.
      expect(store.requests.map((request) => request.kind)).toEqual([
        "save",
        "save",
      ]);

      act(() => store.requests[0]?.answer());
      act(() => store.requests[1]?.answer());
      await settle();
      // What the queue would have left: the state from after the remove, and nothing older.
      expect(store.items.get("orders")).toEqual(
        savedWith({
          filter: priceFilter("10"),
          columns: COLUMN_DEFAULTS,
          sort: null,
        }),
      );
      expect(store.requests).toHaveLength(2);
      await expect(result.current.flush()).resolves.toBe(true);
    });

    it("should end with nothing stored when the last waiting write is a remove", async () => {
      const { store, result } = withSaveOnItsWay();
      act(() => void result.current.flush());
      act(() => result.current.clear());

      act(() => window.dispatchEvent(new Event("pagehide")));
      expect(store.requests.map((request) => request.kind)).toEqual([
        "save",
        "remove",
      ]);
      act(() => store.requests[0]?.answer());
      act(() => store.requests[1]?.answer());
      await settle();
      expect(store.items.has("orders")).toBe(false);
    });

    it("should still send a save that waits when the page closes after unmount", async () => {
      const listen = vi.spyOn(window, "addEventListener");
      const unlisten = vi.spyOn(window, "removeEventListener");
      const count = (spy: typeof listen | typeof unlisten) =>
        spy.mock.calls.filter(([type]) => type === "pagehide").length;
      const { store, unmount } = withSaveOnItsWay();
      // The newer save waits behind the one on its way, and the table is gone.
      unmount();
      expect(store.requests).toHaveLength(1);

      window.dispatchEvent(new Event("pagehide"));
      expect(store.requests).toHaveLength(2);
      act(() => store.requests[0]?.answer());
      act(() => store.requests[1]?.answer());
      await settle();
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: NAME_SORT },
      });
      // Nothing listens to the page once the store has answered.
      expect(count(unlisten)).toBe(count(listen));
    });

    it("should send only the newest of the saves that waited", async () => {
      const { store, result } = withSaveOnItsWay();
      act(() => void result.current.flush());
      act(() => result.current.set.sort(null));
      act(() => void result.current.flush());
      act(() => store.requests[0]?.answer());
      await settle();
      expect(store.save).toHaveBeenCalledTimes(2);
      expect(store.save.mock.calls[1]?.[1]).toMatchObject({
        parts: { sort: null },
      });
    });
  });

  describe("flush", () => {
    it("should settle once the store has answered the save", async () => {
      const store = slowStore();
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      const done = vi.fn();
      act(() => void result.current.flush().then(done));
      await settle();
      expect(done).not.toHaveBeenCalled();

      act(() => store.requests[0]?.answer());
      await settle();
      expect(done).toHaveBeenCalledExactlyOnceWith(true);
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: PRICE_SORT },
      });
    });

    it("should give true at once when nothing waits", async () => {
      const { result } = renderSaved({ store: memoryStore() });
      await expect(result.current.flush()).resolves.toBe(true);
      act(() => result.current.set.sort(PRICE_SORT));
      let flushed: Promise<boolean> | undefined;
      act(() => {
        flushed = result.current.flush();
      });
      await expect(flushed).resolves.toBe(true);
    });

    it("should give false, and not reject, when the save fails", async () => {
      const failure = new Error("offline");
      const store = slowStore();
      const onError = vi.fn();
      const { result } = renderSaved({ store, onError });
      act(() => result.current.set.sort(PRICE_SORT));
      const done = vi.fn();
      const failed = vi.fn();
      act(() => void result.current.flush().then(done, failed));
      act(() => store.requests[0]?.fail(failure));
      await settle();
      expect(done).toHaveBeenCalledExactlyOnceWith(false);
      expect(failed).not.toHaveBeenCalled();
      expect(result.current.status).toBe("error");
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure, "save");
    });

    it("should give false for a change that cannot be saved yet", async () => {
      const store = { ...memoryStore(), load: () => new Promise(() => {}) };
      const { result } = renderSaved({ store });
      await expect(result.current.flush()).resolves.toBe(true);
      act(() => result.current.set.sort(PRICE_SORT));
      await expect(result.current.flush()).resolves.toBe(false);
      expect(store.save).not.toHaveBeenCalled();
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
      act(() => void result.current.flush());
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

    it("should save a change that waited behind another save with its own key's version", async () => {
      const store = slowStore();
      const { result, rerender } = renderSaved({ store, version: 1 });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      act(() => result.current.set.sort(NAME_SORT));
      // The second save waits behind the first, and the new key has a newer version.
      rerender({ store, id: "archive", version: 2 });
      expect(store.save).toHaveBeenCalledOnce();

      act(() => store.requests[0]?.answer());
      await settle();
      expect(store.save).toHaveBeenLastCalledWith(
        "orders",
        savedWith(
          { filter: EMPTY_FILTER, columns: COLUMN_DEFAULTS, sort: NAME_SORT },
          1,
        ),
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
      act(() => void result.current.flush());
      unmount();
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should say which action failed", async () => {
      const store = memoryStore();
      store.load.mockImplementationOnce(() => {
        throw new Error("offline");
      });
      store.save.mockImplementationOnce(() => {
        throw new Error("full");
      });
      store.remove.mockImplementationOnce(() => {
        throw new Error("locked");
      });
      const { result } = renderSaved({ store });
      expect(result.current.errorAction).toBe("load");

      act(() => result.current.reload());
      expect(result.current.status).toBe("ready");
      expect(result.current.errorAction).toBeUndefined();

      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(result.current.errorAction).toBe("save");

      act(() => result.current.set.sort(NAME_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(result.current.errorAction).toBeUndefined();

      act(() => result.current.clear());
      expect(result.current.status).toBe("error");
      expect(result.current.errorAction).toBe("remove");
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

  describe("reload", () => {
    /** A store whose first load fails. Its later loads answer from memory. */
    const storeFailingOnce = (initial: Record<string, unknown>) => {
      const store = memoryStore(initial);
      store.load.mockImplementationOnce(() => {
        throw new Error("offline");
      });
      return store;
    };

    it("should turn saving back on after a failed load, and keep the stored state", () => {
      const store = storeFailingOnce({
        orders: savedWith({ filter: priceFilter("10"), sort: NAME_SORT }),
      });
      const { result } = renderSaved({ store });
      expect(result.current.status).toBe("error");

      act(() => result.current.reload());
      expect(result.current.status).toBe("ready");
      expect(result.current.error).toBeUndefined();
      expect(result.current.values.sort).toEqual(NAME_SORT);
      expect(store.remove).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();

      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toMatchObject({
        parts: { filter: priceFilter("10"), sort: PRICE_SORT },
      });
    });

    it("should keep the same object for a part the store still holds unchanged", () => {
      const store = memoryStore({
        orders: savedWith({ filter: priceFilter("10"), sort: NAME_SORT }),
      });
      const { result } = renderSaved({ store });
      const before = result.current.values;
      // Changed from outside: only the sort differs now.
      store.items.set(
        "orders",
        savedWith({ filter: priceFilter("10"), sort: PRICE_SORT }),
      );

      act(() => result.current.reload());
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      // A table memoised on its filter or its columns must not redraw for this.
      expect(result.current.values.filter).toBe(before.filter);
      expect(result.current.values.columns).toBe(before.columns);
    });

    it("should keep and save a change made after the load failed", () => {
      const store = storeFailingOnce({
        orders: savedWith({ filter: priceFilter("10"), sort: NAME_SORT }),
      });
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => result.current.reload());
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      expect(result.current.values.filter).toEqual(priceFilter("10"));

      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toMatchObject({
        parts: { filter: priceFilter("10"), sort: PRICE_SORT },
      });
    });

    it("should show the load and report it when it fails again", async () => {
      const failure = new Error("still offline");
      const answers = [deferred<unknown>(), deferred<unknown>()];
      const load = vi.fn(
        (_key: string) => answers[load.mock.calls.length - 1]?.promise,
      );
      const onError = vi.fn();
      const { result } = renderSaved({
        store: { ...memoryStore(), load },
        onError,
      });
      answers[0]?.reject(new Error("offline"));
      await settle();
      expect(result.current.errorAction).toBe("load");

      act(() => result.current.reload());
      expect(result.current.status).toBe("loading");
      expect(result.current.error).toBeUndefined();
      answers[1]?.reject(failure);
      await settle();
      expect(result.current.status).toBe("error");
      expect(result.current.error).toBe(failure);
      expect(onError).toHaveBeenLastCalledWith(failure, "load");
    });

    it("should read the store again only after a waiting change is saved", async () => {
      const store = slowStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => result.current.reload());
      expect(result.current.status).toBe("loading");
      expect(store.load).toHaveBeenCalledOnce();

      act(() => store.requests[0]?.answer());
      await settle();
      expect(store.load).toHaveBeenCalledTimes(2);
      expect(result.current.status).toBe("ready");
      expect(result.current.values.sort).toEqual(PRICE_SORT);
    });
  });

  describe("clear", () => {
    it("should not save again when a save from before it fails", async () => {
      const failure = new Error("offline");
      const store = slowStore({ orders: savedWith({ sort: NAME_SORT }) });
      const onError = vi.fn();
      const { result } = renderSaved({ store, onError });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => void result.current.flush());
      act(() => result.current.clear());

      // The save from before the clear fails, and then the remove goes through.
      act(() => store.requests[0]?.fail(failure));
      await settle();
      act(() => store.requests[1]?.answer());
      await settle();
      expect(onError).toHaveBeenCalledExactlyOnceWith(failure, "save");
      expect(result.current.status).toBe("ready");

      // Nothing is left to save, so nothing goes back into the store that was emptied.
      await expect(result.current.flush()).resolves.toBe(true);
      act(() => window.dispatchEvent(new Event("pagehide")));
      expect(store.requests).toHaveLength(2);
      expect(store.items.has("orders")).toBe(false);
    });

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

    it("should not let a save made before it land after the remove", async () => {
      const store = slowStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      act(() => result.current.clear());
      // The save has not been answered, so the remove waits.
      expect(store.remove).not.toHaveBeenCalled();

      act(() => store.requests[0]?.answer());
      await settle();
      expect(store.requests.map((request) => request.kind)).toEqual([
        "save",
        "remove",
      ]);
      act(() => store.requests[1]?.answer());
      await settle();
      expect(store.items.has("orders")).toBe(false);
    });

    it("should not delete a save made after it", async () => {
      const store = slowStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result } = renderSaved({ store });
      act(() => result.current.clear());
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => void result.current.flush());
      // The remove has not been answered, so the save waits.
      expect(store.save).not.toHaveBeenCalled();

      act(() => store.requests[0]?.answer());
      await settle();
      act(() => store.requests[1]?.answer());
      await settle();
      expect(store.requests.map((request) => request.kind)).toEqual([
        "remove",
        "save",
      ]);
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: PRICE_SORT },
      });
    });

    it("should not count a change made after it as saved by a save from before it", async () => {
      const store = slowStore();
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      act(() => result.current.clear());
      // The same value as before the clear, so the two saves look alike.
      act(() => result.current.set.sort(PRICE_SORT));
      let flushed: Promise<boolean> | undefined;
      act(() => {
        flushed = result.current.flush();
      });

      // The save from before the clear and the remove go through. The save after it fails.
      act(() => store.requests[0]?.answer());
      await settle();
      act(() => store.requests[1]?.answer());
      await settle();
      act(() => store.requests[2]?.fail(new Error("offline")));
      await settle();
      expect(store.requests.map((request) => request.kind)).toEqual([
        "save",
        "remove",
        "save",
      ]);
      expect(store.items.has("orders")).toBe(false);
      await expect(flushed).resolves.toBe(false);
      expect(result.current.errorAction).toBe("save");
    });

    it("should end ready when it is called twice and only the first remove fails", async () => {
      const store = slowStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result } = renderSaved({ store });
      act(() => result.current.clear());
      act(() => result.current.clear());

      act(() => store.requests[0]?.fail(new Error("offline")));
      await settle();
      expect(result.current.errorAction).toBe("remove");
      act(() => store.requests[1]?.answer());
      await settle();
      expect(store.requests.map((request) => request.kind)).toEqual([
        "remove",
        "remove",
      ]);
      // The key is gone from the store, so nothing is left to report.
      expect(store.items.has("orders")).toBe(false);
      expect(result.current.status).toBe("ready");
      await expect(result.current.flush()).resolves.toBe(true);
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

    it("should count the browser's empty answer as nothing saved", async () => {
      const store = fetchStore({
        url: "/api/table-state",
        fetch: async () => new Response(""),
      });
      const { result } = renderSaved({ store });
      await settle();
      expect(result.current.status).toBe("ready");
      expect(result.current.values.sort).toBeNull();
    });
  });

  describe("state a server already read", () => {
    const READ_BY_SERVER = savedWith({
      filter: priceFilter("10"),
      sort: NAME_SORT,
      pageSize: 50,
    });

    it("should draw it on the server", () => {
      const store = memoryStore();
      const page = createElement(ServerTable, {
        id: "orders",
        store,
        initialSaved: READ_BY_SERVER,
      });
      // The markup writes each quote of the JSON as "&quot;".
      expect(renderToString(page).replaceAll("&quot;", '"')).toBe(
        `<p>ready ${JSON.stringify(NAME_SORT)}</p>`,
      );
      expect(store.load).not.toHaveBeenCalled();
    });

    it("should draw it in the browser's first render, and not load or save it", () => {
      const store = memoryStore();
      const seen: SavedTableState<Values>[] = [];
      renderHook(() => {
        const saved = useSavedTableState({
          id: "orders",
          parts: PARTS,
          store,
          initialSaved: READ_BY_SERVER,
        });
        seen.push(saved);
        return saved;
      });
      expect(seen[0]?.status).toBe("ready");
      expect(seen[0]?.values.sort).toEqual(NAME_SORT);
      expect(seen[0]?.values.filter).toEqual(priceFilter("10"));
      expect(new Set(seen.map((saved) => saved.values)).size).toBe(1);

      act(() => vi.advanceTimersByTime(1000));
      expect(store.load).not.toHaveBeenCalled();
      expect(store.save).not.toHaveBeenCalled();
    });

    it("should hydrate the server's page without a mismatch", async () => {
      const options = {
        id: "orders",
        store: memoryStore(),
        initialSaved: READ_BY_SERVER,
      };
      const takenOver = vi.fn();
      const page = createElement(HydratedTable, { options, takenOver });
      const container = document.createElement("div");
      container.innerHTML = renderToString(page);
      expect(takenOver).not.toHaveBeenCalled();
      const onRecoverableError = vi.fn();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      let root: ReturnType<typeof hydrateRoot> | undefined;
      await act(async () => {
        root = hydrateRoot(container, page, { onRecoverableError });
      });
      // Without this, the text below would only be what the server drew.
      expect(takenOver).toHaveBeenCalledOnce();
      expect(onRecoverableError).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(container.textContent).toBe(`ready ${JSON.stringify(NAME_SORT)}`);
      act(() => root?.unmount());
    });

    it("should save a change, with the parts it does not own", () => {
      const store = memoryStore();
      const { result } = renderSaved({ store, initialSaved: READ_BY_SERVER });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toEqual(
        savedWith({
          filter: priceFilter("10"),
          columns: COLUMN_DEFAULTS,
          sort: PRICE_SORT,
          pageSize: 50,
        }),
      );
    });

    it("should check it like any saved value", () => {
      const { result } = renderSaved({
        store: memoryStore(),
        initialSaved: savedWith({ sort: "broken", filter: priceFilter("10") }),
      });
      expect(result.current.values.sort).toBeNull();
      expect(result.current.values.filter).toEqual(priceFilter("10"));
    });

    it("should start from the defaults when the server found nothing", () => {
      const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
      const { result } = renderSaved({ store, initialSaved: null });
      expect(result.current.status).toBe("ready");
      expect(result.current.values.sort).toBeNull();
      expect(store.load).not.toHaveBeenCalled();
    });

    it("should load another key from the store", () => {
      const store = memoryStore({ archive: savedWith({ sort: PRICE_SORT }) });
      const options = { store, initialSaved: READ_BY_SERVER };
      const { result, rerender } = renderSaved(options);
      rerender({ ...options, id: "archive" });
      expect(store.load).toHaveBeenCalledExactlyOnceWith("archive");
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      expect(result.current.values.filter).toEqual(EMPTY_FILTER);
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

  describe("two hooks on one key, in one store", () => {
    /** One hook that saves the sort and one that saves the filter, under the same key. */
    const renderPair = (store: StateStore) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const sort = renderHook(() =>
        useSavedTableState({ id: "pair", store, parts: { sort: sortPart } }),
      );
      const filter = renderHook(() =>
        useSavedTableState({
          id: "pair",
          store,
          parts: { filter: filterStatePart() },
        }),
      );
      return { sort, filter };
    };

    it("should not pass on a part the store turned down", async () => {
      const store = slowStore();
      const { sort, filter } = renderPair(store);
      act(() => sort.result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      act(() => store.requests[0]?.fail(new Error("offline")));
      await settle();

      // The store never took the sort, so the other hook must not write it back as saved.
      act(() => filter.result.current.set.filter(priceFilter("10")));
      act(() => vi.advanceTimersByTime(300));
      expect(store.save).toHaveBeenLastCalledWith(
        "pair",
        savedWith({ filter: priceFilter("10") }),
      );
    });

    it("should send their saves one at a time, each with the other's newest part", async () => {
      const store = slowStore();
      const { sort, filter } = renderPair(store);
      act(() => sort.result.current.set.sort(PRICE_SORT));
      act(() => filter.result.current.set.filter(priceFilter("10")));
      act(() => vi.advanceTimersByTime(300));
      // The sort's save has not been answered, so the filter's save waits.
      expect(store.save).toHaveBeenCalledOnce();

      act(() => store.requests[0]?.answer());
      await settle();
      expect(store.save).toHaveBeenCalledTimes(2);
      expect(store.save).toHaveBeenLastCalledWith(
        "pair",
        savedWith({ sort: PRICE_SORT, filter: priceFilter("10") }),
      );
    });
  });

  describe("a save still on its way", () => {
    it("should not hold up the load of another key", () => {
      const store = slowStore({ archive: savedWith({ sort: NAME_SORT }) });
      const { result, rerender } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      rerender({ id: "archive", store });
      // The save to "orders" has not been answered. It cannot change what "archive" holds.
      expect(store.requests).toHaveLength(1);
      expect(store.load).toHaveBeenLastCalledWith("archive");
      expect(result.current.status).toBe("ready");
      expect(result.current.values.sort).toEqual(NAME_SORT);
    });

    it("should go to the store it was made for, not to one given later", async () => {
      const first = slowStore();
      const second = memoryStore();
      const { result, rerender } = renderSaved({ store: first });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      act(() => result.current.set.sort(NAME_SORT));
      act(() => void result.current.flush());
      rerender({ store: second });

      act(() => first.requests[0]?.answer());
      await settle();
      expect(second.save).not.toHaveBeenCalled();
      expect(first.save).toHaveBeenCalledTimes(2);
    });
  });

  describe("a change of store", () => {
    it("should keep the store it loaded from until it loads again", () => {
      const first = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
      const second = memoryStore({ orders: savedWith({ sort: PRICE_SORT }) });
      const { result, rerender } = renderSaved({ store: first });
      rerender({ store: second });
      // A new store alone does not load again, and the state loaded from the first store
      // is not written into the second.
      expect(second.load).not.toHaveBeenCalled();
      expect(result.current.values.sort).toEqual(NAME_SORT);
      act(() => result.current.set.filter(priceFilter("10")));
      act(() => vi.advanceTimersByTime(300));
      expect(first.save).toHaveBeenCalledOnce();
      expect(second.save).not.toHaveBeenCalled();

      act(() => result.current.reload());
      expect(second.load).toHaveBeenCalledExactlyOnceWith("orders");
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      act(() => result.current.set.filter(priceFilter("20")));
      act(() => vi.advanceTimersByTime(300));
      expect(first.save).toHaveBeenCalledOnce();
      expect(second.items.get("orders")).toMatchObject({
        parts: { filter: priceFilter("20"), sort: PRICE_SORT },
      });
    });

    it("should share its key with the hooks of the new store once it has loaded from it", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const first = memoryStore();
      const second = memoryStore();
      const moved = renderHook(
        (store: StateStore) =>
          useSavedTableState({ id: "moved", store, parts: { sort: sortPart } }),
        { initialProps: first },
      );
      moved.rerender(second);
      act(() => moved.result.current.reload());

      const other = renderHook(() =>
        useSavedTableState({
          id: "moved",
          store: second,
          parts: { filter: filterStatePart() },
        }),
      );
      expect(warn).toHaveBeenCalledOnce();
      act(() => other.result.current.set.filter(priceFilter("10")));
      act(() => vi.advanceTimersByTime(300));
      act(() => moved.result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(second.items.get("moved")).toEqual(
        savedWith({ sort: PRICE_SORT, filter: priceFilter("10") }),
      );
      expect(first.save).not.toHaveBeenCalled();
    });

    it("should keep its place when the app makes a new store object on every render", () => {
      const kept = memoryStore();
      const { result, rerender } = renderHook(() =>
        useSavedTableState({
          id: "orders",
          parts: PARTS,
          // A new object on every render, as with an inline `cookieStore()`.
          store: { load: kept.load, save: kept.save, remove: kept.remove },
        }),
      );
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      rerender();
      // There and back: the value is the one already saved, so it is not saved again.
      act(() => result.current.set.sort(NAME_SORT));
      act(() => result.current.set.sort({ ...PRICE_SORT }));
      act(() => vi.advanceTimersByTime(300));
      expect(kept.load).toHaveBeenCalledOnce();
      expect(kept.save).toHaveBeenCalledOnce();
    });
  });

  describe("an onError that throws", () => {
    const throwingOnError = () =>
      vi.fn(() => {
        throw new Error("thrown by the app");
      });

    it("should still send the next save and settle flush", async () => {
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const store = slowStore();
      const onError = throwingOnError();
      const { result, unmount } = renderSaved({ store, onError });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      act(() => result.current.set.sort(NAME_SORT));
      const done = vi.fn();
      act(() => void result.current.flush().then(done));

      act(() => store.requests[0]?.fail(new Error("offline")));
      await settle();
      expect(onError).toHaveBeenCalledOnce();
      // The queue went on to the next save.
      expect(store.save).toHaveBeenCalledTimes(2);
      act(() => store.requests[1]?.fail(new Error("still offline")));
      await settle();
      expect(done).toHaveBeenCalledExactlyOnceWith(false);
      expect(result.current.status).toBe("error");
      expect(logged).toHaveBeenCalled();
      act(() => result.current.clear());
      unmount();
    });

    it("should not let the throw out of flush when the store answers at once", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const store = memoryStore();
      store.save.mockImplementation(() => {
        throw new Error("full");
      });
      const { result, unmount } = renderSaved({
        store,
        onError: throwingOnError(),
      });
      act(() => result.current.set.sort(PRICE_SORT));
      let flushed: Promise<boolean> | undefined;
      act(() => {
        flushed = result.current.flush();
      });
      await expect(flushed).resolves.toBe(false);
      act(() => result.current.clear());
      unmount();
    });
  });

  describe("a save or remove that failed", () => {
    const failOnce = () => {
      throw new Error("full");
    };

    it("should give false on flush until a new try goes through", async () => {
      const store = memoryStore();
      store.save
        .mockImplementationOnce(failOnce)
        .mockImplementationOnce(failOnce);
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(result.current.errorAction).toBe("save");

      // Nothing new waits, but the change is still not in the store. Flush tries it again.
      let flushed: Promise<boolean> | undefined;
      act(() => {
        flushed = result.current.flush();
      });
      await expect(flushed).resolves.toBe(false);
      expect(store.save).toHaveBeenCalledTimes(2);

      act(() => {
        flushed = result.current.flush();
      });
      await expect(flushed).resolves.toBe(true);
      expect(result.current.status).toBe("ready");
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: PRICE_SORT },
      });
      await expect(result.current.flush()).resolves.toBe(true);
    });

    it("should give false on flush after a failed remove, until a later save goes through", async () => {
      const store = memoryStore({ orders: savedWith({ sort: NAME_SORT }) });
      store.remove.mockImplementationOnce(failOnce);
      const { result } = renderSaved({ store });
      act(() => result.current.clear());
      expect(result.current.errorAction).toBe("remove");
      await expect(result.current.flush()).resolves.toBe(false);

      act(() => result.current.set.sort(PRICE_SORT));
      let flushed: Promise<boolean> | undefined;
      act(() => {
        flushed = result.current.flush();
      });
      await expect(flushed).resolves.toBe(true);
    });

    it("should keep the change through a reload, and save it afterwards", () => {
      const store = memoryStore({
        orders: savedWith({ filter: priceFilter("10"), sort: NAME_SORT }),
      });
      store.save
        .mockImplementationOnce(failOnce)
        .mockImplementationOnce(failOnce);
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(result.current.errorAction).toBe("save");

      // The reload tries the save once more, and it fails again. The store's older sort
      // must not replace the change.
      act(() => result.current.reload());
      expect(result.current.values.sort).toEqual(PRICE_SORT);
      expect(result.current.values.filter).toEqual(priceFilter("10"));

      act(() => vi.advanceTimersByTime(300));
      expect(result.current.status).toBe("ready");
      expect(store.items.get("orders")).toMatchObject({
        parts: { filter: priceFilter("10"), sort: PRICE_SORT },
      });
    });
  });

  describe("what counts as already saved", () => {
    it("should save a value again when a reload found the store changed", () => {
      const store = memoryStore();
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      // Something else wrote the key: another tab, or the server.
      store.items.set(
        "orders",
        savedWith({
          filter: EMPTY_FILTER,
          columns: COLUMN_DEFAULTS,
          sort: NAME_SORT,
        }),
      );
      act(() => result.current.reload());
      expect(result.current.values.sort).toEqual(NAME_SORT);

      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.save).toHaveBeenCalledTimes(2);
      expect(store.items.get("orders")).toMatchObject({
        parts: { sort: PRICE_SORT },
      });
    });

    it("should not save a value the store was just read to hold", () => {
      const store = memoryStore({
        orders: savedWith({
          filter: EMPTY_FILTER,
          columns: COLUMN_DEFAULTS,
          sort: PRICE_SORT,
        }),
      });
      const { result } = renderSaved({ store });
      // There and back within one delay: the value is the one the store holds.
      act(() => result.current.set.sort(NAME_SORT));
      act(() => result.current.set.sort({ ...PRICE_SORT }));
      act(() => vi.advanceTimersByTime(300));
      expect(store.save).not.toHaveBeenCalled();
    });
  });

  describe("a reload that finds nothing saved", () => {
    it("should put back the defaults and forget the parts it does not own", () => {
      const store = memoryStore({
        orders: savedWith({
          filter: priceFilter("10"),
          sort: NAME_SORT,
          legacy: ["x"],
        }),
      });
      const { result } = renderSaved({ store });
      // Something else removed the key: another tab, or the server.
      store.items.delete("orders");
      act(() => result.current.reload());
      expect(result.current.status).toBe("ready");
      expect(result.current.values).toEqual({
        filter: EMPTY_FILTER,
        columns: COLUMN_DEFAULTS,
        sort: null,
      });

      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toEqual(
        savedWith({
          filter: EMPTY_FILTER,
          columns: COLUMN_DEFAULTS,
          sort: PRICE_SORT,
        }),
      );
    });

    it("should keep a change the store has not taken yet", () => {
      const fail = () => {
        throw new Error("full");
      };
      const store = memoryStore({
        orders: savedWith({ filter: priceFilter("10"), sort: NAME_SORT }),
      });
      store.save.mockImplementationOnce(fail).mockImplementationOnce(fail);
      const { result } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      act(() => vi.advanceTimersByTime(300));
      store.items.delete("orders");
      act(() => result.current.reload());
      expect(result.current.values.filter).toEqual(EMPTY_FILTER);
      expect(result.current.values.sort).toEqual(PRICE_SORT);

      act(() => vi.advanceTimersByTime(300));
      expect(store.items.get("orders")).toEqual(
        savedWith({
          filter: EMPTY_FILTER,
          columns: COLUMN_DEFAULTS,
          sort: PRICE_SORT,
        }),
      );
    });
  });

  describe("a save that fails as the key changes", () => {
    it("should not be tried again under the new key", async () => {
      const store = memoryStore();
      store.save.mockImplementationOnce(() => {
        throw new Error("full");
      });
      const { result, rerender } = renderSaved({ store });
      act(() => result.current.set.sort(PRICE_SORT));
      // Leaving the key saves the change, and that save fails.
      rerender({ id: "archive", store });
      expect(store.save).toHaveBeenCalledExactlyOnceWith(
        "orders",
        expect.anything(),
      );

      let flushed: Promise<boolean> | undefined;
      act(() => {
        flushed = result.current.flush();
      });
      await expect(flushed).resolves.toBe(true);
      act(() => vi.advanceTimersByTime(1000));
      expect(store.save).toHaveBeenCalledOnce();
      expect(store.items.has("archive")).toBe(false);
    });
  });
});

/** A table that hands its saved state to the test, for the tests that hide and show it. */
function HideableTable(props: {
  store: StateStore;
  seen: { current?: SavedTableState<Values> };
}) {
  props.seen.current = useSavedTableState({
    id: "orders",
    parts: PARTS,
    store: props.store,
  });
  return null;
}

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

/**
 * `ServerTable`, with a call to `takenOver` once React has taken the page over in the browser.
 * Effects never run on a server.
 */
function HydratedTable(props: { options: Options; takenOver: () => void }) {
  const { options, takenOver } = props;
  useEffect(() => takenOver(), [takenOver]);
  return createElement(ServerTable, options);
}

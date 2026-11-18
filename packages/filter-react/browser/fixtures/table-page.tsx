import {
  type ColumnDefinition,
  columnStatePart,
  cookieStore,
  localStorageStore,
  type StateStore,
} from "@arvilmena/filter-core";
import { useEffect, useRef } from "react";
import { ColumnPicker } from "../../src/ui/ColumnPicker";
import { useColumnSettings } from "../../src/useColumnSettings";
import { useSavedTableState } from "../../src/useSavedTableState";

// A whole page with one or more tables that remember their columns. The same code draws it on
// the server and in the browser, as an app's own page would be drawn.

/** The id of the element that holds what the server read, as JSON, for the browser to use. */
export const INITIAL_SAVED_ID = "initial-saved";

/** The columns of every table on the page. */
const PAGE_COLUMNS: readonly ColumnDefinition[] = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "stock", label: "Stock" },
];

const PARTS = { columns: columnStatePart(PAGE_COLUMNS) };

// One store of each kind for the page's life. Making them touches nothing, so it is safe on
// the server too.
const STORES: Record<PageSetup["store"], StateStore> = {
  local: localStorageStore(),
  cookie: cookieStore(),
};

/** How a test asks for the page to be set up, read from the address. */
export interface PageSetup {
  /** Where the tables keep their state. */
  store: "local" | "cookie";
  /** The id of each table on the page. Each id is also the key its state is saved under. */
  tables: readonly string[];
  /** Whether the server draws the tables first, from the saved state in the cookies. */
  ssr: boolean;
  /** How long a table waits before it saves, in milliseconds. Left out for the default. */
  saveDelayMs: number | undefined;
  /** How long each table takes to draw the first time, in milliseconds. */
  slowDrawMs: number;
}

/**
 * The longest slow draw a page may ask for, in milliseconds. A slow draw keeps the thread
 * busy, on the server too, so an address must not be able to ask for a long one.
 */
const MAX_SLOW_DRAW_MS = 200;

/** The slow draw an address asks for. Anything but a number within the limit means none. */
function readSlowDraw(text: string | null): number {
  // Blank text would read as the number 0, which is the answer for it anyway.
  const asked = Number(text ?? 0);
  return Number.isFinite(asked) && asked >= 0 && asked <= MAX_SLOW_DRAW_MS
    ? asked
    : 0;
}

/** Reads the setup from an address's query string, such as "?store=cookie&tables=orders". */
export function readSetup(search: URLSearchParams): PageSetup {
  const delay = search.get("delay");
  return {
    store: search.get("store") === "cookie" ? "cookie" : "local",
    tables: (search.get("tables") ?? "orders").split(","),
    ssr: search.get("ssr") === "1",
    saveDelayMs: delay === null ? undefined : Number(delay),
    slowDrawMs: readSlowDraw(search.get("slow")),
  };
}

/** The saved value the server read for each table, by id. `null` means nothing was saved. */
export type InitialSaved = Readonly<Record<string, unknown>>;

/** What `TablePage` takes. */
export interface TablePageProps {
  setup: PageSetup;
  /** Given only when the server drew the page first. */
  initialSaved?: InitialSaved;
}

/** The page: one saved table per id. */
export function TablePage({ setup, initialSaved }: TablePageProps) {
  // Tells a test that the page is drawn and its buttons work.
  useEffect(() => {
    document.documentElement.setAttribute("data-ready", "");
  }, []);
  return (
    <main>
      {setup.tables.map((id) => (
        <SavedTable
          id={id}
          initialSaved={initialSaved?.[id]}
          key={id}
          serverDrew={initialSaved !== undefined}
          setup={setup}
        />
      ))}
    </main>
  );
}

function SavedTable({
  id,
  setup,
  serverDrew,
  initialSaved,
}: {
  id: string;
  setup: PageSetup;
  serverDrew: boolean;
  initialSaved: unknown;
}) {
  // Stands in for a large table, which takes a while to draw. React runs its late effects
  // straight after a quick draw, with no rest in between, so nothing could be painted
  // before them. After a slow draw it gives the browser a turn first. A test asks for a slow
  // draw to make sure of that turn: state that is loaded late is then seen to be late.
  const isFirstDraw = useRef(true);
  if (isFirstDraw.current) {
    isFirstDraw.current = false;
    const until = performance.now() + setup.slowDrawMs;
    while (performance.now() < until);
  }
  const saved = useSavedTableState({
    id,
    parts: PARTS,
    store: STORES[setup.store],
    saveDelayMs: setup.saveDelayMs,
    // Left out, not `undefined`, when the browser is to load the state itself.
    ...(serverDrew ? { initialSaved: initialSaved ?? null } : {}),
  });
  const table = useColumnSettings({
    columns: PAGE_COLUMNS,
    value: saved.values.columns,
    onChange: saved.set.columns,
  });
  return (
    <section data-table={id}>
      <h2>{id}</h2>
      <ColumnPicker labels={{ trigger: `Columns of ${id}` }} state={table} />
      <p data-shown>
        {table.visibleColumns.map((column) => column.key).join(" ")}
      </p>
      <p data-status>{saved.status}</p>
      <button
        data-action="hide-price"
        onClick={() => table.actions.setVisible("price", false)}
        type="button"
      >
        Hide price
      </button>
      <button
        data-action="stock-first"
        onClick={() => table.actions.move("stock", 0)}
        type="button"
      >
        Put stock first
      </button>
    </section>
  );
}

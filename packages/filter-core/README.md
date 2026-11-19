# @arvilmena/filter-core

The filter format and the rules that decide whether a row matches a filter. It keeps the JSON
shape and matching rules of DataTables SearchBuilder, so a filter saved by SearchBuilder keeps
returning the same rows. It has no dependencies and runs anywhere JavaScript runs.

```sh
npm install @arvilmena/filter-core
```

```ts
import {
  createRowPredicate,
  type FilterDefinition,
} from "@arvilmena/filter-core";

const filter: FilterDefinition = {
  logic: "AND",
  criteria: [
    {
      condition: ">=",
      data: "Ratio",
      origData: "ratio",
      type: "num",
      value: ["10"],
    },
  ],
};

// The app says how to read a field's value off a row, as text.
const valueOf = (row, key) => String(row[key] ?? "");

const visibleRows = rows.filter(createRowPredicate(filter, valueOf));
```

The `@arvilmena/filter-core/schema` entry validates a filter with Effect Schema. It is the only
entry that needs `effect`, which is an optional peer dependency.

## Column settings

The same entry holds the rules for a table's columns: which are shown, and in what order. The
settings are plain JSON, so an app can store them. Every function is pure. A function that takes
both the column list and the settings takes the column list first.

A function that takes settings and returns settings hands back the same object when nothing
changed. Those are `setColumnVisible`, `moveColumn`, `moveColumnAroundPinned`,
`moveColumnGroup`, `moveColumnGroupAroundPinned`, `showAllColumns`, `hideAllColumns`,
`resetColumnSettings` and `reconcileColumnSettings`. The others, `visibleColumns`, `orderedColumns` and
`defaultColumnSettings`, build a new result on each call. The React hook `useColumnSettings`
memoises them (keeps the result until its inputs change).

`isDefaultColumnSettings` answers whether a reset would change anything, so a picker can turn
its reset button off.

A column definition has these parts:

| Part            | Means                                                           |
| --------------- | --------------------------------------------------------------- |
| `key`           | Stored in the settings. Unique in the list.                     |
| `label`         | The column's name, as a picker shows it.                        |
| `hideable`      | `false` keeps the column shown. Defaults to `true`.             |
| `defaultHidden` | `true` hides the column until a person shows it.                |
| `pinned`        | `"start"` or `"end"` keeps the column at that end of the order. |

```ts
import {
  type ColumnDefinition,
  defaultColumnSettings,
  moveColumn,
  reconcileColumnSettings,
  resetColumnSettings,
  setColumnVisible,
  visibleColumns,
} from "@arvilmena/filter-core";

const columns = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "notes", label: "Notes", defaultHidden: true },
] satisfies ColumnDefinition[];

let settings = defaultColumnSettings(columns);
// { order: ["name", "price", "notes"], hidden: ["notes"] }

settings = setColumnVisible(settings, "notes", true);
settings = moveColumn(settings, "notes", 0);

visibleColumns(columns, settings).map((column) => column.key);
// ["notes", "name", "price"]

// Settings read from storage may be old or broken. This fits them to the columns the app has
// now, and nothing throws. Unknown keys go. A new column goes right after the nearest saved
// column before it in the app's list, or first if no saved column comes before it.
const stored: unknown = { order: ["price", "gone"], hidden: ["price"] };
settings = reconcileColumnSettings(columns, stored);
// { order: ["name", "price", "notes"], hidden: ["price", "notes"] }

settings = resetColumnSettings(columns, settings);
// { order: ["name", "price", "notes"], hidden: ["notes"] }
```

| Function                      | Does                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `defaultColumnSettings`       | The list's own order and starting visibility         |
| `reconcileColumnSettings`     | Fits saved settings to the column list               |
| `setColumnVisible`            | Shows or hides one column                            |
| `moveColumn`                  | Moves one column to a place in the order             |
| `moveColumnAroundPinned`      | The same move, leaving pinned columns in place       |
| `moveColumnGroup`             | Moves several columns together to a place            |
| `moveColumnGroupAroundPinned` | The same move, leaving pinned columns in place       |
| `unpinnedRange`               | The places of an order that a column may be moved to |
| `columnPin`                   | The end a column is pinned to, if any                |
| `showAllColumns`              | Shows every column, keeping the order                |
| `hideAllColumns`              | Hides every column that may be hidden                |
| `resetColumnSettings`         | Puts the defaults back                               |
| `isDefaultColumnSettings`     | Whether the settings are the defaults                |
| `orderedColumns`              | Every column in order, each with whether it is shown |
| `visibleColumns`              | The shown columns in order, as the app's own objects |
| `columnMatchesSearch`         | Whether a column's label matches a search            |
| `searchColumns`               | The columns of a list that match a search            |

### Pinned columns

A column with `pinned: "start"` or `pinned: "end"` keeps its place at that end of the order.
Use it for a column a table keeps in view while it scrolls sideways, such as the one that names
the row.

```ts
const columns = [
  { key: "name", label: "Name", pinned: "start", hideable: false },
  { key: "price", label: "Price" },
  { key: "stock", label: "Stock" },
  { key: "actions", label: "Actions", pinned: "end" },
] satisfies ColumnDefinition[];

// Settings saved before the columns were pinned still load. The pinned columns go to their
// ends, and the other columns keep their saved order.
let settings = reconcileColumnSettings(columns, {
  order: ["stock", "actions", "name", "price"],
  hidden: [],
});
// { order: ["name", "stock", "price", "actions"], hidden: [] }

// A pinned column does not move: the same settings come back.
moveColumnAroundPinned(columns, settings, "name", 2) === settings; // true

// Another column stops at the pinned ones. Place 0 is taken, so "price" lands in place 1.
settings = moveColumnAroundPinned(columns, settings, "price", 0);
// { order: ["name", "price", "stock", "actions"], hidden: [] }

orderedColumns(columns, settings).map((entry) => entry.pinned);
// ["start", undefined, undefined, "end"]
```

The rules:

- Pinned columns stand in the order the column list gives them, at their end of the order.
- `defaultColumnSettings`, `reconcileColumnSettings`, `orderedColumns` and `visibleColumns` all
  put pinned columns in place. `moveColumn` takes no column list, so it cannot. Use
  `moveColumnAroundPinned` in a list that pins columns.
- Pinning says where a column stands, not whether it is shown. Add `hideable: false` to keep a
  pinned column shown.
- The library draws no table, so it adds no sticky styling. A table reads `pinned` from each
  column of `visibleColumns`, which are the app's own column objects. `columnPin(column)` reads
  it too, and also compiles for a list written with `as const` where only some columns are
  pinned.

### Moving several columns together

`moveColumnGroup` moves several columns in one step. They land side by side, with the first of
them at the index given, and keep the order they had among themselves. The order the keys are
named in does not count.

```ts
let settings: ColumnSettings = {
  order: [
    "symbol",
    "company",
    "industry",
    "cap",
    "return",
    "age",
    "release",
    "beta",
  ],
  hidden: [],
};

settings = moveColumnGroup(settings, ["cap", "return", "beta"], 1);
// order: symbol, cap, return, beta, company, industry, age, release

// The group already stands there: the same settings come back.
moveColumnGroup(settings, ["cap", "return", "beta"], 1) === settings; // true
```

The rules:

- An index too near either end means the nearest place the whole group fits in.
- A key the order does not name is skipped, and so is a key named twice.
- With one key, it does what `moveColumn` does.
- `moveColumnGroupAroundPinned(columns, settings, keys, toIndex)` takes the column list too.
  It skips a pinned column named in `keys`, and the group never passes a pinned column.

### Searching the columns

`columnMatchesSearch` answers whether a column matches what a person typed in a search box, and
`searchColumns` narrows a whole list. The ready-made picker uses the same rules, so a picker an
app draws itself finds the same columns.

```ts
import { columnMatchesSearch, searchColumns } from "@arvilmena/filter-core";

const columns = [
  { key: "close", label: "Close price" },
  { key: "open", label: "Open price" },
  { key: "volume", label: "Volume" },
];

searchColumns(columns, "PRICE").map((column) => column.key); // ["close", "open"]
searchColumns(columns, "price close").map((column) => column.key); // ["close"]
searchColumns(columns, "  ") === columns; // true: an empty search matches every column

columnMatchesSearch(columns[2], "vol"); // true
```

The rules:

- The label is searched, ignoring case.
- Every word typed must be somewhere in the label, in any order.
- An empty search matches every column, and `searchColumns` then returns the same list.
- Letters with accents are compared as typed: "cafe" does not find "Café".

`searchColumns` also takes the entries of `orderedColumns`, and returns the matching entries.

## Saved table state

A table can remember its filter, its column settings and anything else an app adds, such as
the sort. The pieces are plain functions, so an app without React can use them too.

```ts
import {
  columnStatePart,
  createSavedState,
  filterStatePart,
  localStorageStore,
  readSavedState,
} from "@arvilmena/filter-core";

const PAGE_SIZES = [25, 50, 100];

// Each part has a default, and a `parse` that checks the saved value.
const parts = {
  filter: filterStatePart(),
  columns: columnStatePart(columns),
  pageSize: {
    defaultValue: 25,
    // Only a size the table offers is taken. Any other saved value gives the default.
    parse: (saved: unknown) => PAGE_SIZES.find((size) => size === saved),
  },
};

const store = localStorageStore();

// Typed from the parts: { filter: FilterDefinition, columns: ColumnSettings, pageSize: number }
const state = readSavedState(await store.load("orders"), parts);

await store.save("orders", createSavedState({ ...state, pageSize: 50 }));
```

### The key

`resolveStateKey({ name, id, location })` picks the key the state is saved under. The first of
these that is given wins:

1. `name`, a name the app chooses. Use it when the same table appears on several pages, or
   when several tables share an id.
2. `id`, the table's id.
3. The path of the page, without the query string and the hash. `location` is the page's
   address, and defaults to the address of the page the code runs on.

An empty `name` or `id` counts as not given. The result is `undefined` when nothing is given and
there is no page, as on a server.

```ts
resolveStateKey({ name: "archive", id: "orders" }); // "archive"
resolveStateKey({ id: "orders" }); // "orders"
resolveStateKey({ location: "https://example.com/orders/?page=2#top" }); // "/orders/"
```

### The saved format

The saved value is plain JSON: `{ "version": 1, "parts": { "filter": …, "columns": … } }`.

A saved value is untrusted input, because a person can edit it and an older version of the app
may have written it. `readSavedState` therefore never throws:

- A part that is missing gets its default.
- A part whose `parse` returns `undefined` or throws gets its default. The other parts are
  still used.
- A value that is not a saved state at all gives every part its default.

`filterStatePart` reads a filter as loosely as matching does, so a saved filter keeps returning
the same rows. It turns down one filter: a filter nested more than `MAX_SAVED_FILTER_DEPTH`
(200) groups deep, which no person builds and which could stop the page. `columnStatePart` fits
the saved settings to the column list with `reconcileColumnSettings`. Called with no column
list, `columnStatePart()` is `null` until something is saved and hands saved settings on as
they are, for code that fits them to the column list itself, such as the column hook of
`@arvilmena/filter-react`.

`readSavedState` hands out only the parts you name. To save some parts and keep the others,
read them all with `readSavedParts`, which upgrades them but does not check them:

```ts
const before = readSavedParts(await store.load("orders")) ?? {};
await store.save("orders", createSavedState({ ...before, pageSize: 50 }));
```

When the shape of a part changes, raise `version` and pass `migrate`. It gets the saved parts
and the version that wrote them, and returns the parts in today's shape. Without `migrate`, a
value saved under another version is not used.

```ts
const state = readSavedState(saved, parts, {
  version: 2,
  // Version 1 kept the page size under "rows".
  migrate: (saved, fromVersion) =>
    fromVersion === 1 ? { ...saved, pageSize: saved.rows } : saved,
});
```

### A rule that spans parts

Each part is parsed by itself. For a rule that needs two parts, pass `check`. It runs after
every part was read. It gets all the values, and the names of the parts that got their default
because nothing usable was saved for them. It returns the parts to correct, or nothing.

```ts
const parts = {
  filter: filterStatePart(),
  // The name a person gave the saved filter.
  filterName: {
    defaultValue: "",
    parse: (saved: unknown) => (typeof saved === "string" ? saved : undefined),
  },
};

const state = readSavedState(saved, parts, {
  // A name without its filter means nothing, so it goes when the filter was not usable.
  check: (values, defaulted) =>
    defaulted.includes("filter") ? { filterName: "" } : undefined,
});
```

`check` is as loose as `parse`:

- When it throws, the values read before it are used.
- A returned part the app does not have is ignored, and so is one that is `undefined`.
- A returned part is used as it is. It is not parsed again.
- It is not called when nothing usable is saved, because every part then has its default.

### The stores

A store keeps one JSON value per key. Three are built in. Each one is safe to make on a
server, and a store an app does not use is left out of its bundle.

**Local storage** keeps the state in the browser, on one device. Where there is no local
storage, it loads nothing and saves nothing.

```ts
const store = localStorageStore({ prefix: "my-app." }); // The prefix defaults to "table-state.".
```

**A cookie** lets the app's server read the state and draw the page with it. A cookie holds
about 4 KB. `save` throws a `CookieTooLargeError` for a larger value and writes nothing, so the
value saved before stays as it was.

```ts
const store = cookieStore({ maxAgeDays: 30, path: "/", sameSite: "lax" });

// On the server, from the request's Cookie header:
const saved = readCookieState(request.headers.get("cookie") ?? "", "orders");
const state = readSavedState(saved, parts);
```

Use a cookie for a small state only, and know its limits:

- **Only about 2 KB of state fits.** The value is encoded to be safe in a cookie, which makes
  the JSON about twice as long. A filter of about 25 simple conditions fills the cookie.
- **Every key is a cookie of its own, and the browser sends them all with every request.**
  Several of them can pass the size a server accepts for a request's headers, often 8 KB to
  16 KB in total. The server then refuses every request to the site, not only the table's.
- **The page path as the key adds a cookie per page.** Give each table a `name` or an `id`.
- **`maxBytes` caps each cookie.** It defaults to 4096, the most a browser keeps. Lower it when
  several tables save cookies: `cookieStore({ maxBytes: 1024 })`.

For a larger state, use the fetch store or local storage.

**Fetch** keeps the state on the app's own server. It sends a GET to load, a PUT with a JSON
body to save and a DELETE to remove. On load, a 404, a 204 or an empty body means nothing is
saved. Any other failure rejects with a `FetchStoreError`.

```ts
const store = fetchStore({
  // Text gets the key as a query parameter: "/api/table-state?key=orders".
  // A function builds the address itself. Encode the key: it may be a page path with "/".
  //   url: (key) => `/api/table-state/${encodeURIComponent(key)}`,
  url: "/api/table-state",
  // Called for every request, so it can hand out a fresh token.
  headers: () => ({ authorization: `Bearer ${token()}` }),
  // Passed to `fetch` as they are. `keepalive` lets a save finish while the page closes.
  init: { credentials: "include", keepalive: true },
});
```

The fetch store sends a request only to the address you give, and adds no credentials of its
own. What the browser sends by itself, such as same-site cookies, is set with `init`.

A `headers` function may answer with a promise, and the request starts only once that promise
has settled. A slow promise, such as one that fetches a new token, can therefore lose the save
a closing page makes, even with `keepalive`. Answer at once from a token the app already holds.

**Your own store** is an object with `load`, `save` and `remove`. Each may answer at once or
with a promise. `load` answers `undefined` or `null` when nothing is saved.

```ts
import type { StateStore } from "@arvilmena/filter-core";

const sessionStore: StateStore = {
  load: (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
  save: (key, value) => sessionStorage.setItem(key, JSON.stringify(value)),
  remove: (key) => sessionStorage.removeItem(key),
};
```

### State from an older place

An app may already keep a table's state somewhere of its own, such as a local storage key it
chose before it used this library. `carryOverStore` wraps a store so that this state is taken
over once:

```ts
import { carryOverStore, localStorageStore } from "@arvilmena/filter-core";

const store = carryOverStore(localStorageStore(), {
  // Each part's old value by the part's name: `{ filter, columns }`. `null` for nothing.
  read: () => JSON.parse(localStorage.getItem("orders-table") ?? "null"),
  // Optional. Leave it out to keep the old entry.
  remove: () => localStorage.removeItem("orders-table"),
});
```

- **`load` asks the store first.** Only when nothing is saved under the key does it call
  `read`, with the key. What `read` returns is handed back in the saved format.
- **The old value is read like any saved value.** Each part goes through its `parse`, so a
  broken part gets its default and the others are still used. A `read` that throws or rejects
  counts as nothing to carry over.
- **Loading writes nothing.** The state reaches the store with the first save, which the hook
  makes after the first change a person makes. Until then, each visit carries it over again.
- **The old entry is left alone unless you pass `remove`.** It is called after the first save
  that follows a carry-over, once the store has taken that save, and when the state is
  removed. A failure after a save is ignored, because the state is safe in the store by then.
- **Removed state stays removed.** With `remove`, the store's entry and the old entry both
  go. Without it, the wrapper saves an empty state and does not delete the entry, because
  otherwise the next load would carry the old state over again.
- **Any store works,** and `read` and `remove` may answer with a promise. Where the store and
  your functions answer at once, the wrapper does too.

The carried parts are marked with version 1. If you pass a `version` to `readSavedState` or
the hook, pass the same one here: `carryOverStore(store, { read, version: 2 })`. To have your
`migrate` upgrade the old value, pass the older version it was written in.

A page whose server already read the state (`initialSaved` in the hook) does not load from
the store for its first key, so the server must read the older place itself.

For a builder screen, a column picker and a hook that saves the state, see
`@arvilmena/filter-react`. The full guide is in the
[repository](https://github.com/ArvilDidThis/filter-builder#readme).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables.

## Licence

MIT

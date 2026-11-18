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
changed. Those are `setColumnVisible`, `moveColumn`, `moveColumnAroundPinned`, `showAllColumns`,
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

| Function                  | Does                                                 |
| ------------------------- | ---------------------------------------------------- |
| `defaultColumnSettings`   | The list's own order and starting visibility         |
| `reconcileColumnSettings` | Fits saved settings to the column list               |
| `setColumnVisible`        | Shows or hides one column                            |
| `moveColumn`              | Moves one column to a place in the order             |
| `moveColumnAroundPinned`  | The same move, leaving pinned columns in place       |
| `unpinnedRange`           | The places of an order that a column may be moved to |
| `showAllColumns`          | Shows every column, keeping the order                |
| `resetColumnSettings`     | Puts the defaults back                               |
| `isDefaultColumnSettings` | Whether the settings are the defaults                |
| `orderedColumns`          | Every column in order, each with whether it is shown |
| `visibleColumns`          | The shown columns in order, as the app's own objects |

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
  column of `visibleColumns`, which are the app's own column objects.

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
the saved settings to the column list with `reconcileColumnSettings`.

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

For a builder screen, a column picker and a hook that saves the state, see
`@arvilmena/filter-react`. The full guide is in the
[repository](https://github.com/ArvilDidThis/filter-builder#readme).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables.

## Licence

MIT

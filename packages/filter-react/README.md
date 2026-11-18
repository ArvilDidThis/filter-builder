# @arvilmena/filter-react

A filter builder for React. It edits filters in the JSON shape of DataTables SearchBuilder, with
groups nested as deep as you like. It also holds a column picker, which lets a person hide a
table's columns and change their order. A third hook saves a table's filter and columns between
visits.

```sh
npm install @arvilmena/filter-react @arvilmena/filter-core
```

## The ready-made builder

It uses plain HTML controls, and takes its colours from the `--fb-*` variables in the stylesheet.

```tsx
import type { FieldDefinition, FilterDefinition } from "@arvilmena/filter-core";
import { FilterBuilder } from "@arvilmena/filter-react/ui";
import { useState } from "react";
import "@arvilmena/filter-react/styles.css";

const fields: FieldDefinition[] = [
  { key: "ratio", label: "Ratio", type: "num" },
  { key: "name", label: "Name", type: "string" },
];

function Filters() {
  const [filter, setFilter] = useState<FilterDefinition>({
    logic: "AND",
    criteria: [],
  });
  return <FilterBuilder value={filter} onChange={setFilter} fields={fields} />;
}
```

## Your own builder

The `useFilterBuilder` hook holds no markup. It returns the rows to draw and the actions that
change the filter.

```tsx
import { useFilterBuilder } from "@arvilmena/filter-react";

const builder = useFilterBuilder({
  value: filter,
  onChange: setFilter,
  fields,
});
```

## The ready-made column picker

A button that opens a list of a table's columns. A person ticks a column to show it and drags
its handle to move it. The handle also works from the keyboard: the arrow keys, Home and End
move the column, and a screen reader hears each move.

Below the list, "Show all" shows every column and "Reset" puts back the starting order and
visibility. Each button is unavailable while it has nothing to do: "Show all" while every column
is shown, and "Reset" while the settings are the starting ones. An unavailable button is dimmed
and ignores a press, but it keeps the keyboard focus, so a person who presses "Reset" with the
keyboard stays where they are.

A screen reader hears what a button did once the change is on screen, not at the press. If your
app keeps the settings and applies the change later, the message comes then. If your app turns
the change down, or applies a different one, nothing is read out.

The `useColumnSettings` hook keeps the settings. Its result goes to the picker, and gives the
table its columns.

```tsx
import type { ColumnDefinition } from "@arvilmena/filter-core";
import { useColumnSettings } from "@arvilmena/filter-react";
import { ColumnPicker } from "@arvilmena/filter-react/ui";
import "@arvilmena/filter-react/styles.css";

interface Product {
  id: string;
  name: string;
  price: string;
  notes: string;
}

// `as const` keeps the keys exact, so `actions.toggle("pric")` is a type error.
const columns = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "notes", label: "Notes", defaultHidden: true },
] as const satisfies readonly ColumnDefinition[];

function Products({ rows }: { rows: readonly Product[] }) {
  const table = useColumnSettings({ columns });
  return (
    <>
      <ColumnPicker state={table} />
      <table>
        <thead>
          <tr>
            {table.visibleColumns.map((column) => (
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {table.visibleColumns.map((column) => (
                <td key={column.key}>{row[column.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
```

A column keeps any extra properties you give it, such as a width or a cell renderer, and
`visibleColumns` hands the same objects back.

`ColumnPicker` takes the hook's result as `state`, where `FilterBuilder` takes `value` and
`onChange`. The table needs the same state as the picker, so the hook runs once and its result
goes to both.

### Who keeps the settings

The hook works like a form input. The settings are plain JSON, and the hook fits them to the
column list first, so settings saved for an older column list are safe to pass in.

| You pass               | Who keeps the settings | What is shown                                  |
| ---------------------- | ---------------------- | ---------------------------------------------- |
| neither                | The hook               | The column list's defaults, then each change   |
| `defaultValue`         | The hook               | `defaultValue` at first, then each change      |
| `value` and `onChange` | Your app               | `value`, always                                |
| `value: null`          | Your app               | The defaults, until you pass the settings back |

`null` means "nothing saved", for `value` and for `defaultValue`. A `value` of `null` still
means your app keeps the settings. Only leaving `value` out hands them to the hook.

This example keeps the settings in the browser's storage. It reads them once, and neither a
missing storage nor a damaged string can break the page:

```tsx
import type { ColumnDefinition, ColumnSettings } from "@arvilmena/filter-core";
import { useColumnSettings } from "@arvilmena/filter-react";
import { ColumnPicker } from "@arvilmena/filter-react/ui";
import { useState } from "react";

const columns = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "notes", label: "Notes", defaultHidden: true },
] as const satisfies readonly ColumnDefinition[];

const STORAGE_KEY = "product-columns";

/** Reads the saved settings. `null` means nothing was saved, so the defaults apply. */
function readSavedColumns(): ColumnSettings | null {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
  } catch {
    // There is no storage (as on a server), it is turned off, or the string is damaged.
    return null;
  }
}

function saveColumns(settings: ColumnSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage is full or turned off. The choice then lasts for this visit only.
  }
}

function ProductColumns() {
  // `useState` calls the function once, so storage is read on the first render only.
  const [saved] = useState(readSavedColumns);
  const table = useColumnSettings({
    columns,
    defaultValue: saved,
    onChange: saveColumns,
  });
  return <ColumnPicker state={table} />;
}
```

This suits a page drawn only in the browser. A page drawn on a server first has no storage
there, so the server draws the defaults and the browser draws the saved settings, and React
reports the difference. Saving table state is planned as a feature of its own.

### Replacing parts of the picker

| Prop            | Does                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| `labels`        | Replaces any wording, e.g. `{ trigger: "Edit columns" }`               |
| `align`         | `"end"` lines the list up with the button's right edge                 |
| `renderTrigger` | Draws your own button. Spread the props it is given onto the button    |
| `renderRow`     | Draws the inside of one row from the `checkboxProps` and `handleProps` |
| `className`     | Added to the picker's own class                                        |

The list is kept inside the screen sideways. Where lining it up with the button would run it
past the left or right edge, it moves sideways just far enough to fit. On a page that a person
has zoomed into with two fingers, it is kept inside the part in view, where it fits into that
part. It always opens below the button, and on a short screen it scrolls sooner. Below a button
near the bottom of the screen it keeps a usable height, so it can still pass the bottom edge,
and the page scrolls to show the rest of it.

Spread all of `handleProps` onto your handle. It carries the `touch-action` style that lets a
finger drag the handle. Keep the same `renderRow` function between renders (see `useCallback`),
or every row redraws whenever the picker does. `labels` may be written in place.

The picker reads the `--fb-*` variables from its own class, `.fb-columns`.

### In a shadow root or a frame

A stylesheet styles only the document or the shadow root it is loaded in. The import above
loads it in the main document, which is all a picker drawn there needs.

Load the stylesheet again where the picker is drawn in one of these:

- **A shadow root** (a part of the page that hides its insides, as a web component has): put a
  `<link rel="stylesheet">` or a `<style>` that holds the stylesheet inside the shadow root.
- **An iframe:** put it in the iframe's own document.

Without it the list is not drawn as a popover, and the text meant only for screen readers
shows on the page. The same holds for the ready-made builder.

Inside a closed shadow root, a press beside an open picker does not close it when other code
stops that press on its way down (in the capture phase) at the root's host or above it,
because the picker then never hears the press.

## Your own column picker

`useColumnSettings` holds no markup. It returns every column in order (`orderedColumns`), the
visible columns (`visibleColumns`), and the actions that change the settings. The `actions`
object never changes, and `visibleColumns` changes only when its content does, so a memoised
table does not redraw for nothing.

Two more values say whether a button has anything to do:

| Value        | True when                                   | So this would change nothing |
| ------------ | ------------------------------------------- | ---------------------------- |
| `allVisible` | Every column is shown                       | `actions.showAll`            |
| `isDefault`  | The settings are the column list's defaults | `actions.reset`              |

The example marks such a button with `aria-disabled`, not `disabled`. A button that turns itself
`disabled` while it holds the keyboard focus loses that focus. The click needs no check of its
own, because an action that has nothing to do changes nothing.

```tsx
import type { ColumnDefinition } from "@arvilmena/filter-core";
import { useColumnSettings } from "@arvilmena/filter-react";

const columns = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "notes", label: "Notes", defaultHidden: true },
] as const satisfies readonly ColumnDefinition[];

function ProductColumns() {
  const { orderedColumns, visibleColumns, allVisible, isDefault, actions } =
    useColumnSettings({ columns });
  return (
    <>
      <ul>
        {orderedColumns.map(({ column, visible, hideable }, index) => (
          <li key={column.key}>
            <label>
              <input
                type="checkbox"
                checked={visible}
                disabled={!hideable}
                onChange={() => actions.toggle(column.key)}
              />
              {column.label}
            </label>
            {/* Named for a screen reader, which would otherwise hear "Up" once per row. */}
            <button
              type="button"
              aria-label={`Move ${column.label} up`}
              onClick={() => actions.move(column.key, index - 1)}
            >
              Up
            </button>
            <button
              type="button"
              aria-label={`Move ${column.label} down`}
              onClick={() => actions.move(column.key, index + 1)}
            >
              Down
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        aria-disabled={allVisible}
        onClick={actions.showAll}
      >
        Show all
      </button>
      <button type="button" aria-disabled={isDefault} onClick={actions.reset}>
        Reset
      </button>
      <p>Showing: {visibleColumns.map((column) => column.label).join(", ")}</p>
    </>
  );
}
```

## Saving a table's state

The `useSavedTableState` hook remembers a table's filter, its column settings and any part you
add. It loads the saved state, gives you each part with a setter, and saves after a change.
With only an `id` and the parts, it saves to the browser's local storage.

Each part plugs into a hook through `value` and `onChange`:

```tsx
import {
  columnStatePart,
  createRowPredicate,
  filterStatePart,
} from "@arvilmena/filter-core";
import {
  useColumnSettings,
  useFilterBuilder,
  useSavedTableState,
} from "@arvilmena/filter-react";
import { ColumnPicker, FilterBuilder } from "@arvilmena/filter-react/ui";
import { useMemo } from "react";

// Outside the component, so the parts are made once.
const parts = {
  filter: filterStatePart(),
  columns: columnStatePart(columns),
  // A part of your own: a default, and a `parse` that checks the saved value.
  pageSize: {
    defaultValue: 25,
    parse: (saved: unknown) => (typeof saved === "number" ? saved : undefined),
  },
};

function Orders({ rows }) {
  const saved = useSavedTableState({ id: "orders", parts });
  const { filter, pageSize } = saved.values;

  const table = useColumnSettings({
    columns,
    value: saved.values.columns,
    onChange: saved.set.columns,
  });
  const shown = useMemo(
    () => rows.filter(createRowPredicate(filter, valueOf)),
    [rows, filter],
  );

  return (
    <>
      <FilterBuilder
        value={filter}
        onChange={saved.set.filter}
        fields={fields}
      />
      <ColumnPicker state={table} />
      <PageSize value={pageSize} onChange={saved.set.pageSize} />
      <MyTable columns={table.visibleColumns} rows={shown.slice(0, pageSize)} />
      {saved.status === "error" && <p>Your settings could not be saved.</p>}
    </>
  );
}
```

To draw your own builder, pass the same two values to the builder hook:

```tsx
const builder = useFilterBuilder({
  value: saved.values.filter,
  onChange: saved.set.filter,
  fields,
});
```

The types come from the parts: `saved.values.pageSize` is a `number`, and `saved.set.pageSize`
takes a number or a function from the old number to the new one.

| Option         | Does                                                                      |
| -------------- | ------------------------------------------------------------------------- |
| `name`         | A name for the saved state. Wins over `id`                                |
| `id`           | The table's id. With neither, the state is saved under the page's path    |
| `parts`        | The parts to remember, by name                                            |
| `store`        | Where the state is kept. Defaults to local storage                        |
| `initialSaved` | The saved value a server already read, for the first render               |
| `version`      | The version of your state format. Defaults to 1                           |
| `migrate`      | Upgrades the parts of a value saved under another version                 |
| `saveDelayMs`  | How long to wait after the last change before saving. Defaults to 300     |
| `onError`      | Called with the error and `"load"`, `"save"` or `"remove"` when one fails |

| Result        | Holds                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| `values`      | Each part's value. A part stays the same object until that part changes    |
| `set`         | One setter per part. The setters stay the same functions between renders   |
| `status`      | `"loading"`, `"ready"`, or `"error"` after a failed load, save or remove   |
| `error`       | What went wrong, while `status` is `"error"`                               |
| `errorAction` | What failed, while `status` is `"error"`: `"load"`, `"save"` or `"remove"` |
| `flush()`     | Saves a waiting change now. Its promise settles on the store's answer      |
| `reload()`    | Reads the saved state again, for example after a failed load               |
| `clear()`     | Forgets everything saved under the key, and puts back every default        |

What the hook guarantees:

- **The first render uses the defaults,** so a server and the browser draw the same page. The
  saved state is read right after. Local storage and cookies are read before the browser
  paints, so the defaults do not flash.
- **Nothing is saved before the load has finished.** A part you change in the meantime keeps
  your change, and is saved once the load is done.
- **A failed load or save never breaks the table.** The parts keep working in memory. See
  [When something fails](#when-something-fails).
- **State is saved under the key it was loaded for.** When `name`, `id` or the page's path
  changes, a waiting change is saved under the old key, and the new key's state is loaded.
- **Quick changes are saved together.** A waiting change is also saved when the page is hidden
  or closed, and when the table leaves the screen.
- **Saves reach the store in order.** Each save or remove waits for the store's answer to the
  one before it, so a slow answer cannot leave an older state in the store. Only a closing
  page sends without waiting.
- **Parts the hook does not own are kept.** A save writes back the other parts found under the
  key. `clear()` removes them too.
- **A saved value is checked before use.** A broken part falls back to its default alone.
- **A part added to `parts` later gets a value at once:** the one saved under its name, or its
  default.

### One hook call per key

Use one `useSavedTableState` call per key, and give each table an `id` or a `name`. Two tables
on one page with neither both fall back to the page's path, so they share a key.

Two hooks on one key keep each other's parts when the part names differ. Parts of the same
name overwrite each other. A development build warns once in the console when two tables on
screen share a key and a store.

### State the server already read

The first render uses the defaults, so a table whose state the server could have known jumps
when the browser loads it. To avoid that, keep the state in a cookie, read it on the server
and pass it as `initialSaved`:

```tsx
import {
  cookieStore,
  type FilterDefinition,
  filterStatePart,
  readCookieState,
} from "@arvilmena/filter-core";
import { useSavedTableState } from "@arvilmena/filter-react";

const parts = { filter: filterStatePart() };
const store = cookieStore();

// On the server: read the raw saved value from the request's Cookie header, and hand it to
// the page as a prop. It is `undefined` when nothing is saved.
export function readOrdersState(cookieHeader: string): unknown {
  return readCookieState(cookieHeader, "orders");
}

// On the server and in the browser.
export function Orders({ initialSaved }: { initialSaved: unknown }) {
  const saved = useSavedTableState({
    id: "orders",
    parts,
    store,
    initialSaved,
  });
  const filter: FilterDefinition = saved.values.filter;
  return <p>{filter.criteria.length} conditions</p>;
}
```

With `initialSaved`, the first render uses that state on the server and in the browser, and
`status` starts as `"ready"`. The store is not read for the first key, and nothing is saved
back until a part changes. The value is checked like any saved value. Pass `null` when the
server found nothing, or leave it `undefined` to load from the store. Only the first render
reads it.

### When something fails

`status` becomes `"error"`, `error` holds what went wrong, and `errorAction` says what failed:

| `errorAction` | Means                                                | What to do                          |
| ------------- | ---------------------------------------------------- | ----------------------------------- |
| `"load"`      | The saved state could not be read. **Saving is off** | Call `reload()` to try again        |
| `"save"`      | One save failed. The change is kept                  | Nothing, or call `flush()` to retry |
| `"remove"`    | `clear()` could not remove the stored state          | Call `clear()` again                |

After a failed load nothing is saved, so that the stored state is not overwritten. `reload()`
reads it again and turns saving back on. A part changed since the load failed keeps the
change. `clear()` also turns saving back on, but it deletes the stored state.

```tsx
{
  saved.errorAction === "load" && (
    <button type="button" onClick={saved.reload}>
      Your settings could not be loaded. Try again
    </button>
  );
}
```

### Waiting for a save

`flush()` saves a waiting change now, and returns a promise that settles once the store has
answered. Wait for it before you leave the page:

```tsx
async function leave() {
  const isSaved = await saved.flush();
  if (isSaved) window.location.assign("/done");
}
```

The promise never rejects. It gives `true` when nothing is left unsaved. It gives `false`
while a save or remove has failed and no later one went through, or when a change cannot be
saved because the load has not finished or has failed. The failure itself is in `error`, and
goes to `onError`.

A change whose save failed is not lost. It is saved again with the next change, on `flush()`,
when the page is hidden or closed, and when the table leaves the screen. `reload()` keeps it
too, and saves it after the load.

Two things the hook does not do:

- **It does not cancel a load.** A load still on its way when the table leaves the screen, or
  when its key changes, runs to its end. Its answer is ignored.
- **It cannot wait for a slow `headers` function on a closing page.** The fetch store starts a
  request only once `headers()` has answered. A `headers` function that waits for something
  slow can lose the save a closing page makes, even with `keepalive`.

### Other stores

Pass a `store` to keep the state somewhere else. Keep the store out of the component, or in
`useMemo`, so it is made once.

The hook keeps the store it last loaded from, and saves there. A different `store` passed
later does not load again by itself. It is used from the next load on: a change of key, or
`reload()`.

```tsx
import {
  cookieStore,
  fetchStore,
  localStorageStore,
} from "@arvilmena/filter-core";

// The browser's local storage, with your own prefix in front of the key.
const local = localStorageStore({ prefix: "my-app." });

// A cookie, which your server can read with `readCookieState`. It holds about 4 KB: a larger
// state is not saved, and `status` becomes "error" with a `CookieTooLargeError`.
// Only a small state fits, and every cookie is sent with every request: see the note below.
const cookie = cookieStore({ maxAgeDays: 30 });

// Your own server: GET to load, PUT to save, DELETE to remove.
const server = fetchStore({
  url: "/api/table-state",
  headers: () => ({ authorization: `Bearer ${token()}` }),
  init: { keepalive: true },
});

const saved = useSavedTableState({ id: "orders", parts, store: server });
```

A cookie suits a small state only. Encoding makes the JSON about twice as long, so about 2 KB
of state fills it. Each key is a cookie of its own, sent with every request, and several can
pass the size a server accepts for a request's headers. Give each table an `id` or a `name`,
cap each cookie with `cookieStore({ maxBytes: 1024 })`, and use the fetch store or local
storage for a larger state.

A store of your own is an object with `load`, `save` and `remove`. Each may answer at once or
with a promise:

```tsx
import type { StateStore } from "@arvilmena/filter-core";

const sessionStore: StateStore = {
  load: (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
  save: (key, value) => sessionStorage.setItem(key, JSON.stringify(value)),
  remove: (key) => sessionStorage.removeItem(key),
};
```

When the shape of a part changes, raise `version` and pass `migrate`:

```tsx
const saved = useSavedTableState({
  id: "orders",
  parts,
  version: 2,
  // Version 1 kept the page size under "rows".
  migrate: (saved, fromVersion) =>
    fromVersion === 1 ? { ...saved, pageSize: saved.rows } : saved,
});
```

The [filter-core README](https://github.com/ArvilDidThis/filter-builder/tree/main/packages/filter-core#saved-table-state)
describes the key, the saved format and each store in full.

To filter rows, use `createRowPredicate` from `@arvilmena/filter-core`. The full guide is in the
[repository](https://github.com/ArvilDidThis/filter-builder#readme).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables.

## Licence

MIT

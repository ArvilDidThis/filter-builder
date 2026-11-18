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
[Theming](#theming) shows how to set them.

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

### Pinned columns

Give a column `pinned: "start"` or `pinned: "end"` to keep it at that end of the table. Use it
for a column that must stay in view while the table scrolls sideways, such as the one that
names the row.

```tsx
import { type ColumnDefinition, columnPin } from "@arvilmena/filter-core";

const columns = [
  { key: "name", label: "Name", pinned: "start", hideable: false },
  { key: "price", label: "Price" },
  { key: "notes", label: "Notes" },
  { key: "actions", label: "Actions", pinned: "end" },
] as const satisfies readonly ColumnDefinition[];

function Products() {
  const table = useColumnSettings({ columns });
  return (
    <>
      <ColumnPicker state={table} />
      <table>
        <thead>
          <tr>
            {table.visibleColumns.map((column) => (
              // "start", "end" or nothing. Your own CSS makes the column sticky.
              <th key={column.key} data-pinned={columnPin(column)}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
      </table>
    </>
  );
}
```

```css
th[data-pinned="start"] {
  position: sticky;
  left: 0;
}
th[data-pinned="end"] {
  position: sticky;
  right: 0;
}
```

What pinning does:

- **The column keeps its place.** It is at its end of `visibleColumns` and `orderedColumns`
  whatever the saved order says. Settings saved before the column was pinned still load.
- **Nothing moves it.** `actions.move` on a pinned column changes nothing and does not call
  `onChange`. Another column stops at the pinned ones: moved to a pinned column's place, it
  lands in the nearest place it may take.
- **The picker shows it as fixed.** Its row has a pin where the handle would be, so the arrow
  keys and a drag cannot move it. A screen reader hears that the column cannot be moved.
- **It may still be hidden.** Pinning says where a column stands. Add `hideable: false` to
  keep it shown too.

The library draws no table, so it adds no sticky styling. Each entry of `orderedColumns` has
`pinned`, and the columns of `visibleColumns` are your own objects. `columnPin(column)` reads
the pin from either, and also compiles for a list written with `as const`. Several columns
pinned to one end stand in the order of your column list, and each needs its own `left` or
`right` offset in your CSS.

### Searching the list

A table with many columns makes a long list. The picker then has a search box above the list,
which narrows it to the columns whose name matches what a person types.

```tsx
<ColumnPicker state={table} />                  {/* a box once the table has over 10 columns */}
<ColumnPicker state={table} search />           {/* always a box */}
<ColumnPicker state={table} search={false} />   {/* never a box */}
```

| `search`           | The search box is there                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `"auto"` (default) | When the table has more than 10 columns, which is when the list scrolls. The number is `COLUMN_PICKER_SEARCH_THRESHOLD`. |
| `true`             | Always                                                                                                                   |
| `false`            | Never                                                                                                                    |

How the search works:

- **Matching.** The column's label is searched, ignoring case. Every word typed must be in
  the label, in any order, so "price close" finds "Close price".
- **Moving is off while a search is on.** The rows between the listed ones are out of sight,
  so a move could not show where the column lands. The handles are turned off, and a line
  below the box says "Clear the search to move columns." Ticking a column still works.
- **"Show all" and "Reset" act on every column,** not only the listed ones.
- **A screen reader hears the count,** such as "3 of 40 columns match." The same line is
  shown below the box.
- **Escape clears the search.** Pressed again, it closes the picker. The search also starts
  empty each time the picker opens.

Replace the wording with `labels`: `search`, `searchCount` and `searchMoveHint`.

A picker you draw yourself can use the same matching. `searchColumns` and
`columnMatchesSearch` are pure functions in `@arvilmena/filter-core`:

```tsx
import { searchColumns } from "@arvilmena/filter-core";

const listed = searchColumns(table.orderedColumns, typed);
```

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
| `search`        | `true` or `false` forces the search box on or off. See above           |
| `className`     | Added to the picker's own class                                        |
| `style`         | An inline style for the picker. It also takes the `--fb-*` variables   |

The list is kept inside the screen sideways. Where lining it up with the button would run it
past the left or right edge, it moves sideways just far enough to fit. On a page that a person
has zoomed into with two fingers, it is kept inside the part in view, where it fits into that
part. It always opens below the button, and on a short screen it scrolls sooner. Below a button
near the bottom of the screen it keeps a usable height, so it can still pass the bottom edge,
and the page scrolls to show the rest of it.

Spread all of `handleProps` onto your handle. It carries the `touch-action` style that lets a
finger drag the handle. A row also has `pinned` and `movable`. On a row that is not movable,
such as a pinned one, `handleProps` turns the handle off, or you can leave the handle out. Keep the same `renderRow` function between renders (see `useCallback`),
or every row redraws whenever the picker does. `labels` may be written in place.

The picker reads the same `--fb-*` variables as the builder. Set them on the picker with
`className` or `style`, or on any element around it. See [Theming](#theming).

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

## Theming

The ready-made builder and column picker take their look from CSS variables whose names start
with `--fb-`. With nothing set, the colours are worked out from the page's own text colour, so
both fit a light page and a dark page.

To change the look, set a variable. Set it on the component, or on any element around it, up
to `:root`. One class or one inline style is enough. Your value always wins over the default,
whatever order the style sheets load in, because the library never sets these variables on the
component itself.

### With plain CSS

```css
/* Every builder and picker on the page. */
:root {
  --fb-radius: 0;
  --fb-focus: rebeccapurple;
}

/* Only the ones inside this element. */
.table-tools {
  --fb-control-height: 2rem;
}
```

```tsx
<div className="table-tools">
  <ColumnPicker state={table} />
</div>;
```

A class on the component itself works the same way:

```css
.compact {
  --fb-control-height: 1.75rem;
  --fb-gap: 0.25rem;
}
```

```tsx
<FilterBuilder
  className="compact"
  value={filter}
  onChange={setFilter}
  fields={fields}
/>;
```

### With utility classes

A CSS framework that can set a variable from a class needs no CSS file. This is Tailwind's
syntax for it:

```tsx
<ColumnPicker
  state={table}
  className="[--fb-radius:0] [--fb-focus:var(--color-indigo-500)]"
/>;

{
  /* Or on an element around several components. */
}
<div className="[--fb-control-height:2rem]">
  <FilterBuilder value={filter} onChange={setFilter} fields={fields} />
  <ColumnPicker state={table} />
</div>;
```

### With an inline style

`ColumnPicker` and `FilterBuilder` take `style` beside `className`. Its type knows the
variables, so TypeScript suggests their names and needs no cast.

```tsx
<ColumnPicker
  state={table}
  style={{ "--fb-radius": "0", "--fb-focus": "teal" }}
/>;
```

### The variables

| Variable              | Sets                                                | Default                               |
| --------------------- | --------------------------------------------------- | ------------------------------------- |
| `--fb-page`           | The colour behind the component                     | `--background`, else the page colour  |
| `--fb-border`         | Borders                                             | 22% of the text colour                |
| `--fb-control-bg`     | The background of buttons and boxes                 | 7% of the text colour on `--fb-page`  |
| `--fb-hover-bg`       | The background under the pointer                    | 15% of the text colour on `--fb-page` |
| `--fb-popover-bg`     | The background of an open list                      | `--popover`, else `--fb-page`         |
| `--fb-muted`          | Quieter text, such as counts and handles            | 60% of the text colour                |
| `--fb-focus`          | The focus ring and the drop line                    | `--ring`, else the system highlight   |
| `--fb-shadow`         | The shadow under an open list                       | `rgb(0 0 0 / 0.25)`                   |
| `--fb-and`            | The bar of a group where every condition must pass  | `#3b82f6`                             |
| `--fb-or`             | The bar of a group where one condition is enough    | `#f59e0b`                             |
| `--fb-radius`         | Rounded corners                                     | `0.375rem`                            |
| `--fb-control-height` | The height of buttons and boxes                     | `2.25rem`                             |
| `--fb-gap`            | The space between controls                          | `0.5rem`                              |
| `--fb-value-width`    | The widest a value box grows                        | `12rem`                               |
| `--fb-sticky-top`     | How far below the top a group's "And" or "Or" stays | `0.5rem`                              |

The same names are exported as `FILTER_THEME_VARIABLES` from `@arvilmena/filter-react/ui`.

Three things to know:

- **Colours must be whole colours,** such as `#fff` or `oklch(1 0 0)`. Some themes store only
  the numbers of a colour (`--background: 0 0% 100%`) and wrap them in `hsl()` where they are
  used. With such a theme, set `--fb-page: hsl(var(--background))`, and `--fb-popover-bg` and
  `--fb-focus` the same way from `--popover` and `--ring`.
- **Some defaults follow `--fb-page`.** The control and hover backgrounds mix the text colour
  into it. They are worked out on the component, so set `--fb-page` on the component or
  above it.
- **For anything a variable does not cover,** restyle the `fb-` classes in your own CSS, or
  draw your own component from the hooks.

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

const PAGE_SIZES = [25, 50, 100];

// Outside the component here. Inside it works too: see "Where to build the parts".
const parts = {
  filter: filterStatePart(),
  columns: columnStatePart(columns),
  // A part of your own: a default, and a `parse` that checks the saved value.
  pageSize: {
    defaultValue: 25,
    // Only a size the table offers is taken. Any other saved value gives the default.
    parse: (saved: unknown) => PAGE_SIZES.find((size) => size === saved),
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
| `check`        | Corrects parts that depend on each other, after each was parsed           |
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
  your change. It is saved once the load is done, and only if the table is still mounted
  then. A table unmounted while it loads does not save that change.
- **A failed load or save never breaks the table.** The parts keep working in memory. See
  [When something fails](#when-something-fails).
- **State is saved under the key it was loaded for.** When `name`, `id` or the page's path
  changes, a waiting change is saved under the old key, and the new key's state is loaded.
- **Quick changes are saved together.** A waiting change is also saved when the page is hidden
  or closed, and when the table leaves the screen.
- **A save on unmount is sent, not waited for.** When a loaded table is unmounted, its waiting
  change goes to the store, and nothing waits for the store's answer. An app that moves to
  another page itself should wait for `flush()` first: see
  [Waiting for a save](#waiting-for-a-save).
- **Saves reach the store in order.** Each save or remove waits for the store's answer to the
  one before it, so a slow answer cannot leave an older state in the store.
- **A closing page sends once, without waiting.** It sends the newest state in one request,
  whatever still waits. A save already on its way then may reach the store after that
  request, or not at all, so the store can end with the older state. Wait for `flush()`
  where the app decides when to leave. A page the browser keeps, to show it again on "back",
  is not closing: its saves wait their turn.
- **A closed tab may lose its last change.** A browser does not promise to finish what a
  closing page starts: see [When a tab is closed](#when-a-tab-is-closed).
- **Parts the hook does not own are kept.** A save writes back the other parts found under the
  key. `clear()` removes them too.
- **A saved value is checked before use.** A broken part falls back to its default alone.
- **A part added to `parts` later gets a value at once:** the one saved under its name, or its
  default.

### Where to build the parts

Build the parts outside the component when they need nothing from it. When they do, such as
a column list that comes from props, build them inside it:

```tsx
function Orders({ columns, rows }) {
  const saved = useSavedTableState({
    id: "orders",
    parts: { filter: filterStatePart(), columns: columnStatePart(columns) },
  });
  // …
}
```

That is safe, and needs no `useMemo`:

- A new `parts` object on every render starts no load and no save, and the setters in
  `saved.set` stay the same functions for as long as the part names do.
- The hook uses the newest parts each time it reads a saved value: on a load, on `reload()`
  and for a part added later.
- A value the hook has read already is not parsed again when the parts change. So a column
  list that changes while the table is on screen does not re-fit `saved.values.columns`. The
  column hook does that fitting on every render, so the table is still right.

A parts object typed with an `interface` works like one typed with a `type`.

### Passing the column list once

`columnStatePart(columns)` and `useColumnSettings({ columns })` both take the column list. To
pass it once, call `columnStatePart()` with no list. The part is then `null` until something
is saved, and the column hook fits the saved settings to the list:

```tsx
const parts = { filter: filterStatePart(), columns: columnStatePart() };

function Orders({ columns, rows }) {
  const saved = useSavedTableState({ id: "orders", parts });
  const table = useColumnSettings({
    columns,
    value: saved.values.columns,
    onChange: saved.set.columns,
  });
  // …
}
```

Draw the table from `table.visibleColumns`. `saved.values.columns` is then the settings as
they were saved, or `null`, and may name columns the list no longer has. Keep
`columnStatePart(columns)` when your code reads `saved.values.columns` itself.

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
change. The other parts take the stored state, or their defaults when nothing is saved. `clear()` also turns saving back on, but it deletes the stored state.

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

### When a tab is closed

When a person closes a tab, the hook saves a waiting change at once, as the browser tells the
page that it is going away. The browser may still end the page before that save is kept. No
library can prevent this, because a closing page cannot make the browser wait.

- **Chromium kept every such save** in this library's tests.
- **WebKit, the engine of Safari, lost about one in nine** on a busy machine, in the local
  storage store and in the cookie store alike. A page with no library code lost its own
  writes at the same rate. The tests drive a test build of WebKit, not Safari itself, so
  Safari's own rate is not known.
- **Going to another address lost none,** in every browser tested.

Only a change that the store has not yet kept is at risk. With local storage and cookies,
that is a change still waiting out `saveDelayMs`: by default, one made in the last 300
milliseconds. A store that answers later, such as `fetchStore`, keeps a change only when
its request has been answered, so a change stays at risk until then. To lower the risk:

- **Wait for `flush()` where the app decides when to leave:** before it goes to another page,
  or closes its own window.
- **Keep `saveDelayMs` short.** The shorter the wait, the less often a change is still
  waiting when the tab closes.

The hook also saves when the page is hidden: when the person switches to another tab or
app, or locks a phone. That save starts while the page is still alive. With local storage
and cookies it is kept at once. With a store that answers later, it is kept only if the page
lives until the answer comes.

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

### A rule that spans parts

Each part is parsed by itself. For a rule that needs two parts, pass `check`. It gets every
part's value, and the names of the parts that got their default because nothing usable was
saved for them. It returns the parts to correct, or nothing:

```tsx
// The name a person gave the saved filter.
const filterNamePart = {
  defaultValue: "",
  parse: (saved: unknown) => (typeof saved === "string" ? saved : undefined),
};

const saved = useSavedTableState({
  id: "orders",
  parts: { filter: filterStatePart(), filterName: filterNamePart },
  // A name without its filter means nothing, so it goes when the filter was not usable.
  check: (values, defaulted) =>
    defaulted.includes("filter") ? { filterName: "" } : undefined,
});
```

`check` runs each time a saved value is read: on a load, on `reload()` and on `initialSaved`.
It does not run on the changes a person makes. It is as loose as `parse`: when it throws, the
parsed values are used, and nothing is reported.

### State the app kept elsewhere before

If your app already keeps a table's state under a key of its own, wrap the store in
`carryOverStore`. The old state is then shown when nothing is saved under the new key:

```tsx
import { carryOverStore, localStorageStore } from "@arvilmena/filter-core";

const store = carryOverStore(localStorageStore(), {
  // Each part's old value by the part's name: `{ filter, columns }`. `null` for nothing.
  read: () => JSON.parse(localStorage.getItem("orders-table") ?? "null"),
  // Optional. Leave it out to keep the old entry.
  remove: () => localStorage.removeItem("orders-table"),
});

const saved = useSavedTableState({ id: "orders", parts, store });
```

- The old value is checked like any saved value, part by part. If it has another shape than
  your parts, turn it into `{ filter, columns }` inside `read`.
- Nothing is written until the person changes something. That first save holds every carried
  part, and the old entry is removed after the store has taken it, if you passed `remove`.
- `clear()` removes the old entry too. Without `remove`, it saves an empty state under the
  new key and does not delete it, so that the old state does not come back.
- It works with every store, and `read` and `remove` may answer with a promise. `status`
  stays `"loading"` until both the store and `read` have answered.
- With `initialSaved`, the store is not read for the first key, so the server must read the
  older place itself.

The [filter-core README](https://github.com/ArvilDidThis/filter-builder/tree/main/packages/filter-core#saved-table-state)
describes the key, the saved format, each store and `carryOverStore` in full.

To filter rows, use `createRowPredicate` from `@arvilmena/filter-core`. The full guide is in the
[repository](https://github.com/ArvilDidThis/filter-builder#readme).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables.

## Licence

MIT

# @arvilmena/filter-react

A filter builder for React. It edits filters in the JSON shape of DataTables SearchBuilder, with
groups nested as deep as you like. It also holds a column picker, which lets a person hide a
table's columns and change their order.

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

To filter rows, use `createRowPredicate` from `@arvilmena/filter-core`. The full guide is in the
[repository](https://github.com/ArvilDidThis/filter-builder#readme).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables.

## Licence

MIT

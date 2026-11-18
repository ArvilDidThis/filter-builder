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

The `useColumnSettings` hook keeps the settings. Its result goes to the picker, and gives the
table its columns.

```tsx
import type { ColumnDefinition } from "@arvilmena/filter-core";
import { useColumnSettings } from "@arvilmena/filter-react";
import { ColumnPicker } from "@arvilmena/filter-react/ui";
import "@arvilmena/filter-react/styles.css";

// `as const` keeps the keys exact, so `actions.toggle("pric")` is a type error.
const columns = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "notes", label: "Notes", defaultHidden: true },
] as const satisfies readonly ColumnDefinition[];

function Products({ rows }) {
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

The hook works like a form input. Leave `value` out and it keeps the settings itself, starting
from `defaultValue`. Pass `value` and `onChange` to keep them in your own state. Either way the
settings are plain JSON and are fitted to the column list first, so settings read from storage
are safe to pass in:

```tsx
const table = useColumnSettings({
  columns,
  defaultValue: JSON.parse(localStorage.getItem("product-columns") ?? "null"),
  onChange: (settings) =>
    localStorage.setItem("product-columns", JSON.stringify(settings)),
});
```

The picker's props replace parts of it:

| Prop            | Does                                                                   |
| --------------- | ---------------------------------------------------------------------- |
| `labels`        | Replaces any wording, e.g. `{ trigger: "Edit columns" }`               |
| `align`         | `"end"` lines the list up with the button's right edge                 |
| `renderTrigger` | Draws your own button. Spread the props it is given onto the button    |
| `renderRow`     | Draws the inside of one row from the `checkboxProps` and `handleProps` |
| `className`     | Added to the picker's own class                                        |

The picker reads the `--fb-*` variables from its own class, `.fb-columns`.

## Your own column picker

`useColumnSettings` holds no markup. It returns every column in order, the visible columns, and
the actions that change the settings. The `actions` object never changes, and `visibleColumns`
changes only when its content does, so a memoised table does not redraw for nothing.

```tsx
import { useColumnSettings } from "@arvilmena/filter-react";

function Products({ rows }) {
  const {
    columns: ordered,
    visibleColumns,
    actions,
  } = useColumnSettings({
    columns,
  });
  return (
    <>
      <ul>
        {ordered.map(({ column, visible, hideable }, index) => (
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
            <button onClick={() => actions.move(column.key, index - 1)}>
              Up
            </button>
            <button onClick={() => actions.move(column.key, index + 1)}>
              Down
            </button>
          </li>
        ))}
      </ul>
      <button onClick={actions.showAll}>Show all</button>
      <button onClick={actions.reset}>Reset</button>
      <MyTable columns={visibleColumns} rows={rows} />
    </>
  );
}
```

To filter rows, use `createRowPredicate` from `@arvilmena/filter-core`. The full guide is in the
[repository](https://github.com/ArvilDidThis/filter-builder#readme).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables.

## Licence

MIT

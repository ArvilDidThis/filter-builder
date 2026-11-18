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
settings are plain JSON, so an app can store them. Every function is pure, and returns the same
object when nothing changed. A function that takes both the column list and the settings takes
the column list first.

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
// now: unknown keys go, new columns keep their default place, and nothing throws.
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
| `showAllColumns`          | Shows every column, keeping the order                |
| `resetColumnSettings`     | Puts the defaults back                               |
| `orderedColumns`          | Every column in order, each with whether it is shown |
| `visibleColumns`          | The shown columns in order, as the app's own objects |

For a builder screen and a column picker, see `@arvilmena/filter-react`. The full guide is in the
[repository](https://github.com/ArvilDidThis/filter-builder#readme).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables.

## Licence

MIT

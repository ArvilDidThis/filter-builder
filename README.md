# Filter builder

A headless filter builder: the filter format, the rules that decide whether a row matches, and
the builder UI. It replaces DataTables SearchBuilder and keeps its JSON shape and matching
rules, so filters saved by SearchBuilder keep returning the same rows.

Install the packages from npm:

```sh
npm install @arvilmena/filter-core @arvilmena/filter-react
```

The rules for working here are in [AGENTS.md](AGENTS.md).

## Packages

| Package                   | Holds                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `@arvilmena/filter-core`  | Filter types, matching rules, transforms, the summary, column settings |
| `…/filter-core/schema`    | Validation with Effect Schema. The only entry point that loads Effect. |
| `@arvilmena/filter-react` | Builder and column state as React hooks, with no markup or styling     |
| `…/filter-react/ui`       | Ready-made builder and column picker, with their default style sheet   |

## Commands

Use Node.js 26 or later and pnpm 12.

```sh
pnpm install
pnpm verify   # lint, type checks, tests, build, the entry-point check and script tests
pnpm test
pnpm lint:fix
```

## Automated checks

| Workflow                 | What it does                                                             |
| ------------------------ | ------------------------------------------------------------------------ |
| `ci.yml`                 | Runs `pnpm verify` on every pull request and on pushes to `main`         |
| `claude-code-review.yml` | Reviews each pull request against AGENTS.md and tracks findings          |
| `claude.yml`             | Answers `@claude` mentions in issues and pull requests                   |
| `zizmor.yml`             | Audits the workflows themselves for security problems                    |
| `dependency-audit.yml`   | Scans `pnpm-lock.yaml` for known vulnerable or malicious packages, daily |
| `release.yml`            | Publishes both packages to npm when a version tag is pushed              |

## Data types

Each condition names the type of its field, which decides how values compare. These are
SearchBuilder's types, with its rules.

| Type                               | Compares                                              |
| ---------------------------------- | ----------------------------------------------------- |
| `num`                              | Plain numbers                                         |
| `num-fmt`                          | Formatted numbers, such as "$86,000" or "45%"         |
| `string`                           | Text                                                  |
| `date`                             | Dates written year first, such as "2011-04-25"        |
| `array`                            | Lists of text, such as tags                           |
| `html`, `html-num`, `html-num-fmt` | As `string`, `num` and `num-fmt`, after removing tags |

SearchBuilder's `moment` and `luxon` date types are not supported, because they need those
libraries.

## Example

```ts
import {
  createRowPredicate,
  describeFilter,
  type FilterDefinition,
  summaryToText,
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
summaryToText(
  describeFilter(filter, [{ key: "ratio", label: "Ratio", type: "num" }]),
);
// "Ratio 10 or more"
```

## The builder

`@arvilmena/filter-react/ui` holds a ready-made builder. It uses plain HTML controls, and takes
its colours from the `--fb-*` variables in the stylesheet.

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

To draw your own builder, use the `useFilterBuilder` hook from `@arvilmena/filter-react`. It
holds no markup. It returns the rows to draw and the actions that change the filter.

```tsx
import { useFilterBuilder } from "@arvilmena/filter-react";

const builder = useFilterBuilder({
  value: filter,
  onChange: setFilter,
  fields,
});
// builder.root.rows: the conditions and groups, in order.
// builder.actions: addCondition, remove, move and the rest.
```

## The column picker

A table with many columns needs a way to hide columns and change their order. The
`useColumnSettings` hook keeps those settings, and `ColumnPicker` is a ready-made button that
opens the list of columns.

```tsx
import type { ColumnDefinition } from "@arvilmena/filter-core";
import { useColumnSettings } from "@arvilmena/filter-react";
import { ColumnPicker } from "@arvilmena/filter-react/ui";
import "@arvilmena/filter-react/styles.css";

const columns = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "notes", label: "Notes", defaultHidden: true },
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
              <th key={column.key}>{column.label}</th>
            ))}
          </tr>
        </thead>
      </table>
    </>
  );
}
```

The picker works with a mouse, with touch and with a keyboard. To draw your own picker, use the
hook alone: it returns every column in order, the visible columns and the actions. The
[filter-react README](packages/filter-react/README.md) shows both, and the
[filter-core README](packages/filter-core/README.md) lists the pure functions underneath.

## Saved table state

The `useSavedTableState` hook remembers a table's filter, its column settings and any part an
app adds. It saves to the browser's local storage by default, and can save to a cookie, to the
app's own server or to a store the app writes.

```tsx
import { columnStatePart, filterStatePart } from "@arvilmena/filter-core";
import { useColumnSettings, useSavedTableState } from "@arvilmena/filter-react";
import { ColumnPicker, FilterBuilder } from "@arvilmena/filter-react/ui";

const parts = {
  filter: filterStatePart(),
  columns: columnStatePart(columns),
};

function Orders({ rows }) {
  const saved = useSavedTableState({ id: "orders", parts });
  const table = useColumnSettings({
    columns,
    value: saved.values.columns,
    onChange: saved.set.columns,
  });
  return (
    <>
      <FilterBuilder
        value={saved.values.filter}
        onChange={saved.set.filter}
        fields={fields}
      />
      <ColumnPicker state={table} />
      <MyTable columns={table.visibleColumns} rows={rows} />
    </>
  );
}
```

The [filter-react README](packages/filter-react/README.md#saving-a-tables-state) lists the
hook's options and guarantees. The
[filter-core README](packages/filter-core/README.md#saved-table-state) describes the key, the
saved format and the stores, which need no React.

## Licence

[MIT](LICENSE).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables. One test file
holds SearchBuilder's own matching tests, used under its MIT licence.

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
pnpm verify         # lint, type checks, tests, build, the entry-point check and script tests
pnpm test
pnpm lint:fix
pnpm test:browser   # the tests that need a real browser: see "Browser tests" below
pnpm test:react18   # the tests of filter-react again, against React 18
```

## Automated checks

| Workflow                 | What it does                                                             |
| ------------------------ | ------------------------------------------------------------------------ |
| `ci.yml`                 | Runs `pnpm verify` on every pull request and on pushes to `main`         |
| `browser-tests.yml`      | Runs the browser tests and the React 18 tests on the same events         |
| `claude-code-review.yml` | Reviews each pull request against AGENTS.md and tracks findings          |
| `claude.yml`             | Answers `@claude` mentions in issues and pull requests                   |
| `zizmor.yml`             | Audits the workflows themselves for security problems                    |
| `dependency-audit.yml`   | Scans `pnpm-lock.yaml` for known vulnerable or malicious packages, daily |
| `release.yml`            | Publishes both packages to npm when a version tag is pushed              |

## Browser tests

`pnpm verify` runs its tests in a simulated page, which has no layout, no real pointer and no
real shadow tree. A second suite runs the column picker and saved table state in Chromium,
Firefox and WebKit, with real mouse, touch and key input. It lives in
`packages/filter-react/browser` and is not part of `pnpm verify`.

Install the browsers once, and again after the `playwright` package changes version:

```sh
pnpm --filter @arvilmena/filter-react exec playwright install chromium firefox webkit
```

On Linux, add `--with-deps` to install the system libraries the browsers need.

Then run the suite. It needs no build first:

```sh
pnpm test:browser
pnpm --filter @arvilmena/filter-react run test:browser --project firefox   # one browser
```

A failed test leaves a screenshot of the page in `packages/filter-react/.vitest`. In CI, the
failed run offers that folder for download as `browser-test-failures`.

### Screenshots

Two tests compare the open picker, on a light page and on a dark page, with stored
screenshots. Text is drawn differently on each system, so each system has its own stored
screenshots, in `packages/filter-react/browser/__screenshots__/<system>/<browser>/`.

- **Linux** screenshots are the ones CI compares. Only they are kept in the repository.
- **Other systems:** your own screenshots stay on your machine, and git ignores them. Where
  none is stored, the test compares nothing, says so, and passes.

To check a change to the look on your own machine:

1. Before the change, store screenshots: `pnpm test:browser:update`.
2. Make the change.
3. Run `pnpm test:browser`. A difference fails the test and is saved under `.vitest`.

To update the Linux screenshots after a change to the look that you intend:

1. Push the branch.
2. On GitHub, open **Actions**, choose **Browser tests**, and press **Run workflow**. Pick the
   branch and tick **update-screenshots**.
3. Download `linux-screenshots` from the finished run, and unpack it into
   `packages/filter-react/browser/__screenshots__/linux/`.
4. Look at each picture, then commit them.

### React 18

`@arvilmena/filter-react` supports React from version 18, and its own tests run against the
newest React. `pnpm test:react18` runs the same tests against React 18. The package in
`tests/react-18` holds that copy of React. It is private and never published.

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
import {
  columnStatePart,
  createRowPredicate,
  filterStatePart,
} from "@arvilmena/filter-core";
import { useColumnSettings, useSavedTableState } from "@arvilmena/filter-react";
import { ColumnPicker, FilterBuilder } from "@arvilmena/filter-react/ui";
import { useMemo } from "react";

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
  // The rows the saved filter lets through. `valueOf` reads a row's value, as shown above.
  const shown = useMemo(
    () => rows.filter(createRowPredicate(saved.values.filter, valueOf)),
    [rows, saved.values.filter],
  );
  return (
    <>
      <FilterBuilder
        value={saved.values.filter}
        onChange={saved.set.filter}
        fields={fields}
      />
      <ColumnPicker state={table} />
      <MyTable columns={table.visibleColumns} rows={shown} />
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

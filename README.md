# Filter builder

A headless filter builder: the filter format, the rules that decide whether a row matches, and
the builder UI. It replaces DataTables SearchBuilder and keeps its JSON shape and matching
rules, so filters saved by SearchBuilder keep returning the same rows.

The packages are not published yet.

The rules for working here are in [AGENTS.md](AGENTS.md).

## Packages

| Package                   | Holds                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `@arvilmena/filter-core`  | Filter types, matching rules, transforms, the plain-English summary    |
| `…/filter-core/schema`    | Validation with Effect Schema. The only entry point that loads Effect. |
| `@arvilmena/filter-react` | Builder state and actions as a React hook, with no markup or styling   |
| `…/filter-react/ui`       | Ready-made builder components, with their own default style sheet      |

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
  summaryToText,
} from "@arvilmena/filter-core";

const filter = {
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
import { useState } from "react";
import { FilterBuilder } from "@arvilmena/filter-react/ui";
import "@arvilmena/filter-react/styles.css";

const fields = [
  { key: "ratio", label: "Ratio", type: "num" },
  { key: "name", label: "Name", type: "string" },
];

function Filters() {
  const [filter, setFilter] = useState({ logic: "AND", criteria: [] });
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

## Licence

[MIT](LICENSE).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables. One test file
holds SearchBuilder's own matching tests, used under its MIT licence.

# @arvilmena/filter-core

The filter format and the rules that decide whether a row matches a filter. It keeps the JSON
shape and matching rules of DataTables SearchBuilder, so a filter saved by SearchBuilder keeps
returning the same rows. It has no dependencies and runs anywhere JavaScript runs.

```sh
npm install @arvilmena/filter-core
```

```ts
import { createRowPredicate } from "@arvilmena/filter-core";

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
```

The `@arvilmena/filter-core/schema` entry validates a filter with Effect Schema. It is the only
entry that needs `effect`, which is an optional peer dependency.

For a builder screen, see `@arvilmena/filter-react`. The full guide is in the
[repository](https://github.com/ArvilDidThis/filter-builder#readme).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables.

## Licence

MIT

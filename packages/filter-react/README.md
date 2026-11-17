# @arvilmena/filter-react

A filter builder for React. It edits filters in the JSON shape of DataTables SearchBuilder, with
groups nested as deep as you like.

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

To filter rows, use `createRowPredicate` from `@arvilmena/filter-core`. The full guide is in the
[repository](https://github.com/ArvilDidThis/filter-builder#readme).

This project is not affiliated with or endorsed by SpryMedia Ltd or DataTables.

## Licence

MIT

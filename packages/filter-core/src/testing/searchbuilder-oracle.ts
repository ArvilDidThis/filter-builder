/**
 * Asks the real DataTables SearchBuilder whether a row passes a filter.
 *
 * Tests use it as an oracle (a trusted source of the right answer): they run the same filter and
 * row through SearchBuilder's own code and through this library, and fail on any difference.
 *
 * SearchBuilder normally needs a table on a web page. This file avoids that by building its
 * `Criteria` and `Group` objects directly and filling in only the fields their `search` methods
 * read. The comparison code that runs is SearchBuilder's own, unchanged.
 *
 * One thing is NOT taken from SearchBuilder: whether a condition counts as filled in. It works
 * that out from its input boxes on the page, which do not exist here, so the caller passes it.
 */
import DataTable from "datatables.net";
import "datatables.net-searchbuilder";
import type { FilterValue, MatchOptions } from "../evaluate";
import type {
  ConditionType,
  Criterion,
  FilterDefinition,
  LeafCondition,
} from "../types";
import { isFilterGroup } from "../types";

/** One of SearchBuilder's condition sets: operator name to its definition. */
type ConditionSet = Record<string, { search: (...args: never[]) => boolean }>;

/** The parts of a SearchBuilder `Criteria` or `Group` that this file touches. */
interface UpstreamNode {
  s: Record<string, unknown>;
  c?: Record<string, unknown>;
  search(rowData: readonly unknown[], rowIndex: number): boolean | undefined;
}

interface UpstreamClass {
  prototype: object;
}

// SearchBuilder attaches its classes to DataTable when it loads; its types do not list them.
const upstream = DataTable as unknown as {
  Criteria: UpstreamClass & Record<string, ConditionSet>;
  Group: UpstreamClass;
};

/** The same pairing of type and condition set as SearchBuilder's defaults. */
const CONDITIONS_BY_TYPE: Record<ConditionType, ConditionSet> = {
  array: upstream.Criteria.arrayConditions as ConditionSet,
  date: upstream.Criteria.dateConditions as ConditionSet,
  html: upstream.Criteria.stringConditions as ConditionSet,
  "html-num": upstream.Criteria.numConditions as ConditionSet,
  "html-num-fmt": upstream.Criteria.numFmtConditions as ConditionSet,
  num: upstream.Criteria.numConditions as ConditionSet,
  "num-fmt": upstream.Criteria.numFmtConditions as ConditionSet,
  string: upstream.Criteria.stringConditions as ConditionSet,
};

/** The operators SearchBuilder itself offers for a type. */
export function upstreamOperatorsFor(type: ConditionType): string[] {
  return Object.keys(CONDITIONS_BY_TYPE[type]);
}

/** A stand-in for the DataTables table object, holding only the number-format settings. */
function fakeTable(options: MatchOptions) {
  const language = {
    decimal: options.decimal ?? "",
    thousands: options.thousands ?? "",
  };
  return {
    settings: () => [{ language }],
    // DataTables returns the fallback only when the setting is missing altogether.
    i18n: (token: string, fallback: string) =>
      token === "decimal" ? language.decimal : fallback,
  };
}

/** Decides whether a condition is filled in. See the note at the top of this file. */
export type IsFilled = (condition: LeafCondition) => boolean;

/**
 * Builds SearchBuilder's own objects for a filter. Each condition is given a column number, and
 * `columns` records which field that column holds.
 */
function buildNode(
  criterion: Criterion | FilterDefinition,
  columns: string[],
  isFilled: IsFilled,
  options: MatchOptions,
): UpstreamNode {
  if (isFilterGroup(criterion as Criterion)) {
    const group = Object.create(upstream.Group.prototype) as UpstreamNode;
    const { criteria, logic } = criterion as FilterDefinition;
    group.s = {
      logic,
      criteria: criteria.map((child) => ({
        criteria: buildNode(child, columns, isFilled, options),
      })),
    };
    return group;
  }

  const leaf = criterion as LeafCondition;
  const node = Object.create(upstream.Criteria.prototype) as UpstreamNode;
  columns.push(leaf.origData);
  node.s = {
    dt: fakeTable(options),
    conditions: CONDITIONS_BY_TYPE[leaf.type],
    condition: leaf.condition,
    dataIdx: columns.length - 1,
    type: leaf.type,
    // A copy: SearchBuilder sorts this list in place for some list conditions.
    value: [...leaf.value],
    filled: isFilled(leaf),
  };
  // "filter" means: use the row data as given, which is the default.
  node.c = { orthogonal: { search: "filter" } };
  return node;
}

/**
 * Whether the real SearchBuilder lets this row through the filter.
 *
 * @param readValue - Reads a field's value from the row, as `FilterValueOf` does.
 */
export function upstreamMatches<Row>(
  filter: FilterDefinition,
  row: Row,
  readValue: (row: Row, key: string) => FilterValue,
  isFilled: IsFilled,
  options: MatchOptions = {},
): boolean {
  const columns: string[] = [];
  const top = buildNode(filter, columns, isFilled, options);
  const rowData = columns.map((key) => {
    const value = readValue(row, key);
    // A copy: SearchBuilder sorts a list value in place.
    return Array.isArray(value) ? [...value] : value;
  });
  // SearchBuilder returns nothing at all (`undefined`) for an operator its type does not have,
  // and treats that as "does not pass".
  return Boolean(top.search(rowData, 0));
}

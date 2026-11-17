/**
 * Decides whether one row passes a filter, with the SAME rules DataTables SearchBuilder uses — so a
 * filter built in SearchBuilder returns the same rows here.
 *
 * These rules differ from what a stricter evaluator would do, in ways that change which rows
 * match. They are reproduced as SearchBuilder itself writes them
 * (`datatables.net-searchbuilder/js/dataTables.searchBuilder.js`):
 *
 * 1. Every value is compared as TEXT. DataTables keeps each cell's filter value as a string, and a
 *    blank becomes `''`. A number condition then reads it back with `+value`, so a blank number
 *    compares as 0 — a row with no score passes "score below 20".
 * 2. A condition that is not filled in (no condition, or an empty value box) is SKIPPED, not
 *    failed. An AND group ignores it; an OR group counts only filled conditions, and a group with
 *    none filled matches everything.
 * 3. "Equals" on text is case-sensitive; "contains", "starts" and "ends" are not.
 * 4. "Between" accepts its two bounds in either order.
 * 5. Each data type has its own set of conditions (see `ConditionType`). A formatted number
 *    ("$86,000") loses everything but its digits, decimal point and leading minus sign. A date is
 *    compared as text, year first. A list is compared item by item, ignoring order.
 *
 * Do not change these rules casually: saved filters would start returning different rows.
 *
 * Plain functions on purpose — overrides "use Effect": this runs for every row on every keystroke
 * (about 1,500 rows × each condition), cannot fail and does no input or output, so wrapping each
 * call in an Effect would add runtime cost for no gain.
 */

import type {
  ConditionOperator,
  ConditionType,
  Criterion,
  FilterDefinition,
  LeafCondition,
} from "./types";
import { isCriterionObject, isFilterGroup } from "./types";

/**
 * What a field of a row holds, ready to filter on: text, or a list of text for an `array` field.
 * A blank is `""`, `null` or `undefined`.
 */
export type FilterValue = string | readonly string[] | null | undefined;

/**
 * Turns a row into the value to filter a field on. The caller supplies it because only the app
 * knows how a field is stored and shown — for example a true/false field filtered as "Yes"/"No".
 * `key` is the condition's `origData`. Return `""` for a blank value, and a list for an `array`
 * field.
 */
export type FilterValueOf<Row> = (row: Row, key: string) => FilterValue;

/**
 * Options for matching. Set these only when the rows write numbers in another way than
 * "1,234.5". They are the same two settings as DataTables' `language.decimal` and
 * `language.thousands`.
 */
export interface MatchOptions {
  /**
   * The decimal mark in the rows' numbers, such as "," for "1234,5". Defaults to ".".
   *
   * This follows SearchBuilder step for step, including one oddity: a formatted number
   * (`num-fmt`) in a row is converted twice, so "1.234,5" reads as 1.2345. Plain numbers
   * (`num`) are read correctly.
   */
  decimal?: string;
  /** The thousands separator in the rows' numbers, such as "." for "1.234,5". */
  thousands?: string;
}

/** `MatchOptions` with every setting filled in. An empty text means "the default". */
interface NumberFormat {
  decimal: string;
  thousands: string;
}

function numberFormatOf(options: MatchOptions): NumberFormat {
  return {
    decimal: options.decimal ?? "",
    thousands: options.thousands ?? "",
  };
}

/** How many filled values each operator needs before SearchBuilder applies it. */
export const VALUES_NEEDED: Record<ConditionOperator, number> = {
  "=": 1,
  "!=": 1,
  "<": 1,
  "<=": 1,
  ">": 1,
  ">=": 1,
  between: 2,
  "!between": 2,
  contains: 1,
  "!contains": 1,
  starts: 1,
  "!starts": 1,
  ends: 1,
  "!ends": 1,
  null: 0,
  "!null": 0,
  without: 1,
};

/** Whether SearchBuilder would apply this condition, or skip it as not yet filled in. */
export function isConditionFilled(condition: LeafCondition): boolean {
  // Read loosely: a stored filter holds whatever was written. A slot that is not an object, or a
  // property that is not text, cannot be compared against a row — count it as an empty box, which
  // the rules already skip, rather than letting it reach the comparison and stop the run.
  if (!isCriterionObject(condition)) return false;
  if (typeof condition.origData !== "string" || condition.origData.length === 0)
    return false;
  // `Object.hasOwn`, not `in`: a name every object carries ("toString") is not an operator, and
  // counting it as one is what let such a condition through as filled.
  if (!Object.hasOwn(VALUES_NEEDED, condition.condition)) {
    return false;
  }
  const needed = VALUES_NEEDED[condition.condition];
  // The value boxes must really be a list. Text has a `slice` of its own, so reading a stored `"20"`
  // as a list of boxes got part-way and then stopped the run; no boxes at all is simply unfilled.
  const values = condition.value;
  if (!Array.isArray(values) || values.length < needed) return false;
  // "Equals" on a list compares every value given, not only the first. One that is not text
  // cannot be compared, so the whole condition counts as an empty box.
  if (
    condition.type === "array" &&
    (condition.condition === "=" || condition.condition === "!=") &&
    !values.every((v) => typeof v === "string")
  ) {
    return false;
  }
  // SearchBuilder only checks for an empty box; a box holding a space still counts as filled.
  return values
    .slice(0, needed)
    .every((v) => typeof v === "string" && v.length > 0);
}

/** Whether a group holds at least one filled condition, however deeply nested. */
function isGroupFilled(criteria: readonly Criterion[]): boolean {
  return criteria.some((c) =>
    isFilterGroup(c) ? isGroupFilled(c.criteria) : isConditionFilled(c),
  );
}

/**
 * Whether the filter has anything to apply at all, at any depth.
 *
 * A filter with nothing filled in matches EVERY row by these rules (rule 2 above: nothing filled
 * means nothing is narrowed). That is right for showing a list, and wrong for a rule that acts on
 * each match — it would act on every row — so a caller acting on the result needs to ask this first. Nesting matters: a filter
 * holding one empty group still has nothing to apply.
 */
export function filterHasFilledCondition(
  filter: FilterDefinition | null | undefined,
): boolean {
  const criteria = filter?.criteria;
  return Array.isArray(criteria) && isGroupFilled(criteria);
}

/** SearchBuilder has five sets of conditions. Each data type uses one of them. */
type ConditionFamily = "num" | "num-fmt" | "string" | "date" | "array";

const FAMILY_BY_TYPE: Record<ConditionType, ConditionFamily> = {
  num: "num",
  "html-num": "num",
  "num-fmt": "num-fmt",
  "html-num-fmt": "num-fmt",
  string: "string",
  html: "string",
  date: "date",
  array: "array",
};

/** A stored type this library does not know compares as text, as it always has. */
function familyOf(type: unknown): ConditionFamily {
  return typeof type === "string" && Object.hasOwn(FAMILY_BY_TYPE, type)
    ? FAMILY_BY_TYPE[type as ConditionType]
    : "string";
}

const LINE_BREAKS = /[\r\n\u2028]/g;
const HTML_TAGS = /(<([^>]+)>)/gi;
const DATE_SEPARATORS = /(\/|-|,)/g;
// Everything that is not a digit or a decimal point, except a minus sign at the very start.
const NOT_PART_OF_A_NUMBER = /(?!^-)[^0-9.]/g;

/**
 * Gets a row's value ready to compare, in the same steps as SearchBuilder's `Criteria.search`.
 * A list comes back as a sorted list; everything else comes back as text.
 */
function prepareValue(
  raw: FilterValue,
  family: ConditionFamily,
  stripsHtml: boolean,
  format: NumberFormat,
): string | readonly unknown[] {
  let value: unknown = raw;

  // A table that writes numbers its own way ("1.234,5") is first rewritten with "." for the
  // decimal point, so that the number comparisons below can read it.
  if (
    typeof value === "string" &&
    (family === "num" || family === "num-fmt") &&
    (format.decimal !== "" || format.thousands !== "")
  ) {
    let parts = [value];
    if (format.decimal !== "") parts = value.split(format.decimal);
    if (format.thousands !== "") {
      // Only the first separator of each part is swapped: SearchBuilder does the same.
      parts = parts.map((part) => part.replace(format.thousands, ","));
    }
    value = parts.join(".");
  }

  if (family === "array") {
    // A single value counts as a list of one. Sort a copy: the row's own list must not change.
    return Array.isArray(value) ? [...value].sort() : [value];
  }

  if (typeof value === "string") {
    value = value.replace(LINE_BREAKS, " ");
    if (stripsHtml) value = (value as string).replace(HTML_TAGS, "");
    return value as string;
  }
  // A blank is empty text. Anything else that is not text (a number, a list on a text field) is
  // read as text too, so that a careless `filterValueOf` cannot stop the run.
  return value === null || value === undefined ? "" : String(value);
}

/** Reads a formatted number such as "$86,000" the way SearchBuilder's `parseNumber` does. */
function parseFormattedNumber(text: string, decimal: string): number {
  let cleaned = text;
  if (decimal !== "" && decimal !== ".") {
    cleaned = cleaned.replace(/\./g, "").replace(decimal, ".");
  }
  return +cleaned.replace(NOT_PART_OF_A_NUMBER, "");
}

/** The number conditions, shared by plain and formatted numbers once both sides are numbers. */
function compareNumbers(
  n: number,
  operator: ConditionOperator,
  a: number,
  b: number,
): boolean {
  switch (operator) {
    case "=":
      return n === a;
    case "!=":
      return n !== a;
    case "<":
      return n < a;
    case "<=":
      return n <= a;
    case ">":
      return n > a;
    case ">=":
      return n >= a;
    case "between":
    case "!between": {
      const [low, high] = a < b ? [a, b] : [b, a];
      const inside = low <= n && n <= high;
      return operator === "between" ? inside : !inside;
    }
    default:
      // A text-only condition on a number column: SearchBuilder offers none, so nothing matches.
      return false;
  }
}

/** The date conditions. Dates are written year first, so comparing them as text orders them. */
function compareDates(
  value: string,
  operator: ConditionOperator,
  first: string,
  second: string,
): boolean {
  // Only the row's value is rewritten with "-". The filter's own values are compared as stored,
  // which is how SearchBuilder does it: its date picker always writes "-".
  const date = value.replace(DATE_SEPARATORS, "-");
  switch (operator) {
    case "=":
      return date === first;
    case "!=":
      return date !== first;
    case "<":
      return date < first;
    case ">":
      return date > first;
    // SearchBuilder offers no "<=" or ">=" for dates. They are accepted here so that inverting
    // "<" or ">" (see `invertFilter`) gives a condition that still works.
    case "<=":
      return date <= first;
    case ">=":
      return date >= first;
    case "between":
    case "!between": {
      const [low, high] = first < second ? [first, second] : [second, first];
      const inside = low <= date && date <= high;
      return operator === "between" ? inside : !inside;
    }
    default:
      return false;
  }
}

/** The text conditions. */
function compareText(
  value: string,
  operator: ConditionOperator,
  first: string,
): boolean {
  const lower = value.toLowerCase();
  const target = first.toLowerCase();
  switch (operator) {
    case "=":
      return value === first;
    case "!=":
      return value !== first;
    case "contains":
      return lower.includes(target);
    case "!contains":
      return !lower.includes(target);
    case "starts":
      return lower.startsWith(target);
    case "!starts":
      return !lower.startsWith(target);
    case "ends":
      return lower.endsWith(target);
    case "!ends":
      return !lower.endsWith(target);
    default:
      // A number-only condition on a text column: SearchBuilder offers none, so nothing matches.
      return false;
  }
}

/** The list conditions. `values` is already sorted. */
function compareLists(
  values: readonly unknown[],
  operator: ConditionOperator,
  wanted: readonly string[],
): boolean {
  switch (operator) {
    case "contains":
      return values.includes(wanted[0]);
    case "without":
      return !values.includes(wanted[0]);
    case "=":
    case "!=": {
      // Equal means the same items in any order, so both sides are compared sorted.
      const sorted = [...wanted].sort();
      const same =
        values.length === sorted.length &&
        values.every((item, index) => item === sorted[index]);
      return operator === "=" ? same : !same;
    }
    default:
      return false;
  }
}

/** One condition, compared exactly as SearchBuilder compares it. */
function compare(
  raw: FilterValue,
  operator: ConditionOperator,
  wanted: readonly string[],
  family: ConditionFamily,
  stripsHtml: boolean,
  format: NumberFormat,
): boolean {
  const value = prepareValue(raw, family, stripsHtml, format);

  // "Empty" and "Not empty" are the same for every type: no text, or no items in the list.
  if (operator === "null") return value.length === 0;
  if (operator === "!null") return value.length !== 0;

  if (typeof value !== "string") return compareLists(value, operator, wanted);

  const first = wanted[0] ?? "";
  // Only "between" uses the second box, and for it `isConditionFilled` has checked that the box
  // holds text. For the rest it is ignored, so whatever a stored filter holds there is not read.
  const second = typeof wanted[1] === "string" ? wanted[1] : "";
  switch (family) {
    case "num":
      // `+''` is 0: this is the rule that makes a blank number compare as zero.
      return compareNumbers(+value, operator, +first, +second);
    case "num-fmt": {
      const decimal = format.decimal === "" ? "." : format.decimal;
      return compareNumbers(
        parseFormattedNumber(value, decimal),
        operator,
        parseFormattedNumber(first, decimal),
        parseFormattedNumber(second, decimal),
      );
    }
    case "date":
      return compareDates(value, operator, first, second);
    default:
      return compareText(value, operator, first);
  }
}

/** Asks one row whether it passes a part of a filter that has already been read. */
type RowTest<Row> = (row: Row, filterValueOf: FilterValueOf<Row>) => boolean;

const passesAlways = (): boolean => true;

/**
 * Reads one filled condition once, so that nothing about the condition itself is worked out
 * again for each row: its set of conditions, and whether its values hold HTML tags.
 */
function readCondition<Row>(
  condition: LeafCondition,
  format: NumberFormat,
): RowTest<Row> {
  const { origData, condition: operator, type } = condition;
  // A copy: the test must keep its answers when the filter's own list is edited later.
  const wanted = [...condition.value];
  const family = familyOf(type);
  const stripsHtml = typeof type === "string" && type.includes("html");
  return (row, filterValueOf) =>
    compare(
      filterValueOf(row, origData),
      operator,
      wanted,
      family,
      stripsHtml,
      format,
    );
}

/**
 * Reads a group once and returns the test to run on each row. Which conditions are filled in,
 * and so which ones count, depends only on the filter, so it is decided here and not per row.
 */
function readGroup<Row>(
  criteria: readonly Criterion[],
  logic: "AND" | "OR",
  format: NumberFormat,
): RowTest<Row> {
  // A stored filter whose conditions are not a list narrows nothing, the same as holding none of
  // them. Reading it as a list instead stopped the run outright.
  if (!Array.isArray(criteria) || criteria.length === 0) return passesAlways;
  // A group joined by anything other than AND or OR narrows nothing: SearchBuilder lets every
  // row through such a group, so a filter stored with a broken `logic` does the same here.
  if (logic !== "AND" && logic !== "OR") return passesAlways;

  const read = (c: Criterion): RowTest<Row> =>
    isFilterGroup(c)
      ? readGroup(c.criteria, c.logic, format)
      : readCondition(c, format);

  if (logic === "AND") {
    // A condition not yet filled in is skipped; a nested group is always asked.
    const tests = criteria
      .filter((c) => isFilterGroup(c) || isConditionFilled(c))
      .map(read);
    return (row, filterValueOf) =>
      tests.every((test) => test(row, filterValueOf));
  }

  // OR: only filled conditions and groups holding one count. With none filled, everything passes.
  const tests = criteria
    .filter((c) =>
      isFilterGroup(c) ? isGroupFilled(c.criteria) : isConditionFilled(c),
    )
    .map(read);
  if (tests.length === 0) return passesAlways;
  return (row, filterValueOf) => tests.some((test) => test(row, filterValueOf));
}

/**
 * Whether one row passes the filter, by SearchBuilder's rules (see the top of this file).
 *
 * This reads the filter again on every call. To test many rows against one filter, build the
 * test once with `createRowPredicate`.
 */
export function matchesFilter<Row>(
  filter: FilterDefinition,
  row: Row,
  filterValueOf: FilterValueOf<Row>,
  options: MatchOptions = {},
): boolean {
  return readGroup<Row>(
    filter.criteria,
    filter.logic,
    numberFormatOf(options),
  )(row, filterValueOf);
}

/**
 * Builds a "does this row pass?" function for one filter, ready for `rows.filter(...)`.
 *
 * The filter is read once, when this is called. If the filter is edited afterwards, build the
 * function again: the old one keeps testing the filter as it was.
 *
 * @example
 * const visibleRows = rows.filter(createRowPredicate(filter, valueOf));
 */
export function createRowPredicate<Row>(
  filter: FilterDefinition,
  filterValueOf: FilterValueOf<Row>,
  options: MatchOptions = {},
): (row: Row) => boolean {
  const test = readGroup<Row>(
    filter.criteria,
    filter.logic,
    numberFormatOf(options),
  );
  return (row) => test(row, filterValueOf);
}

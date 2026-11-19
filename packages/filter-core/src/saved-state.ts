// What a table remembers between visits: its filter, its column settings and anything else an
// app adds. This file holds the name the state is saved under, the saved format, and the loose
// reading of a saved value. Where the value is kept is in state-stores.ts.
//
// A saved value is untrusted input: a person can edit it, and an older version of the app may
// have written it. Nothing here throws on a broken value.

import {
  type ColumnDefinition,
  type ColumnSettings,
  defaultColumnSettings,
  reconcileColumnSettings,
} from "./columns";
import type { FilterDefinition } from "./types";

/** The version a saved state gets when the app names none. */
export const DEFAULT_STATE_VERSION = 1;

/**
 * How many groups deep a saved filter may be nested, counting the top group. No filter a person
 * builds comes near it. A deeper one was written to break the page: matching walks a filter
 * group by group, and runs out of room at a depth of some thousands.
 */
export const MAX_SAVED_FILTER_DEPTH = 200;

/** What `resolveStateKey` chooses a key from. */
export interface StateKeyOptions {
  /**
   * A name the app chooses. Use it when the same table appears on several pages, or when
   * several tables share an id.
   */
  name?: string;
  /** The table's id. */
  id?: string;
  /**
   * The page's address: `window.location`, a `URL`, or text such as "/orders?page=2". Leave out
   * to use the address of the page the code runs on.
   */
  location?: string | { readonly pathname: string };
}

/**
 * The key a table's state is saved under. The first of these that is given wins:
 *
 * 1. `name`, as it is.
 * 2. `id`, as it is.
 * 3. The path of the page: the address without its origin ("https://example.com"), its query
 *    string ("?page=2") and its hash ("#top"). Nothing else is changed, so "/orders" and
 *    "/orders/" are two keys.
 *
 * An empty `name` or `id` counts as not given. The result is `undefined` when nothing is given
 * and there is no page, as on a server.
 */
export function resolveStateKey(
  options: StateKeyOptions = {},
): string | undefined {
  if (isFilledText(options.name)) return options.name;
  if (isFilledText(options.id)) return options.id;
  const location =
    options.location ?? (globalThis as { location?: unknown }).location;
  if (typeof location === "string") return pathOfAddress(location);
  const pathname = (location as { pathname?: unknown } | null | undefined)
    ?.pathname;
  return isFilledText(pathname) ? pathname : undefined;
}

function isFilledText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** The origin at the start of an address, such as "https://example.com" or "//example.com". */
const ORIGIN_PATTERN = /^(?:[a-z][a-z0-9+.-]*:)?\/\/[^/?#]*/i;

/** The path of an address written as text. */
function pathOfAddress(address: string): string | undefined {
  const withoutOrigin = address.replace(ORIGIN_PATTERN, "");
  const path = withoutOrigin.split(/[?#]/, 1)[0] ?? "";
  if (path.length > 0) return path;
  // An address that is only an origin points at the top page.
  return withoutOrigin.length < address.length ? "/" : undefined;
}

/** The saved format: plain JSON with a version number and one entry per named part. */
export interface SavedState {
  /** The version of the app's state format that wrote this value. */
  version: number;
  /** Each part's value, by the part's name. */
  parts: Record<string, unknown>;
}

/** One named part of a table's state, such as its filter or its sort. */
export interface StatePart<Value> {
  /** The value to use when nothing usable is saved. */
  defaultValue: Value;
  /**
   * Turns the saved value into one that is safe to use. The saved value may be anything, so
   * check it here. Return `undefined`, or throw, to use `defaultValue`.
   */
  parse: (saved: unknown) => Value | undefined;
}

/** The parts of a table's state, by name. `Values` holds each part's value type. */
export type StateParts<Values> = {
  readonly [Name in keyof Values]: StatePart<Values[Name]>;
};

/** How a saved value's version is treated. */
export interface SavedStateVersionOptions {
  /** The version the app writes now. Defaults to 1. */
  version?: number;
  /**
   * Upgrades the parts of a value saved under another version. It gets the saved parts and the
   * version that wrote them (0 when the value names none), and returns the parts in today's
   * shape. Each returned part is still read through its `parse`.
   *
   * Without it, a value saved under another version is not used.
   */
  migrate?: (
    parts: Record<string, unknown>,
    fromVersion: number,
  ) => Record<string, unknown>;
}

/** How `readSavedState` treats versions, and the rules that span several parts. */
export interface ReadSavedStateOptions<Values = unknown>
  extends SavedStateVersionOptions {
  /**
   * Checks the parts against each other, after each one was read by itself. Use it for a rule
   * that spans parts: for example, to drop a saved filter's name when the filter was not usable.
   *
   * It gets every part's value, and the names of the parts that got their default because
   * nothing usable was saved for them. Return the parts to correct, by name, or nothing to
   * keep them all. A returned part replaces the read one as it is, and is not parsed again.
   *
   * The step is as loose as `parse`: when it throws, the values read before it are used. It is
   * not called when every part got its default, because nothing usable was saved then.
   *
   * @example
   * check: (values, defaulted) =>
   *   defaulted.includes("filter") ? { filterName: "" } : undefined,
   */
  check?: (
    values: Readonly<NoInfer<Values>>,
    defaulted: readonly (keyof NoInfer<Values>)[],
  ) => Partial<NoInfer<Values>> | undefined;
}

/**
 * Reads a saved value into one value per part. Call it on anything a store hands back.
 *
 * - A part that is missing or broken gets its default. The other parts are still used.
 * - A saved part the app no longer has is ignored.
 * - A value that is not a saved state at all, or that `migrate` cannot upgrade, gives every
 *   part its default.
 * - `check`, when given, then corrects the parts that depend on each other.
 *
 * Nothing here throws, whatever was saved.
 *
 * @example
 * const state = readSavedState(store.load("orders"), {
 *   filter: filterStatePart(),
 *   columns: columnStatePart(columns),
 * });
 * // state.filter, state.columns
 */
export function readSavedState<Values>(
  saved: unknown,
  parts: StateParts<Values>,
  options: ReadSavedStateOptions<Values> = {},
): Values {
  const savedParts = readSavedParts(saved, options);
  const values = {} as Values;
  const defaulted: (keyof Values)[] = [];
  const names = Object.keys(parts) as (keyof Values & string)[];
  for (const name of names) {
    const read = readPart(parts[name], savedParts, name);
    values[name] = read.value;
    if (read.isDefault) defaulted.push(name);
  }
  // With every part at its default, nothing usable was saved, so there is nothing to check.
  if (options.check === undefined || defaulted.length === names.length) {
    return values;
  }
  return checkTogether(values, defaulted, options.check);
}

/**
 * Wraps one value per part in the saved format, ready to hand to a store.
 *
 * @example
 * store.save("orders", createSavedState({ filter, columns }));
 */
export function createSavedState(
  // `object`, not a record: a value typed with an `interface` is not a record to TypeScript.
  values: object,
  version: number = DEFAULT_STATE_VERSION,
): SavedState {
  return { version, parts: { ...values } };
}

/**
 * The filter part of a table's state.
 *
 * It reads the saved filter as loosely as matching does. The top level must be a group with a
 * list of rows. A broken row inside is kept: matching skips it and a builder shows it as
 * broken, so a saved filter returns the same rows as before.
 *
 * A filter nested more than `MAX_SAVED_FILTER_DEPTH` groups deep is turned down, and the
 * default is used.
 */
export function filterStatePart(
  defaultValue: FilterDefinition = { criteria: [], logic: "AND" },
): StatePart<FilterDefinition> {
  return {
    defaultValue,
    parse: (saved) =>
      hasCriteriaList(saved) && isNestedWithinLimit(saved) ? saved : undefined,
  };
}

/**
 * The column part of a table's state: which columns are shown, and in what order.
 *
 * With the column list, the saved settings are fitted to it with `reconcileColumnSettings`,
 * and the part is never empty.
 *
 * Without the column list, the part is `null` until something is saved, and saved settings
 * are handed on as they are once their shape is right. Use this form when the settings go to
 * something that fits them to the column list itself, as the column hook of
 * `@arvilmena/filter-react` does. The column list is then passed in one place only.
 *
 * @example
 * // The settings are ready to use anywhere.
 * const parts = { columns: columnStatePart(columns) };
 *
 * @example
 * // The column hook fits the settings, so only the hook gets the column list.
 * const parts = { columns: columnStatePart() };
 * const saved = useSavedTableState({ id: "orders", parts });
 * const table = useColumnSettings({
 *   columns,
 *   value: saved.values.columns,
 *   onChange: saved.set.columns,
 * });
 */
export function columnStatePart(
  columns: readonly ColumnDefinition[],
): StatePart<ColumnSettings>;
export function columnStatePart(): StatePart<ColumnSettings | null>;
export function columnStatePart(
  columns?: readonly ColumnDefinition[],
): StatePart<ColumnSettings> | StatePart<ColumnSettings | null> {
  if (columns === undefined) {
    return {
      defaultValue: null,
      parse: (saved) => (isColumnSettings(saved) ? saved : undefined),
    };
  }
  return {
    defaultValue: defaultColumnSettings(columns),
    parse: (saved) => reconcileColumnSettings(columns, saved),
  };
}

/**
 * The parts of a saved value in today's shape, upgraded with `migrate` when another version
 * wrote them. It gives `undefined` when the value cannot be used. It never throws.
 *
 * The parts are not checked yet, and may be anything. `readSavedState` checks them. Use this
 * to keep the parts your code does not read, so that saving does not drop them.
 *
 * @example
 * const before = readSavedParts(store.load("orders")) ?? {};
 * store.save("orders", createSavedState({ ...before, pageSize: 50 }));
 */
export function readSavedParts(
  saved: unknown,
  options: SavedStateVersionOptions = {},
): Record<string, unknown> | undefined {
  if (!isRecord(saved) || !isRecord(saved.parts)) return undefined;
  const current = options.version ?? DEFAULT_STATE_VERSION;
  const savedVersion =
    typeof saved.version === "number" ? saved.version : undefined;
  if (savedVersion === current) return saved.parts;
  if (options.migrate === undefined) return undefined;
  try {
    const upgraded: unknown = options.migrate(saved.parts, savedVersion ?? 0);
    return isRecord(upgraded) ? upgraded : undefined;
  } catch {
    // The app's upgrade could not handle this value. Start from the defaults.
    return undefined;
  }
}

/**
 * One part's value: the saved one when its `parse` accepts it, and the default otherwise.
 * `isDefault` tells which of the two it is.
 */
function readPart<Value>(
  part: StatePart<Value>,
  savedParts: Record<string, unknown> | undefined,
  name: string,
): { value: Value; isDefault: boolean } {
  const fallback = { value: part.defaultValue, isDefault: true };
  // `Object.hasOwn`, not a plain read: a part named like something every object carries
  // ("toString") must not pick that up as its saved value.
  if (savedParts === undefined || !Object.hasOwn(savedParts, name)) {
    return fallback;
  }
  try {
    const value = part.parse(savedParts[name]);
    return value === undefined ? fallback : { value, isDefault: false };
  } catch {
    return fallback;
  }
}

/**
 * The values after the app's `check` has corrected them. Only parts the app named are taken
 * from its answer. When `check` throws, or answers with nothing usable, `values` come back.
 */
function checkTogether<Values>(
  values: Values,
  defaulted: readonly (keyof Values)[],
  check: NonNullable<ReadSavedStateOptions<Values>["check"]>,
): Values {
  try {
    // A copy goes in, so a `check` that changes it and then throws leaves `values` whole.
    const corrections: unknown = check({ ...values }, defaulted);
    if (!isRecord(corrections)) return values;
    const corrected = { ...values };
    for (const name of Object.keys(values as object) as (keyof Values)[]) {
      // `undefined` is no value for a part: it means "leave this one".
      if (
        Object.hasOwn(corrections, name) &&
        corrections[name as string] !== undefined
      ) {
        corrected[name] = corrections[name as string] as Values[keyof Values];
      }
    }
    return corrected;
  } catch {
    return values;
  }
}

/** Whether the value is an object that is not a list. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether a saved value has the shape of column settings: two lists of keys. */
function isColumnSettings(value: unknown): value is ColumnSettings {
  return isRecord(value) && isKeyList(value.order) && isKeyList(value.hidden);
}

function isKeyList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((key) => typeof key === "string");
}

/** Whether a saved value can be the top group of a filter. */
function hasCriteriaList(value: unknown): value is FilterDefinition {
  return isRecord(value) && Array.isArray(value.criteria);
}

/** Whether no group of the filter sits deeper than `MAX_SAVED_FILTER_DEPTH`. */
function isNestedWithinLimit(filter: FilterDefinition): boolean {
  // A list of groups still to visit, not a function that calls itself: a filter nested deep
  // enough to be dangerous would run this check out of room too.
  const toVisit: { criteria: readonly unknown[]; depth: number }[] = [
    { criteria: filter.criteria, depth: 1 },
  ];
  for (let group = toVisit.pop(); group; group = toVisit.pop()) {
    if (group.depth > MAX_SAVED_FILTER_DEPTH) return false;
    for (const row of group.criteria) {
      if (hasCriteriaList(row)) {
        toVisit.push({ criteria: row.criteria, depth: group.depth + 1 });
      }
    }
  }
  return true;
}

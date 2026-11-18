// Which columns a table shows, and in what order. An app passes in its own column list, and
// stores the settings a person chose as plain JSON.
//
// Every action is a pure function: it takes settings and returns new ones, and never changes
// the settings it was given. An action that changes nothing returns the SAME settings object,
// so a caller can tell with `===` that nothing happened.

/** Describes one column of a table. Each app passes in its own list. */
export interface ColumnDefinition {
  /** Stored in the settings. Must be unique in the list. */
  key: string;
  /** The column's name, as shown in a picker. */
  label: string;
  /** Whether a person may hide the column. Defaults to true. */
  hideable?: boolean;
  /** Whether the column starts hidden. Ignored for a column that cannot be hidden. */
  defaultHidden?: boolean;
  /**
   * Keeps the column at the start or the end of the order, whatever a person or the saved
   * settings say. Use it for a column a table keeps in view, such as the one that names the row.
   *
   * Pinned columns stand in the order the list gives them. A pinned column may still be hidden:
   * add `hideable: false` to keep it shown too.
   */
  pinned?: ColumnPin;
}

/** The end of the order a pinned column is kept at. */
export type ColumnPin = "start" | "end";

/** The choices a person made about a table's columns. Plain JSON, so an app can store it. */
export interface ColumnSettings {
  /** Every column's key, in the order the columns are shown. Hidden columns keep their place. */
  order: readonly string[];
  /** The keys of the hidden columns. */
  hidden: readonly string[];
}

/** One column in its chosen place, as a picker lists it. */
export interface OrderedColumn<
  Column extends ColumnDefinition = ColumnDefinition,
> {
  /** The app's own column object, untouched. */
  column: Column;
  /** Whether the table shows the column. Always true for a column that cannot be hidden. */
  visible: boolean;
  /** Whether a person may hide the column. */
  hideable: boolean;
  /**
   * The end of the order the column is pinned to, or `undefined` for a column a person may
   * move. A table can use it to keep the column in view, with sticky CSS of its own.
   */
  pinned: ColumnPin | undefined;
}

/** The settings of a table nobody has changed: the list's own order and starting visibility. */
export function defaultColumnSettings(
  columns: readonly ColumnDefinition[],
): ColumnSettings {
  const lookup = createColumnLookup(columns);
  const order: string[] = [];
  const hidden: string[] = [];
  for (const [key, column] of lookup) {
    order.push(key);
    if (startsHidden(column)) hidden.push(key);
  }
  return { order: withPinnedInPlace(order, lookup), hidden };
}

/**
 * Fits saved settings to the column list an app has now. Call it on anything read from storage.
 *
 * - A saved key that is no longer a column is dropped, and so is a key saved twice.
 * - A column the saved order does not name is new. It goes after the nearest saved column
 *   before it in the list, or first if there is none. It starts shown or hidden as the list
 *   says, even if the saved hidden keys name it.
 * - A saved order that is broken, or names no column of the list, cannot tell which columns
 *   are new. The list's own order is used, and the saved hidden keys still count.
 * - A column that cannot be hidden is never hidden.
 * - A pinned column goes to its end of the order, wherever the saved order has it. So settings
 *   saved before a column was pinned still load.
 * - A broken part falls back to the defaults. Nothing here throws.
 *
 * Settings that already fit come back as the SAME object.
 */
export function reconcileColumnSettings(
  columns: readonly ColumnDefinition[],
  saved: unknown,
): ColumnSettings {
  const lookup = createColumnLookup(columns);
  const { order, hidden } =
    typeof saved === "object" && saved !== null
      ? (saved as { order?: unknown; hidden?: unknown })
      : {};

  const savedOrder = Array.isArray(order)
    ? cleanKeys(order, (key) => lookup.has(key))
    : [];
  const wasSaved = new Set(savedOrder);

  // Each new column is filed under the nearest saved column before it in the list, so it lands
  // right after that column wherever a person has moved it.
  const leading: string[] = [];
  const followers = new Map<string, string[]>();
  let anchor: string | undefined;
  for (const key of lookup.keys()) {
    if (wasSaved.has(key)) {
      anchor = key;
    } else if (anchor === undefined) {
      leading.push(key);
    } else {
      const list = followers.get(anchor);
      if (list) list.push(key);
      else followers.set(anchor, [key]);
    }
  }
  const placedOrder = leading;
  for (const key of savedOrder) {
    placedOrder.push(key);
    // Added one at a time. Passing a whole group to one `push` call fails on a very long group,
    // because an engine limits how many values one call may take.
    for (const follower of followers.get(key) ?? []) placedOrder.push(follower);
  }
  const nextOrder = withPinnedInPlace(placedOrder, lookup);

  // With no usable saved list of hidden columns, every column takes its starting visibility.
  const hasSavedHidden = Array.isArray(hidden);
  // A saved hidden key counts only for a column the saved order names: any other column is new,
  // and starts as the list says. A saved order that names no column of the list cannot tell
  // which columns are new, so then every saved hidden key is kept.
  const orderTellsNew = savedOrder.length > 0;
  const nextHidden = hasSavedHidden
    ? cleanKeys(
        hidden,
        (key) =>
          isHideable(lookup.get(key)) && (!orderTellsNew || wasSaved.has(key)),
      )
    : [];
  const isHidden = new Set(nextHidden);
  for (const [key, column] of lookup) {
    const isNew = !hasSavedHidden || !wasSaved.has(key);
    if (isNew && startsHidden(column) && !isHidden.has(key)) {
      nextHidden.push(key);
    }
  }

  const fits =
    Array.isArray(order) &&
    hasSavedHidden &&
    isSameList(order, nextOrder) &&
    isSameList(hidden, nextHidden);
  return fits
    ? (saved as ColumnSettings)
    : { order: nextOrder, hidden: nextHidden };
}

/**
 * Shows or hides one column. A key the order does not name changes nothing.
 *
 * It does not know the column list, so it cannot tell that a column must stay shown.
 * `orderedColumns` and `visibleColumns` show such a column whatever the settings say.
 */
export function setColumnVisible(
  settings: ColumnSettings,
  key: string,
  visible: boolean,
): ColumnSettings {
  const isHidden = settings.hidden.includes(key);
  if (visible === !isHidden || !settings.order.includes(key)) return settings;
  return {
    order: settings.order,
    hidden: visible
      ? settings.hidden.filter((hiddenKey) => hiddenKey !== key)
      : [...settings.hidden, key],
  };
}

/**
 * Moves one column so that it ends up at `toIndex` in the order. The order counts hidden
 * columns too. An index past either end means the first or the last place.
 *
 * It does not know the column list, so it cannot tell that a column is pinned. Use
 * `moveColumnAroundPinned` for a list that pins columns.
 */
export function moveColumn(
  settings: ColumnSettings,
  key: string,
  toIndex: number,
): ColumnSettings {
  const from = settings.order.indexOf(key);
  if (from === -1 || Number.isNaN(toIndex)) return settings;
  const last = settings.order.length - 1;
  const to = Math.min(Math.max(Math.trunc(toIndex), 0), last);
  if (to === from) return settings;
  const order = [...settings.order];
  order.splice(from, 1);
  order.splice(to, 0, key);
  return { order, hidden: settings.hidden };
}

/**
 * Moves one column as `moveColumn` does, and leaves the pinned columns where they are.
 *
 * - A pinned column does not move.
 * - Another column moves only among the places between the pinned columns. An index in a
 *   pinned column's place, or past either end, means the nearest place a column may take.
 *
 * Pass settings that fit the column list (see `reconcileColumnSettings`), so that the pinned
 * columns are already at their ends of the order.
 */
export function moveColumnAroundPinned(
  columns: readonly ColumnDefinition[],
  settings: ColumnSettings,
  key: string,
  toIndex: number,
): ColumnSettings {
  const { order } = settings;
  const { first, last } = unpinnedRange(columns, order);
  // No column is pinned at either end, so there is nothing to keep in place.
  if (first === 0 && last === order.length - 1) {
    return moveColumn(settings, key, toIndex);
  }
  const from = order.indexOf(key);
  // The column is one of the pinned ones.
  if (from < first || from > last) return settings;
  // A number that is not one stays so, and `moveColumn` turns it down.
  return moveColumn(settings, key, Math.min(Math.max(toIndex, first), last));
}

/**
 * The places of an order that a column may be moved to: from `first` to `last`, counting from
 * 0. The pinned columns stand before and after them. With every column pinned, `last` is one
 * less than `first`.
 *
 * A picker uses it to tell which rows a drag may land between. Pass an order that fits the
 * column list (see `reconcileColumnSettings`).
 */
export function unpinnedRange(
  columns: readonly ColumnDefinition[],
  order: readonly string[],
): { first: number; last: number } {
  const pins = new Map<string, ColumnPin>();
  for (const [key, column] of createColumnLookup(columns)) {
    const pin = columnPin(column);
    if (pin !== undefined) pins.set(key, pin);
  }
  let first = 0;
  let last = order.length - 1;
  if (pins.size === 0) return { first, last };
  while (first <= last && pins.get(order[first] as string) === "start") first++;
  while (last >= first && pins.get(order[last] as string) === "end") last--;
  return { first, last };
}

/**
 * The end of the order the column is pinned to, or `undefined` for a column a person may move.
 *
 * A table can read `column.pinned` itself. This function also suits a column list written
 * with `as const`, where only some columns have the property and TypeScript would turn a plain
 * read down. It is read loosely, as an app written in plain JavaScript may pass anything: only
 * `"start"` and `"end"` pin a column.
 *
 * @example
 * <th className={columnPin(column) === "start" ? "sticky-start" : undefined}>
 */
export function columnPin(
  column: ColumnDefinition | undefined,
): ColumnPin | undefined {
  const pin = column?.pinned;
  return pin === "start" || pin === "end" ? pin : undefined;
}

/** Shows every column, keeping the order. */
export function showAllColumns(settings: ColumnSettings): ColumnSettings {
  return settings.hidden.length === 0
    ? settings
    : { order: settings.order, hidden: [] };
}

/**
 * Puts back the list's own order and starting visibility.
 *
 * The column list comes first, as in every function here that takes both it and the settings.
 */
export function resetColumnSettings(
  columns: readonly ColumnDefinition[],
  settings: ColumnSettings,
): ColumnSettings {
  const defaults = defaultColumnSettings(columns);
  return isSameSettings(settings, defaults) ? settings : defaults;
}

/**
 * Whether the settings are the list's own order and starting visibility, so that
 * `resetColumnSettings` would change nothing. A picker uses it to turn its reset button off.
 *
 * The order is compared place by place. The hidden keys count as a set: hiding the same
 * columns in another sequence shows the same table, so it is still the defaults.
 */
export function isDefaultColumnSettings(
  columns: readonly ColumnDefinition[],
  settings: ColumnSettings,
): boolean {
  return isSameSettings(settings, defaultColumnSettings(columns));
}

/**
 * Every column in its chosen place, each with whether it is shown. A picker draws this.
 *
 * It reads the settings loosely: an unknown key is skipped, and a column the order does not
 * name goes last. Use `reconcileColumnSettings` to place new columns properly.
 *
 * A pinned column is at its end of the list whatever the order says, and each entry says
 * whether its column is pinned.
 */
export function orderedColumns<Column extends ColumnDefinition>(
  columns: readonly Column[],
  settings: ColumnSettings,
): OrderedColumn<Column>[] {
  const result: OrderedColumn<Column>[] = [];
  eachColumnInOrder(columns, settings, (column, visible, hideable) => {
    result.push({ column, visible, hideable, pinned: columnPin(column) });
  });
  return result;
}

/**
 * The columns a table should draw, in order. They are the app's own column objects, so any
 * extra properties on them are still there. That includes `pinned`, which a table can read to
 * keep a column in view.
 */
export function visibleColumns<Column extends ColumnDefinition>(
  columns: readonly Column[],
  settings: ColumnSettings,
): Column[] {
  const result: Column[] = [];
  eachColumnInOrder(columns, settings, (column, visible) => {
    if (visible) result.push(column);
  });
  return result;
}

/**
 * Whether a column matches what a person typed in a search box. A picker lists the columns
 * that do.
 *
 * - The column's label is searched, ignoring case.
 * - Each word typed must be somewhere in the label, in any order: "price close" finds
 *   "Close price".
 * - An empty search, or one of spaces only, matches every column.
 *
 * Letters with accents are compared as typed: "cafe" does not find "Café".
 *
 * @example
 * const listed = table.orderedColumns.filter((entry) =>
 *   columnMatchesSearch(entry.column, search),
 * );
 */
export function columnMatchesSearch(
  column: Pick<ColumnDefinition, "label">,
  search: string,
): boolean {
  return labelHasWords(column.label, searchWords(search));
}

/**
 * The columns that match what a person typed in a search box, in the order given. It follows
 * the rules of `columnMatchesSearch`, and reads the search once for the whole list.
 *
 * It takes plain columns, or the entries of `orderedColumns`. With an empty search the SAME
 * list comes back.
 *
 * @example
 * const listed = searchColumns(table.orderedColumns, search);
 */
export function searchColumns<
  Item extends ColumnDefinition | OrderedColumn = ColumnDefinition,
>(items: readonly Item[], search: string): readonly Item[] {
  const words = searchWords(search);
  if (words.length === 0) return items;
  return items.filter((item) => labelHasWords(labelOf(item), words));
}

/** The label of a plain column, or of an entry of `orderedColumns`. */
function labelOf(item: ColumnDefinition | OrderedColumn): string {
  return "column" in item ? item.column.label : item.label;
}

/** The words of a search, in lower case. */
function searchWords(search: string): string[] {
  // Read loosely: an app may pass on whatever its input holds.
  if (typeof search !== "string") return [];
  return search.toLowerCase().split(/\s+/).filter(Boolean);
}

/** Whether the label holds every one of the words. The words must be in lower case. */
function labelHasWords(label: string, words: readonly string[]): boolean {
  if (words.length === 0) return true;
  const text = String(label).toLowerCase();
  return words.every((word) => text.includes(word));
}

/** Calls `visit` once for each column, in the chosen order. */
function eachColumnInOrder<Column extends ColumnDefinition>(
  columns: readonly Column[],
  settings: ColumnSettings,
  visit: (column: Column, visible: boolean, hideable: boolean) => void,
): void {
  const lookup = createColumnLookup(columns);
  const hidden = new Set(settings.hidden);
  const placed = new Set<string>();
  const place = (key: string, column: Column | undefined) => {
    if (column === undefined || placed.has(key)) return;
    placed.add(key);
    const hideable = isHideable(column);
    visit(column, !hideable || !hidden.has(key), hideable);
  };
  // The columns pinned to the start, in the list's order. The order is not asked about them.
  for (const [key, column] of lookup) {
    if (columnPin(column) === "start") place(key, column);
  }
  for (const key of settings.order) {
    const column = lookup.get(key);
    if (columnPin(column) === undefined) place(key, column);
  }
  // Columns the order does not name, then the columns pinned to the end.
  for (const [key, column] of lookup) {
    if (columnPin(column) === undefined) place(key, column);
  }
  for (const [key, column] of lookup) place(key, column);
}

/** The columns by key, in list order. When two share a key, the first one counts. */
function createColumnLookup<Column extends ColumnDefinition>(
  columns: readonly Column[],
): Map<string, Column> {
  const lookup = new Map<string, Column>();
  for (const column of columns) {
    if (!lookup.has(column.key)) lookup.set(column.key, column);
  }
  return lookup;
}

/** Whether a person may hide the column. False for a column that does not exist. */
function isHideable(column: ColumnDefinition | undefined): boolean {
  return column !== undefined && column.hideable !== false;
}

/**
 * The order with every pinned column at its end of it: the columns pinned to the start, then
 * the rest as the order has them, then the columns pinned to the end. Pinned columns stand in
 * the list's order. `order` must name every column of the lookup.
 *
 * With no pinned column, the order comes back as the SAME list.
 */
function withPinnedInPlace(
  order: string[],
  lookup: ReadonlyMap<string, ColumnDefinition>,
): string[] {
  const start: string[] = [];
  const end: string[] = [];
  for (const [key, column] of lookup) {
    const pin = columnPin(column);
    if (pin === "start") start.push(key);
    else if (pin === "end") end.push(key);
  }
  if (start.length === 0 && end.length === 0) return order;
  const result = start;
  // Added one at a time, as a very long list cannot be handed to one `push` call.
  for (const key of order) {
    if (columnPin(lookup.get(key)) === undefined) result.push(key);
  }
  for (const key of end) result.push(key);
  return result;
}

/** Whether the column is hidden until a person shows it. */
function startsHidden(column: ColumnDefinition): boolean {
  return column.defaultHidden === true && isHideable(column);
}

/** The text items of a stored list that pass `keep`, each once, in their saved order. */
function cleanKeys(
  list: readonly unknown[],
  keep: (key: string) => boolean,
): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const key of list) {
    if (typeof key !== "string" || seen.has(key) || !keep(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** Whether two settings show the same table: the same order, and the same columns hidden. */
function isSameSettings(a: ColumnSettings, b: ColumnSettings): boolean {
  return isSameList(a.order, b.order) && isSameSet(a.hidden, b.hidden);
}

/** Whether two lists hold the same keys, in any sequence. A key listed twice counts once. */
function isSameSet(a: readonly string[], b: readonly string[]): boolean {
  const keys = new Set(a);
  const others = new Set(b);
  if (keys.size !== others.size) return false;
  for (const key of keys) {
    if (!others.has(key)) return false;
  }
  return true;
}

/** Whether two lists hold the same items in the same order. */
function isSameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (a.length !== b.length) return false;
  // Every place is read by its number. `every` skips a hole (a place in a list that was never
  // given a value), so a stored list with a hole would pass as equal to a full one.
  for (let index = 0; index < a.length; index++) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

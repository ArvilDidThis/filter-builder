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
}

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
}

/** The settings of a table nobody has changed: the list's own order and starting visibility. */
export function defaultColumnSettings(
  columns: readonly ColumnDefinition[],
): ColumnSettings {
  const order: string[] = [];
  const hidden: string[] = [];
  for (const [key, column] of createColumnLookup(columns)) {
    order.push(key);
    if (startsHidden(column)) hidden.push(key);
  }
  return { order, hidden };
}

/**
 * Fits saved settings to the column list an app has now. Call it on anything read from storage.
 *
 * - A saved key that is no longer a column is dropped, and so is a key saved twice.
 * - A column the saved order does not name is new. It goes after the column it follows in the
 *   list, and starts shown or hidden as the list says.
 * - A column that cannot be hidden is never hidden.
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
  const nextOrder = leading;
  for (const key of savedOrder) {
    nextOrder.push(key);
    // Added one at a time. Passing a whole group to one `push` call fails on a very long group,
    // because an engine limits how many values one call may take.
    for (const follower of followers.get(key) ?? []) nextOrder.push(follower);
  }

  // With no usable saved list of hidden columns, every column takes its starting visibility.
  const hasSavedHidden = Array.isArray(hidden);
  const nextHidden = hasSavedHidden
    ? cleanKeys(hidden, (key) => isHideable(lookup.get(key)))
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
 */
export function orderedColumns<Column extends ColumnDefinition>(
  columns: readonly Column[],
  settings: ColumnSettings,
): OrderedColumn<Column>[] {
  const result: OrderedColumn<Column>[] = [];
  eachColumnInOrder(columns, settings, (column, visible, hideable) => {
    result.push({ column, visible, hideable });
  });
  return result;
}

/**
 * The columns a table should draw, in order. They are the app's own column objects, so any
 * extra properties on them are still there.
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

/** Calls `visit` once for each column, in the chosen order. */
function eachColumnInOrder<Column extends ColumnDefinition>(
  columns: readonly Column[],
  settings: ColumnSettings,
  visit: (column: Column, visible: boolean, hideable: boolean) => void,
): void {
  const lookup = createColumnLookup(columns);
  const hidden = new Set(settings.hidden);
  const placed = new Set<string>();
  const place = (key: string) => {
    const column = lookup.get(key);
    if (column === undefined || placed.has(key)) return;
    placed.add(key);
    const hideable = isHideable(column);
    visit(column, !hideable || !hidden.has(key), hideable);
  };
  for (const key of settings.order) place(key);
  // Columns the order does not name.
  for (const key of lookup.keys()) place(key);
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

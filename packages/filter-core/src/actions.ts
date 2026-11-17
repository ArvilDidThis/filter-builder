import { VALUES_NEEDED } from "./evaluate";
import { type FieldDefinition, operatorsForField } from "./fields";
import type {
  ConditionOperator,
  Criterion,
  FilterDefinition,
  FilterGroup,
  LeafCondition,
  LogicOperator,
} from "./types";
import { isFilterGroup, isLeafCondition } from "./types";

// The actions a builder screen needs: add, remove, change and move conditions and groups.
//
// Every action is a pure function: it takes a filter and returns a new one, and never changes the
// filter it was given. An action that cannot be done (a path that leads nowhere, a move past the
// depth limit) returns the SAME filter object, so a caller can tell with `===` that nothing
// happened.

/**
 * Where an item sits in a filter: the position to follow at each level, from the top group down.
 * `[]` is the top group itself, `[1]` its second item, and `[1, 0]` the first item inside that.
 */
export type FilterPath = readonly number[];

/** Limits shared by the actions that can make a filter deeper. */
export interface DepthOptions {
  /**
   * The most levels of groups allowed, counting the top group as level 1. The same meaning as
   * SearchBuilder's `depthLimit`. Leave out for no limit.
   */
  depthLimit?: number;
}

/** The item at `path`: a condition, a group, or `undefined` when the path leads nowhere. */
export function getItemAt(
  filter: FilterDefinition,
  path: FilterPath,
): Criterion | undefined {
  let current: Criterion = filter;
  for (const index of path) {
    if (!isFilterGroup(current)) return undefined;
    const next: Criterion | undefined = current.criteria[index];
    if (next === undefined) return undefined;
    current = next;
  }
  return current;
}

/** The group at `path`, or `undefined` when the path leads to a condition or nowhere. */
function getGroupAt(
  filter: FilterDefinition,
  path: FilterPath,
): FilterGroup | undefined {
  const item = getItemAt(filter, path);
  return item !== undefined && isFilterGroup(item) ? item : undefined;
}

/**
 * Returns a copy of the filter with the group at `groupPath` replaced by `change(group)`. Only
 * the groups along the path are copied; everything else is shared with the original.
 */
function changeGroupAt(
  filter: FilterDefinition,
  groupPath: FilterPath,
  change: (group: FilterGroup) => FilterGroup,
): FilterDefinition {
  const walk = (group: FilterGroup, depth: number): FilterGroup => {
    // A stored filter may hold a top group with no list of rows. It is treated as empty.
    const criteria = Array.isArray(group.criteria) ? group.criteria : [];
    if (depth === groupPath.length) {
      return change(
        criteria === group.criteria ? group : { ...group, criteria },
      );
    }
    const index = groupPath[depth] as number;
    const child = criteria[index];
    if (child === undefined || !isFilterGroup(child)) return group;
    const changed = walk(child, depth + 1);
    if (changed === child) return group;
    const copy = [...criteria];
    copy[index] = changed;
    return { ...group, criteria: copy };
  };
  return walk(filter, 0);
}

/** How many levels of groups an item adds below itself: 0 for a condition, 1 for a flat group. */
function levelsIn(item: Criterion): number {
  if (!isFilterGroup(item)) return 0;
  let deepest = 0;
  for (const child of item.criteria) {
    deepest = Math.max(deepest, levelsIn(child));
  }
  return deepest + 1;
}

/** Whether `item` may sit inside the group at `groupPath` without passing the depth limit. */
function fitsInGroup(
  item: Criterion,
  groupPath: FilterPath,
  depthLimit: number | undefined,
): boolean {
  if (depthLimit === undefined) return true;
  // The group at `groupPath` is at level `groupPath.length + 1`.
  return groupPath.length + 1 + levelsIn(item) <= depthLimit;
}

/**
 * How many value boxes a condition shows: 0, 1 or 2. It is `null` for a list compared for
 * equality, which takes any number of values.
 */
export function valueBoxCount(
  operator: ConditionOperator,
  type: LeafCondition["type"],
): number | null {
  if (type === "array" && (operator === "=" || operator === "!=")) return null;
  return Object.hasOwn(VALUES_NEEDED, operator) ? VALUES_NEEDED[operator] : 1;
}

/** The right number of value boxes for an operator, keeping what was already typed. */
function resizeValues(
  values: readonly string[],
  operator: ConditionOperator,
  type: LeafCondition["type"],
): string[] {
  const needed = valueBoxCount(operator, type);
  if (needed === null) return [...values];
  return Array.from({ length: needed }, (_, index) => values[index] ?? "");
}

/**
 * A new, empty condition for a builder to add.
 *
 * With a field, the condition is set to that field and waits for a value. Without one, it is a
 * blank row waiting for a field. Matching skips both until they are filled in.
 *
 * @param operator - The operator to start with. Defaults to the first the field offers.
 */
export function createCondition(
  field?: FieldDefinition,
  operator?: ConditionOperator,
): LeafCondition {
  if (field === undefined) {
    return {
      condition: "=",
      data: "",
      origData: "",
      type: "string",
      value: [],
    };
  }
  const offered = operatorsForField(field);
  const chosen =
    operator !== undefined && offered.includes(operator)
      ? operator
      : (offered[0] ?? "=");
  return {
    condition: chosen,
    data: field.label,
    origData: field.key,
    type: field.type,
    value: resizeValues([], chosen, field.type),
  };
}

/** Adds a condition to the end of the group at `groupPath`. */
export function addCondition(
  filter: FilterDefinition,
  groupPath: FilterPath,
  condition: LeafCondition = createCondition(),
): FilterDefinition {
  return changeGroupAt(filter, groupPath, (group) => ({
    ...group,
    criteria: [...group.criteria, condition],
  }));
}

/**
 * Adds an empty group to the end of the group at `groupPath`. Does nothing when the new group
 * would pass the depth limit.
 */
export function addGroup(
  filter: FilterDefinition,
  groupPath: FilterPath,
  options: DepthOptions & { logic?: LogicOperator } = {},
): FilterDefinition {
  const group: FilterGroup = { criteria: [], logic: options.logic ?? "AND" };
  if (!fitsInGroup(group, groupPath, options.depthLimit)) return filter;
  return changeGroupAt(filter, groupPath, (parent) => ({
    ...parent,
    criteria: [...parent.criteria, group],
  }));
}

/** Removes the condition or group at `path`. The top group itself cannot be removed. */
export function removeItem(
  filter: FilterDefinition,
  path: FilterPath,
): FilterDefinition {
  if (path.length === 0) return filter;
  const index = path[path.length - 1] as number;
  return changeGroupAt(filter, path.slice(0, -1), (group) =>
    index in group.criteria
      ? { ...group, criteria: group.criteria.filter((_, i) => i !== index) }
      : group,
  );
}

/** Sets whether the group at `groupPath` needs all of its items ("AND") or any one ("OR"). */
export function setGroupLogic(
  filter: FilterDefinition,
  groupPath: FilterPath,
  logic: LogicOperator,
): FilterDefinition {
  return changeGroupAt(filter, groupPath, (group) =>
    group.logic === logic ? group : { ...group, logic },
  );
}

/** Replaces the condition at `path` with `change(condition)`. */
function changeConditionAt(
  filter: FilterDefinition,
  path: FilterPath,
  change: (condition: LeafCondition) => LeafCondition,
): FilterDefinition {
  if (path.length === 0) return filter;
  const index = path[path.length - 1] as number;
  return changeGroupAt(filter, path.slice(0, -1), (group) => {
    const item = group.criteria[index];
    if (item === undefined || !isLeafCondition(item)) return group;
    const changed = change(item);
    if (changed === item) return group;
    const criteria = [...group.criteria];
    criteria[index] = changed;
    return { ...group, criteria };
  });
}

/**
 * Points the condition at `path` to another field. The operator is kept when the new field
 * offers it, and the values are cleared, because a value for one field rarely suits another.
 *
 * A blank row has no operator a person chose yet. It starts on `defaultOperator` when the field
 * offers it, and otherwise on the first operator the field offers.
 */
export function setConditionField(
  filter: FilterDefinition,
  path: FilterPath,
  field: FieldDefinition,
  options: { defaultOperator?: ConditionOperator } = {},
): FilterDefinition {
  return changeConditionAt(filter, path, (condition) => {
    // Picking the field a condition is already on changes nothing, and keeps its values.
    if (
      condition.origData === field.key &&
      condition.data === field.label &&
      condition.type === field.type
    ) {
      return condition;
    }
    const isBlankRow = condition.origData === "";
    return createCondition(
      field,
      isBlankRow ? options.defaultOperator : condition.condition,
    );
  });
}

/**
 * Changes the operator of the condition at `path`, and gives it the number of value boxes the
 * new operator needs. Values already typed are kept where they still fit.
 */
export function setConditionOperator(
  filter: FilterDefinition,
  path: FilterPath,
  operator: ConditionOperator,
): FilterDefinition {
  return changeConditionAt(filter, path, (condition) =>
    condition.condition === operator
      ? condition
      : {
          ...condition,
          condition: operator,
          value: resizeValues(
            Array.isArray(condition.value) ? condition.value : [],
            operator,
            condition.type,
          ),
        },
  );
}

/** Sets one value box of the condition at `path`. `index` is 0, or 1 for the second bound. */
export function setConditionValue(
  filter: FilterDefinition,
  path: FilterPath,
  index: number,
  value: string,
): FilterDefinition {
  return changeConditionAt(filter, path, (condition) => {
    if (Array.isArray(condition.value) && condition.value[index] === value) {
      return condition;
    }
    const values = Array.isArray(condition.value) ? [...condition.value] : [];
    // Fill any gap before `index` with blanks, so the list never holds an empty slot.
    while (values.length < index) values.push("");
    values[index] = value;
    return { ...condition, value: values };
  });
}

/** Replaces the whole value list of the condition at `path`, for fields that hold a list. */
export function setConditionValues(
  filter: FilterDefinition,
  path: FilterPath,
  values: readonly string[],
): FilterDefinition {
  return changeConditionAt(filter, path, (condition) =>
    Array.isArray(condition.value) &&
    condition.value.length === values.length &&
    condition.value.every((value, index) => value === values[index])
      ? condition
      : { ...condition, value: [...values] },
  );
}

/**
 * Wraps the item at `path` in a new group, in the same spot. Does nothing when that would pass
 * the depth limit, or for the top group.
 */
export function wrapInGroup(
  filter: FilterDefinition,
  path: FilterPath,
  options: DepthOptions & { logic?: LogicOperator } = {},
): FilterDefinition {
  if (path.length === 0) return filter;
  const item = getItemAt(filter, path);
  if (item === undefined) return filter;
  const wrapper: FilterGroup = {
    criteria: [item],
    logic: options.logic ?? "AND",
  };
  const parentPath = path.slice(0, -1);
  if (!fitsInGroup(wrapper, parentPath, options.depthLimit)) return filter;
  const index = path[path.length - 1] as number;
  return changeGroupAt(filter, parentPath, (group) => {
    const criteria = [...group.criteria];
    criteria[index] = wrapper;
    return { ...group, criteria };
  });
}

/** Whether two paths lead to the same place. */
export function isSamePath(a: FilterPath, b: FilterPath): boolean {
  return a.length === b.length && startsWithPath(a, b);
}

/** Removes every condition and group, keeping the top group's "AND" or "OR". */
export function clearFilter(filter: FilterDefinition): FilterDefinition {
  return changeGroupAt(filter, [], (group) =>
    group.criteria.length === 0 ? group : { ...group, criteria: [] },
  );
}

/** Whether `path` starts with every step of `prefix`. */
function startsWithPath(path: FilterPath, prefix: FilterPath): boolean {
  return (
    path.length >= prefix.length &&
    prefix.every((step, index) => path[index] === step)
  );
}

/**
 * Moves the item at `from` into the group at `toGroupPath`, placing it before the item that is
 * at `toIndex` now. A `toIndex` equal to the group's length puts it at the end.
 *
 * This one action covers every move: up, down, into a group and out of one. It does nothing
 * when the move would put a group inside itself or pass the depth limit.
 */
export function moveItem(
  filter: FilterDefinition,
  from: FilterPath,
  toGroupPath: FilterPath,
  toIndex: number,
  options: DepthOptions = {},
): FilterDefinition {
  if (from.length === 0) return filter;
  const item = getItemAt(filter, from);
  const target = getGroupAt(filter, toGroupPath);
  if (item === undefined || target === undefined) return filter;
  // A group cannot be moved into itself or into a group inside it.
  if (startsWithPath(toGroupPath, from)) return filter;
  if (toIndex < 0 || toIndex > target.criteria.length) return filter;
  if (!fitsInGroup(item, toGroupPath, options.depthLimit)) return filter;

  const fromParent = from.slice(0, -1);
  const fromIndex = from[from.length - 1] as number;
  const sameGroup = isSamePath(fromParent, toGroupPath);
  // Moving an item to where it already is, or just after itself, changes nothing.
  if (sameGroup && (toIndex === fromIndex || toIndex === fromIndex + 1)) {
    return filter;
  }

  // Taking the item out shifts everything after it in its old group one place up. Correct the
  // destination for that shift before putting the item back in.
  const adjustedGroupPath = [...toGroupPath];
  const passesThroughOldGroup =
    toGroupPath.length > fromParent.length &&
    startsWithPath(toGroupPath, fromParent);
  if (passesThroughOldGroup) {
    const step = adjustedGroupPath[fromParent.length] as number;
    if (step > fromIndex) adjustedGroupPath[fromParent.length] = step - 1;
  }
  const adjustedIndex =
    sameGroup && toIndex > fromIndex ? toIndex - 1 : toIndex;

  const without = removeItem(filter, from);
  return changeGroupAt(without, adjustedGroupPath, (group) => {
    const criteria = [...group.criteria];
    criteria.splice(adjustedIndex, 0, item);
    return { ...group, criteria };
  });
}

/** Moves the item at `path` one place up within its group. Does nothing for the first item. */
export function moveUp(
  filter: FilterDefinition,
  path: FilterPath,
): FilterDefinition {
  if (path.length === 0) return filter;
  const index = path[path.length - 1] as number;
  if (index === 0) return filter;
  return moveItem(filter, path, path.slice(0, -1), index - 1);
}

/** Moves the item at `path` one place down within its group. Does nothing for the last item. */
export function moveDown(
  filter: FilterDefinition,
  path: FilterPath,
): FilterDefinition {
  if (path.length === 0) return filter;
  const index = path[path.length - 1] as number;
  // "Before the item two places down" is one place down, once this item is taken out.
  return moveItem(filter, path, path.slice(0, -1), index + 2);
}

/**
 * Moves the item at `path` to the end of the group directly above it. Does nothing when the item
 * above is not a group, or when the move would pass the depth limit.
 */
export function moveIntoGroupAbove(
  filter: FilterDefinition,
  path: FilterPath,
  options: DepthOptions = {},
): FilterDefinition {
  if (path.length === 0) return filter;
  const index = path[path.length - 1] as number;
  if (index === 0) return filter;
  const abovePath = [...path.slice(0, -1), index - 1];
  const above = getGroupAt(filter, abovePath);
  if (above === undefined) return filter;
  return moveItem(filter, path, abovePath, above.criteria.length, options);
}

/**
 * Moves the item at `path` out of its group, to just after that group one level up. Does nothing
 * for an item in the top group.
 */
export function moveOutOfGroup(
  filter: FilterDefinition,
  path: FilterPath,
): FilterDefinition {
  // An item in the top group has a one-step path, and nowhere further out to go.
  if (path.length < 2) return filter;
  const groupPath = path.slice(0, -1);
  const groupIndex = groupPath[groupPath.length - 1] as number;
  return moveItem(filter, path, groupPath.slice(0, -1), groupIndex + 1);
}

/** Which moves a builder should offer for one item. Use it to show, hide or turn off menu items. */
export interface AvailableMoves {
  up: boolean;
  down: boolean;
  intoGroupAbove: boolean;
  outOfGroup: boolean;
  wrapInGroup: boolean;
}

/** Works out which moves are possible for the item at `path`, by trying each one. */
export function availableMoves(
  filter: FilterDefinition,
  path: FilterPath,
  options: DepthOptions = {},
): AvailableMoves {
  return {
    up: moveUp(filter, path) !== filter,
    down: moveDown(filter, path) !== filter,
    intoGroupAbove: moveIntoGroupAbove(filter, path, options) !== filter,
    outOfGroup: moveOutOfGroup(filter, path) !== filter,
    wrapInGroup: wrapInGroup(filter, path, options) !== filter,
  };
}

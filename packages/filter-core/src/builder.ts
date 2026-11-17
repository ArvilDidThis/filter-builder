import {
  type AvailableMoves,
  availableMoves,
  type DepthOptions,
  type FilterPath,
  valueBoxCount,
} from "./actions";
import { isConditionFilled } from "./evaluate";
import {
  type FieldDefinition,
  type FieldLookup,
  OPERATORS_BY_TYPE,
  operatorsForField,
} from "./fields";
import type {
  ConditionOperator,
  FilterDefinition,
  FilterGroup,
  LeafCondition,
  LogicOperator,
} from "./types";
import { isFilterGroup, isLeafCondition } from "./types";

// Turns a filter into the list of rows a builder screen draws. It holds no markup and no styling:
// a screen in any framework reads these rows and decides how they look.

/** What every row of a builder has, whether it is a condition or a group. */
interface BuilderRowBase {
  /** Where the row sits in the filter. Pass it to the actions. */
  path: FilterPath;
  /** A text form of `path`, unique in the filter. Use it as a list key. */
  id: string;
  /** How many groups the row sits inside: 1 for a row in the top group. 0 for the top group. */
  level: number;
  /**
   * How the row joins the one before it: the logic of the group it sits in. `null` for the first
   * row of a group and for the top group, which have nothing before them.
   */
  joiner: LogicOperator | null;
  /** Which moves are possible from here, to show, hide or turn off menu items. */
  moves: AvailableMoves;
}

/** One condition row. */
export interface BuilderCondition extends BuilderRowBase {
  kind: "condition";
  condition: LeafCondition;
  /** The field the condition is on. `undefined` for a blank row, or a field the app no longer has. */
  field: FieldDefinition | undefined;
  /** The operators to offer for this row. */
  operators: readonly ConditionOperator[];
  /**
   * How many value boxes to show: 0, 1 or 2. `null` for a list compared for equality, which
   * takes any number of values.
   */
  valueCount: number | null;
  /** Whether matching applies the condition, or skips it as not yet filled in. */
  filled: boolean;
}

/** One group row, with the rows inside it. */
export interface BuilderGroup extends BuilderRowBase {
  kind: "group";
  logic: LogicOperator;
  rows: BuilderRow[];
  /** Whether a group may be added inside this one without passing the depth limit. */
  canAddGroup: boolean;
}

/**
 * A slot that holds neither a condition nor a group. A filter edited by hand can hold one.
 * Matching skips it. A screen should show it, so a person can remove it.
 */
export interface BuilderBrokenRow extends BuilderRowBase {
  kind: "broken";
  /** What the slot holds. */
  raw: unknown;
}

/** One row of a builder. */
export type BuilderRow = BuilderCondition | BuilderGroup | BuilderBrokenRow;

/** The operators to offer for a condition, from its field or else from its own type. */
function operatorsOf(
  condition: LeafCondition,
  field: FieldDefinition | undefined,
): readonly ConditionOperator[] {
  if (field !== undefined) return operatorsForField(field);
  // A stored filter may hold a type this library does not know.
  return Object.hasOwn(OPERATORS_BY_TYPE, condition.type)
    ? OPERATORS_BY_TYPE[condition.type]
    : [];
}

/**
 * Builds the rows a builder screen draws for a filter. The result is the top group; its `rows`
 * hold the conditions and nested groups, in order.
 *
 * @param fields - The app's fields, from `createFieldLookup`.
 */
export function buildBuilderRows(
  filter: FilterDefinition,
  fields: FieldLookup,
  options: DepthOptions = {},
): BuilderGroup {
  const { depthLimit } = options;

  const groupRow = (
    group: FilterGroup,
    path: FilterPath,
    joiner: LogicOperator | null,
  ): BuilderGroup => {
    // A stored filter may hold a joiner other than "AND" or "OR". Matching lets every row
    // through such a group; a screen shows it as "AND" until the person picks one.
    const logic: LogicOperator = group.logic === "OR" ? "OR" : "AND";
    return {
      kind: "group",
      path,
      id: path.length === 0 ? "root" : path.join("."),
      level: path.length,
      joiner,
      moves: availableMoves(filter, path, options),
      logic,
      // The group is at level `path.length + 1`, so a group inside it is one level further down.
      canAddGroup: depthLimit === undefined || path.length + 2 <= depthLimit,
      // A stored filter may hold a group with no list of rows. It is drawn as an empty group.
      rows: (Array.isArray(group.criteria) ? group.criteria : []).map(
        (item, index): BuilderRow => {
          const childPath = [...path, index];
          const childJoiner = index === 0 ? null : logic;
          if (isFilterGroup(item))
            return groupRow(item, childPath, childJoiner);
          const base = {
            path: childPath,
            id: childPath.join("."),
            level: childPath.length,
            joiner: childJoiner,
            moves: availableMoves(filter, childPath, options),
          };
          if (!isLeafCondition(item))
            return { ...base, kind: "broken", raw: item };
          const field = fields.get(item.origData);
          return {
            ...base,
            kind: "condition",
            condition: item,
            field,
            operators: operatorsOf(item, field),
            valueCount: valueBoxCount(item.condition, item.type),
            filled: isConditionFilled(item),
          };
        },
      ),
    };
  };

  return groupRow(filter, [], null);
}

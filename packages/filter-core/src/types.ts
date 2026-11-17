/**
 * The filter format: a tree of AND/OR groups holding conditions.
 *
 * This is the JSON shape DataTables SearchBuilder reads and writes, kept unchanged so filters
 * saved by SearchBuilder keep working. The types are mutable (not `readonly`) because apps that
 * already use this shape build and edit filters in place.
 */

/** Condition operators for filtering. */
export type ConditionOperator =
  | ">="
  | ">"
  | "="
  | "!="
  | "<"
  | "<="
  | "null"
  | "!null"
  | "between"
  | "!between"
  | "contains"
  | "!contains"
  | "starts"
  | "!starts"
  | "ends"
  | "!ends"
  | "without";

/**
 * How a field's values compare. These are SearchBuilder's column types:
 *
 * - `num`: a plain number.
 * - `num-fmt`: a formatted number such as "$86,000" or "45%". Everything except digits, the
 *   decimal point and a leading minus sign is dropped before comparing.
 * - `string`: text.
 * - `date`: a date written year first ("2011-04-25" or "2011/04/25"), compared as text.
 * - `array`: a list of text values, such as tags.
 * - `html`, `html-num`, `html-num-fmt`: as `string`, `num` and `num-fmt`, for values that still
 *   hold HTML tags. The tags are removed before comparing.
 *
 * SearchBuilder's `moment` and `luxon` date types are not supported: they need those libraries.
 */
export type ConditionType =
  | "num"
  | "num-fmt"
  | "string"
  | "date"
  | "array"
  | "html"
  | "html-num"
  | "html-num-fmt";

/** Logic operators for combining criteria. */
export type LogicOperator = "AND" | "OR";

/**
 * Leaf condition (actual filter condition)
 * Represents a single filterable condition on a field
 */
export interface LeafCondition {
  condition: ConditionOperator;
  data: string; // Display name (e.g., "Growth %")
  origData: string; // Field key, often a dotted path (e.g., "details.growth")
  type: ConditionType; // Data type for comparison
  value: string[]; // Values for the condition (1 for most, 2 for between)
}

/**
 * Nested filter group (contains sub-criteria)
 * Enables complex logical expressions with AND/OR
 */
export interface FilterGroup {
  criteria: Criterion[];
  logic: LogicOperator;
}

/**
 * A criterion can be either a leaf condition or a nested group
 * This enables recursive filter structures of arbitrary complexity
 */
export type Criterion = LeafCondition | FilterGroup;

/**
 * Main filter definition type
 * Top-level structure for complete filter expressions
 */
export interface FilterDefinition {
  criteria: Criterion[];
  logic: LogicOperator;
}

/**
 * Type guard to check if a criterion is a leaf condition
 */
export function isLeafCondition(
  criterion: Criterion,
): criterion is LeafCondition {
  return (
    isCriterionObject(criterion) &&
    "condition" in criterion &&
    !("criteria" in criterion)
  );
}

/**
 * Whether this slot in a filter holds an object at all.
 *
 * A filter comes back from its database column exactly as it was stored, so a slot may hold anything —
 * including nothing (`null`) or a bare number. Asking such a value which keys it has stops the run
 * outright, so both checks below rule it out first.
 */
export function isCriterionObject(criterion: unknown): criterion is object {
  return typeof criterion === "object" && criterion !== null;
}

/**
 * Type guard to check if a criterion is a filter group
 */
export function isFilterGroup(criterion: Criterion): criterion is FilterGroup {
  // The list of conditions must really be a list. A filter comes back from its database column
  // exactly as it was stored, and every caller walks `criteria` with list methods, so a group holding
  // anything else stopped them mid-run.
  return (
    isCriterionObject(criterion) &&
    "criteria" in criterion &&
    "logic" in criterion &&
    Array.isArray(criterion.criteria)
  );
}

import type {
  ConditionOperator,
  Criterion,
  FilterDefinition,
  LeafCondition,
} from "./types";
import { isFilterGroup, isLeafCondition } from "./types";

/**
 * Map of operator inversions for logical negation
 * Used to convert filter conditions to their opposite (De Morgan's Laws)
 */
export const OPERATOR_INVERSIONS: Record<ConditionOperator, ConditionOperator> =
  {
    ">=": "<",
    ">": "<=",
    "=": "!=",
    "!=": "=",
    "<": ">=",
    "<=": ">",
    null: "!null",
    "!null": "null",
    between: "!between",
    "!between": "between",
    contains: "!contains",
    "!contains": "contains",
    starts: "!starts",
    "!starts": "starts",
    ends: "!ends",
    "!ends": "ends",
    without: "contains",
  };

/**
 * The opposite of an operator for a field of the given type.
 *
 * Mostly `OPERATOR_INVERSIONS`. A list is the exception: the opposite of "contains" is
 * "without", because SearchBuilder has no "does not contain" for lists.
 */
export function invertOperator(
  operator: ConditionOperator,
  type: LeafCondition["type"],
): ConditionOperator | undefined {
  if (type === "array" && operator === "contains") return "without";
  // `Object.hasOwn`: a stored filter may hold an operator this library does not know.
  return Object.hasOwn(OPERATOR_INVERSIONS, operator)
    ? OPERATOR_INVERSIONS[operator]
    : undefined;
}

/**
 * Inverts a filter definition using De Morgan's Laws
 * NOT(A AND B) = (NOT A) OR (NOT B)
 * NOT(A OR B) = (NOT A) AND (NOT B)
 *
 * @param filter - The filter definition to invert
 * @param excludeFields - Optional array of origData field paths to exclude from inversion
 * @returns The inverted filter definition
 *
 * @example
 * const filter = { criteria: [...], logic: "AND" };
 * const opposite = invertFilter(filter, ["createdAt"]); // Negates all conditions except excluded fields
 */
export function invertFilter(
  filter: FilterDefinition,
  excludeFields: string[] = [],
): FilterDefinition {
  const invertedCriteria = filter.criteria
    .map((criterion) => invertCriterion(criterion, excludeFields))
    .filter((criterion): criterion is Criterion => criterion !== null); // Remove null entries

  return {
    criteria: invertedCriteria,
    logic: filter.logic === "AND" ? "OR" : "AND", // De Morgan's Law: flip the logic
  };
}

/**
 * Inverts a single criterion (leaf condition or nested group)
 * Recursively handles nested filter groups
 * Returns null for excluded criteria (they will be filtered out)
 *
 * @param criterion - The criterion to invert
 * @param excludeFields - Array of origData field paths to exclude from inversion
 * @returns The inverted criterion, or null if excluded
 */
function invertCriterion(
  criterion: Criterion,
  excludeFields: string[] = [],
): Criterion | null {
  if (isLeafCondition(criterion)) {
    // Skip (exclude) this condition if its origData is in the exclude list
    if (excludeFields.includes(criterion.origData)) {
      return null;
    }

    // Invert the operator for leaf conditions
    const invertedOperator = invertOperator(
      criterion.condition,
      criterion.type,
    );
    // If no inversion exists, return the original criterion (graceful degradation).
    // This could happen if new operators are added without updating OPERATOR_INVERSIONS.
    // Consider making this explicit or adding validation if strict behavior is needed.
    if (!invertedOperator) {
      return criterion;
    }
    return {
      ...criterion,
      condition: invertedOperator,
    };
  }

  if (isFilterGroup(criterion)) {
    // Recursively invert nested groups
    const invertedCriteria = criterion.criteria
      .map((c) => invertCriterion(c, excludeFields))
      .filter((c): c is Criterion => c !== null); // Remove null entries

    // If all criteria were excluded, return null to remove this group
    if (invertedCriteria.length === 0) {
      return null;
    }

    return {
      criteria: invertedCriteria,
      logic: criterion.logic === "AND" ? "OR" : "AND", // De Morgan's Law
    };
  }

  // Should never reach here with proper types
  return criterion;
}

/**
 * Strip conditions matching a predicate (for creating a variant of a filter)
 *
 * @param filter - The filter definition to modify
 * @param predicate - Function that returns true for conditions to remove
 * @returns A new filter with matching conditions removed
 *
 * This is also how to take one field out of a filter: pass a predicate that matches the field,
 * such as `(condition) => condition.origData === "account.amount"`.
 *
 * @example
 * const withoutUserFields = stripConditions(
 *   filter,
 *   (condition) => condition.origData.startsWith("user.")
 * );
 */
export function stripConditions(
  filter: FilterDefinition,
  predicate: (condition: LeafCondition) => boolean,
): FilterDefinition {
  const strippedCriteria = filter.criteria
    .map((criterion) => stripCriterionConditions(criterion, predicate))
    .filter((c): c is Criterion => c !== null);

  return {
    ...filter,
    criteria: strippedCriteria,
  };
}

/**
 * Helper to strip conditions from a criterion based on predicate
 */
function stripCriterionConditions(
  criterion: Criterion,
  predicate: (condition: LeafCondition) => boolean,
): Criterion | null {
  if (isLeafCondition(criterion)) {
    // If predicate returns true, remove this condition
    if (predicate(criterion)) {
      return null;
    }
    return criterion;
  }

  if (isFilterGroup(criterion)) {
    const remainingCriteria = criterion.criteria
      .map((c) => stripCriterionConditions(c, predicate))
      .filter((c): c is Criterion => c !== null);

    // If all criteria were stripped, remove this group
    if (remainingCriteria.length === 0) {
      return null;
    }

    return {
      ...criterion,
      criteria: remainingCriteria,
    };
  }

  return criterion;
}

import type { ConditionOperator, LogicOperator } from "./types";

/**
 * Plain-English names for each operator, as shown in a builder's operator dropdown.
 * An app can override any of them: `{ ...OPERATOR_LABELS, ">=": "min" }`.
 */
export const OPERATOR_LABELS: Record<ConditionOperator, string> = {
  "=": "is",
  "!=": "is not",
  "<": "less than",
  "<=": "at most",
  ">=": "at least",
  ">": "more than",
  between: "between",
  "!between": "not between",
  contains: "contains",
  "!contains": "does not contain",
  starts: "starts with",
  "!starts": "does not start with",
  ends: "ends with",
  "!ends": "does not end with",
  without: "does not include",
  null: "is empty",
  "!null": "is not empty",
};

/** The word shown between rows of a group, and bolded in a summary. */
export const LOGIC_JOINERS: Record<LogicOperator, string> = {
  AND: "and",
  OR: "or",
};

/** The choice shown in a group's "Match … of these" dropdown, with its hint. */
export const LOGIC_LABELS: Record<
  LogicOperator,
  { label: string; hint: string }
> = {
  AND: { label: "all", hint: "every one must pass (AND)" },
  OR: { label: "any", hint: "one is enough (OR)" },
};

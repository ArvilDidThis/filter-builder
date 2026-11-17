import type { ConditionOperator, LeafCondition } from "./types";

/** One choice in a dropdown value: the stored value and the text shown for it. */
export interface FieldChoice {
  /** The value stored in the filter, e.g. "FEATURED". */
  value: string;
  /** The text shown to people, e.g. "Featured". */
  label: string;
}

/**
 * Describes one field a filter can use. Each app passes in its own list, which is what keeps
 * app-specific knowledge out of this library.
 */
export interface FieldDefinition {
  /** Stored as the condition's `origData`. Must be unique in the list. */
  key: string;
  /** Stored as the condition's `data`, and shown in the builder. */
  label: string;
  /** How the field reads mid-sentence in a summary, e.g. "budget". Defaults to `label`. */
  summaryLabel?: string;
  /** How values compare: as numbers, text, dates or lists. See `ConditionType`. */
  type: LeafCondition["type"];
  /** Shown before the value, e.g. "$". */
  prefix?: string;
  /** Shown after the value, e.g. "B" or "%". */
  suffix?: string;
  /** When set, the value is picked from this list instead of typed. */
  choices?: readonly FieldChoice[];
  /** Limits which operators the builder offers for this field. */
  operators?: readonly ConditionOperator[];
}

/** Looks fields up by key. Build it once per field list, not once per condition. */
export type FieldLookup = ReadonlyMap<string, FieldDefinition>;

/**
 * Builds a `FieldLookup` from a field list, keyed by each field's `key`.
 * Build it once per field list, not once per condition.
 */
export function createFieldLookup(
  fields: readonly FieldDefinition[],
): FieldLookup {
  return new Map(fields.map((field) => [field.key, field]));
}

const NUMBER_OPERATORS: readonly ConditionOperator[] = [
  "=",
  "!=",
  "<",
  "<=",
  ">=",
  ">",
  "between",
  "!between",
  "null",
  "!null",
];

const TEXT_OPERATORS: readonly ConditionOperator[] = [
  "=",
  "!=",
  "starts",
  "!starts",
  "contains",
  "!contains",
  "ends",
  "!ends",
  "null",
  "!null",
];

/**
 * The operators that make sense for each kind of field, in the order a builder lists them.
 * Same sets and order as SearchBuilder, so the evaluator has a rule for every pairing.
 */
export const OPERATORS_BY_TYPE: Record<
  LeafCondition["type"],
  readonly ConditionOperator[]
> = {
  num: NUMBER_OPERATORS,
  "num-fmt": NUMBER_OPERATORS,
  "html-num": NUMBER_OPERATORS,
  "html-num-fmt": NUMBER_OPERATORS,
  string: TEXT_OPERATORS,
  html: TEXT_OPERATORS,
  date: ["=", "!=", "<", ">", "between", "!between", "null", "!null"],
  array: ["contains", "without", "=", "!=", "null", "!null"],
};

/** The operators a builder should offer for one field. */
export function operatorsForField(
  field: Pick<FieldDefinition, "type" | "operators">,
): readonly ConditionOperator[] {
  return field.operators ?? OPERATORS_BY_TYPE[field.type];
}

import { isConditionFilled } from "./evaluate";
import type { FieldDefinition, FieldLookup } from "./fields";
import { createFieldLookup } from "./fields";
import { LOGIC_JOINERS } from "./labels";
import type {
  ConditionOperator,
  Criterion,
  LeafCondition,
  LogicOperator,
} from "./types";
import { isFilterGroup } from "./types";

/**
 * One piece of a filter summary. A summary is a list of parts rather than one string so a UI can
 * style the joiners ("and" / "or") differently — the design shows them in bold.
 * Joining every part's `text` in order gives the full sentence.
 */
export type SummaryPart =
  | { kind: "text"; text: string }
  | { kind: "joiner"; text: string };

/**
 * How each operator reads in a sentence, given its already-formatted values.
 * `values` holds as many entries as the operator needs: two for "between", none for "is empty".
 */
export type OperatorPhrases = Record<
  ConditionOperator,
  (values: readonly string[]) => string
>;

/** The default English wording for each operator. Override parts of it with `phrases`. */
export const OPERATOR_PHRASES: OperatorPhrases = {
  "=": ([v]) => `is ${v}`,
  "!=": ([v]) => `is not ${v}`,
  "<": ([v]) => `less than ${v}`,
  "<=": ([v]) => `up to ${v}`,
  ">=": ([v]) => `${v} or more`,
  ">": ([v]) => `more than ${v}`,
  between: ([a, b]) => `between ${a} and ${b}`,
  "!between": ([a, b]) => `not between ${a} and ${b}`,
  contains: ([v]) => `contains ${v}`,
  "!contains": ([v]) => `does not contain ${v}`,
  starts: ([v]) => `starts with ${v}`,
  "!starts": ([v]) => `does not start with ${v}`,
  ends: ([v]) => `ends with ${v}`,
  "!ends": ([v]) => `does not end with ${v}`,
  without: ([v]) => `does not include ${v}`,
  null: () => "is empty",
  "!null": () => "is not empty",
};

/**
 * Wording that differs for a date field, where "less than" reads wrongly. Operators not listed
 * here use `OPERATOR_PHRASES`. Override parts of it with `datePhrases`.
 */
export const DATE_OPERATOR_PHRASES: Partial<OperatorPhrases> = {
  "<": ([v]) => `before ${v}`,
  "<=": ([v]) => `on or before ${v}`,
  ">": ([v]) => `after ${v}`,
  ">=": ([v]) => `on or after ${v}`,
};

/** The operators that compare a whole list at once. */
const LIST_EQUALITY: ReadonlySet<ConditionOperator> = new Set(["=", "!="]);

/** Options that change the wording of a summary. */
export interface DescribeFilterOptions {
  /** Replace the wording of some operators. Unlisted ones keep `OPERATOR_PHRASES`. */
  phrases?: Partial<OperatorPhrases>;
  /** Replace the wording of some operators on date fields only. */
  datePhrases?: Partial<OperatorPhrases>;
  /** Replace the joiner words, e.g. for another language. */
  joiners?: Record<LogicOperator, string>;
}

/** The slice of a filter that `describeFilter` reads. Loose on purpose: see `describeFilter`. */
interface DescribableFilter {
  criteria: readonly Criterion[];
  logic: LogicOperator;
}

/**
 * Formats one stored value the way a person reads it: a choice's label ("Featured" for
 * "FEATURED"), or the value with the field's prefix and suffix ("$10B", "15%").
 */
export function formatFieldValue(
  field: FieldDefinition | undefined,
  value: string,
): string {
  const choice = field?.choices?.find((c) => c.value === value);
  if (choice) return choice.label;
  return `${field?.prefix ?? ""}${value}${field?.suffix ?? ""}`;
}

/**
 * Turns a filter into a plain-English summary, such as
 * "budget $10B or more **and** (ratio up to 50 **or** ratio is empty)".
 *
 * It describes what matching APPLIES, so it follows the evaluator's rules: a condition that is
 * not filled in is left out, and so is a group with nothing filled in. A nested group gets
 * brackets only when it holds more than one described item.
 *
 * Returns an empty list when the filter narrows nothing.
 *
 * @param fields - The app's field list, or a lookup built once with `createFieldLookup`.
 */
export function describeFilter(
  filter: DescribableFilter | null | undefined,
  fields: readonly FieldDefinition[] | FieldLookup,
  options: DescribeFilterOptions = {},
): SummaryPart[] {
  if (!filter || !Array.isArray(filter.criteria)) return [];
  const lookup: FieldLookup =
    fields instanceof Map
      ? fields
      : createFieldLookup(fields as readonly FieldDefinition[]);
  const phrases: OperatorPhrases = { ...OPERATOR_PHRASES, ...options.phrases };
  // A caller's general wording still applies to dates, unless date wording replaces it.
  const datePhrases: OperatorPhrases = {
    ...phrases,
    ...DATE_OPERATOR_PHRASES,
    ...options.phrases,
    ...options.datePhrases,
  };
  const joiners = options.joiners ?? LOGIC_JOINERS;

  const describeLeaf = (leaf: LeafCondition): string => {
    const field = lookup.get(leaf.origData);
    // An unknown field (removed from the app since the filter was saved) falls back to the name
    // stored in the filter itself, so the summary still reads.
    const label = field?.summaryLabel ?? field?.label ?? leaf.data;
    // Safe only for a filled condition: `isConditionFilled` has checked that the value is a list
    // of text and that the operator is a known one. Keep that check in front of every call.
    const values = leaf.value.map((v) => formatFieldValue(field, v));
    if (leaf.type === "array" && LIST_EQUALITY.has(leaf.condition)) {
      // "Is" on a list compares the whole list, so every value is named, not just the first.
      return `${label} ${phrases[leaf.condition]([values.join(", ")])}`;
    }
    const wording = leaf.type === "date" ? datePhrases : phrases;
    return `${label} ${wording[leaf.condition](values)}`;
  };

  // Each described item is a list of parts: one text part for a condition, several for a group.
  const describeItems = (criteria: readonly Criterion[]): SummaryPart[][] => {
    const items: SummaryPart[][] = [];
    for (const criterion of criteria) {
      if (isFilterGroup(criterion)) {
        const inner = describeItems(criterion.criteria);
        if (inner.length === 0) continue;
        const joined = joinItems(inner, joiners[criterion.logic] ?? "");
        items.push(
          inner.length > 1 ? [text("("), ...joined, text(")")] : joined,
        );
      } else if (isConditionFilled(criterion)) {
        items.push([text(describeLeaf(criterion))]);
      }
    }
    return items;
  };

  const items = describeItems(filter.criteria);
  return mergeText(joinItems(items, joiners[filter.logic] ?? ""));
}

/** Joins a summary's parts into one plain string, for places that cannot style the joiners. */
export function summaryToText(parts: readonly SummaryPart[]): string {
  return parts.map((part) => part.text).join("");
}

const text = (value: string): SummaryPart => ({ kind: "text", text: value });

/** Puts the joiner word, with a space either side, between each pair of items. */
function joinItems(items: SummaryPart[][], joiner: string): SummaryPart[] {
  const out: SummaryPart[] = [];
  items.forEach((item, index) => {
    if (index > 0) {
      out.push(text(" "), { kind: "joiner", text: joiner }, text(" "));
    }
    out.push(...item);
  });
  return out;
}

/** Merges neighbouring text parts, so a UI renders as few pieces as possible. */
function mergeText(parts: SummaryPart[]): SummaryPart[] {
  const out: SummaryPart[] = [];
  for (const part of parts) {
    const last = out[out.length - 1];
    if (part.kind === "text" && last?.kind === "text") {
      out[out.length - 1] = text(last.text + part.text);
    } else {
      out.push(part);
    }
  }
  return out;
}

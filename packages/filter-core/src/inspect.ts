import { isConditionFilled } from "./evaluate";
import type { Criterion, FilterDefinition, LeafCondition } from "./types";
import { isFilterGroup, isLeafCondition } from "./types";

/**
 * Counts the condition rows in a filter, at any depth. Groups themselves are not counted.
 *
 * This counts every condition row a builder would show, filled in or not. Use
 * `countFilledConditions` for the number that actually narrows the result.
 */
export function countConditions(
  filter: FilterDefinition | null | undefined,
): number {
  return countLeaves(filter?.criteria, () => true);
}

/** Counts only the conditions that are filled in, which are the ones matching applies. */
export function countFilledConditions(
  filter: FilterDefinition | null | undefined,
): number {
  return countLeaves(filter?.criteria, isConditionFilled);
}

function countLeaves(
  criteria: readonly Criterion[] | undefined,
  counts: (leaf: LeafCondition) => boolean,
): number {
  // Read loosely, like the evaluator: a stored filter may hold anything, even a non-list here.
  if (!Array.isArray(criteria)) return 0;
  let total = 0;
  for (const criterion of criteria) {
    if (isFilterGroup(criterion)) {
      total += countLeaves(criterion.criteria, counts);
    } else if (isLeafCondition(criterion) && counts(criterion)) {
      total += 1;
    }
  }
  return total;
}

/**
 * Walks a filter and collects every condition's `origData` path with its `type`, de-duplicated
 * and in first-seen order (the type comes from the first condition that uses the path).
 *
 * This answers "which fields does this filter use?".
 *
 * @param shouldSkip - Optional. Return true for a path to leave out.
 */
export function collectFilterPathTypes(
  filter: FilterDefinition | null | undefined,
  shouldSkip: (path: string) => boolean = () => false,
): { path: string; type: LeafCondition["type"] }[] {
  const seen = new Set<string>();
  const out: { path: string; type: LeafCondition["type"] }[] = [];
  const walk = (criterion: Criterion): void => {
    if (isLeafCondition(criterion)) {
      const path = criterion.origData;
      if (!shouldSkip(path) && !seen.has(path)) {
        seen.add(path);
        out.push({ path, type: criterion.type });
      }
      return;
    }
    if (isFilterGroup(criterion)) {
      for (const child of criterion.criteria) walk(child);
    }
  };
  // Read loosely, like the counters: a stored filter may be missing or hold a non-list here.
  const criteria: unknown = filter?.criteria;
  if (!Array.isArray(criteria)) return out;
  for (const criterion of criteria) walk(criterion);
  return out;
}

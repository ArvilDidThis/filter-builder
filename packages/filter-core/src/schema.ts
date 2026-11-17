/**
 * Validates filters that come from outside the app: pasted JSON, API input, a form about to save.
 *
 * This is the only file that imports Effect. It is published as its own entry point
 * (`@arvilmena/filter-core/schema`) so apps that never validate never load the Effect runtime.
 *
 * Matching does NOT validate first. The evaluator reads stored filters loosely and skips a broken
 * slot; rejecting the whole filter there would change which rows a saved filter returns.
 */
import { Data, Effect, Result, Schema } from "effect";
import type {
  ConditionOperator,
  ConditionType,
  FilterDefinition,
  FilterGroup,
  LeafCondition,
  LogicOperator,
} from "./types";

/** Accepts the operators a condition may use. */
export const ConditionOperatorSchema: Schema.Codec<ConditionOperator> =
  Schema.Literals([
    ">=",
    ">",
    "=",
    "!=",
    "<",
    "<=",
    "null",
    "!null",
    "between",
    "!between",
    "contains",
    "!contains",
    "starts",
    "!starts",
    "ends",
    "!ends",
    "without",
  ]);

/** Accepts the data types a condition may compare as. */
export const ConditionTypeSchema: Schema.Codec<ConditionType> = Schema.Literals(
  [
    "num",
    "num-fmt",
    "string",
    "date",
    "array",
    "html",
    "html-num",
    "html-num-fmt",
  ],
);

/** Accepts the two ways a group joins its conditions. */
export const LogicOperatorSchema: Schema.Codec<LogicOperator> = Schema.Literals(
  ["AND", "OR"],
);

/** Accepts one condition on a field. */
// `Schema.mutable` because the library's filter types are mutable (see types.ts); without it the
// decoded lists would be `readonly` and not fit `FilterDefinition`.
export const LeafConditionSchema: Schema.Codec<LeafCondition> = Schema.Struct({
  condition: ConditionOperatorSchema,
  data: Schema.String,
  origData: Schema.String,
  type: ConditionTypeSchema,
  value: Schema.mutable(Schema.Array(Schema.String)),
});

/** Accepts a group of conditions and nested groups, at any depth. */
// A group can hold groups, so the schema refers to itself. `Schema.suspend` delays that
// reference until it is needed; the explicit type is what lets TypeScript follow the loop.
export const FilterGroupSchema: Schema.Codec<FilterGroup> = Schema.Struct({
  criteria: Schema.mutable(
    Schema.Array(
      Schema.Union([
        LeafConditionSchema,
        Schema.suspend((): Schema.Codec<FilterGroup> => FilterGroupSchema),
      ]),
    ),
  ),
  logic: LogicOperatorSchema,
});

/** A whole filter has the same shape as a group: a list of criteria and how to combine them. */
export const FilterDefinitionSchema: Schema.Codec<FilterDefinition> =
  FilterGroupSchema;

/** The input is not a valid filter. `message` lists each problem with where it is. */
export class InvalidFilterError extends Data.TaggedError("InvalidFilterError")<{
  readonly message: string;
}> {}

const decodeResult = Schema.decodeUnknownResult(FilterDefinitionSchema);

/**
 * Checks that `input` is a valid filter, for callers outside Effect (a form, a paste handler).
 * Unknown extra keys are dropped rather than rejected.
 *
 * @example
 * const result = decodeFilterResult(JSON.parse(pasted));
 * if (Result.isSuccess(result)) setFilter(result.success);
 */
export function decodeFilterResult(
  input: unknown,
): Result.Result<FilterDefinition, InvalidFilterError> {
  return Result.mapError(
    decodeResult(input),
    (error) => new InvalidFilterError({ message: error.message }),
  );
}

/** The same check as `decodeFilterResult`, as an Effect that fails with `InvalidFilterError`. */
export function decodeFilter(
  input: unknown,
): Effect.Effect<FilterDefinition, InvalidFilterError> {
  return Effect.fromResult(decodeFilterResult(input));
}

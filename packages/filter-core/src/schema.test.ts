import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { decodeFilter, decodeFilterResult } from "./schema";

const leaf = {
  condition: ">=",
  data: "Score",
  origData: "a.score",
  type: "num",
  value: ["20"],
};

// The same inputs were run through the zod schema this replaces; both gave these answers.
const accepted: Array<[string, unknown]> = [
  ["a flat filter", { criteria: [leaf], logic: "AND" }],
  ["an empty filter", { criteria: [], logic: "OR" }],
  [
    "three levels of groups",
    {
      criteria: [
        leaf,
        { criteria: [leaf, { criteria: [leaf], logic: "AND" }], logic: "OR" },
      ],
      logic: "AND",
    },
  ],
  [
    "an extra key on a condition",
    { criteria: [{ ...leaf, x: 1 }], logic: "AND" },
  ],
  ["an extra key on the filter", { criteria: [], logic: "AND", x: 1 }],
  [
    "a date condition",
    {
      criteria: [
        { ...leaf, type: "date", condition: "<", value: ["2011-04-25"] },
      ],
      logic: "AND",
    },
  ],
  [
    "a list condition",
    {
      criteria: [
        { ...leaf, type: "array", condition: "without", value: ["a"] },
      ],
      logic: "AND",
    },
  ],
  [
    "an unfilled condition",
    { criteria: [{ ...leaf, value: [] }], logic: "AND" },
  ],
];

const rejected: Array<[string, unknown]> = [
  ["nothing in a slot", { criteria: [null], logic: "AND" }],
  ["a number in a slot", { criteria: [5], logic: "AND" }],
  ["text where the list belongs", { criteria: "x", logic: "AND" }],
  [
    "text where a nested list belongs",
    { criteria: [{ criteria: "x", logic: "OR" }], logic: "AND" },
  ],
  ["an unknown logic word", { criteria: [], logic: "XOR" }],
  [
    "a data type that needs a date library",
    { criteria: [{ ...leaf, type: "moment" }], logic: "AND" },
  ],
  [
    "an unknown operator",
    { criteria: [{ ...leaf, condition: "toString" }], logic: "AND" },
  ],
  [
    "a value that is text, not a list",
    { criteria: [{ ...leaf, value: "20" }], logic: "AND" },
  ],
  [
    "a value list holding a number",
    { criteria: [{ ...leaf, value: [20] }], logic: "AND" },
  ],
  [
    "a condition missing its display name",
    {
      criteria: [{ condition: ">=", origData: "a", type: "num", value: [] }],
      logic: "AND",
    },
  ],
  ["null", null],
  ["plain text", "x"],
];

describe("decodeFilterResult", () => {
  it.each(accepted)("accepts %s", (_name, input) => {
    expect(Result.isSuccess(decodeFilterResult(input))).toBe(true);
  });

  it.each(rejected)("rejects %s", (_name, input) => {
    expect(Result.isFailure(decodeFilterResult(input))).toBe(true);
  });

  it("drops unknown extra keys rather than keeping them", () => {
    const result = decodeFilterResult({
      criteria: [{ ...leaf, x: 1 }],
      logic: "AND",
      y: 2,
    });
    expect(Result.isSuccess(result) && result.success).toEqual({
      criteria: [leaf],
      logic: "AND",
    });
  });

  it("says what is wrong and where", () => {
    const result = decodeFilterResult({
      criteria: [{ ...leaf, condition: "toString" }],
      logic: "AND",
    });
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("InvalidFilterError");
      expect(result.failure.message).toContain('["criteria"][0]["condition"]');
    }
  });
});

describe("decodeFilter", () => {
  it.effect("succeeds with the filter", () =>
    Effect.gen(function* () {
      const filter = yield* decodeFilter({ criteria: [leaf], logic: "AND" });
      expect(filter.criteria).toHaveLength(1);
    }),
  );

  it.effect("fails with a tagged error that can be caught by name", () =>
    Effect.gen(function* () {
      const recovered = yield* decodeFilter({
        criteria: "x",
        logic: "AND",
      }).pipe(
        Effect.catchTag("InvalidFilterError", (error) =>
          Effect.succeed(error.message),
        ),
      );
      expect(recovered).toContain('["criteria"]');
    }),
  );
});

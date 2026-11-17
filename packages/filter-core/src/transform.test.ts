import { describe, expect, test } from "vitest";
import {
  invertFilter,
  OPERATOR_INVERSIONS,
  stripConditions,
} from "./transform";
import type {
  Criterion,
  FilterDefinition,
  FilterGroup,
  LeafCondition,
} from "./types";
import { isFilterGroup } from "./types";

/** Fails the test unless the criterion is a group, then returns it as one. */
const expectGroup = (criterion: Criterion | undefined): FilterGroup => {
  if (!criterion || !isFilterGroup(criterion)) {
    throw new Error("Expected a group, got a condition or nothing");
  }
  return criterion;
};

describe("Filter Helpers", () => {
  describe("OPERATOR_INVERSIONS", () => {
    test("should have inversions for all comparison operators", () => {
      expect(OPERATOR_INVERSIONS[">="]).toBe("<");
      expect(OPERATOR_INVERSIONS[">"]).toBe("<=");
      expect(OPERATOR_INVERSIONS["<="]).toBe(">");
      expect(OPERATOR_INVERSIONS["<"]).toBe(">=");
      expect(OPERATOR_INVERSIONS["="]).toBe("!=");
      expect(OPERATOR_INVERSIONS["!="]).toBe("=");
    });

    test("should have inversions for null operators", () => {
      expect(OPERATOR_INVERSIONS.null).toBe("!null");
      expect(OPERATOR_INVERSIONS["!null"]).toBe("null");
    });

    test("should have inversions for between operators", () => {
      expect(OPERATOR_INVERSIONS.between).toBe("!between");
      expect(OPERATOR_INVERSIONS["!between"]).toBe("between");
    });

    test("should have inversions for string operators", () => {
      expect(OPERATOR_INVERSIONS.contains).toBe("!contains");
      expect(OPERATOR_INVERSIONS["!contains"]).toBe("contains");
      expect(OPERATOR_INVERSIONS.starts).toBe("!starts");
      expect(OPERATOR_INVERSIONS["!starts"]).toBe("starts");
      expect(OPERATOR_INVERSIONS.ends).toBe("!ends");
      expect(OPERATOR_INVERSIONS["!ends"]).toBe("ends");
    });
  });

  describe("invertFilter", () => {
    test("should invert simple AND filter to OR", () => {
      const filter: FilterDefinition = {
        criteria: [
          {
            condition: ">=",
            data: "Score",
            origData: "score",
            type: "num",
            value: ["5"],
          },
        ],
        logic: "AND",
      };

      const inverted = invertFilter(filter);

      expect(inverted.logic).toBe("OR"); // De Morgan's Law: AND → OR
      expect(inverted.criteria).toHaveLength(1);
      const criterion = inverted.criteria[0] as LeafCondition;
      expect(criterion.condition).toBe("<"); // >= → <
    });

    test("should invert simple OR filter to AND", () => {
      const filter: FilterDefinition = {
        criteria: [
          {
            condition: ">",
            data: "Score",
            origData: "score",
            type: "num",
            value: ["5"],
          },
        ],
        logic: "OR",
      };

      const inverted = invertFilter(filter);

      expect(inverted.logic).toBe("AND"); // De Morgan's Law: OR → AND
    });

    test("should handle nested filter groups", () => {
      const filter: FilterDefinition = {
        criteria: [
          {
            criteria: [
              {
                condition: ">=",
                data: "Score A",
                origData: "scoreA",
                type: "num",
                value: ["5"],
              },
              {
                condition: ">=",
                data: "Score B",
                origData: "scoreB",
                type: "num",
                value: ["3"],
              },
            ],
            logic: "AND",
          },
        ],
        logic: "AND",
      };

      const inverted = invertFilter(filter);

      expect(inverted.logic).toBe("OR"); // Top level: AND → OR
      expect(inverted.criteria).toHaveLength(1);
      // Nested group should also be inverted
      const nestedGroup = expectGroup(inverted.criteria[0]);
      expect(nestedGroup.logic).toBe("OR"); // Nested: AND → OR
      expect(nestedGroup.criteria).toHaveLength(2);
    });

    test("should exclude specified fields from inversion", () => {
      const filter: FilterDefinition = {
        criteria: [
          {
            condition: ">=",
            data: "Score",
            origData: "score",
            type: "num",
            value: ["5"],
          },
          {
            condition: "<=",
            data: "Age",
            origData: "age",
            type: "num",
            value: ["30"],
          },
        ],
        logic: "AND",
      };

      const inverted = invertFilter(filter, ["age"]);

      // Should only have 1 criterion (age excluded)
      expect(inverted.criteria).toHaveLength(1);
      const criterion = inverted.criteria[0] as LeafCondition;
      expect(criterion.origData).toBe("score");
    });

    test("should handle unknown operator gracefully", () => {
      const filter: FilterDefinition = {
        criteria: [
          {
            // biome-ignore lint/suspicious/noExplicitAny: Testing unknown operator handling
            condition: "unknown" as any,
            data: "Test",
            origData: "test",
            type: "num",
            value: ["1"],
          },
        ],
        logic: "AND",
      };

      const inverted = invertFilter(filter);

      // Should return original criterion if operator not found
      expect(inverted.criteria).toHaveLength(1);
      const criterion = inverted.criteria[0] as LeafCondition;
      // biome-ignore lint/suspicious/noExplicitAny: Testing unknown operator
      expect(criterion.condition as any).toBe("unknown"); // Original unchanged
    });
  });

  describe("stripConditions", () => {
    test("should strip conditions matching predicate", () => {
      const filter: FilterDefinition = {
        criteria: [
          {
            condition: ">=",
            data: "Score",
            origData: "metrics.score",
            type: "num",
            value: ["5"],
          },
          {
            condition: "!null",
            data: "Amount",
            origData: "user.amount",
            type: "num",
            value: [],
          },
          {
            condition: "<",
            data: "Another Amount",
            origData: "user.balance",
            type: "num",
            value: ["1000"],
          },
        ],
        logic: "AND",
      };

      const stripped = stripConditions(filter, (c) =>
        c.origData.startsWith("user."),
      );

      // Should only have 1 criterion left (metrics.score)
      expect(stripped.criteria).toHaveLength(1);
      const criterion = stripped.criteria[0] as LeafCondition;
      expect(criterion.origData).toBe("metrics.score");
    });

    test("should handle nested groups", () => {
      const filter: FilterDefinition = {
        criteria: [
          {
            criteria: [
              {
                condition: ">=",
                data: "Score",
                origData: "metrics.score",
                type: "num",
                value: ["5"],
              },
              {
                condition: "!null",
                data: "Amount",
                origData: "user.amount",
                type: "num",
                value: [],
              },
            ],
            logic: "OR",
          },
        ],
        logic: "AND",
      };

      const stripped = stripConditions(filter, (c) =>
        c.origData.startsWith("user."),
      );

      // Nested group should still exist with one criterion
      expect(stripped.criteria).toHaveLength(1);
      const nestedGroup = expectGroup(stripped.criteria[0]);
      expect(nestedGroup.criteria).toHaveLength(1);
      const criterion = nestedGroup.criteria[0] as LeafCondition;
      expect(criterion.origData).toBe("metrics.score");
    });

    test("should remove empty groups after stripping", () => {
      const filter: FilterDefinition = {
        criteria: [
          {
            criteria: [
              {
                condition: "!null",
                data: "Amount",
                origData: "user.amount",
                type: "num",
                value: [],
              },
            ],
            logic: "AND",
          },
        ],
        logic: "AND",
      };

      const stripped = stripConditions(filter, (c) =>
        c.origData.startsWith("user."),
      );

      // All criteria stripped, should have no criteria left
      expect(stripped.criteria).toHaveLength(0);
    });

    test("should remove every condition on one field, at any depth", () => {
      const onField = (value: string): LeafCondition => ({
        condition: ">=",
        data: "Amount",
        origData: "account.amount",
        type: "num",
        value: [value],
      });
      const other: LeafCondition = {
        condition: ">=",
        data: "Score",
        origData: "metrics.score",
        type: "num",
        value: ["5"],
      };
      // One match at the top, one two groups deep beside another condition, and one that is
      // the only content of its group.
      const filter: FilterDefinition = {
        criteria: [
          onField("1"),
          {
            criteria: [{ criteria: [onField("2"), other], logic: "AND" }],
            logic: "OR",
          },
          { criteria: [onField("3")], logic: "AND" },
        ],
        logic: "AND",
      };

      const result = stripConditions(
        filter,
        (condition) => condition.origData === "account.amount",
      );

      expect(result).toEqual({
        criteria: [
          { criteria: [{ criteria: [other], logic: "AND" }], logic: "OR" },
        ],
        logic: "AND",
      });
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty filter criteria", () => {
      const filter: FilterDefinition = {
        criteria: [],
        logic: "AND",
      };

      const inverted = invertFilter(filter);
      expect(inverted.criteria).toHaveLength(0);
      expect(inverted.logic).toBe("OR");
    });

    test("should handle deeply nested groups", () => {
      const filter: FilterDefinition = {
        criteria: [
          {
            criteria: [
              {
                criteria: [
                  {
                    condition: ">=",
                    data: "Deep Score",
                    origData: "deep.score",
                    type: "num",
                    value: ["5"],
                  },
                ],
                logic: "AND",
              },
            ],
            logic: "OR",
          },
        ],
        logic: "AND",
      };

      const inverted = invertFilter(filter);

      // Each level should flip: AND → OR → AND → OR
      expect(inverted.logic).toBe("OR"); // Top: AND → OR
      const level1 = expectGroup(inverted.criteria[0]);
      expect(level1.logic).toBe("AND"); // Level 1: OR → AND
      const level2 = expectGroup(level1.criteria[0]);
      expect(level2.logic).toBe("OR"); // Level 2: AND → OR
    });

    test("should handle filter with all conditions excluded", () => {
      const filter: FilterDefinition = {
        criteria: [
          {
            condition: "!null",
            data: "Amount",
            origData: "user.amount",
            type: "num",
            value: [],
          },
        ],
        logic: "AND",
      };

      const inverted = invertFilter(filter, ["user.amount"]);

      // All conditions excluded, should have empty criteria
      expect(inverted.criteria).toHaveLength(0);
    });
  });
});

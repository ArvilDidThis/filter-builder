import { describe, expect, it } from "vitest";
import {
  createRowPredicate,
  type FilterValue,
  isConditionFilled,
  type MatchOptions,
  matchesFilter,
} from "./evaluate";
import { OPERATORS_BY_TYPE } from "./fields";
import {
  upstreamMatches,
  upstreamOperatorsFor,
} from "./testing/searchbuilder-oracle";
import type {
  ConditionOperator,
  ConditionType,
  Criterion,
  FilterDefinition,
  LeafCondition,
} from "./types";

// These tests run the real DataTables SearchBuilder beside this library and fail on any
// difference. They are the proof that a filter returns the same rows in both.
//
// Every case is generated from a fixed seed, so a run always tests the same cases and a failure
// can be reproduced.

/** A small repeatable random number generator (mulberry32). Returns a number from 0 up to 1. */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = createRandom(20261113);
const pick = <T>(items: readonly T[]): T =>
  items[Math.floor(random() * items.length)] as T;

// Values chosen to hit the awkward corners: blanks, spaces, signs, text where a number is
// expected, mixed case, and line breaks.
const NUMBER_TEXT = [
  "",
  " ",
  "0",
  "-0",
  "5",
  "5.0",
  "05",
  " 5 ",
  "-5",
  "10",
  "9",
  "100",
  "1e2",
  "0x10",
  "3.14",
  ".5",
  "abc",
  "NaN",
  "Infinity",
  "-Infinity",
  "1,000",
  "5\n",
];
const FORMATTED_NUMBER_TEXT = [
  ...NUMBER_TEXT,
  "$86,000",
  "$1,200.50",
  "-$5",
  "$-5",
  "45%",
  "1.2.3",
  "5-3",
  "(5)",
  "€ 1 000",
  "1.234,5",
  "--5",
];
const TEXT = [
  "",
  " ",
  "London",
  "london",
  "LONDON",
  "New York",
  "new\nyork",
  "York",
  "o",
  "Lon",
  "don",
  "İstanbul",
  "straße",
  "a.b",
  "5",
];
const DATE_TEXT = [
  "",
  "2011/04/25",
  "2011-04-25",
  "2011,04,25",
  "2009-01-12",
  "2009/01/13",
  "2013-01-13",
  "2012-12-02",
  "1999-12-31",
  "2011-4-25",
  "25/04/2011",
  "not a date",
];
const TAGS = ["red", "green", "blue", "Red", "", "x y"];
const HTML_WRAPPERS: readonly ((text: string) => string)[] = [
  (text) => text,
  (text) => `<div>${text}</div>`,
  (text) => `<a href="#">${text}</a>`,
  (text) => `<b>${text}</b><br>`,
];

/** A value a row could hold for a field of this type. */
function randomRowValue(type: ConditionType): FilterValue {
  if (random() < 0.05) return null;
  switch (type) {
    case "num":
      return pick(NUMBER_TEXT);
    case "num-fmt":
      return pick(FORMATTED_NUMBER_TEXT);
    case "html-num":
      return pick(HTML_WRAPPERS)(pick(NUMBER_TEXT));
    case "html-num-fmt":
      return pick(HTML_WRAPPERS)(pick(FORMATTED_NUMBER_TEXT));
    case "html":
      return pick(HTML_WRAPPERS)(pick(TEXT));
    case "date":
      return pick(DATE_TEXT);
    case "array": {
      // Mostly a list, sometimes a single value: SearchBuilder accepts both.
      if (random() < 0.15) return pick(TAGS);
      const count = Math.floor(random() * 4);
      return Array.from({ length: count }, () => pick(TAGS));
    }
    default:
      return pick(TEXT);
  }
}

/** A value a person could have typed into a condition of this type. */
function randomFilterValue(type: ConditionType): string {
  switch (type) {
    case "num":
    case "html-num":
      return pick(NUMBER_TEXT);
    case "num-fmt":
    case "html-num-fmt":
      return pick(FORMATTED_NUMBER_TEXT);
    case "date":
      return pick(DATE_TEXT);
    case "array":
      return pick(TAGS);
    default:
      return pick(TEXT);
  }
}

const TYPES: readonly ConditionType[] = [
  "num",
  "num-fmt",
  "html-num",
  "html-num-fmt",
  "string",
  "html",
  "date",
  "array",
];

const BROKEN_LOGIC = ["and", "XOR", ""];

/** The field name is the type: one field of each type is enough for these tests. */
function randomLeaf(type: ConditionType = pick(TYPES)): LeafCondition {
  const condition = pick(upstreamOperatorsFor(type)) as ConditionOperator;
  const valueCount = type === "array" ? 1 + Math.floor(random() * 3) : 2;
  return {
    condition,
    data: type,
    origData: type,
    type,
    value: Array.from({ length: valueCount }, () => randomFilterValue(type)),
  };
}

function randomGroup(depth: number): FilterDefinition {
  const size = Math.floor(random() * 4);
  const criteria: Criterion[] = Array.from({ length: size }, () =>
    depth > 0 && random() < 0.35 ? randomGroup(depth - 1) : randomLeaf(),
  );
  // Now and then a broken joiner, as a filter edited by hand could hold.
  const logic = random() < 0.04 ? pick(BROKEN_LOGIC) : pick(["AND", "OR"]);
  return { criteria, logic: logic as FilterDefinition["logic"] };
}

type Row = Record<string, FilterValue>;

function randomRow(): Row {
  return Object.fromEntries(TYPES.map((type) => [type, randomRowValue(type)]));
}

const readValue = (row: Row, key: string): FilterValue => row[key];

/** Fails with the filter and row in the message, so a difference can be reproduced by hand. */
function expectSameAnswer(
  filter: FilterDefinition,
  row: Row,
  options: MatchOptions = {},
): void {
  const ours = matchesFilter(filter, row, readValue, options);
  // Both ways of asking must agree: one row at a time, and a test built once for many rows.
  const built = createRowPredicate(filter, readValue, options)(row);
  if (built !== ours) {
    throw new Error(
      `matchesFilter says ${ours}, createRowPredicate says ${built}.\n` +
        `filter: ${JSON.stringify(filter)}\nrow: ${JSON.stringify(row)}`,
    );
  }
  const theirs = upstreamMatches(
    filter,
    row,
    readValue,
    isConditionFilled,
    options,
  );
  if (ours !== theirs) {
    throw new Error(
      `This library says ${ours}, SearchBuilder says ${theirs}.\n` +
        `filter: ${JSON.stringify(filter)}\nrow: ${JSON.stringify(row)}\n` +
        `options: ${JSON.stringify(options)}`,
    );
  }
}

describe("parity with the real SearchBuilder", () => {
  describe.each(TYPES)("single conditions on a %s field", (type) => {
    it.each(upstreamOperatorsFor(type))(
      "should answer as SearchBuilder does for '%s'",
      (condition) => {
        for (let i = 0; i < 400; i++) {
          const leaf = { ...randomLeaf(type), condition } as LeafCondition;
          expectSameAnswer({ criteria: [leaf], logic: "AND" }, randomRow());
        }
      },
    );
  });

  it("should answer as SearchBuilder does for nested groups of mixed conditions", () => {
    for (let i = 0; i < 5000; i++) {
      expectSameAnswer(randomGroup(4), randomRow());
    }
  });

  it("should skip conditions that are not filled in, as SearchBuilder does", () => {
    for (let i = 0; i < 2000; i++) {
      const filter = randomGroup(3);
      // Empty some value boxes, so that some conditions count as not filled in.
      const emptySome = (criteria: Criterion[]): void => {
        for (const criterion of criteria) {
          if ("criteria" in criterion) emptySome(criterion.criteria);
          else if (random() < 0.5) criterion.value = [""];
        }
      };
      emptySome(filter.criteria);
      expectSameAnswer(filter, randomRow());
    }
  });

  it.each([
    { decimal: ",", thousands: "." },
    { decimal: ",", thousands: "" },
    { decimal: "", thousands: " " },
    { decimal: ".", thousands: "," },
  ])("should read numbers written with %o as SearchBuilder does", (options) => {
    const numberTypes = TYPES.filter((type) => type.includes("num"));
    for (let i = 0; i < 2000; i++) {
      const leaf = randomLeaf(pick(numberTypes));
      // SearchBuilder itself stops with an error on a `null` number here. A real table never
      // gives it one, because DataTables hands over blanks as empty text.
      const row = Object.fromEntries(
        Object.entries(randomRow()).map(([key, value]) => [key, value ?? ""]),
      );
      expectSameAnswer({ criteria: [leaf], logic: "AND" }, row, options);
    }
  });

  it.each(TYPES)(
    "should offer SearchBuilder's operators for a %s field, in its order",
    (type) => {
      expect(OPERATORS_BY_TYPE[type]).toEqual(upstreamOperatorsFor(type));
    },
  );
});

import { describe, expect, it } from "vitest";
import { type FilterValue, matchesFilter } from "./evaluate";
import { countConditions } from "./inspect";
import { EMPLOYEES, type Employee } from "./testing/employees";
import type {
  ConditionOperator,
  ConditionType,
  Criterion,
  FilterDefinition,
  LeafCondition,
} from "./types";

// SearchBuilder's own tests, ported. Each test below names the upstream file and test it comes
// from (https://github.com/DataTables/SearchBuilder, `test/`, version 2.1.1; MIT licence,
// copyright SpryMedia Limited).
//
// The upstream tests drive a real table in a browser and read what it shows. These run the same
// filter over the same sample data and check the same rows. Only tests about which rows match
// are ported: tests of buttons, wording and layout have nothing to check in a library without
// a screen.

/** The sample table's columns, by the title upstream filters name them with. */
const COLUMNS: Record<string, { key: keyof Employee; type: ConditionType }> = {
  Name: { key: "name", type: "string" },
  Position: { key: "position", type: "string" },
  Office: { key: "office", type: "string" },
  Age: { key: "age", type: "num" },
  // DataTables detects these two types from the cells: "2011/04/25" and "$320,800".
  "Start date": { key: "startDate", type: "date" },
  Salary: { key: "salary", type: "num-fmt" },
  // Upstream's "html" sample table holds the salary inside a `<div>`.
  HTML: { key: "salary", type: "html-num-fmt" },
};

/** A condition written the way upstream's tests write it: column title, condition, values. */
function on(
  title: keyof typeof COLUMNS,
  condition: ConditionOperator,
  value: string[] = [],
): LeafCondition {
  const column = COLUMNS[title];
  if (!column) throw new Error(`No column titled ${title}`);
  return {
    condition,
    data: title,
    origData: title,
    type: column.type,
    value,
  };
}

const all = (...criteria: Criterion[]): FilterDefinition => ({
  criteria,
  logic: "AND",
});
const any = (...criteria: Criterion[]): FilterDefinition => ({
  criteria,
  logic: "OR",
});

function readValue(row: Employee, title: string): FilterValue {
  const column = COLUMNS[title];
  if (!column) return "";
  const cell = row[column.key];
  return title === "HTML" ? `<div>${cell}</div>` : cell;
}

/** A copy of the sample table with some cells changed, as upstream's tests blank cells out. */
function employeesWith(
  changes: Record<string, Partial<Employee>>,
): readonly Employee[] {
  return EMPLOYEES.map((row) => ({ ...row, ...changes[row.name] }));
}

/**
 * The names a table would show for this filter: matching rows in name order, first page of ten.
 * That is the default view upstream's tests read their rows from.
 */
function shownNames(
  filter: FilterDefinition,
  rows: readonly Employee[] = EMPLOYEES,
): string[] {
  return rows
    .filter((row) => matchesFilter(filter, row, readValue))
    .map((row) => row.name)
    .sort()
    .slice(0, 10);
}

describe("SearchBuilder's tests: option/searchBuilder.preDefined.condition.js", () => {
  describe("String tests", () => {
    // Upstream blanks the Office cell of the third row before it builds the table.
    const rows = employeesWith({ "Ashton Cox": { office: "" } });

    it("... Contains", () => {
      expect(shownNames(all(on("Name", "contains", ["Ox"])), rows)).toEqual([
        "Ashton Cox",
      ]);
    });

    it("... Empty", () => {
      expect(shownNames(all(on("Office", "null")), rows)).toEqual([
        "Ashton Cox",
      ]);
    });

    it("... Not empty", () => {
      const names = shownNames(all(on("Office", "!null")), rows);
      expect(names).toHaveLength(10);
      expect(names[2]).toBe("Bradley Greer");
    });
  });

  describe("Numeric tests", () => {
    // Upstream blanks the Age cell of the fourth row. A blank number counts as 0.
    const rows = employeesWith({ "Cedric Kelly": { age: "" } });

    it("... Between", () => {
      const names = shownNames(all(on("Age", "between", ["63", "70"])), rows);
      expect(names).toHaveLength(8);
      expect(names[0]).toBe("Ashton Cox");
    });

    it("... Not Between", () => {
      const names = shownNames(all(on("Age", "!between", ["15", "64"])), rows);
      expect(names).toHaveLength(4);
      expect(names[0]).toBe("Ashton Cox");
    });

    it("... Empty", () => {
      expect(shownNames(all(on("Age", "null")), rows)).toEqual([
        "Cedric Kelly",
      ]);
    });

    it("... Greater than equal to", () => {
      const names = shownNames(all(on("Age", ">=", ["66"])), rows);
      expect(names).toHaveLength(2);
      expect(names[0]).toBe("Ashton Cox");
    });

    it("... Greater than", () => {
      // Upstream expects the "No matching records found" row.
      expect(shownNames(all(on("Age", ">", ["66"])), rows)).toEqual([]);
    });
  });

  describe("Date tests", () => {
    it("... Before", () => {
      const names = shownNames(all(on("Start date", "<", ["2009-01-13"])));
      expect(names).toHaveLength(10);
      expect(names[1]).toBe("Ashton Cox");
      expect(names[9]).toBe("Timothy Mooney");
    });

    it("... After", () => {
      const names = shownNames(all(on("Start date", ">", ["2013-01-13"])));
      expect(names).toHaveLength(3);
      expect(names[0]).toBe("Jennifer Acosta");
      expect(names[2]).toBe("Thor Walton");
    });

    it("... Between", () => {
      // The bounds are given latest first: "between" accepts either order.
      const names = shownNames(
        all(on("Start date", "between", ["2009-09-13", "2009-01-12"])),
      );
      expect(names).toHaveLength(7);
      expect(names[0]).toBe("Ashton Cox");
      expect(names[6]).toBe("Yuri Berry");
    });
  });

  describe("HTML tests", () => {
    it("... Equals", () => {
      expect(shownNames(all(on("HTML", "=", ["$86,000"])))).toEqual([
        "Ashton Cox",
      ]);
    });

    it("... Between", () => {
      const names = shownNames(all(on("HTML", "between", ["86000", "90000"])));
      expect(names).toHaveLength(3);
      expect(names[0]).toBe("Ashton Cox");
      expect(names[2]).toBe("Jonas Alexander");
    });
  });
});

describe("SearchBuilder's tests: option/searchBuilder.preDefined.js", () => {
  it("Single criteria search", () => {
    const filter = all(on("Office", "=", ["Edinburgh"]));
    // Upstream reads the count from the title, "Custom Search Builder (1)".
    expect(countConditions(filter)).toBe(1);
    expect(shownNames(filter)[0]).toBe("Cedric Kelly");
  });

  it("Complex criteria search", () => {
    const filter = all(
      on("Office", "!=", ["London"]),
      any(on("Office", "contains", ["h"]), on("Age", ">", ["50"])),
    );
    expect(countConditions(filter)).toBe(3);
    expect(shownNames(filter)[0]).toBe("Ashton Cox");
  });
});

describe("SearchBuilder's tests: option/searchBuilder.preDefined.criteria.js", () => {
  it("Nested criteria - single depth", () => {
    // Upstream writes the two inner groups without a `logic`, relying on AND as the default.
    // A stored filter always holds one, so it is written out here.
    const filter = all(
      all(on("Office", "!=", ["London"]), on("Age", ">", ["55"])),
      all(on("Salary", "between", ["2", "10000000"])),
      on("Age", ">", ["60"]),
    );
    expect(countConditions(filter)).toBe(4);
    expect(shownNames(filter)[0]).toBe("Ashton Cox");
  });

  it("Can specifiy OR", () => {
    const filter = any(on("Office", "!=", ["London"]), on("Age", ">", ["55"]));
    expect(countConditions(filter)).toBe(2);
    expect(shownNames(filter)[0]).toBe("Airi Satou");
  });
});

describe("SearchBuilder's tests: option/searchBuilder.preDefined.logic.js", () => {
  it("Default uses AND", () => {
    const filter = all(on("Office", "!=", ["London"]), on("Age", ">", ["55"]));
    expect(shownNames(filter)[0]).toBe("Ashton Cox");
  });

  it("Can specifiy OR", () => {
    const filter = any(on("Office", "!=", ["London"]), on("Age", ">", ["55"]));
    expect(shownNames(filter)[0]).toBe("Airi Satou");
  });
});

describe("SearchBuilder's tests: option/searchBuilder.js", () => {
  describe("Tests with rendered data", () => {
    // Upstream makes the table filter the Office column on "test " plus the office name. Here
    // the app's own value reader does that job.
    const readRenderedValue = (row: Employee, title: string): FilterValue =>
      title === "Office" ? `test ${row.office}` : readValue(row, title);
    const firstShown = (filter: FilterDefinition): string | undefined =>
      EMPLOYEES.filter((row) => matchesFilter(filter, row, readRenderedValue))
        .map((row) => row.name)
        .sort()[0];

    it("With columns.render - just filter - equals", () => {
      expect(firstShown(all(on("Office", "=", ["test San Francisco"])))).toBe(
        "Ashton Cox",
      );
    });

    it("With columns.render - just filter - contains", () => {
      expect(firstShown(all(on("Office", "contains", ["test San"])))).toBe(
        "Ashton Cox",
      );
    });
  });

  describe("General usage - simple tests for strings", () => {
    it("Add a single condition - equals", () => {
      expect(shownNames(all(on("Office", "=", ["San Francisco"])))[0]).toBe(
        "Ashton Cox",
      );
    });

    it("Add a single condition - ends with", () => {
      expect(shownNames(all(on("Office", "ends", ["Londo"])))).toEqual([]);
    });

    it("... and give values that will match (ends with)", () => {
      expect(shownNames(all(on("Office", "ends", ["don"])))[0]).toBe(
        "Angelica Ramos",
      );
    });

    it("Add a single condition - starts with", () => {
      expect(shownNames(all(on("Office", "starts", ["ondon"])))).toEqual([]);
    });

    it("... and give values that will match (starts with)", () => {
      expect(shownNames(all(on("Office", "starts", ["Londo"])))[0]).toBe(
        "Angelica Ramos",
      );
    });
  });

  describe("General usage - diacritics tests for strings", () => {
    // Two Japanese words that differ only by a voicing mark. They must not match each other.
    const KATAKANA_LETTER_TE = "テモ";
    const KATAKANA_LETTER_DE = "デモ";
    const rows = [KATAKANA_LETTER_TE, KATAKANA_LETTER_DE].map(
      (name): Employee => ({
        name,
        position: "",
        office: "",
        age: "",
        startDate: "",
        salary: "",
      }),
    );

    it("Add a single condition - starts", () => {
      expect(
        shownNames(all(on("Name", "starts", [KATAKANA_LETTER_DE])), rows),
      ).toEqual([KATAKANA_LETTER_DE]);
    });

    it("Add a single condition - not starts", () => {
      expect(
        shownNames(all(on("Name", "!starts", [KATAKANA_LETTER_DE])), rows),
      ).toEqual([KATAKANA_LETTER_TE]);
    });
  });

  describe("General usage - simple tests for number", () => {
    const rowsWithAges = (...ages: string[]): Employee[] =>
      ages.map((age, index) => ({
        name: ["a", "b", "c"][index] ?? "",
        position: "b",
        office: "c",
        age,
        startDate: "",
        salary: "",
      }));
    const rows = rowsWithAges("0", "3", "-4");

    it("Add a single condition - equals", () => {
      expect(shownNames(all(on("Age", "=", ["-4"])), rows)).toEqual(["c"]);
    });

    it("Add a single condition - between", () => {
      expect(shownNames(all(on("Age", "between", ["-5", "-2"])), rows)[0]).toBe(
        "c",
      );
    });

    it("Add a single condition - between for %", () => {
      // DataTables detects "0%" as a formatted number.
      const percentages = rowsWithAges("0%", "3%", "-4%");
      const condition: LeafCondition = {
        ...on("Age", "between", ["-5", "-2"]),
        type: "num-fmt",
      };
      expect(shownNames(all(condition), percentages)[0]).toBe("c");
    });

    it("Add a single condition - greater than", () => {
      expect(shownNames(all(on("Age", ">", ["-5"])), rows)[0]).toBe("a");
    });

    it("... less values (greater than)", () => {
      expect(shownNames(all(on("Age", ">", ["2"])), rows)[0]).toBe("b");
    });

    it("Add a single condition - less than", () => {
      expect(shownNames(all(on("Age", "<", ["2"])), rows)[0]).toBe("a");
    });

    it("... less values (less than)", () => {
      expect(shownNames(all(on("Age", "<", ["-3"])), rows)[0]).toBe("c");
    });

    it("Empty data", () => {
      expect(shownNames(all(on("Name", "null")))).toEqual([]);
    });

    it("Clear empty data", () => {
      // With the condition removed, the first page is full again.
      expect(shownNames(all())).toHaveLength(10);
    });
  });
});

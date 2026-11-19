import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useColumnSettings } from "../useColumnSettings";
import { ColumnPicker } from "./ColumnPicker";
import { FilterBuilder } from "./FilterBuilder";
import { FILTER_THEME_VARIABLES } from "./theme";

// The test page works out no styles, so these tests read the style sheet as text. They guard
// the rule that lets an app's own value of a variable always win. The real-browser test
// `browser/theming.test.tsx` checks the result on screen.

const SHEET = readFileSync(`${import.meta.dirname}/../../styles.css`, "utf8")
  // Comments quote variables as examples, and are not rules.
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Every distinct piece of the style sheet that a pattern finds. */
const found = (pattern: RegExp): string[] => [
  ...new Set(
    Array.from(SHEET.matchAll(pattern), (match) => match[1] as string),
  ),
];

/** The variables the component sets on itself and never offers to an app. */
const INTERNAL = ["--fb-bar-color", "--fb-popover-room", "--fb-popover-shift"];

afterEach(cleanup);

describe("the theme variables in the style sheet", () => {
  it("should keep a default for every variable in the list, under its private name", () => {
    const defaults = found(/^\s*--_fb-([a-z-]+)\s*:/gm).map(
      (name) => `--fb-${name}`,
    );
    // `--fb-sticky-top` has its default where it is used, as it is used only once.
    const listed = FILTER_THEME_VARIABLES.filter(
      (name) => name !== "--fb-sticky-top",
    );
    expect(defaults.sort()).toEqual([...listed].sort());
  });

  it("should read every variable with a fallback, so an app's value wins and a default remains", () => {
    // A read with no fallback: `var(--fb-radius)`, with or without spaces inside.
    const bare = found(/var\(\s*(--fb-[a-z-]+)\s*\)/g);
    expect(bare.sort()).toEqual(INTERNAL);
    // A read with a fallback names the variable's own private default.
    for (const [, name, fallback] of SHEET.matchAll(
      /var\(\s*--fb-([a-z-]+)\s*,\s*var\(\s*--_fb-([a-z-]+)\s*\)\s*\)/g,
    )) {
      expect(fallback).toBe(name);
    }
  });

  it("should never set a variable of the list on the component itself", () => {
    // Set on the component, a default would win over a value an app sets further up.
    const set = found(/^\s*(--fb-[a-z-]+)\s*:/gm);
    // The one exception is set on a part inside the builder, and says so in the sheet.
    expect(set.sort()).toEqual([...INTERNAL, "--fb-value-width"].sort());
  });
});

/** A picker with a class and a style of the app's own. */
function Picker() {
  const state = useColumnSettings({
    columns: [{ key: "name", label: "Name" }],
  });
  return (
    <ColumnPicker
      className="mine"
      state={state}
      style={{ "--fb-radius": "0", marginTop: 4 }}
    />
  );
}

describe("the style prop", () => {
  it("should reach the picker's outer element, beside its class", () => {
    const { container } = render(<Picker />);
    const root = container.querySelector(".fb-columns") as HTMLElement;
    expect(root.className).toBe("fb-columns mine");
    expect(root.style.getPropertyValue("--fb-radius")).toBe("0");
    expect(root.style.marginTop).toBe("4px");
  });

  it("should reach the builder's outer element, beside its class", () => {
    const { container } = render(
      <FilterBuilder
        className="mine"
        fields={[{ key: "name", label: "Name", type: "string" }]}
        onChange={() => {}}
        style={{ "--fb-and": "teal" }}
        value={{ logic: "AND", criteria: [] }}
      />,
    );
    const root = container.querySelector(".fb") as HTMLElement;
    expect(root.className).toBe("fb mine");
    expect(root.style.getPropertyValue("--fb-and")).toBe("teal");
  });
});

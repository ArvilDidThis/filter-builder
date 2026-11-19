import type { FieldDefinition } from "@arvilmena/filter-core";
import { describe, expect, test } from "vitest";
import { FilterBuilder } from "../src/ui/FilterBuilder";
import { addAppCss } from "./support/app-css";
import { PickerApp, pickerParts } from "./support/apps";
import { mount } from "./support/mount";

// An app changes the look by setting `--fb-*` variables. Whether its value wins over the
// library's default is decided by the browser's own rules for style sheets, so it is checked
// here on the styles the browser really worked out.

/** The corner radius the browser gives the picker's button. */
async function triggerRadius(): Promise<string> {
  const picker = pickerParts();
  await expect
    .poll(() => document.querySelector(".fb-columns-trigger"))
    .not.toBeNull();
  return getComputedStyle(picker.trigger()).borderTopLeftRadius;
}

const FIELDS: readonly FieldDefinition[] = [
  { key: "name", label: "Name", type: "string" },
];

describe("setting a --fb-* variable", () => {
  test("has the default look when the app sets nothing", async () => {
    mount(<PickerApp />);
    // 0.375rem of the browser's 16px.
    expect(await triggerRadius()).toBe("6px");
  });

  test("wins with one class on the component", async () => {
    addAppCss(".square { --fb-radius: 0px; }");
    mount(<PickerApp picker={{ className: "square" }} />);
    expect(await triggerRadius()).toBe("0px");
  });

  test("wins with an inline style on the component", async () => {
    mount(<PickerApp picker={{ style: { "--fb-radius": "2px" } }} />);
    expect(await triggerRadius()).toBe("2px");
  });

  test("wins with one class on an element around the component", async () => {
    addAppCss(".tools { --fb-radius: 11px; }");
    mount(
      <div className="tools">
        <PickerApp />
      </div>,
    );
    expect(await triggerRadius()).toBe("11px");
  });

  test("wins when set on the page's root", async () => {
    addAppCss(":root { --fb-radius: 9px; }");
    mount(<PickerApp />);
    expect(await triggerRadius()).toBe("9px");
  });

  test("lets the nearest value win: the component over an element around it", async () => {
    addAppCss(".tools { --fb-radius: 11px; } .square { --fb-radius: 0px; }");
    mount(
      <div className="tools">
        <PickerApp picker={{ className: "square" }} />
      </div>,
    );
    expect(await triggerRadius()).toBe("0px");
  });

  test("changes the colours worked out from the page colour", async () => {
    addAppCss(
      ".dark-tools { --fb-page: rgb(0, 0, 0); color: rgb(255, 255, 255); }",
    );
    mount(
      <div className="dark-tools">
        <PickerApp />
      </div>,
    );
    await triggerRadius();
    // The button's background mixes a little of the text colour into the page colour, so on
    // a black page it is a dark grey, not the light grey of the default.
    const background = getComputedStyle(
      pickerParts().trigger(),
    ).backgroundColor;
    const [red] = (background.match(/[\d.]+/g) ?? []).map(Number);
    expect(red).toBeLessThan(0.2 * (background.startsWith("color(") ? 1 : 255));
  });

  test("reaches the builder the same way, by class, by style and from around it", async () => {
    addAppCss(".square { --fb-radius: 0px; } .tools { --fb-radius: 11px; }");
    const builder = (props: {
      className?: string;
      style?: { "--fb-radius": string };
    }) => (
      <FilterBuilder
        fields={FIELDS}
        onChange={() => {}}
        value={{ logic: "AND", criteria: [] }}
        {...props}
      />
    );
    mount(
      <>
        <div data-testid="by-class">{builder({ className: "square" })}</div>
        <div data-testid="by-style">
          {builder({ style: { "--fb-radius": "2px" } })}
        </div>
        <div className="tools" data-testid="from-around">
          {builder({})}
        </div>
        <div data-testid="default">{builder({})}</div>
      </>,
    );
    const radius = (testId: string): string | undefined => {
      const button = document.querySelector(
        `[data-testid="${testId}"] .fb-button`,
      );
      return button ? getComputedStyle(button).borderTopLeftRadius : undefined;
    };
    await expect.poll(() => radius("default")).toBe("6px");
    expect(radius("by-class")).toBe("0px");
    expect(radius("by-style")).toBe("2px");
    expect(radius("from-around")).toBe("11px");
  });
});

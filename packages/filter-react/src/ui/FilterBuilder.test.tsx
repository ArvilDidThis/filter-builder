import type { FieldDefinition, FilterDefinition } from "@arvilmena/filter-core";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { FilterBuilder, type FilterBuilderProps } from "./FilterBuilder";
import { pressInOpenTree, stopPressesAt } from "./shadowPress.testing";

const FIELDS: FieldDefinition[] = [
  { key: "amount", label: "Amount", type: "num", prefix: "$", suffix: "B" },
  { key: "name", label: "Name", type: "string" },
  {
    key: "status",
    label: "Status",
    type: "string",
    choices: [
      { value: "OPEN", label: "Open" },
      { value: "DONE", label: "Done" },
    ],
  },
];

const EMPTY: FilterDefinition = { criteria: [], logic: "AND" };

const amount = (value: string): FilterDefinition["criteria"][number] => ({
  condition: ">=",
  data: "Amount",
  origData: "amount",
  type: "num",
  value: [value],
});
const named = (value: string): FilterDefinition["criteria"][number] => ({
  condition: "=",
  data: "Name",
  origData: "name",
  type: "string",
  value: [value],
});

/** An app around the builder: it keeps the filter and passes it back in. */
function App({
  initial,
  extra,
  onFilter,
}: {
  initial: FilterDefinition;
  extra: Partial<FilterBuilderProps>;
  onFilter: (filter: FilterDefinition) => void;
}) {
  const [value, setValue] = useState(initial);
  onFilter(value);
  return (
    <FilterBuilder
      fields={FIELDS}
      onChange={setValue}
      value={value}
      {...extra}
    />
  );
}

/** Draws the builder inside an app, and gives back a way to read the app's filter. */
function renderBuilder(
  initial: FilterDefinition = EMPTY,
  extra: Partial<FilterBuilderProps> = {},
) {
  let latest = initial;
  const rendered = render(
    <App
      extra={extra}
      initial={initial}
      onFilter={(filter) => {
        latest = filter;
      }}
    />,
  );
  return { container: rendered.container, filter: () => latest };
}

afterEach(cleanup);

describe("FilterBuilder", () => {
  it("should show the heading, the count and the top group's bar", () => {
    renderBuilder(EMPTY, { title: "Order filters" });
    expect(screen.getByRole("region", { name: "Order filters" })).toBeTruthy();
    expect(screen.getByText("(0)")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Match all of these/ }),
    ).toBeTruthy();
    // Nothing to clear yet.
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  it("should add a condition, pick its field, and fill it in", () => {
    const { filter } = renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Add condition" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose a field" }));
    fireEvent.click(screen.getByRole("option", { name: "Amount" }));
    fireEvent.change(screen.getByLabelText("Condition for Amount"), {
      target: { value: "between" },
    });
    fireEvent.change(screen.getByLabelText("From value for Amount"), {
      target: { value: "10" },
    });
    fireEvent.change(screen.getByLabelText("To value for Amount"), {
      target: { value: "50" },
    });
    expect(filter()).toEqual({
      criteria: [
        {
          condition: "between",
          data: "Amount",
          origData: "amount",
          type: "num",
          value: ["10", "50"],
        },
      ],
      logic: "AND",
    });
  });

  it("should show the unit around a value and the summary below", () => {
    const { container } = renderBuilder({
      criteria: [amount("10")],
      logic: "AND",
    });
    const affixes = [...container.querySelectorAll(".fb-affix")].map(
      (node) => node.textContent,
    );
    expect(affixes).toEqual(["$", "B"]);
    expect(container.querySelector(".fb-summary")?.textContent).toBe(
      "Amount $10B or more",
    );
  });

  it("should leave the summary out when asked", () => {
    const { container } = renderBuilder(
      { criteria: [amount("10")], logic: "AND" },
      { showSummary: false },
    );
    expect(container.querySelector(".fb-summary")).toBeNull();
  });

  it("should offer a field's choices in a dropdown", () => {
    const { filter } = renderBuilder({
      criteria: [
        {
          condition: "=",
          data: "Status",
          origData: "status",
          type: "string",
          value: [""],
        },
      ],
      logic: "AND",
    });
    const box = screen.getByLabelText("Value for Status") as HTMLSelectElement;
    expect([...box.options].map((option) => option.text)).toEqual([
      "Choose",
      "Open",
      "Done",
    ]);
    fireEvent.change(box, { target: { value: "DONE" } });
    expect(filter().criteria[0]).toMatchObject({ value: ["DONE"] });
  });

  it("should offer a date picker for a date field, and keep text boxes otherwise", () => {
    const { filter } = renderBuilder(
      {
        criteria: [
          {
            condition: ">",
            data: "Started",
            origData: "started",
            type: "date",
            value: [""],
          },
          amount("10"),
          named("Ann"),
        ],
        logic: "AND",
      },
      {
        fields: [...FIELDS, { key: "started", label: "Started", type: "date" }],
      },
    );
    const date = screen.getByLabelText("Value for Started") as HTMLInputElement;
    expect(date.type).toBe("date");
    // A date reads from the left, like text, so it is not marked as a number.
    expect(date.hasAttribute("data-number")).toBe(false);
    fireEvent.change(date, { target: { value: "2011-04-25" } });
    expect(filter().criteria[0]).toMatchObject({ value: ["2011-04-25"] });

    const number = screen.getByLabelText(
      "Value for Amount",
    ) as HTMLInputElement;
    expect(number.type).toBe("text");
    expect(number.hasAttribute("data-number")).toBe(true);
    const text = screen.getByLabelText("Value for Name") as HTMLInputElement;
    expect(text.type).toBe("text");
    expect(text.hasAttribute("data-number")).toBe(false);
  });

  it("should show a stored date the picker cannot display in a plain box, as stored", () => {
    const dateBox = (value: string) => {
      cleanup();
      renderBuilder(
        {
          criteria: [
            {
              condition: "=",
              data: "Started",
              origData: "started",
              type: "date",
              value: [value],
            },
          ],
          logic: "AND",
        },
        { fields: [{ key: "started", label: "Started", type: "date" }] },
      );
      return screen.getByLabelText("Value for Started") as HTMLInputElement;
    };
    expect(dateBox("2011-04-25").type).toBe("date");
    expect(dateBox("").type).toBe("date");
    // The picker would show "2011/04/25" as an empty box. Matching compares the stored text
    // as it is, so the box shows exactly that text.
    expect(dateBox("2011/04/25").type).toBe("text");
    expect(dateBox("2011/04/25").value).toBe("2011/04/25");
    expect(dateBox("last week").value).toBe("last week");
    // A day that does not exist has the right form, but the picker would still show it empty.
    expect(dateBox("2026-02-30").type).toBe("text");
    expect(dateBox("2026-02-30").value).toBe("2026-02-30");
    expect(dateBox("2026-13-01").type).toBe("text");
    expect(dateBox("2024-02-29").type).toBe("date");
  });

  it("should offer a number pad only for the number types", () => {
    const boxFor = (type: FieldDefinition["type"]) => {
      cleanup();
      renderBuilder(
        {
          criteria: [
            {
              condition: "=",
              data: "Thing",
              origData: "thing",
              type,
              value: [""],
            },
          ],
          logic: "AND",
        },
        { fields: [{ key: "thing", label: "Thing", type }] },
      );
      return screen.getByLabelText("Value for Thing") as HTMLInputElement;
    };
    for (const type of [
      "num",
      "num-fmt",
      "html-num",
      "html-num-fmt",
    ] as const) {
      expect(boxFor(type).getAttribute("inputmode")).toBe("decimal");
    }
    // Text inside markup is still text, so a phone must offer its letter keys.
    expect(boxFor("html").hasAttribute("inputmode")).toBe(false);
    expect(boxFor("html").hasAttribute("data-number")).toBe(false);
    expect(boxFor("string").hasAttribute("inputmode")).toBe(false);
  });

  it("should keep a list as typed, so a comma can be typed and erased", () => {
    const { filter } = renderBuilder(
      {
        criteria: [
          {
            condition: "=",
            data: "Tags",
            origData: "tags",
            type: "array",
            value: ["a", "b"],
          },
        ],
        logic: "AND",
      },
      { fields: [...FIELDS, { key: "tags", label: "Tags", type: "array" }] },
    );
    const box = () =>
      screen.getByLabelText(
        "Values for Tags, separated by commas",
      ) as HTMLInputElement;
    expect(box().value).toBe("a, b");

    // A comma at the end stays as typed, with no space written after it.
    fireEvent.change(box(), { target: { value: "a," } });
    expect(box().value).toBe("a,");
    // The comma alone adds no value yet: a blank value would match no row.
    expect(filter().criteria[0]).toMatchObject({ value: ["a"] });

    // So Backspace can take the comma away again.
    fireEvent.change(box(), { target: { value: "a" } });
    expect(box().value).toBe("a");
    expect(filter().criteria[0]).toMatchObject({ value: ["a"] });

    fireEvent.change(box(), { target: { value: "a,  c ,,d," } });
    expect(box().value).toBe("a,  c ,,d,");
    expect(filter().criteria[0]).toMatchObject({ value: ["a", "c", "d"] });

    fireEvent.change(box(), { target: { value: "" } });
    expect(filter().criteria[0]).toMatchObject({ value: [] });
  });

  it("should switch a group between And and Or from its bar", () => {
    const { filter } = renderBuilder({
      criteria: [amount("1"), named("a")],
      logic: "AND",
    });
    const bar = screen.getByRole("button", { name: /^Match all of these/ });
    expect(bar.textContent).toBe("and");
    fireEvent.click(bar);
    expect(filter().logic).toBe("OR");
    expect(
      screen.getByRole("button", { name: /^Match any of these/ }).textContent,
    ).toBe("or");
  });

  it("should draw a nested group inside its own bar", () => {
    const { container } = renderBuilder({
      criteria: [
        amount("1"),
        { criteria: [named("a"), named("b")], logic: "OR" },
      ],
      logic: "AND",
    });
    const groups = container.querySelectorAll(".fb-group");
    expect(groups).toHaveLength(2);
    const nested = groups[1] as HTMLElement;
    expect(nested.getAttribute("data-logic")).toBe("OR");
    // The nested group's bar spans its own two rows and nothing else.
    expect(nested.querySelectorAll(".fb-row")).toHaveLength(2);
    expect(
      within(nested).getByRole("button", { name: "Remove group" }),
    ).toBeTruthy();
    // The top group cannot be removed.
    expect(
      screen.getAllByRole("button", { name: "Remove group" }),
    ).toHaveLength(1);
  });

  it("should put a condition in a new group with '>' and take it out with '<'", () => {
    const { filter } = renderBuilder({
      criteria: [amount("1"), named("a")],
      logic: "AND",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Put Name in a new group" }),
    );
    expect(filter().criteria[1]).toEqual({
      criteria: [named("a")],
      logic: "AND",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Move Name out of its group" }),
    );
    expect(
      filter().criteria.map((item) => "origData" in item && item.origData),
    ).toContain("name");
  });

  it("should reorder rows with the arrows, and turn off the ones that cannot move", () => {
    const { filter } = renderBuilder({
      criteria: [amount("1"), named("a")],
      logic: "AND",
    });
    const up = screen.getByRole("button", { name: "Move Amount up" });
    expect((up as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Move Amount down" }));
    expect(
      filter().criteria.map((item) => "origData" in item && item.origData),
    ).toEqual(["name", "amount"]);
  });

  it("should keep the focus on a row its move button moved", () => {
    renderBuilder({
      criteria: [named("Ann"), named("Bob"), amount("1")],
      logic: "AND",
    });
    const press = (name: string) => {
      const button = screen.getByRole("button", { name });
      button.focus();
      fireEvent.click(button);
    };
    const focused = () => document.activeElement?.getAttribute("aria-label");

    // Twice up takes the last row to the top. The second press must move the same row.
    press("Move Amount up");
    expect(focused()).toBe("Move Amount up");
    fireEvent.click(document.activeElement as HTMLElement);
    // At the top "up" is turned off, so the focus rests on "down".
    expect(focused()).toBe("Move Amount down");
    expect(
      screen
        .getAllByRole("button", { name: /^Field: / })
        .map((button) => button.textContent),
    ).toEqual(["Amount▾", "Name▾", "Name▾"]);

    press("Put Amount in a new group");
    expect(focused()).toBe("Put Amount in a new group");
    press("Move Amount out of its group");
    expect(focused()).toBe("Put Amount in a new group");
  });

  it("should move a row into the group above it, and keep the focus on it", () => {
    const { filter } = renderBuilder({
      criteria: [{ criteria: [amount("1")], logic: "OR" }, named("Ann")],
      logic: "AND",
    });
    const button = screen.getByRole("button", {
      name: "Move Name into the group above",
    });
    button.focus();
    fireEvent.click(button);
    expect(filter()).toEqual({
      criteria: [{ criteria: [amount("1"), named("Ann")], logic: "OR" }],
      logic: "AND",
    });
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Move Name out of its group",
    );
    // A row with no group just above it is not offered the move.
    expect(
      screen.queryByRole("button", {
        name: "Move Amount into the group above",
      }),
    ).toBeNull();
  });

  it("should keep showing a stored value its field no longer offers", () => {
    renderBuilder({
      criteria: [
        {
          condition: "=",
          data: "Status",
          origData: "status",
          type: "string",
          value: ["LEGACY"],
        },
      ],
      logic: "AND",
    });
    const box = screen.getByLabelText("Value for Status") as HTMLSelectElement;
    expect(box.value).toBe("LEGACY");
    expect([...box.options].map((option) => option.text)).toEqual([
      "Choose",
      "LEGACY",
      "Open",
      "Done",
    ]);
  });

  it("should remove a condition and a group", () => {
    const { filter } = renderBuilder({
      criteria: [amount("1"), { criteria: [named("a")], logic: "OR" }],
      logic: "AND",
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove group" }));
    expect(filter().criteria).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Remove Amount" }));
    expect(filter().criteria).toHaveLength(0);
  });

  it("should stop offering deeper groups at the depth limit", () => {
    renderBuilder(
      {
        criteria: [{ criteria: [amount("1")], logic: "AND" }],
        logic: "AND",
      },
      { depthLimit: 2 },
    );
    // Only the top group may hold another group.
    expect(screen.getAllByRole("button", { name: "Add group" })).toHaveLength(
      1,
    );
    // A condition in the second level cannot be put in a third.
    expect(
      screen.queryByRole("button", { name: "Put Amount in a new group" }),
    ).toBeNull();
  });

  it("should put the remove button right after the value boxes", () => {
    const { container } = renderBuilder({
      criteria: [amount("1")],
      logic: "AND",
    });
    const values = container.querySelector(".fb-values") as HTMLElement;
    expect(values.lastElementChild?.getAttribute("aria-label")).toBe(
      "Remove Amount",
    );
    // The move buttons stay at the end of the row, without a second remove button.
    const moves = container.querySelector(".fb-row-actions") as HTMLElement;
    expect(within(moves).queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("should say what every button does when the pointer rests on it", () => {
    const { container } = renderBuilder({
      criteria: [amount("1"), { criteria: [named("a")], logic: "OR" }],
      logic: "AND",
    });
    const buttons = [
      ...container.querySelectorAll(
        ".fb-icon-button, .fb-bar-logic, .fb-bar-remove",
      ),
    ];
    expect(buttons.length).toBeGreaterThan(8);
    for (const button of buttons) {
      expect(button.getAttribute("data-tooltip")).toBeTruthy();
    }
    expect(
      screen
        .getByRole("button", { name: /^Match any of these/ })
        .getAttribute("data-tooltip"),
    ).toBe("One row in this group is enough (OR). Click to change to AND.");
  });

  it("should mark each group as And or Or, for the style sheet to colour", () => {
    const { container } = renderBuilder({
      criteria: [{ criteria: [named("a")], logic: "OR" }],
      logic: "AND",
    });
    const logic = [...container.querySelectorAll(".fb-group")].map((group) =>
      group.getAttribute("data-logic"),
    );
    expect(logic).toEqual(["AND", "OR"]);
  });

  it("should clear every row", () => {
    const { filter } = renderBuilder({
      criteria: [amount("1"), named("a")],
      logic: "OR",
    });
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(filter()).toEqual({ criteria: [], logic: "OR" });
  });

  it("should show a slot it cannot read, and let a person remove it", () => {
    const { filter } = renderBuilder({
      criteria: [5 as unknown as FilterDefinition["criteria"][number]],
      logic: "AND",
    });
    expect(screen.getByText(/cannot be read/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove unreadable row" }),
    );
    expect(filter().criteria).toHaveLength(0);
  });

  it("should use an app's own wording for an operator", () => {
    renderBuilder(
      { criteria: [amount("1")], logic: "AND" },
      { operatorLabels: { ">=": "min" } },
    );
    const box = screen.getByLabelText(
      "Condition for Amount",
    ) as HTMLSelectElement;
    expect(box.selectedOptions[0]?.text).toBe("min");
  });
});

/** An app with a button that changes the filter itself, as a preset or a paste would. */
function AppThatChangesTheFilter() {
  const [value, setValue] = useState<FilterDefinition>({
    criteria: [amount("1"), amount("2"), amount("3")],
    logic: "AND",
  });
  return (
    <>
      <button
        onClick={() =>
          setValue((was) => ({
            ...was,
            criteria: [named("New"), ...was.criteria],
          }))
        }
        type="button"
      >
        Change from outside
      </button>
      <FilterBuilder fields={FIELDS} onChange={setValue} value={value} />
      <output>
        {JSON.stringify(
          value.criteria.map((item) => (item as { value: string[] }).value[0]),
        )}
      </output>
    </>
  );
}

describe("FilterBuilder drag and drop", () => {
  const nested: FilterDefinition = {
    criteria: [
      amount("1"),
      named("Ann"),
      { criteria: [amount("2")], logic: "OR" },
    ],
    logic: "AND",
  };

  /** The rows and nested groups that can be dragged, in the order they are drawn. */
  const items = (container: HTMLElement) => [
    ...container.querySelectorAll<HTMLElement>("[data-fb-item]"),
  ];
  const handleOf = (item: HTMLElement) =>
    // A nested group holds the handles of its rows too. Its own is the last one.
    [...item.querySelectorAll<HTMLElement>(".fb-drag-handle")].at(
      -1,
    ) as HTMLElement;

  /**
   * Drags over an element with the pointer `clientY` pixels down the screen. The test page has
   * no drag event of its own, so the pointer's place is added to a plain one.
   */
  const dragOverAt = (element: HTMLElement, clientY: number): boolean => {
    const event = createEvent.dragOver(element);
    Object.defineProperty(event, "clientY", { value: clientY });
    return fireEvent(element, event);
  };

  /** Gives an element a place on screen: 40 pixels tall, starting at `top`. */
  const placeAt = (element: HTMLElement, top: number) => {
    element.getBoundingClientRect = () =>
      ({
        top,
        height: 40,
        bottom: top + 40,
        left: 0,
        right: 0,
        width: 0,
      }) as DOMRect;
  };

  it("should drop a row before another when over its top half, and after when over its bottom half", () => {
    const { container, filter } = renderBuilder({
      criteria: [amount("1"), amount("2"), amount("3")],
      logic: "AND",
    });
    const values = () =>
      filter().criteria.map((item) => (item as { value: string[] }).value[0]);

    let rows = items(container);
    fireEvent.dragStart(handleOf(rows[0] as HTMLElement));
    placeAt(rows[2] as HTMLElement, 100);
    dragOverAt(rows[2] as HTMLElement, 130);
    fireEvent.drop(rows[2] as HTMLElement);
    expect(values()).toEqual(["2", "3", "1"]);

    rows = items(container);
    fireEvent.dragStart(handleOf(rows[2] as HTMLElement));
    placeAt(rows[0] as HTMLElement, 0);
    dragOverAt(rows[0] as HTMLElement, 5);
    fireEvent.drop(rows[0] as HTMLElement);
    expect(values()).toEqual(["1", "2", "3"]);
  });

  it("should mark the row being dragged and the place it would land, then clear both", () => {
    const { container } = renderBuilder({
      criteria: [amount("1"), amount("2"), amount("3")],
      logic: "AND",
    });
    const rows = items(container);
    fireEvent.dragStart(handleOf(rows[0] as HTMLElement));
    expect(rows[0]?.hasAttribute("data-dragging")).toBe(true);

    placeAt(rows[1] as HTMLElement, 50);
    dragOverAt(rows[1] as HTMLElement, 85);
    // After the second row is the same place as before the third.
    expect(rows[2]?.hasAttribute("data-drop")).toBe(true);
    expect(container.querySelectorAll("[data-drop]")).toHaveLength(1);

    fireEvent.dragEnd(handleOf(rows[0] as HTMLElement));
    expect(container.querySelector("[data-dragging]")).toBeNull();
    expect(container.querySelector("[data-drop]")).toBeNull();
  });

  it("should drop a row at the end of a group from that group's footer", () => {
    const { container, filter } = renderBuilder(nested);
    const [first] = items(container);
    const footers = container.querySelectorAll<HTMLElement>(".fb-group-footer");
    // The nested group is drawn before the top group's footer.
    const nestedFooter = footers[0] as HTMLElement;

    fireEvent.dragStart(handleOf(first as HTMLElement));
    fireEvent.dragOver(nestedFooter);
    expect(nestedFooter.hasAttribute("data-drop")).toBe(true);
    fireEvent.drop(nestedFooter);

    expect(filter()).toEqual({
      criteria: [
        named("Ann"),
        { criteria: [amount("2"), amount("1")], logic: "OR" },
      ],
      logic: "AND",
    });
  });

  it("should move a whole group by its bar, and take a row out of a group", () => {
    const { container, filter } = renderBuilder(nested);
    let all = items(container);
    const group = all[2] as HTMLElement;
    placeAt(all[0] as HTMLElement, 0);
    fireEvent.dragStart(handleOf(group));
    dragOverAt(all[0] as HTMLElement, 5);
    fireEvent.drop(all[0] as HTMLElement);
    expect(filter().criteria[0]).toEqual({
      criteria: [amount("2")],
      logic: "OR",
    });

    // Now drag the row inside the group to just after the group, by the group's bar.
    all = items(container);
    const movedGroup = all[0] as HTMLElement;
    const inside = all[1] as HTMLElement;
    const bar = movedGroup.querySelector(".fb-bar") as HTMLElement;
    placeAt(bar, 0);
    fireEvent.dragStart(handleOf(inside));
    dragOverAt(bar, 35);
    fireEvent.drop(bar);
    expect(filter()).toEqual({
      criteria: [
        { criteria: [], logic: "OR" },
        amount("2"),
        amount("1"),
        named("Ann"),
      ],
      logic: "AND",
    });
  });

  it("should refuse a drop that changes nothing or puts a group inside itself", () => {
    const { container, filter } = renderBuilder(nested);
    const all = items(container);
    const group = all[2] as HTMLElement;
    const ownFooter = group.querySelector(".fb-group-footer") as HTMLElement;

    fireEvent.dragStart(handleOf(group));
    // `fireEvent` gives back false when the event was accepted (its default was prevented).
    expect(fireEvent.dragOver(ownFooter)).toBe(true);
    expect(container.querySelector("[data-drop]")).toBeNull();
    fireEvent.drop(ownFooter);
    fireEvent.dragEnd(handleOf(group));

    // A row dropped on its own top half stays where it is.
    placeAt(all[0] as HTMLElement, 0);
    fireEvent.dragStart(handleOf(all[0] as HTMLElement));
    expect(dragOverAt(all[0] as HTMLElement, 5)).toBe(true);
    fireEvent.drop(all[0] as HTMLElement);

    expect(filter()).toEqual(nested);
  });

  it("should refuse a drop that would pass the depth limit", () => {
    const { container, filter } = renderBuilder(nested, { depthLimit: 2 });
    const before = filter();
    const all = items(container);
    const group = all[2] as HTMLElement;
    // A second group, added at the top level, may not go inside the first.
    fireEvent.click(
      within(container)
        .getAllByRole("button", { name: "Add group" })
        .at(-1) as HTMLElement,
    );
    expect(filter()).not.toEqual(before);
    const withTwo = filter();
    const second = items(container).at(-1) as HTMLElement;
    fireEvent.dragStart(handleOf(second));
    const firstFooter = group.querySelector(".fb-group-footer") as HTMLElement;
    expect(fireEvent.dragOver(firstFooter)).toBe(true);
    fireEvent.drop(firstFooter);
    expect(filter()).toEqual(withTwo);
  });

  it("should end a drag when the app changes the filter under it", () => {
    const { container } = render(<AppThatChangesTheFilter />);
    fireEvent.dragStart(handleOf(items(container)[1] as HTMLElement));
    fireEvent.click(
      screen.getByRole("button", { name: "Change from outside" }),
    );
    expect(container.querySelector("[data-dragging]")).toBeNull();

    // The held path now leads to another row, so the drop must do nothing.
    const rows = items(container);
    placeAt(rows[3] as HTMLElement, 0);
    dragOverAt(rows[3] as HTMLElement, 35);
    fireEvent.drop(rows[3] as HTMLElement);
    expect(container.querySelector("output")?.textContent).toBe(
      '["New","1","2","3"]',
    );
  });

  it("should ignore something dragged in from outside the builder", () => {
    const { container, filter } = renderBuilder(nested);
    const [first] = items(container);
    placeAt(first as HTMLElement, 0);
    expect(dragOverAt(first as HTMLElement, 30)).toBe(true);
    fireEvent.drop(first as HTMLElement);
    expect(filter()).toEqual(nested);
    expect(container.querySelector("[data-drop]")).toBeNull();
  });
});

describe("FieldPicker", () => {
  const open = () => {
    renderBuilder({ criteria: [amount("1")], logic: "AND" });
    fireEvent.click(screen.getByRole("button", { name: "Field: Amount" }));
    return screen.getByRole("combobox", { name: "Search fields" });
  };

  it("should list every field and mark the chosen one", () => {
    open();
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Amount",
      "Name",
      "Status",
    ]);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("should find a field by part of its name or its key", () => {
    const search = open();
    fireEvent.change(search, { target: { value: "sta" } });
    const list = screen.getByRole("listbox");
    expect(
      within(list)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Status"]);
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(within(list).queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No field found.")).toBeTruthy();
  });

  it("should pick with the arrow keys and Enter", () => {
    const search = open();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    expect(screen.getByRole("button", { name: "Field: Name" })).toBeTruthy();
    // The list closes after a pick.
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("should close on Escape and on a click outside, without changing the field", () => {
    const search = open();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Field: Amount" }));
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("button", { name: "Field: Amount" })).toBeTruthy();
  });

  it.each(["open", "closed"] as const)(
    "should close on a press on the bare host of the %s shadow tree it is drawn in",
    (mode) => {
      // A shadow tree is a part of the page that hides its insides from the rest.
      const host = document.createElement("div");
      document.body.append(host);
      const container = document.createElement("div");
      host.attachShadow({ mode }).append(container);
      const { unmount } = render(
        <App
          extra={{}}
          initial={{ criteria: [amount("1")], logic: "AND" }}
          onFilter={() => {}}
        />,
        { container },
      );
      const inside = within(container);
      fireEvent.click(inside.getByRole("button", { name: "Field: Amount" }));
      const search = inside.getByRole("combobox", { name: "Search fields" });
      fireEvent.change(search, { target: { value: "sta" } });
      // A press on the host itself, such as on its padding. It is outside the picker.
      fireEvent.pointerDown(host);
      expect(inside.queryByRole("listbox")).toBeNull();
      // The search is cleared too, so the list is whole when it opens again.
      fireEvent.click(inside.getByRole("button", { name: "Field: Amount" }));
      expect(
        within(inside.getByRole("listbox")).getAllByRole("option"),
      ).toHaveLength(3);
      unmount();
      host.remove();
    },
  );

  it("should tell a press in an open shadow tree apart when the host stops the press", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const container = document.createElement("div");
    const beside = document.createElement("p");
    host.attachShadow({ mode: "open" }).append(container, beside);
    // No listener inside the tree hears a press. Only the page's own listener does, and it
    // is told that the press was on the host.
    stopPressesAt(host);
    const { unmount } = render(
      <App
        extra={{}}
        initial={{ criteria: [amount("1")], logic: "AND" }}
        onFilter={() => {}}
      />,
      { container },
    );
    const inside = within(container);
    fireEvent.click(inside.getByRole("button", { name: "Field: Amount" }));
    pressInOpenTree(host, inside.getByRole("listbox"));
    expect(inside.queryByRole("listbox")).not.toBeNull();
    // Inside the same tree, but outside the picker, on something that takes no focus.
    pressInOpenTree(host, beside);
    expect(inside.queryByRole("listbox")).toBeNull();
    unmount();
    host.remove();
  });

  it("should close when the keyboard focus leaves it, and stay open while focus is inside", () => {
    const search = open();
    // Focus moving to the picker's own button is still inside the picker.
    fireEvent.blur(search, {
      relatedTarget: screen.getByRole("button", { name: "Field: Amount" }),
    });
    expect(screen.getByRole("listbox")).toBeTruthy();
    // Tab moves the focus to the next control on the page.
    fireEvent.blur(search, { relatedTarget: document.body });
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

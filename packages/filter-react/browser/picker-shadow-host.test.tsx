import type { FieldDefinition, FilterDefinition } from "@arvilmena/filter-core";
import { useState } from "react";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { FilterBuilder } from "../src/ui/FilterBuilder";
import { openPicker, PickerApp } from "./support/apps";
import { mount } from "./support/mount";
import { clickAt, clickOn } from "./support/pointer";
import { barePadding, shadowStage } from "./support/shadow";

// A press on the bare host of a shadow tree (a part of the page that hides its insides): on
// the host's own padding, where nothing inside the tree is drawn. It is outside the picker, so
// the picker closes.
//
// Only a real browser can settle this. The page is told of such a press exactly as it is told
// of a press inside the tree, and a closed tree hides the difference altogether. The picker
// tells the two apart by the order in which the browser calls the host's listeners.

const FIELDS: FieldDefinition[] = [
  { key: "name", label: "Name", type: "string" },
  { key: "amount", label: "Amount", type: "num" },
];
const FILTER: FilterDefinition = {
  logic: "AND",
  criteria: [
    {
      condition: "=",
      data: "Name",
      origData: "name",
      type: "string",
      value: ["A"],
    },
  ],
};

/** A filter builder with one condition, whose field picker a test opens. */
function BuilderApp() {
  const [filter, setFilter] = useState(FILTER);
  return <FilterBuilder fields={FIELDS} onChange={setFilter} value={filter} />;
}

describe.each(["open", "closed"] as const)(
  "a press on the bare host of a %s shadow tree",
  (mode) => {
    test("closes the column picker, which a press inside keeps open", async () => {
      const { host, shadow, container } = shadowStage(mode);
      mount(<PickerApp />, container);
      const picker = await openPicker(shadow);

      // A press inside: the column is hidden, and the list is still there.
      await clickOn(picker.row("Price").querySelector("label") as Element);
      await expect.poll(picker.table).toBe("name stock");
      expect(picker.popover()).not.toBeNull();

      await clickAt(barePadding(host));
      await expect.poll(picker.popover).toBeNull();

      // The picker still works afterwards: it opens, and closes the same way again.
      await clickOn(picker.trigger());
      await expect.poll(picker.popover).not.toBeNull();
      await clickAt(barePadding(host));
      await expect.poll(picker.popover).toBeNull();
    });

    test("closes the builder's field picker, which a press inside keeps open", async () => {
      const { host, shadow, container } = shadowStage(mode);
      // The field picker also closes when its search box loses the focus, which a press on
      // the padding would cause. This host keeps the focus where it is, as an app's own
      // handler may. So only the place of the press can close the picker here.
      host.addEventListener("mousedown", (event) => {
        if (event.target === host) event.preventDefault();
      });
      mount(<BuilderApp />, container);
      const popover = () => shadow.querySelector(".fb-picker-popover");
      const options = () => shadow.querySelectorAll(".fb-picker-option").length;
      await expect
        .poll(() => shadow.querySelector(".fb-picker-button"))
        .not.toBeNull();
      await clickOn(shadow.querySelector(".fb-picker-button") as Element);
      await expect.poll(popover).not.toBeNull();

      // A press inside, on the search box. Typing then narrows the list, which shows that the
      // list is still open and in use.
      await clickOn(shadow.querySelector(".fb-picker-search") as Element);
      await userEvent.keyboard("amo");
      await expect.poll(options).toBe(1);
      expect(popover()).not.toBeNull();

      await clickAt(barePadding(host));
      await expect.poll(popover).toBeNull();
    });
  },
);

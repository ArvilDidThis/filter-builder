import type { ColumnDefinition } from "@arvilmena/filter-core";
import { memo } from "react";
import { expect } from "vitest";
import {
  ColumnPicker,
  type ColumnPickerProps,
  type ColumnPickerRow,
} from "../../src/ui/ColumnPicker";
import { useColumnSettings } from "../../src/useColumnSettings";
import { mount } from "./mount";
import { clickOn } from "./pointer";

// Small apps around the column picker, and ways to find its parts on the page.

/** A short column list. "Name" must stay shown, and "Notes" starts hidden. */
export const COLUMNS: readonly ColumnDefinition[] = [
  { key: "name", label: "Name", hideable: false },
  { key: "price", label: "Price" },
  { key: "stock", label: "Stock" },
  { key: "notes", label: "Notes", defaultHidden: true },
];

/** A column list of any length: "Column 0", "Column 1" and so on. */
export function manyColumns(count: number): readonly ColumnDefinition[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `c${index}`,
    label: `Column ${index}`,
  }));
}

/** Counts what a test wants counted, such as how often a table is drawn. */
export interface Counter {
  count: number;
}

/** A stand-in for an app's table. It is memoised, as a large table would be. */
const Table = memo(function Table({
  columns,
  drawn,
}: {
  columns: readonly ColumnDefinition[];
  drawn?: Counter;
}) {
  if (drawn) drawn.count += 1;
  return (
    <p data-testid="table">{columns.map((column) => column.key).join(" ")}</p>
  );
});

/** What `PickerApp` takes. */
export interface PickerAppProps {
  columns?: readonly ColumnDefinition[];
  /** Passed on to the picker. */
  picker?: Partial<ColumnPickerProps>;
  /** Goes up each time the table is drawn. */
  tableDrawn?: Counter;
  /** Goes up each time the picker asks for a change. */
  changed?: Counter;
}

/** An app around the picker: a table that follows it, and something else to click on. */
export function PickerApp({
  columns = COLUMNS,
  picker,
  tableDrawn,
  changed,
}: PickerAppProps) {
  const state = useColumnSettings({
    columns,
    onChange: () => {
      if (changed) changed.count += 1;
    },
  });
  return (
    <>
      {/* Above the picker, so the open list never covers it. */}
      <p>
        <button data-testid="elsewhere" type="button">
          Elsewhere
        </button>{" "}
        {/* Takes no keyboard focus, so a click on it is told only by where it lands. */}
        <span data-testid="plain-text">Plain text</span>
      </p>
      <ColumnPicker state={state} {...picker} />
      <Table columns={state.visibleColumns} drawn={tableDrawn} />
    </>
  );
}

/**
 * A row drawn by an app, with the same parts and classes as the picker's own. A test passes
 * it as `renderRow` to count the rows drawn, or to change one part.
 *
 * `handleKey` is the handle's React key. A new one makes React put a new element in the old
 * one's place.
 */
export function standardRow(row: ColumnPickerRow, handleKey?: number) {
  return (
    <>
      <input className="fb-columns-checkbox" {...row.checkboxProps} />
      <button
        className="fb-columns-handle"
        key={handleKey}
        {...row.handleProps}
      >
        <span aria-hidden="true">⠿</span>
      </button>
      <label className="fb-columns-label" htmlFor={row.checkboxProps.id}>
        {row.column.label}
      </label>
    </>
  );
}

/** Finds the parts of one picker. `within` is the page, shadow tree or element that holds it. */
export function pickerParts(within: ParentNode = document) {
  const one = <Found extends Element = HTMLElement>(
    selector: string,
  ): Found => {
    const found = within.querySelector<Found>(selector);
    if (found === null)
      throw new Error(`Nothing on the page matches ${selector}`);
    return found;
  };
  const rows = (): HTMLElement[] =>
    Array.from(within.querySelectorAll<HTMLElement>(".fb-columns-row"));
  const row = (label: string): HTMLElement => {
    // By the label's whole text, so "Price" never finds a row named "Unit price".
    const found = rows().find(
      (item) =>
        item.querySelector(".fb-columns-label")?.textContent?.trim() === label,
    );
    if (found === undefined) throw new Error(`No row is named ${label}`);
    return found;
  };
  const footerButton = (name: string): HTMLButtonElement => {
    const found = Array.from(
      within.querySelectorAll<HTMLButtonElement>(".fb-columns-footer button"),
    ).find((button) => button.textContent === name);
    if (found === undefined) throw new Error(`No button is named ${name}`);
    return found;
  };
  return {
    trigger: () => one<HTMLButtonElement>(".fb-columns-trigger"),
    popover: () => within.querySelector<HTMLElement>(".fb-columns-popover"),
    list: () => one(".fb-columns-list"),
    /** Whether a drag is under way in the list. */
    isDragging: () => one(".fb-columns-list").hasAttribute("data-dragging"),
    rows,
    row,
    /** The names in the list, in order. */
    listed: () =>
      rows().map((item) => item.textContent?.replace("⠿", "").trim()),
    handle: (label: string) =>
      one<HTMLButtonElement>(
        `[data-fb-column-handle][aria-label="Move ${label}"]`,
      ),
    checkbox: (label: string) => {
      const box = row(label).querySelector<HTMLInputElement>("input");
      if (box === null) throw new Error(`The row ${label} has no checkbox`);
      return box;
    },
    showAll: () => footerButton("Show all"),
    reset: () => footerButton("Reset"),
    /** The column keys the table shows, in order. */
    table: () => one('[data-testid="table"]').textContent,
    elsewhere: () => one<HTMLButtonElement>('[data-testid="elsewhere"]'),
    /** Text outside the picker that takes no keyboard focus. */
    plainText: () => one('[data-testid="plain-text"]'),
    /** What a screen reader was last told. */
    announced: () => one("[aria-live]").textContent,
  };
}

/** One picker's parts, as `pickerParts` finds them. */
export type PickerParts = ReturnType<typeof pickerParts>;

/**
 * Opens the picker found in `within` with a real click on its button, and waits for its list.
 * `within` is the page, shadow tree or element that holds the picker.
 */
export async function openPicker(
  within: ParentNode = document,
): Promise<PickerParts> {
  const picker = pickerParts(within);
  await expect
    .poll(() => within.querySelector(".fb-columns-trigger"))
    .not.toBeNull();
  await clickOn(picker.trigger());
  await expect.poll(picker.popover).not.toBeNull();
  return picker;
}

/** Draws `PickerApp` on the page and opens its picker. */
export async function mountOpenPicker(
  props: PickerAppProps = {},
): Promise<PickerParts> {
  mount(<PickerApp {...props} />);
  return openPicker();
}

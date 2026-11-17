import type { FieldDefinition } from "@arvilmena/filter-core";
import { useEffect, useId, useMemo, useRef, useState } from "react";

/** What the field picker needs. */
export interface FieldPickerProps {
  /** The fields to choose from. */
  fields: readonly FieldDefinition[];
  /** The key of the field chosen now, or "" for none. */
  selectedKey: string;
  /** The text shown on the button: the chosen field's label, or "" for none. */
  label: string;
  /** Called with the key of the field a person picks. */
  onPick: (key: string) => void;
}

/**
 * A button that opens a searchable list of fields. A plain dropdown is hard to use once an app
 * has many fields, so a person can type part of a field's name or key to find it.
 *
 * It works from the keyboard: the arrow keys move through the list, Enter picks, Escape closes.
 */
export function FieldPicker({
  fields,
  selectedKey,
  label,
  onPick,
}: FieldPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const wanted = query.trim().toLowerCase();
    if (wanted === "") return fields;
    return fields.filter(
      (field) =>
        field.label.toLowerCase().includes(wanted) ||
        field.key.toLowerCase().includes(wanted),
    );
  }, [fields, query]);

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setQuery("");
    if (returnFocus) buttonRef.current?.focus();
  };

  const openList = () => {
    // Start on the field chosen now, so the arrow keys move from there.
    const chosen = fields.findIndex((field) => field.key === selectedKey);
    setActive(chosen === -1 ? 0 : chosen);
    setOpen(true);
  };

  const pick = (field: FieldDefinition | undefined) => {
    if (field === undefined) return;
    onPick(field.key);
    close(true);
  };

  // A click or tap anywhere outside the picker closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted field in view while the arrow keys move through a long list.
  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.children[active] as HTMLElement | undefined;
    item?.scrollIntoView?.({ block: "nearest" });
  }, [open, active]);

  return (
    // It only hears the blur of the controls inside it. A person never acts on it directly.
    // biome-ignore lint/a11y/noStaticElementInteractions: see the line above
    <div
      className="fb-picker"
      // Tab moves the focus on to the next control. The list would otherwise stay open over it.
      onBlur={(event) => {
        if (open && !rootRef.current?.contains(event.relatedTarget)) {
          close(false);
        }
      }}
      ref={rootRef}
    >
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label ? `Field: ${label}` : "Choose a field"}
        className="fb-control fb-picker-button"
        onClick={() => (open ? close(false) : openList())}
        // Keeps the focus in the search box while the list is open. Some browsers do not
        // focus a clicked button, so the blur above would close the list and this click
        // would open it again.
        onPointerDown={(event) => {
          if (open) event.preventDefault();
        }}
        ref={buttonRef}
        type="button"
      >
        <span
          className={label ? "fb-picker-label" : "fb-picker-label fb-muted"}
        >
          {label || "Choose a field"}
        </span>
        <span aria-hidden="true" className="fb-picker-arrow">
          ▾
        </span>
      </button>

      {open && (
        <div className="fb-picker-popover">
          <input
            aria-activedescendant={
              matches[active] ? `${listId}-${active}` : undefined
            }
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded="true"
            aria-label="Search fields"
            // The search box is why the list opened, so typing should work at once.
            // biome-ignore lint/a11y/noAutofocus: see the line above
            autoFocus
            className="fb-control fb-picker-search"
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActive((was) => Math.min(was + 1, matches.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((was) => Math.max(was - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                pick(matches[active]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                close(true);
              }
            }}
            placeholder="Search fields"
            role="combobox"
            type="text"
            value={query}
          />
          {/* The search box keeps the focus, and reads out the highlighted field through
              `aria-activedescendant`. So the fields are not tab stops themselves. */}
          <div
            className="fb-picker-list"
            id={listId}
            ref={listRef}
            role="listbox"
            tabIndex={-1}
          >
            {matches.map((field, index) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: the search box handles the keys
              <div
                aria-selected={field.key === selectedKey}
                className="fb-picker-option"
                data-active={index === active ? "" : undefined}
                id={`${listId}-${index}`}
                key={field.key}
                onClick={() => pick(field)}
                // Keeps the focus in the search box, so the click is not lost to a blur.
                onPointerDown={(event) => event.preventDefault()}
                role="option"
                tabIndex={-1}
              >
                {field.label}
              </div>
            ))}
            {matches.length === 0 && (
              <div className="fb-picker-empty fb-muted">No field found.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

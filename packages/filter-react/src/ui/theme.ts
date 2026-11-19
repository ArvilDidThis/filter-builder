import type { CSSProperties } from "react";

// The names of the CSS variables that change the look of the ready-made components. The
// defaults are in `styles.css`, and a test checks that this list and that file agree.

/**
 * Every `--fb-*` variable an app may set to change the look of the ready-made builder and
 * column picker. Set one on the component, or on any element around it.
 */
export const FILTER_THEME_VARIABLES = [
  "--fb-page",
  "--fb-border",
  "--fb-control-bg",
  "--fb-hover-bg",
  "--fb-and",
  "--fb-or",
  "--fb-popover-bg",
  "--fb-shadow",
  "--fb-muted",
  "--fb-focus",
  "--fb-radius",
  "--fb-control-height",
  "--fb-gap",
  "--fb-value-width",
  "--fb-backdrop",
  "--fb-dialog-column-width",
  "--fb-selected-bg",
  "--fb-sticky-top",
] as const;

/** The name of one `--fb-*` variable. */
export type FilterThemeVariable = (typeof FILTER_THEME_VARIABLES)[number];

/**
 * An inline style for a ready-made component. Besides the usual CSS properties it takes the
 * `--fb-*` variables, so TypeScript accepts them with no cast and suggests their names.
 *
 * @example
 * <ColumnPicker state={table} style={{ "--fb-radius": "0", "--fb-focus": "rebeccapurple" }} />
 */
export type FilterThemeStyle = CSSProperties & {
  [Name in FilterThemeVariable]?: string | number;
};

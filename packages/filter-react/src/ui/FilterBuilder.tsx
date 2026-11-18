import {
  type BuilderCondition,
  type BuilderGroup,
  type BuilderRow,
  type ConditionOperator,
  describeFilter,
  type FieldDefinition,
  type FilterDefinition,
  type FilterPath,
  getItemAt,
  isFilterGroup,
  isNumberType,
  LOGIC_JOINERS,
  LOGIC_LABELS,
  type LogicOperator,
  OPERATOR_LABELS,
} from "@arvilmena/filter-core";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  type FilterBuilderActions,
  useFilterBuilder,
} from "../useFilterBuilder";
import { FieldPicker } from "./FieldPicker";
import type { FilterThemeStyle } from "./theme";
import { type RowDrag, useRowDrag } from "./useRowDrag";

// A ready-made filter builder with default styling. It is laid out like DataTables
// SearchBuilder: each group has a tall bar on its left that says "And" or "Or" and spans every
// row of the group.
//
// It uses plain HTML controls and the class names in `styles.css`, so it needs no UI kit. An app
// that wants a different look can restyle those classes, or draw its own builder from
// `useFilterBuilder`.

/** What the builder needs from the app. */
export interface FilterBuilderProps {
  /** The filter to show. The app owns it: keep it in state and pass it back in. */
  value: FilterDefinition;
  /** Called with the new filter after every change. */
  onChange: (filter: FilterDefinition) => void;
  /** The fields a condition can be on. Keep the same list between renders. */
  fields: readonly FieldDefinition[];
  /** The most levels of groups allowed, counting the top group as level 1. */
  depthLimit?: number;
  /** The operator a new condition starts with, when its field offers it. */
  defaultOperator?: ConditionOperator;
  /** The heading. Defaults to "Filters". */
  title?: string;
  /** Replace the wording of some operators, e.g. `{ ">=": "min" }`. */
  operatorLabels?: Partial<Record<ConditionOperator, string>>;
  /** Extra controls for the header, such as a preset picker. */
  headerActions?: ReactNode;
  /** Whether to show the plain-English summary under the builder. Defaults to true. */
  showSummary?: boolean;
  /** Added to the builder's own class, for an app's extra styling. */
  className?: string;
  /**
   * An inline style for the builder's outer element. It also takes the `--fb-*` variables, to
   * change the look of this one builder: `style={{ "--fb-radius": "0" }}`.
   */
  style?: FilterThemeStyle;
}

/** The move buttons of a row. */
type MoveButton = "up" | "down" | "out" | "wrap" | "into";

/** Names one row's move button, so it can be found again after the row has moved. */
const moveButtonKey = (path: FilterPath, button: MoveButton): string =>
  `${path.join(".")}:${button}`;

/** What every row needs, passed down once so each row does not take a long list of props. */
interface BuilderContext {
  actions: FilterBuilderActions;
  /** Dragging a row or a group to a new place. */
  drag: RowDrag;
  /**
   * Keeps the keyboard focus on a row after one of its move buttons moved it. `path` is where
   * the row lands, and `buttons` are the buttons to focus there, the first that can be used.
   */
  followMove: (path: FilterPath, buttons: readonly MoveButton[]) => void;
  /** How many rows the group at `path` holds, or 0 when there is no group there. */
  rowCountAt: (path: FilterPath) => number;
  fields: readonly FieldDefinition[];
  operatorLabels: Record<ConditionOperator, string>;
}

/**
 * A filter builder: conditions, nested groups, and a plain-English summary of the result.
 *
 * Load its style sheet once in the app: `import "@arvilmena/filter-react/styles.css"`.
 */
export function FilterBuilder({
  value,
  onChange,
  fields,
  depthLimit,
  defaultOperator,
  title = "Filters",
  operatorLabels,
  headerActions,
  showSummary = true,
  className,
  style,
}: FilterBuilderProps) {
  const builder = useFilterBuilder({
    value,
    onChange,
    fields,
    depthLimit,
    defaultOperator,
  });

  const drag = useRowDrag(builder.actions, value);
  const labels = useMemo(
    () => ({ ...OPERATOR_LABELS, ...operatorLabels }),
    [operatorLabels],
  );
  // A row is drawn by its place in the filter, so after a move the focused button would
  // belong to the row that took its place. The focus is moved to the row's new place instead,
  // so pressing the button again moves the same row again.
  const rootRef = useRef<HTMLElement>(null);
  const focusNext = useRef<readonly string[] | null>(null);
  useEffect(() => {
    const wanted = focusNext.current;
    if (wanted === null) return;
    focusNext.current = null;
    for (const key of wanted) {
      const button = rootRef.current?.querySelector<HTMLButtonElement>(
        `[data-move="${key}"]:not(:disabled)`,
      );
      if (button) {
        button.focus();
        return;
      }
    }
  });

  const context: BuilderContext = {
    actions: builder.actions,
    drag,
    rowCountAt: (path) => {
      const item = getItemAt(value, path);
      return item !== undefined && isFilterGroup(item)
        ? item.criteria.length
        : 0;
    },
    followMove: (path, buttons) => {
      focusNext.current = buttons.map((button) => moveButtonKey(path, button));
    },
    fields,
    operatorLabels: labels,
  };
  const summary = useMemo(
    () => (showSummary ? describeFilter(value, builder.fields) : []),
    [showSummary, value, builder.fields],
  );
  const count = builder.conditionCount;

  return (
    <section
      aria-label={title}
      className={className ? `fb ${className}` : "fb"}
      ref={rootRef}
      style={style}
    >
      <header className="fb-header">
        <h2 className="fb-title">
          {title} <span className="fb-count">({count})</span>
        </h2>
        <div className="fb-header-actions">
          {headerActions}
          {count > 0 && (
            <button
              className="fb-button"
              onClick={builder.actions.clear}
              type="button"
            >
              Clear all
            </button>
          )}
        </div>
      </header>

      <Group context={context} group={builder.root} />

      {summary.length > 0 && (
        <p className="fb-summary">
          {summary.map((part, index) =>
            part.kind === "joiner" ? (
              // The parts never reorder, so their position is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: see the line above
              <strong key={index}>{part.text}</strong>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              <span key={index}>{part.text}</span>
            ),
          )}
        </p>
      )}
    </section>
  );
}

/** A group: the bar that says "And" or "Or", then its rows and the buttons that add to it. */
function Group({
  group,
  context,
}: {
  group: BuilderGroup;
  context: BuilderContext;
}) {
  const { actions, drag } = context;
  const other: LogicOperator = group.logic === "AND" ? "OR" : "AND";
  const isTopGroup = group.path.length === 0;

  return (
    <div
      className="fb-group"
      data-logic={group.logic}
      {...(isTopGroup ? {} : itemProps(drag, group.path))}
    >
      {/* A drop on a nested group's bar lands before or after the whole group. */}
      <div
        className="fb-bar"
        {...(isTopGroup ? {} : drag.dropAroundProps(group.path))}
      >
        <button
          aria-label={`Match ${LOGIC_LABELS[group.logic].label} of these: ${LOGIC_LABELS[group.logic].hint}. Change to ${LOGIC_LABELS[other].label}.`}
          className="fb-bar-logic"
          onClick={() => actions.setLogic(group.path, other)}
          data-tooltip={LOGIC_TOOLTIPS[group.logic]}
          data-tooltip-side="right"
          type="button"
        >
          <span className="fb-bar-text">{LOGIC_JOINERS[group.logic]}</span>
        </button>
        {!isTopGroup && (
          <button
            aria-label="Remove group"
            className="fb-bar-remove"
            data-tooltip="Remove this group and everything in it"
            data-tooltip-side="right"
            onClick={() => actions.remove(group.path)}
            type="button"
          >
            ×
          </button>
        )}
      </div>

      <div className="fb-group-body">
        {group.rows.map((row) => (
          <Row context={context} key={row.id} row={row} />
        ))}

        {/* A drop on the footer lands at the end of this group. */}
        <div
          className="fb-group-footer"
          data-drop={
            drag.isDropSlot(group.path, group.rows.length) ? "" : undefined
          }
          {...drag.dropAtEndProps(group.path, group.rows.length)}
        >
          <button
            className="fb-button"
            onClick={() => actions.addCondition(group.path)}
            type="button"
          >
            Add condition
          </button>
          {group.canAddGroup && (
            <button
              className="fb-button"
              onClick={() => actions.addGroup(group.path)}
              type="button"
            >
              Add group
            </button>
          )}
          {!isTopGroup && (
            <RowActions context={context} label="group" row={group} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The marks on a row's or a nested group's own element: that it can be dragged, whether it is
 * the one being dragged, and whether a drop would land just before it. The style sheet draws
 * from these.
 */
function itemProps(drag: RowDrag, path: FilterPath) {
  const index = path[path.length - 1] as number;
  return {
    "data-fb-item": "",
    "data-dragging": drag.isDragging(path) ? "" : undefined,
    "data-drop": drag.isDropSlot(path.slice(0, -1), index) ? "" : undefined,
  };
}

/** One row of a group: a condition, a nested group, or a slot that holds neither. */
function Row({ row, context }: { row: BuilderRow; context: BuilderContext }) {
  if (row.kind === "condition") {
    return <ConditionRow context={context} row={row} />;
  }
  if (row.kind === "group") {
    return <Group context={context} group={row} />;
  }
  return (
    <div
      className="fb-row fb-row-broken"
      {...itemProps(context.drag, row.path)}
      {...context.drag.dropAroundProps(row.path)}
    >
      <span className="fb-muted">
        This row cannot be read, so it is skipped.
      </span>
      <RowActions
        context={context}
        label="unreadable row"
        row={row}
        withRemove
      />
    </div>
  );
}

/** A condition: its field, its operator, its value boxes and its buttons, in four columns. */
function ConditionRow({
  row,
  context,
}: {
  row: BuilderCondition;
  context: BuilderContext;
}) {
  const { actions, operatorLabels } = context;
  const { condition, field, path } = row;
  const name = field?.label ?? (condition.data || "new condition");
  // A stored filter may hold an operator the field no longer offers. Keep it listed, so the
  // dropdown still shows what the filter says.
  const operators = row.operators.includes(condition.condition)
    ? row.operators
    : [condition.condition, ...row.operators];

  return (
    <div
      className="fb-row"
      {...itemProps(context.drag, path)}
      {...context.drag.dropAroundProps(path)}
    >
      <FieldPicker
        fields={context.fields}
        label={field?.label ?? condition.data}
        onPick={(key) => actions.setField(path, key)}
        selectedKey={condition.origData}
      />

      <select
        aria-label={`Condition for ${name}`}
        className="fb-control fb-operator"
        onChange={(event) =>
          actions.setOperator(path, event.target.value as ConditionOperator)
        }
        value={condition.condition}
      >
        {operators.map((operator) => (
          <option key={operator} value={operator}>
            {operatorLabels[operator] ?? operator}
          </option>
        ))}
      </select>

      <div className="fb-values">
        <ValueBoxes context={context} name={name} row={row} />
        {/* Right beside the value, where a person looks when a condition is wrong. */}
        <RemoveButton label={name} onRemove={() => actions.remove(path)} />
      </div>

      <RowActions context={context} label={name} row={row} />
    </div>
  );
}

/** The value boxes of a condition: none, one, two, or a comma-separated list. */
function ValueBoxes({
  row,
  name,
  context,
}: {
  row: BuilderCondition;
  name: string;
  context: BuilderContext;
}) {
  const { actions } = context;
  const { condition, field, path, valueCount } = row;
  const values = Array.isArray(condition.value) ? condition.value : [];

  if (valueCount === null) {
    return (
      <ListValueBox
        name={name}
        onValues={(next) => actions.setValues(path, next)}
        values={values}
      />
    );
  }

  return (
    <>
      {Array.from({ length: valueCount }, (_, index) => {
        const label =
          valueCount === 2
            ? `${index === 0 ? "From" : "To"} value for ${name}`
            : `Value for ${name}`;
        const current = values[index] ?? "";
        const isNumber = field !== undefined && isNumberType(field.type);
        // The date picker shows only a date written as "2011-04-25". A stored date in any other
        // form keeps a plain box, so it is shown as it is stored and as matching compares it.
        const usesDatePicker =
          field?.type === "date" && (current === "" || isPickerDate(current));
        if (field?.choices && field.choices.length > 0) {
          return (
            <select
              aria-label={label}
              className="fb-control fb-value"
              // The boxes never reorder, so their position is a stable key.
              // biome-ignore lint/suspicious/noArrayIndexKey: see the line above
              key={index}
              onChange={(event) =>
                actions.setValue(path, index, event.target.value)
              }
              value={current}
            >
              <option value="">Choose</option>
              {/* A stored value the field no longer offers stays listed, so the box shows
                  what the filter holds until the person picks something else. */}
              {current !== "" &&
                !field.choices.some((choice) => choice.value === current) && (
                  <option value={current}>{current}</option>
                )}
              {field.choices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          );
        }
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: see above
          <label className="fb-control fb-value" key={index}>
            {field?.prefix && (
              <span aria-hidden="true" className="fb-affix">
                {field.prefix}
              </span>
            )}
            <input
              // The name is on the box itself, so the unit beside it is not read out as part
              // of the name.
              aria-label={label}
              className="fb-value-input"
              // Numbers line up on the right, as in a table. Text and dates read from the left.
              data-number={isNumber ? "" : undefined}
              inputMode={isNumber ? "decimal" : undefined}
              onChange={(event) =>
                actions.setValue(path, index, event.target.value)
              }
              // The browser's date picker writes a date year first ("2011-04-25"), which is
              // the form the matching rules compare.
              type={usesDatePicker ? "date" : "text"}
              value={current}
            />
            {field?.suffix && (
              <span aria-hidden="true" className="fb-affix">
                {field.suffix}
              </span>
            )}
          </label>
        );
      })}
    </>
  );
}

/**
 * Whether the browser's date picker can show this text: a real day written as "2011-04-25".
 * The picker shows a day that does not exist, such as 30 February, as an empty box.
 */
function isPickerDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const day = new Date(`${text}T00:00:00Z`);
  // A day that does not exist is either refused or rolled over into the next month.
  return !Number.isNaN(day.getTime()) && day.toISOString().startsWith(text);
}

/**
 * Splits typed text into the values of a list. Empty parts are left out, so a comma typed
 * before the next value does not store a blank value that no row has.
 */
const parseList = (text: string): string[] =>
  text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");

/**
 * The box for a list compared for equality. It takes any number of values, typed with commas
 * between them.
 *
 * It keeps the text as typed. Showing the stored values instead would write a space after every
 * comma, and Backspace would then remove that space but never the comma.
 */
function ListValueBox({
  values,
  name,
  onValues,
}: {
  values: readonly string[];
  name: string;
  onValues: (values: string[]) => void;
}) {
  const [typed, setTyped] = useState(() => values.join(", "));
  // The filter can change from outside the box, such as when a saved filter is loaded. The
  // typed text then no longer says what the filter holds, so the stored values are shown.
  const typedValues = parseList(typed);
  const isCurrent =
    typedValues.length === values.length &&
    typedValues.every((value, index) => value === values[index]);
  return (
    <input
      aria-label={`Values for ${name}, separated by commas`}
      className="fb-control fb-value fb-value-list"
      onChange={(event) => {
        setTyped(event.target.value);
        onValues(parseList(event.target.value));
      }}
      placeholder="a, b, c"
      type="text"
      value={isCurrent ? typed : values.join(", ")}
    />
  );
}

/** What a click on a group's bar does, shown when the pointer rests on it. */
const LOGIC_TOOLTIPS: Record<LogicOperator, string> = {
  AND: "Every row in this group must pass (AND). Click to change to OR.",
  OR: "One row in this group is enough (OR). Click to change to AND.",
};

/** The "×" that removes a condition or an unreadable row. */
function RemoveButton({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <button
      aria-label={`Remove ${label}`}
      className="fb-icon-button fb-remove"
      data-tooltip="Remove this condition"
      onClick={onRemove}
      type="button"
    >
      ×
    </button>
  );
}

/**
 * The move buttons at the end of a row. "<" and ">" are SearchBuilder's: move out of the group,
 * and put in a new group. "⤴" goes beyond SearchBuilder: it moves a row into the group just
 * above it, which is otherwise possible only by dragging. They are left out when the move is not possible, as SearchBuilder
 * does. The arrows reorder within a group.
 *
 * Every move is a button, so reordering works from the keyboard and on a touch screen. Each
 * button says what it does when the pointer rests on it (`data-tooltip`, drawn by the style
 * sheet), and to a screen reader (`aria-label`).
 *
 * The handle before the buttons drags the row with the mouse. It is hidden from a screen
 * reader, because the buttons already make every move it can.
 */
function RowActions({
  row,
  label,
  context,
  withRemove = false,
}: {
  row: BuilderRow;
  label: string;
  context: BuilderContext;
  /** Adds the "×" here, for a row that has no value boxes to put it beside. */
  withRemove?: boolean;
}) {
  const { actions, followMove, rowCountAt } = context;
  const { moves, path } = row;
  const what = row.kind === "group" ? "group" : "row";
  const parentPath = path.slice(0, -1);
  const index = path[path.length - 1] as number;
  return (
    <div className="fb-row-actions">
      <span
        aria-hidden="true"
        className="fb-drag-handle"
        data-tooltip={`Drag to move this ${what}`}
        {...context.drag.handleProps(path)}
      >
        ⠿
      </span>
      <button
        aria-label={`Move ${label} up`}
        className="fb-icon-button"
        data-tooltip={`Move this ${what} up`}
        data-move={moveButtonKey(path, "up")}
        disabled={!moves.up}
        onClick={() => {
          actions.moveUp(path);
          // At the top of its group "up" is turned off, so the focus goes to "down".
          followMove([...parentPath, index - 1], ["up", "down"]);
        }}
        type="button"
      >
        ↑
      </button>
      <button
        aria-label={`Move ${label} down`}
        className="fb-icon-button"
        data-tooltip={`Move this ${what} down`}
        data-move={moveButtonKey(path, "down")}
        disabled={!moves.down}
        onClick={() => {
          actions.moveDown(path);
          followMove([...parentPath, index + 1], ["down", "up"]);
        }}
        type="button"
      >
        ↓
      </button>
      {moves.intoGroupAbove && (
        <button
          aria-label={`Move ${label} into the group above`}
          className="fb-icon-button"
          data-move={moveButtonKey(path, "into")}
          data-tooltip={`Move this ${what} into the group above`}
          onClick={() => {
            // The row becomes the last row of the group just above it.
            const groupAbove = [...parentPath, index - 1];
            const landsAt = [...groupAbove, rowCountAt(groupAbove)];
            actions.moveIntoGroupAbove(path);
            followMove(landsAt, ["out", "up", "down"]);
          }}
          type="button"
        >
          ⤴
        </button>
      )}
      {moves.outOfGroup && (
        <button
          aria-label={`Move ${label} out of its group`}
          className="fb-icon-button"
          data-tooltip={`Move this ${what} out of its group`}
          data-move={moveButtonKey(path, "out")}
          onClick={() => {
            actions.moveOutOfGroup(path);
            // The row lands just after the group it left.
            const groupIndex = parentPath[parentPath.length - 1] as number;
            followMove(
              [...parentPath.slice(0, -1), groupIndex + 1],
              ["out", "wrap", "up", "down"],
            );
          }}
          type="button"
        >
          &lt;
        </button>
      )}
      {moves.wrapInGroup && (
        <button
          aria-label={`Put ${label} in a new group`}
          className="fb-icon-button"
          data-tooltip={`Put this ${what} in a new group`}
          data-move={moveButtonKey(path, "wrap")}
          onClick={() => {
            actions.wrapInGroup(path);
            // The row becomes the first row of the new group.
            followMove([...path, 0], ["wrap", "out"]);
          }}
          type="button"
        >
          &gt;
        </button>
      )}
      {withRemove && (
        <RemoveButton label={label} onRemove={() => actions.remove(path)} />
      )}
    </div>
  );
}

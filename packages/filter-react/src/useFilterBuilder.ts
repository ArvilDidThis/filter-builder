import {
  addCondition,
  addGroup,
  type BuilderGroup,
  buildBuilderRows,
  type ConditionOperator,
  clearFilter,
  countConditions,
  countFilledConditions,
  createCondition,
  createFieldLookup,
  type FieldDefinition,
  type FieldLookup,
  type FilterDefinition,
  type FilterPath,
  type LogicOperator,
  moveDown,
  moveIntoGroupAbove,
  moveItem,
  moveOutOfGroup,
  moveUp,
  removeItem,
  setConditionField,
  setConditionOperator,
  setConditionValue,
  setConditionValues,
  setGroupLogic,
  wrapInGroup,
} from "@arvilmena/filter-core";
import { useCallback, useMemo, useRef } from "react";
import { useEarlyEffect } from "./useEarlyEffect";

/** What `useFilterBuilder` needs from the app. */
export interface UseFilterBuilderOptions {
  /** The filter to show. The app owns it: keep it in state and pass it back in. */
  value: FilterDefinition;
  /** Called with the new filter after every change a person makes. */
  onChange: (filter: FilterDefinition) => void;
  /** The fields a condition can be on. Keep the same list between renders (see `useMemo`). */
  fields: readonly FieldDefinition[];
  /**
   * The most levels of groups allowed, counting the top group as level 1. The same meaning as
   * SearchBuilder's `depthLimit`. Leave out for no limit.
   */
  depthLimit?: number;
  /**
   * The operator a new condition starts with, when its field offers it. Otherwise the field's
   * first operator is used. The same idea as SearchBuilder's `defaultCondition`.
   */
  defaultOperator?: ConditionOperator;
}

/**
 * Every change a builder screen can make. Each takes the `path` of the row it acts on, which
 * the rows carry. An action that cannot be done changes nothing and does not call `onChange`.
 */
export interface FilterBuilderActions {
  /** Adds a condition to the end of a group. With a field key, the condition starts on that field. */
  addCondition: (groupPath: FilterPath, fieldKey?: string) => void;
  /** Adds an empty group to the end of a group. */
  addGroup: (groupPath: FilterPath, logic?: LogicOperator) => void;
  /** Removes a condition or a group. */
  remove: (path: FilterPath) => void;
  /** Sets whether a group needs all of its rows ("AND") or any one ("OR"). */
  setLogic: (groupPath: FilterPath, logic: LogicOperator) => void;
  /** Points a condition at another field, by the field's key. */
  setField: (path: FilterPath, fieldKey: string) => void;
  /** Changes a condition's operator. */
  setOperator: (path: FilterPath, operator: ConditionOperator) => void;
  /** Sets one value box of a condition. `index` is 0, or 1 for the second bound. */
  setValue: (path: FilterPath, index: number, value: string) => void;
  /** Replaces a condition's whole value list, for a field that holds a list. */
  setValues: (path: FilterPath, values: readonly string[]) => void;
  /** Wraps a row in a new group, in the same spot. */
  wrapInGroup: (path: FilterPath, logic?: LogicOperator) => void;
  /**
   * Moves a row into a group, before the row that is at `toIndex` now. Drag and drop calls this.
   */
  move: (from: FilterPath, toGroupPath: FilterPath, toIndex: number) => void;
  /**
   * Whether `move` with the same arguments would change the filter. It is false for a group
   * moved into itself, a move past the depth limit, and a row moved to where it already is.
   */
  canMove: (
    from: FilterPath,
    toGroupPath: FilterPath,
    toIndex: number,
  ) => boolean;
  /** Moves a row one place up within its group. */
  moveUp: (path: FilterPath) => void;
  /** Moves a row one place down within its group. */
  moveDown: (path: FilterPath) => void;
  /** Moves a row to the end of the group directly above it. */
  moveIntoGroupAbove: (path: FilterPath) => void;
  /** Moves a row out of its group, to just after that group. */
  moveOutOfGroup: (path: FilterPath) => void;
  /** Removes every row, keeping the top group's logic. */
  clear: () => void;
  /** Replaces the whole filter, for a preset or a pasted filter. */
  replace: (filter: FilterDefinition) => void;
}

/** What `useFilterBuilder` gives a builder screen. */
export interface FilterBuilderState {
  /** The top group, with every row inside it. Draw the screen from this. */
  root: BuilderGroup;
  /** The app's fields, by key. */
  fields: FieldLookup;
  /** How many condition rows the filter has, filled in or not. */
  conditionCount: number;
  /** How many conditions are filled in. Matching applies only these. */
  filledConditionCount: number;
  /** The changes a screen can make. The object stays the same between renders. */
  actions: FilterBuilderActions;
}

/**
 * The state of a filter builder, with no markup or styling. A screen draws `root` however it
 * likes and calls `actions` when a person changes something.
 *
 * The app owns the filter ("controlled"): it passes `value` in and gets every change through
 * `onChange`. That lets a preset, an "invert" button or a paste set the filter directly.
 *
 * @example
 * const [filter, setFilter] = useState<FilterDefinition>({ criteria: [], logic: "AND" });
 * const builder = useFilterBuilder({ value: filter, onChange: setFilter, fields });
 * const rows = useMemo(
 *   () => data.filter(createRowPredicate(filter, readValue)),
 *   [data, filter],
 * );
 */
export function useFilterBuilder(
  options: UseFilterBuilderOptions,
): FilterBuilderState {
  const { value, onChange, fields, depthLimit, defaultOperator } = options;

  // The actions read the newest props through this ref, so they can stay the same functions
  // from one render to the next. That keeps a screen's memoised rows from redrawing.
  //
  // The ref is written after React has put a render on screen, not while rendering: React may
  // throw a render away, and its props must not reach the actions. It is written before any
  // other effect runs, so an action called from an effect already sees the new filter.
  const fieldLookup = useMemo(() => createFieldLookup(fields), [fields]);
  const latest = useRef({
    value,
    onChange,
    depthLimit,
    defaultOperator,
    fieldLookup,
  });
  useEarlyEffect(() => {
    latest.current = {
      value,
      onChange,
      depthLimit,
      defaultOperator,
      fieldLookup,
    };
  });

  // The filter proposed by an action in the event being handled now, if any. A second action
  // in the same event builds on it, not on the old filter. It is forgotten once the event is
  // over: the app owns the filter, and may have turned the change down.
  const proposed = useRef<FilterDefinition | null>(null);

  const apply = useCallback(
    (change: (filter: FilterDefinition) => FilterDefinition) => {
      const before = proposed.current ?? latest.current.value;
      const next = change(before);
      // The actions return the same filter when nothing could be done.
      if (next === before) return;
      if (proposed.current === null) {
        // Runs as soon as the event's own code has finished.
        queueMicrotask(() => {
          proposed.current = null;
        });
      }
      proposed.current = next;
      latest.current.onChange(next);
    },
    [],
  );

  const actions = useMemo<FilterBuilderActions>(() => {
    const depth = () => ({ depthLimit: latest.current.depthLimit });
    return {
      addCondition: (groupPath, fieldKey) =>
        apply((filter) => {
          const field =
            fieldKey === undefined
              ? undefined
              : latest.current.fieldLookup.get(fieldKey);
          return addCondition(
            filter,
            groupPath,
            createCondition(field, latest.current.defaultOperator),
          );
        }),
      addGroup: (groupPath, logic) =>
        apply((filter) => addGroup(filter, groupPath, { ...depth(), logic })),
      remove: (path) => apply((filter) => removeItem(filter, path)),
      setLogic: (groupPath, logic) =>
        apply((filter) => setGroupLogic(filter, groupPath, logic)),
      setField: (path, fieldKey) =>
        apply((filter) => {
          const field = latest.current.fieldLookup.get(fieldKey);
          return field === undefined
            ? filter
            : setConditionField(filter, path, field, {
                defaultOperator: latest.current.defaultOperator,
              });
        }),
      setOperator: (path, operator) =>
        apply((filter) => setConditionOperator(filter, path, operator)),
      setValue: (path, index, text) =>
        apply((filter) => setConditionValue(filter, path, index, text)),
      setValues: (path, values) =>
        apply((filter) => setConditionValues(filter, path, values)),
      wrapInGroup: (path, logic) =>
        apply((filter) => wrapInGroup(filter, path, { ...depth(), logic })),
      canMove: (from, toGroupPath, toIndex) => {
        const filter = proposed.current ?? latest.current.value;
        return moveItem(filter, from, toGroupPath, toIndex, depth()) !== filter;
      },
      move: (from, toGroupPath, toIndex) =>
        apply((filter) =>
          moveItem(filter, from, toGroupPath, toIndex, depth()),
        ),
      moveUp: (path) => apply((filter) => moveUp(filter, path)),
      moveDown: (path) => apply((filter) => moveDown(filter, path)),
      moveIntoGroupAbove: (path) =>
        apply((filter) => moveIntoGroupAbove(filter, path, depth())),
      moveOutOfGroup: (path) => apply((filter) => moveOutOfGroup(filter, path)),
      clear: () => apply(clearFilter),
      replace: (filter) => apply(() => filter),
    };
  }, [apply]);

  const root = useMemo(
    () => buildBuilderRows(value, fieldLookup, { depthLimit }),
    [value, fieldLookup, depthLimit],
  );
  const conditionCount = useMemo(() => countConditions(value), [value]);
  const filledConditionCount = useMemo(
    () => countFilledConditions(value),
    [value],
  );

  return {
    root,
    fields: fieldLookup,
    conditionCount,
    filledConditionCount,
    actions,
  };
}

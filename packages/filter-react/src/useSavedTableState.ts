import {
  createSavedState,
  localStorageStore,
  type ReadSavedStateOptions,
  readSavedState,
  resolveStateKey,
  type StateParts,
  type StateStore,
} from "@arvilmena/filter-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useEarlyEffect } from "./useEarlyEffect";

/** How long the hook waits after the last change before it saves, in milliseconds. */
const DEFAULT_SAVE_DELAY_MS = 300;

/** Whether the saved state is still being read, is in use, or could not be read or written. */
export type SavedTableStateStatus = "loading" | "ready" | "error";

/** What the hook was doing when something failed. */
export type SavedTableStateAction = "load" | "save" | "remove";

/** What `useSavedTableState` needs from the app. */
export interface UseSavedTableStateOptions<Values>
  extends ReadSavedStateOptions {
  /**
   * A name for the saved state. Use it when the same table appears on several pages, or when
   * several tables share an id. It wins over `id`.
   */
  name?: string;
  /** The table's id. With neither `name` nor `id`, the state is saved under the page's path. */
  id?: string;
  /**
   * The parts to remember, by name. Each has a default and a `parse` that checks the saved
   * value. `filterStatePart()` and `columnStatePart(columns)` cover the filter and the columns.
   */
  parts: StateParts<Values>;
  /**
   * Where the state is kept. Defaults to the browser's local storage. A different store given
   * while the table is on screen is used from the next load or save on.
   */
  store?: StateStore;
  /**
   * How long to wait after the last change before saving, in milliseconds. Changes made within
   * that time are saved together. Defaults to 300.
   */
  saveDelayMs?: number;
  /** Called when a load, a save or a remove fails. The table keeps working. */
  onError?: (error: unknown, action: SavedTableStateAction) => void;
}

/** One setter per part. It takes the new value, or a function from the old value to the new. */
export type SavedTableStateSetters<Values> = {
  readonly [Name in keyof Values]: (
    change: Values[Name] | ((before: Values[Name]) => Values[Name]),
  ) => void;
};

/** What `useSavedTableState` gives a table. */
export interface SavedTableState<Values> {
  /**
   * Each part's value now. A part's value stays the same object until that part changes, so a
   * change to the filter does not redraw a table memoised on its columns.
   */
  values: Readonly<Values>;
  /** Sets one part. The object and its functions stay the same between renders. */
  set: SavedTableStateSetters<Values>;
  /**
   * - "loading": the saved state is being read, and the parts hold their defaults.
   * - "ready": the saved state is in use, and changes are saved.
   * - "error": the last load, save or remove failed. See `error`.
   */
  status: SavedTableStateStatus;
  /** What went wrong, while `status` is "error". */
  error: unknown;
  /** Saves a waiting change now, without waiting out the delay. */
  flush: () => void;
  /** Forgets the saved state and puts every part back to its default. */
  clear: () => void;
}

/**
 * Remembers a table's state between visits: its filter, its column settings and any part the
 * app adds. It loads the saved state, hands out each part with a setter, and saves after a
 * change.
 *
 * - The first render uses the defaults, so a server and the browser draw the same page. The
 *   saved state is read right after, before the browser paints when the store answers at once.
 * - Nothing is saved until the load has finished. A part changed in the meantime keeps the
 *   change. After a failed load nothing is saved, so the stored state is not overwritten.
 * - When `name`, `id` or the page's path changes, a waiting change is saved under the old key
 *   and the state for the new key is loaded.
 * - A waiting change is also saved when the page is hidden or closed, and on unmount.
 *
 * @example
 * const saved = useSavedTableState({
 *   id: "orders",
 *   parts: { filter: filterStatePart(), columns: columnStatePart(columns) },
 * });
 * const builder = useFilterBuilder({
 *   value: saved.values.filter,
 *   onChange: saved.set.filter,
 *   fields,
 * });
 * const table = useColumnSettings({
 *   columns,
 *   value: saved.values.columns,
 *   onChange: saved.set.columns,
 * });
 */
export function useSavedTableState<Values>(
  options: UseSavedTableStateOptions<Values>,
): SavedTableState<Values> {
  const { name, id, parts } = options;
  const key = resolveStateKey({ name, id });

  // The controller reads the newest options through this ref. It is written after React has
  // put a render on screen, not while rendering: React may throw a render away.
  const latest = useRef(options);
  useEarlyEffect(() => {
    latest.current = options;
  });

  const [snapshot, setSnapshot] = useState(() => startSnapshot(key, parts));
  const [controller] = useState(() =>
    createController(snapshot, setSnapshot, latest),
  );

  // The key changed while the table stayed on screen. The old key's state must not be drawn
  // under the new key, even for one render, so the defaults stand in until the load below.
  let shown = snapshot;
  if (shown.key !== key) {
    shown = startSnapshot(key, parts);
    setSnapshot(shown);
  }

  // Loads the state for the key. An early effect, so a store that answers at once (local
  // storage, a cookie) is read before the browser paints and the defaults never flash.
  // `shown` is left out of the list below on purpose: only a new key starts a new load.
  useEarlyEffect(() => {
    controller.begin(shown);
    // Runs before the next key's load and on unmount. It saves a waiting change.
    return controller.stop;
  }, [controller, key]);

  useEffect(() => {
    // A phone may close a hidden page without telling it, so a hidden page saves too.
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") controller.flush();
    };
    window.addEventListener("pagehide", controller.flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", controller.flush);
      document.removeEventListener("visibilitychange", flushWhenHidden);
    };
  }, [controller]);

  // The setters are rebuilt only when the part names change, not when `parts` is a new object.
  const names = Object.keys(parts).join(NAME_SEPARATOR);
  const set = useMemo(() => {
    const setters: Record<string, (change: unknown) => void> = {};
    for (const part of names === "" ? [] : names.split(NAME_SEPARATOR)) {
      setters[part] = (change) => controller.set(part as keyof Values, change);
    }
    return setters as SavedTableStateSetters<Values>;
  }, [controller, names]);

  return {
    values: shown.values,
    set,
    status: shown.status,
    error: shown.error,
    flush: controller.flush,
    clear: controller.clear,
  };
}

/** Joins part names into one text. A character no part name holds. */
const NAME_SEPARATOR = "\u0000";

/** The state of one key at one moment. */
interface Snapshot<Values> {
  /** The key the values belong to. `undefined` when there is none, as on a server. */
  key: string | undefined;
  values: Values;
  status: SavedTableStateStatus;
  error: unknown;
}

/** The state before anything is loaded: every part's default. */
function startSnapshot<Values>(
  key: string | undefined,
  parts: StateParts<Values>,
): Snapshot<Values> {
  return {
    key,
    values: readSavedState(undefined, parts),
    status: "loading",
    error: undefined,
  };
}

// Made on first use, so an app that passes its own store never makes this one.
let defaultStore: StateStore | undefined;

/**
 * Holds the state between renders and talks to the store. It lives outside React's render so
 * that the setters can stay the same functions, and so that a save always carries the key its
 * values were loaded for.
 */
function createController<Values>(
  initial: Snapshot<Values>,
  draw: (snapshot: Snapshot<Values>) => void,
  latest: { readonly current: UseSavedTableStateOptions<Values> },
) {
  /** The newest state, including a change React has not drawn yet. */
  let live = initial;
  /** False after unmount, and between two keys. Nothing is drawn then. */
  let active = false;
  /** Whether the load for `live.key` finished well. Nothing is saved until it has. */
  let canSave = false;
  /** The parts a person changed while the load was on its way. */
  const touched = new Set<keyof Values>();
  /** Goes up whenever a load is started or dropped. A load that answers late sees it moved. */
  let loadRun = 0;

  /** The change waiting to be saved, with the key it belongs to. */
  let pending: { key: string; values: Values } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The text last handed to the store. The same text is not saved twice. */
  let written: { key: string; json: string } | undefined;
  /** How many saves the store has not answered yet. */
  let sending = 0;
  /** Whether a save is waiting for the one before it to be answered. */
  let queued = false;
  /** Goes up with every save. Only the newest save may clear an error. */
  let saveRun = 0;

  const store = (): StateStore => {
    if (latest.current.store) return latest.current.store;
    defaultStore ??= localStorageStore();
    return defaultStore;
  };

  const publish = (next: Snapshot<Values>): void => {
    live = next;
    if (active) draw(next);
  };

  /** Shows a failure when it is about the key on screen, and always tells the app. */
  const report = (
    error: unknown,
    action: SavedTableStateAction,
    key: string | undefined,
  ): void => {
    if (live.key === key) publish({ ...live, status: "error", error });
    latest.current.onError?.(error, action);
  };

  const write = (now = false): void => {
    clearTimeout(timer);
    timer = undefined;
    const job = pending;
    if (job === undefined) return;
    // One save at a time, so an older save cannot land after a newer one. A save that must go
    // now (the page is closing) does not wait.
    if (sending > 0 && !now) {
      queued = true;
      return;
    }
    pending = undefined;
    queued = false;

    const saved = createSavedState(
      job.values as Record<string, unknown>,
      latest.current.version,
    );
    let json: string;
    try {
      json = JSON.stringify(saved);
    } catch (error) {
      report(error, "save", job.key);
      return;
    }
    if (written?.key === job.key && written.json === json) return;
    const record = { key: job.key, json };
    written = record;
    saveRun += 1;
    const run = saveRun;

    const settle = (failure?: { error: unknown }): void => {
      if (failure) {
        // Forget the text, so the next change tries again.
        if (written === record) written = undefined;
        report(failure.error, "save", job.key);
      } else if (
        run === saveRun &&
        live.key === job.key &&
        live.status === "error" &&
        canSave
      ) {
        // An earlier save had failed, and this one went through.
        publish({ ...live, status: "ready", error: undefined });
      }
      if (queued && sending === 0) write();
    };

    try {
      const answer = store().save(job.key, saved);
      if (!isPromiseLike(answer)) {
        settle();
        return;
      }
      sending += 1;
      answer.then(
        () => {
          sending -= 1;
          settle();
        },
        (error: unknown) => {
          sending -= 1;
          settle({ error });
        },
      );
    } catch (error) {
      settle({ error });
    }
  };

  const scheduleSave = (key: string): void => {
    pending = { key, values: live.values };
    clearTimeout(timer);
    timer = setTimeout(
      write,
      latest.current.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS,
    );
  };

  return {
    /** Starts the load for a key. `start` is the state React drew for it. */
    begin(start: Snapshot<Values>): void {
      live = start;
      active = true;
      canSave = false;
      touched.clear();
      loadRun += 1;
      const run = loadRun;
      const { key } = start;

      const fail = (error: unknown): void => {
        // The key changed or the table left the screen while the store was answering.
        if (run !== loadRun) return;
        report(error, "load", key);
      };
      if (key === undefined) {
        fail(
          new Error(
            "There is no key to save the table state under. Pass `name` or `id`.",
          ),
        );
        return;
      }
      const finish = (saved: unknown): void => {
        if (run !== loadRun) return;
        // With nothing saved the values on screen are already right. Keeping them, and not a
        // fresh copy of the defaults, saves the table a redraw.
        let values = live.values;
        if (saved !== null && saved !== undefined) {
          values = readSavedState(saved, latest.current.parts, latest.current);
          // A part changed while loading keeps the change.
          for (const part of touched) values[part] = live.values[part];
        }
        canSave = true;
        publish({ key, values, status: "ready", error: undefined });
        if (touched.size > 0) scheduleSave(key);
        touched.clear();
      };

      try {
        const answer = store().load(key);
        if (isPromiseLike(answer)) answer.then(finish, fail);
        else finish(answer);
      } catch (error) {
        fail(error);
      }
    },

    /** Drops a load on its way and saves a waiting change, under the key it belongs to. */
    stop(): void {
      loadRun += 1;
      active = false;
      write(true);
    },

    set(part: keyof Values, change: unknown): void {
      const before = live.values[part];
      const next =
        typeof change === "function" ? change(before) : (change as never);
      if (Object.is(before, next)) return;
      const wasLoading = live.status === "loading";
      publish({ ...live, values: { ...live.values, [part]: next } });
      if (canSave && live.key !== undefined) scheduleSave(live.key);
      else if (wasLoading) touched.add(part);
    },

    flush(): void {
      write(true);
    },

    clear(): void {
      // A load still on its way must not bring the old state back.
      loadRun += 1;
      clearTimeout(timer);
      timer = undefined;
      pending = undefined;
      queued = false;
      written = undefined;
      touched.clear();
      const { key } = live;
      const values = readSavedState(undefined, latest.current.parts);
      if (key === undefined) {
        publish({ ...live, values });
        return;
      }
      // The stored state is gone on purpose, so saving is safe even after a failed load.
      canSave = true;
      publish({ key, values, status: "ready", error: undefined });
      try {
        const answer = store().remove(key);
        if (isPromiseLike(answer)) {
          answer.then(undefined, (error: unknown) =>
            report(error, "remove", key),
          );
        }
      } catch (error) {
        report(error, "remove", key);
      }
    },
  };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

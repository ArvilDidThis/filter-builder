import {
  createSavedState,
  DEFAULT_STATE_VERSION,
  localStorageStore,
  type ReadSavedStateOptions,
  readSavedParts,
  readSavedState,
  resolveStateKey,
  type SavedState,
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
  /**
   * The table's id. With neither `name` nor `id`, the state is saved under the page's path.
   *
   * Use one hook call per key. Two tables on one page with neither a `name` nor an `id` both
   * fall back to the page's path, and then save over each other's parts of the same name.
   */
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
  /**
   * Saves a waiting change now, without waiting out the delay. The promise settles once the
   * store has answered every save and remove sent so far, so an app can wait for it before it
   * leaves the page: `await saved.flush()`.
   *
   * The promise never rejects. It gives `true` when nothing is left unsaved, and `false` when a
   * save or remove failed, or when a change cannot be saved because the load has not finished
   * or has failed. The failure itself is in `error` and goes to `onError`.
   */
  flush: () => Promise<boolean>;
  /**
   * Forgets everything saved under the key and puts every part back to its default. The remove
   * is sent after the saves sent before it, so none of them can bring the state back.
   */
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
 * - Parts saved under the key that this hook does not own are kept, and written back with its
 *   own. `clear()` removes them too.
 * - Saves and removes reach the store one at a time, in the order they were made, so a slow
 *   answer cannot leave an older state in the store. Only a closing page does not wait for the
 *   answer before it sends the next one.
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
    // A phone may close a hidden page without telling it, so a hidden page saves too. It may
    // also come back, so its save waits its turn like any other.
    const flushWhenHidden = () => {
      if (document.visibilityState === "hidden") void controller.flush();
    };
    // A closing page has no time to wait for an answer.
    window.addEventListener("pagehide", controller.flushWithoutWaiting);
    document.addEventListener("visibilitychange", flushWhenHidden);
    return () => {
      window.removeEventListener("pagehide", controller.flushWithoutWaiting);
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

/** What a hook hears from another hook that saves under the same key, in the same store. */
interface KeySharer {
  /** The other hook saved these parts. */
  saved(parts: Readonly<Record<string, unknown>>): void;
  /** The other hook removed everything saved under the key. */
  removed(): void;
}

/**
 * The hooks on screen, by store and key. One hook call per key is the rule. When an app breaks
 * it, the hooks tell each other what they save, so that neither drops the other's parts.
 */
const sharersByStore = new WeakMap<StateStore, Map<string, Set<KeySharer>>>();

/** The keys already warned about, so each is named once. */
const warnedKeys = new Set<string>();

// Bundlers put the build mode in place of `process.env.NODE_ENV`. Where there is no bundler
// and no `process`, as in a plain browser page, nothing is warned about.
declare const process: { env: { NODE_ENV?: string } } | undefined;

/** Tells a developer, once per key, that two tables on screen save under the same key. */
function warnAboutSharedKey(key: string): void {
  if (typeof process === "undefined") return;
  if (process.env.NODE_ENV === "production" || warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(
    `useSavedTableState: two tables on screen save their state under the key "${key}". ` +
      "Parts of the same name overwrite each other. Give each table its own `id` or `name`.",
  );
}

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
  /**
   * The parts saved under `live.key` that this hook does not own: another hook's, or ones the
   * app no longer has. They are written back with every save, so that saving drops nothing.
   */
  let unowned: Record<string, unknown> = {};
  /** The store and key this hook is listed under in `sharersByStore`, while on screen. */
  let listed: { store: StateStore; key: string } | undefined;
  /** The parts a person changed while the load was on its way. */
  const touched = new Set<keyof Values>();
  /** Goes up whenever a load is started or dropped. A load that answers late sees it moved. */
  let loadRun = 0;

  /** The change waiting out the delay, with the key it belongs to. */
  let pending: { key: string; values: Values } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** The text of the newest save made. The same text is not saved twice. */
  let written: { key: string; json: string } | undefined;
  /**
   * The saves and removes not yet handed to the store, oldest first. They go one at a time:
   * each waits for the store's answer to the one before it. The store therefore ends with the
   * newest state, however slowly it answers.
   */
  const queue: StoreJob[] = [];
  /** How many saves and removes the store has not answered yet. */
  let sending = 0;
  /** Goes up with every save handed to the store. Only the newest save may clear an error. */
  let saveRun = 0;
  /** Goes up with every failed save or remove. `flush` reads it to tell how its saves went. */
  let failures = 0;
  /** Called once the store has answered everything. `flush` and a load wait here. */
  const whenIdle: (() => void)[] = [];

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
    if (action !== "load") failures += 1;
    if (live.key === key) publish({ ...live, status: "error", error });
    latest.current.onError?.(error, action);
  };

  const isOwnPart = (name: string): boolean =>
    Object.hasOwn(latest.current.parts, name);

  const sharer: KeySharer = {
    saved(parts) {
      for (const [name, value] of Object.entries(parts)) {
        if (!isOwnPart(name)) unowned[name] = value;
      }
    },
    removed() {
      unowned = {};
    },
  };

  /** The other hooks on screen that use this store and key. */
  const othersOn = (place: StateStore, key: string): KeySharer[] =>
    [...(sharersByStore.get(place)?.get(key) ?? [])].filter(
      (other) => other !== sharer,
    );

  /** Lists this hook under its store and key, and warns when another hook is there already. */
  const joinSharers = (key: string): void => {
    const place = store();
    let byKey = sharersByStore.get(place);
    if (byKey === undefined) {
      byKey = new Map();
      sharersByStore.set(place, byKey);
    }
    const sharers = byKey.get(key) ?? new Set();
    byKey.set(key, sharers);
    sharers.add(sharer);
    listed = { store: place, key };
    if (sharers.size > 1) warnAboutSharedKey(key);
  };

  const leaveSharers = (): void => {
    if (listed === undefined) return;
    const byKey = sharersByStore.get(listed.store);
    const sharers = byKey?.get(listed.key);
    sharers?.delete(sharer);
    if (sharers?.size === 0) byKey?.delete(listed.key);
    listed = undefined;
  };

  /** Hands one save or remove to the store, and deals with its answer. */
  const send = (job: StoreJob): void => {
    saveRun += job.kind === "save" ? 1 : 0;
    const run = saveRun;

    const settle = (failure?: { error: unknown }): void => {
      if (failure) {
        // Forget the text, so the next change tries again.
        if (job.kind === "save" && written === job.record) written = undefined;
        report(failure.error, job.kind, job.key);
      } else if (
        job.kind === "save" &&
        run === saveRun &&
        live.key === job.key &&
        live.status === "error" &&
        canSave
      ) {
        // An earlier save had failed, and this one went through.
        publish({ ...live, status: "ready", error: undefined });
      }
    };

    try {
      const place = store();
      for (const other of othersOn(place, job.key)) {
        if (job.kind === "save") other.saved(job.saved.parts);
        else other.removed();
      }
      const answer =
        job.kind === "save"
          ? place.save(job.key, job.saved)
          : place.remove(job.key);
      if (!isPromiseLike(answer)) {
        settle();
        return;
      }
      sending += 1;
      answer.then(
        () => {
          sending -= 1;
          settle();
          sendNext();
        },
        (error: unknown) => {
          sending -= 1;
          settle({ error });
          sendNext();
        },
      );
    } catch (error) {
      settle({ error });
    }
  };

  /** Sends what is in the queue, for as long as the store has answered everything before it. */
  const sendNext = (): void => {
    while (sending === 0) {
      const job = queue.shift();
      if (job === undefined) break;
      send(job);
    }
    if (sending > 0 || queue.length > 0) return;
    for (const tell of whenIdle.splice(0)) tell();
  };

  /** Moves the waiting change into the queue, without waiting out the rest of the delay. */
  const queuePending = (): void => {
    clearTimeout(timer);
    timer = undefined;
    const job = pending;
    if (job === undefined) return;
    pending = undefined;

    // `unowned` still belongs to the job's key: a change of key queues the waiting change
    // before it loads the new key.
    const saved = createSavedState(
      { ...unowned, ...job.values },
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
    written = { key: job.key, json };
    // A save still in the queue is out of date now. Only the newest state needs to be sent.
    const last = queue.at(-1);
    if (last?.kind === "save" && last.key === job.key) queue.pop();
    queue.push({ kind: "save", key: job.key, saved, record: written });
  };

  const scheduleSave = (key: string): void => {
    pending = { key, values: live.values };
    clearTimeout(timer);
    timer = setTimeout(() => {
      queuePending();
      sendNext();
    }, latest.current.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS);
  };

  /** Reads the state saved under `live.key`, and puts it on screen when the store answers. */
  const load = (): void => {
    loadRun += 1;
    const run = loadRun;
    const { key } = live;

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
        const loaded = readLoadedState(saved, latest.current);
        values = loaded.values;
        unowned = loaded.unowned;
        // A part changed while loading keeps the change.
        for (const part of touched) values[part] = live.values[part];
      }
      canSave = true;
      publish({ key, values, status: "ready", error: undefined });
      if (touched.size > 0) scheduleSave(key);
      touched.clear();
    };
    const read = (): void => {
      if (run !== loadRun) return;
      try {
        const answer = store().load(key);
        if (isPromiseLike(answer)) answer.then(finish, fail);
        else finish(answer);
      } catch (error) {
        fail(error);
      }
    };

    // A load asked for while a save is on its way could be answered with the state from before
    // that save. So it waits until the store has answered everything sent to it.
    if (sending > 0 || queue.length > 0) whenIdle.push(read);
    else read();
  };

  return {
    /**
     * Called when the table comes on screen, and when its key changes. `start` is the state
     * React drew for the key.
     *
     * React also calls this again for the same key: twice in a row in development (strict
     * mode), and when a hidden part of the page is shown again. The state the hook holds is
     * then at least as new as the store's, so it is kept and not loaded a second time.
     */
    begin(start: Snapshot<Values>): void {
      active = true;
      if (start.key !== live.key) {
        live = start;
        canSave = false;
        unowned = {};
        touched.clear();
      } else if (live !== start) {
        // The state moved on while nothing could be drawn. Show it now.
        draw(live);
      }
      if (live.key !== undefined) joinSharers(live.key);
      // Still to load: a first visit, or a load that was dropped or failed.
      if (!canSave) load();
    },

    /**
     * Drops a load on its way and saves a waiting change, under the key it belongs to. The save
     * waits its turn: the queue keeps going after the table has left the screen.
     */
    stop(): void {
      loadRun += 1;
      active = false;
      leaveSharers();
      queuePending();
      sendNext();
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

    flush(): Promise<boolean> {
      const failuresBefore = failures;
      queuePending();
      sendNext();
      // A change made before the load has finished, or after it failed, is not saved.
      const isAllSaved = (): boolean =>
        failures === failuresBefore && touched.size === 0;
      if (sending === 0 && queue.length === 0) {
        return Promise.resolve(isAllSaved());
      }
      return new Promise((resolve) => {
        whenIdle.push(() => resolve(isAllSaved()));
      });
    },

    /**
     * Sends every waiting save and remove at once, in order, without waiting for the store's
     * answers. For a closing page only: the answers may come back in another order.
     */
    flushWithoutWaiting(): void {
      queuePending();
      for (const job of queue.splice(0)) send(job);
    },

    clear(): void {
      // A load still on its way must not bring the old state back.
      loadRun += 1;
      clearTimeout(timer);
      timer = undefined;
      pending = undefined;
      written = undefined;
      unowned = {};
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
      // Through the same queue as the saves. A save made before this cannot land after the
      // remove, and a save made after this cannot be deleted by it.
      queue.push({ kind: "remove", key });
      sendNext();
    },
  };
}

/**
 * Reads what a store handed back: each of the hook's parts, checked, and the saved parts the
 * hook does not own, as they are.
 */
function readLoadedState<Values>(
  saved: unknown,
  options: UseSavedTableStateOptions<Values>,
): { values: Values; unowned: Record<string, unknown> } {
  const version = options.version ?? DEFAULT_STATE_VERSION;
  // Upgraded once here. Wrapped in today's version below, so they are not upgraded again.
  const savedParts = readSavedParts(saved, options);
  const unowned: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(savedParts ?? {})) {
    if (!Object.hasOwn(options.parts, name)) unowned[name] = value;
  }
  const values = readSavedState(
    savedParts && createSavedState(savedParts, version),
    options.parts,
    { version },
  );
  return { values, unowned };
}

/** A save or a remove on its way to the store. */
type StoreJob =
  | {
      kind: "save";
      key: string;
      saved: SavedState;
      /** The entry in `written` this save made, to forget it when the save fails. */
      record: { key: string; json: string };
    }
  | { kind: "remove"; key: string };

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

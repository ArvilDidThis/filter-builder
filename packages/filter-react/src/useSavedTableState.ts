import {
  createSavedState,
  DEFAULT_STATE_VERSION,
  localStorageStore,
  type ReadSavedStateOptions,
  readSavedParts,
  readSavedState,
  resolveStateKey,
  type StateParts,
  type StateStore,
} from "@arvilmena/filter-core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  isPromiseLike,
  joinChannel,
  leaveChannel,
  type SavedParts,
  type StateChannel,
  type Write,
  type WriteOutcome,
} from "./savedStateChannel";
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
   * Where the state is kept. Defaults to the browser's local storage.
   *
   * The hook keeps the store it last loaded from, and saves there. A different `store` given
   * while the table is on screen does not load again by itself. It is used from the next load
   * on: a change of key, or `reload()`. So the state read from one store is never written into
   * another, and a store made anew on every render (`store: cookieStore()` inside the
   * component) behaves like one store.
   */
  store?: StateStore;
  /**
   * The saved value a server already read, as the store holds it: for example what
   * `readCookieState` returns. The first render uses it on the server and in the browser, so
   * both draw the same page and the table does not jump. `status` starts as "ready", and the
   * store is not read for the first key.
   *
   * Pass `null` when the server found nothing saved. Leave it out to load from the store.
   * Only the first render reads it: a later change to it, or to the key, loads from the store.
   *
   * @example
   * // On the server, with the request's `Cookie` header:
   * const initialSaved = readCookieState(cookieHeader, "orders");
   * // In the component, on the server and in the browser:
   * const saved = useSavedTableState({ id: "orders", parts, store, initialSaved });
   */
  initialSaved?: unknown;
  /**
   * How long to wait after the last change before saving, in milliseconds. Changes made within
   * that time are saved together. Defaults to 300.
   */
  saveDelayMs?: number;
  /**
   * Called when a load, a save or a remove fails. The table keeps working. An error thrown
   * inside this callback is logged to the console and goes no further.
   */
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
   * - "error": the last load, save or remove failed. See `error` and `errorAction`.
   */
  status: SavedTableStateStatus;
  /** What went wrong, while `status` is "error". */
  error: unknown;
  /**
   * What failed, while `status` is "error":
   *
   * - "load": the saved state could not be read. Saving is off, so that the stored state is
   *   not overwritten. Call `reload()` to try again.
   * - "save": one save failed. The change is kept, and is saved again with the next change,
   *   on `flush()`, when the page is hidden or closed, and when the table leaves the screen.
   * - "remove": `clear()` could not remove the stored state.
   */
  errorAction: SavedTableStateAction | undefined;
  /**
   * Reads the saved state again. Use it after a failed load, to turn saving back on without
   * deleting the stored state. A part whose change the store has not taken keeps the change:
   * one made while saving was off, or one whose save failed. It is saved after the load. The
   * other parts take the stored state, or their defaults when nothing is saved any more.
   */
  reload: () => void;
  /**
   * Saves a waiting change now, without waiting out the delay. A change whose save failed
   * earlier counts as waiting, and is tried again. The promise settles once the store has
   * answered every save and remove sent so far, so an app can wait for it before it leaves the
   * page: `await saved.flush()`.
   *
   * The promise never rejects. It gives `true` when nothing is left unsaved. It gives `false`
   * while a save or remove has failed and no later one went through, or when a change cannot
   * be saved because the load has not finished or has failed. The failure itself is in `error`
   * and goes to `onError`.
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
 *   With `initialSaved`, the first render uses the state the server read.
 * - Nothing is saved until the load has finished. A part changed in the meantime keeps the
 *   change. After a failed load nothing is saved, so the stored state is not overwritten.
 *   `errorAction` is then "load", and `reload()` tries again.
 * - When `name`, `id` or the page's path changes, a waiting change is saved under the old key
 *   and the state for the new key is loaded.
 * - A waiting change is also saved when the page is hidden or closed, and on unmount.
 * - A change whose save failed is kept, and saved again with the next save.
 * - Parts saved under the key that this hook does not own are kept, and written back with its
 *   own. `clear()` removes them too.
 * - A load still on its way when the table leaves the screen, or when its key changes, is not
 *   cancelled. Its answer is ignored.
 * - Saves and removes reach the store one at a time, in the order they were made, so a slow
 *   answer cannot leave an older state in the store. Only a closing page does not wait: it
 *   sends the newest state at once, in one request. A save still on its way then may reach
 *   the store after that request, or not at all.
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

  // The controller reads the newest options through this ref. It is written in an effect
  // further down, after React has put a render on screen: React may throw a render away.
  const latest = useRef(options);

  const [first] = useState(() => firstState(key, options));
  const [snapshot, setSnapshot] = useState(first.snapshot);
  const [controller] = useState(() =>
    createController(first, setSnapshot, latest),
  );

  // The key changed while the table stayed on screen. The old key's state must not be drawn
  // under the new key, even for one render, so the defaults stand in until the load below.
  let shown = snapshot;
  if (shown.key !== key) {
    shown = startSnapshot(key, parts);
    setSnapshot(shown);
  }

  // A part added to `parts` while the table is on screen has no value yet. It gets the value
  // saved under its name, or its default, in this same render.
  const completed = withMissingParts(
    shown.values,
    options,
    controller.savedParts(),
  );
  if (completed !== shown.values) {
    shown = { ...shown, values: completed };
    setSnapshot(shown);
  }

  // Before the load effect below, which reads the options.
  useEarlyEffect(() => {
    latest.current = options;
    controller.adopt(shown);
  });

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
    errorAction: shown.errorAction,
    flush: controller.flush,
    reload: controller.reload,
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
  errorAction: SavedTableStateAction | undefined;
}

/** The status of a key whose state is in use, with no failure to show. */
const READY = {
  status: "ready",
  error: undefined,
  errorAction: undefined,
} as const;

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
    errorAction: undefined,
  };
}

/**
 * `values` with a value for every part. A part it lacks gets the value saved under its name,
 * checked, or its default. The same object comes back when nothing is missing.
 */
function withMissingParts<Values>(
  values: Values,
  options: UseSavedTableStateOptions<Values>,
  saved: SavedParts,
): Values {
  const missing = (Object.keys(options.parts) as (keyof Values)[]).filter(
    (name) => !Object.hasOwn(values as object, name),
  );
  if (missing.length === 0) return values;
  const version = options.version ?? DEFAULT_STATE_VERSION;
  const read = readSavedState(createSavedState(saved, version), options.parts, {
    version,
  });
  const completed = { ...values };
  for (const name of missing) completed[name] = read[name];
  return completed;
}

/** The state of the first render, and what a server read for it, if anything. */
interface FirstState<Values> {
  snapshot: Snapshot<Values>;
  serverRead: StoreRead | undefined;
}

/** What a read of the store found: the value as it came, and its parts in today's shape. */
interface StoreRead {
  saved: unknown;
  parts: SavedParts;
}

/**
 * The state of the first render: the defaults, to be loaded over, or the state a server
 * already read, which is in use at once.
 */
function firstState<Values>(
  key: string | undefined,
  options: UseSavedTableStateOptions<Values>,
): FirstState<Values> {
  if (options.initialSaved === undefined) {
    return {
      snapshot: startSnapshot(key, options.parts),
      serverRead: undefined,
    };
  }
  const loaded = readLoadedState(options.initialSaved, options);
  return {
    snapshot: { key, values: loaded.values, ...READY },
    serverRead: { saved: options.initialSaved, parts: loaded.savedParts },
  };
}

/**
 * Holds one hook's state between renders. It lives outside React's render so that the setters
 * can stay the same functions, and so that a save always carries the key its values were
 * loaded for.
 *
 * It does not talk to the store's `save` and `remove` itself. It hands every write to the
 * channel of its store and key, which all hooks on that key share.
 */
function createController<Values>(
  first: FirstState<Values>,
  draw: (snapshot: Snapshot<Values>) => void,
  latest: { readonly current: UseSavedTableStateOptions<Values> },
) {
  /** The newest state, including a change React has not drawn yet. */
  let live = first.snapshot;
  /** False after unmount, and between two keys. Nothing is drawn then. */
  let active = false;
  /**
   * Whether the state for `live.key` is known: its load finished well, or a server read it.
   * Nothing is saved until then. Without a key there is nowhere to save.
   */
  let canSave = live.status === "ready" && live.key !== undefined;
  /**
   * The channel of `live.key` in the hook's store. The hook keeps it after the table leaves
   * the screen, so that a table shown again finds what it knew about the store.
   */
  let channel: StateChannel | undefined;
  /** Whether the hook counts among the hooks on `channel`. Only while the table is on screen. */
  let isJoined = false;
  /** What a server read, until the first channel takes it over. */
  let serverRead = first.serverRead;
  /**
   * The parts a person changed that the store has not taken yet: saving was off, the save
   * still waits, or it failed. A load never replaces them, and `flush` gives false while one
   * is left.
   */
  const unsaved = new Set<keyof Values>();
  /**
   * Whether every part outside `unsaved` still holds its default: nothing was loaded or saved
   * for the key yet. A load that finds nothing saved then has nothing to put back.
   */
  let holdsDefaults = first.serverRead === undefined;
  /** Whether `clear()` could not remove the stored state, and no save went through since. */
  let removeFailed = false;
  /** Goes up whenever a load is started or dropped. A load that answers late sees it moved. */
  let loadRun = 0;

  /** The change waiting out the delay, with the key it belongs to. */
  let pending: Change<Values> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Marks this hook's saves in a channel, so a newer one can replace one that still waits. */
  const owner = {};
  /** Goes up with every save handed to a channel. Only the newest save may clear an error. */
  let saveRun = 0;
  /** How many of this hook's saves and removes have not ended yet. */
  let unanswered = 0;
  /** Called once all of this hook's saves and removes have ended. `flush` waits here. */
  const whenAnswered: (() => void)[] = [];
  /** The channels that still hold a write of this hook. A closing page sends them all. */
  const busyChannels = new Set<StateChannel>();

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
    if (live.key === key)
      publish({ ...live, status: "error", error, errorAction: action });
    try {
      latest.current.onError?.(error, action);
    } catch (thrown) {
      // The app's own callback failed. Its error is logged, not passed on: it must not stop
      // the next save or make `flush` fail.
      console.error(thrown);
    }
  };

  /** Forgets the change waiting out the delay. Its parts stay in `unsaved`. */
  const dropPending = (): void => {
    clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };

  /** Turns saving off until the state for `live.key` has been read again. */
  const awaitLoad = (): void => {
    canSave = false;
    if (live.status === "loading") return;
    publish({
      ...live,
      status: "loading",
      error: undefined,
      errorAction: undefined,
    });
  };

  const leave = (): void => {
    if (isJoined && channel) leaveChannel(channel);
    isJoined = false;
  };

  /** Joins the channel of a store and key, and warns when another hook is on it already. */
  const join = (store: StateStore, key: string): void => {
    if (isJoined && channel?.store === store && channel.key === key) return;
    leave();
    channel = joinChannel(store, key, channel);
    isJoined = true;
    if (serverRead !== undefined) {
      // Only when nothing was written yet: a write is newer than what the server read.
      channel.noteRead(serverRead.saved, serverRead.parts, 0);
      serverRead = undefined;
    }
    if (channel.hookCount() > 1) warnAboutSharedKey(key);
  };

  /**
   * The store to use from here on. The hook keeps the store it loaded the key's state from. It
   * takes the store the app asks for now only when it is about to load.
   */
  const storeFor = (isNewKey: boolean): StateStore => {
    const keepsStore = !isNewKey && canSave && channel !== undefined;
    return keepsStore && channel ? channel.store : storeOf(latest.current);
  };

  /** Hands a save or a remove to a channel, and counts it until it has ended. */
  const send = (target: StateChannel, write: Write): void => {
    unanswered += 1;
    busyChannels.add(target);
    const done = (outcome: WriteOutcome): void => {
      write.done(outcome);
      unanswered -= 1;
      if (target.isIdle()) busyChannels.delete(target);
      if (unanswered > 0) return;
      for (const tell of whenAnswered.splice(0)) tell();
    };
    target.write({ ...write, done });
  };

  /** Deals with the end of a save of `change`. `run` is the save's number. */
  const saveEnded = (
    change: Change<Values>,
    run: number,
    outcome: WriteOutcome,
  ): void => {
    const isForKeyOnScreen = live.key === change.key;
    if (outcome.status === "failed") {
      // The change waits again, so that the next flush or the next change tries once more.
      if (isForKeyOnScreen && canSave)
        pending ??= { ...change, values: live.values };
      report(outcome.error, "save", change.key);
      return;
    }
    if (outcome.status === "replaced" || !isForKeyOnScreen) return;

    removeFailed = false;
    holdsDefaults = false;
    // A part changed again since this save was made is still not in the store.
    for (const part of unsaved) {
      if (Object.is(live.values[part], change.values[part]))
        unsaved.delete(part);
    }
    // A change put back to wait by an earlier failure has now been saved by this save.
    if (unsaved.size === 0 && timer === undefined) pending = undefined;
    // An earlier save had failed, and this one, the newest, went through.
    const clearsError = run === saveRun && live.status === "error" && canSave;
    if (clearsError) publish({ ...live, ...READY });
  };

  /** Hands the waiting change to its channel, without waiting out the rest of the delay. */
  const queuePending = (): void => {
    clearTimeout(timer);
    timer = undefined;
    const change = pending;
    pending = undefined;
    // A change of key queues the waiting change before it joins the new key's channel, so
    // the channel is the change's own. A change left over from another key is dropped: one
    // key's state must never be saved under another key.
    if (change === undefined || channel?.key !== change.key) return;
    // Another table used the key while this one was off screen, so the channel no longer
    // knows the parts the store holds, and a save could drop some. The change waits in
    // `unsaved`. When the table is shown again it reads the store first, then saves.
    if (channel.isSuperseded()) {
      awaitLoad();
      return;
    }
    saveRun += 1;
    const run = saveRun;
    send(channel, {
      kind: "save",
      owner,
      build: (stored) =>
        createSavedState(
          withOtherParts(stored, change.values as object),
          latest.current.version,
        ),
      done: (outcome) => saveEnded(change, run, outcome),
    });
  };

  const scheduleSave = (key: string): void => {
    pending = { key, values: live.values };
    clearTimeout(timer);
    timer = setTimeout(
      queuePending,
      latest.current.saveDelayMs ?? DEFAULT_SAVE_DELAY_MS,
    );
  };

  /** Reads the state saved under `live.key`, and puts it on screen when the store answers. */
  const load = (): void => {
    loadRun += 1;
    const run = loadRun;
    const { key } = live;
    const source = channel;

    const fail = (error: unknown): void => {
      // The key changed or the table left the screen while the store was answering.
      if (run !== loadRun) return;
      report(error, "load", key);
    };
    if (key === undefined || source === undefined) {
      fail(
        new Error(
          "There is no key to save the table state under. Pass `name` or `id`.",
        ),
      );
      return;
    }
    let writesAtRead = 0;
    const finish = (saved: unknown): void => {
      if (run !== loadRun) return;
      const isNothingSaved = saved === null || saved === undefined;
      const loaded = readLoadedState(saved, latest.current);
      // Also when nothing is saved: the parts the channel knew are then gone from the store.
      source.noteRead(saved, loaded.savedParts, writesAtRead);
      // On a first load that finds nothing, the values on screen are already right. Keeping
      // them, and not a fresh copy of the defaults, saves the table a redraw.
      let values = live.values;
      if (!isNothingSaved || !holdsDefaults) {
        values = loaded.values;
        // A change the store has not taken is kept, and saved below.
        for (const part of unsaved) values[part] = live.values[part];
      }
      holdsDefaults = isNothingSaved;
      canSave = true;
      publish({ key, values, ...READY });
      if (unsaved.size > 0) scheduleSave(key);
    };
    const read = (): void => {
      if (run !== loadRun) return;
      writesAtRead = source.writeCount();
      try {
        const answer = source.store.load(key);
        if (isPromiseLike(answer)) answer.then(finish, fail);
        else finish(answer);
      } catch (error) {
        fail(error);
      }
    };

    // A read made while a write to this key is on its way could be answered with the state
    // from before that write. So it waits for the writes to this key, and for no others.
    source.whenIdle(read);
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
      const isNewKey = start.key !== live.key;
      if (isNewKey) {
        live = start;
        canSave = false;
        // A save that failed on the way out of the old key is not tried under the new one.
        pending = undefined;
        unsaved.clear();
        removeFailed = false;
        holdsDefaults = true;
      } else if (canSave && channel?.isSuperseded()) {
        // Another table used the key while this one was off screen. What this hook knows
        // about the store is out of date, so it reads again. Changes not saved yet are kept.
        dropPending();
        awaitLoad();
      } else if (live !== start) {
        // The state moved on while nothing could be drawn. Show it now.
        draw(live);
      }
      if (live.key !== undefined) join(storeFor(isNewKey), live.key);
      // Still to load: a first visit, or a load that was dropped or failed.
      if (!canSave) load();
    },

    /**
     * Drops a load on its way and saves a waiting change, under the key it belongs to. The save
     * waits its turn: the channel keeps going after the table has left the screen.
     */
    stop(): void {
      loadRun += 1;
      active = false;
      queuePending();
      leave();
    },

    /**
     * The parts saved under the key, the hook's own and others. A part added later may find
     * its value here.
     */
    savedParts(): SavedParts {
      return channel?.storedParts() ?? serverRead?.parts ?? {};
    },

    /**
     * Takes over the values React filled in for parts that were added while the table was on
     * screen. `drawn` is the state React drew.
     */
    adopt(drawn: Snapshot<Values>): void {
      if (drawn.key !== live.key) return;
      let values = live.values;
      for (const name of Object.keys(
        drawn.values as object,
      ) as (keyof Values)[]) {
        if (Object.hasOwn(live.values as object, name)) continue;
        if (values === live.values) values = { ...live.values };
        values[name] = drawn.values[name];
      }
      if (values !== live.values) live = { ...live, values };
    },

    set(part: keyof Values, change: unknown): void {
      const before = live.values[part];
      const next =
        typeof change === "function" ? change(before) : (change as never);
      if (Object.is(before, next)) return;
      publish({ ...live, values: { ...live.values, [part]: next } });
      unsaved.add(part);
      // While saving is off the change only waits in `unsaved`. The load saves it later.
      if (canSave && live.key !== undefined) scheduleSave(live.key);
    },

    reload(): void {
      // A change waiting out the delay goes first, so that the store answers with it.
      queuePending();
      // When that save fails, the change stays in `unsaved`, and is saved after the load.
      pending = undefined;
      awaitLoad();
      // The app may have passed another store since the last load. Off screen, the table
      // joins and loads when it is shown again.
      if (!active) return;
      if (live.key !== undefined) join(storeOf(latest.current), live.key);
      load();
    },

    flush(): Promise<boolean> {
      queuePending();
      const isAllSaved = (): boolean => unsaved.size === 0 && !removeFailed;
      if (unanswered === 0) return Promise.resolve(isAllSaved());
      return new Promise((resolve) => {
        whenAnswered.push(() => resolve(isAllSaved()));
      });
    },

    /**
     * Sends what waits now, as one request per key, without waiting for the store to answer
     * a write already on its way. For a closing page only.
     */
    flushWithoutWaiting(): void {
      queuePending();
      for (const busy of busyChannels) busy.sendNewestNow();
    },

    clear(): void {
      // A load still on its way must not bring the old state back.
      loadRun += 1;
      dropPending();
      unsaved.clear();
      removeFailed = false;
      holdsDefaults = true;
      const { key } = live;
      const values = readSavedState(undefined, latest.current.parts);
      if (key === undefined || channel === undefined) {
        publish({ ...live, values });
        return;
      }
      // The stored state is gone on purpose, so saving is safe even after a failed load.
      canSave = true;
      publish({ key, values, ...READY });
      // Through the same channel as the saves. A save made before this cannot land after the
      // remove, and a save made after this cannot be deleted by it.
      send(channel, {
        kind: "remove",
        done: (outcome) => {
          if (outcome.status !== "failed") return;
          removeFailed = live.key === key;
          report(outcome.error, "remove", key);
        },
      });
    },
  };
}

/** A set of values to save, with the key they belong to. */
interface Change<Values> {
  key: string;
  values: Values;
}

// Made on first use, so an app that passes its own store never makes this one.
let defaultStore: StateStore | undefined;

/** The store the app asks for now: its own, or the browser's local storage. */
function storeOf(options: { store?: StateStore }): StateStore {
  if (options.store) return options.store;
  defaultStore ??= localStorageStore();
  return defaultStore;
}

/**
 * The parts to save: the stored parts the hook does not own, as they are, and then its own
 * values. This way a save drops nothing that another hook, or an older version of the app,
 * saved under the key.
 */
function withOtherParts(
  stored: SavedParts,
  own: object,
): Record<string, unknown> {
  const parts: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(stored)) {
    if (!Object.hasOwn(own, name)) parts[name] = value;
  }
  return Object.assign(parts, own);
}

/**
 * Reads what a store handed back: each of the hook's parts, checked, and all the saved parts
 * as they are, in today's shape.
 */
function readLoadedState<Values>(
  saved: unknown,
  options: UseSavedTableStateOptions<Values>,
): { values: Values; savedParts: SavedParts } {
  const version = options.version ?? DEFAULT_STATE_VERSION;
  // Upgraded once here. Wrapped in today's version below, so they are not upgraded again.
  const savedParts = readSavedParts(saved, options);
  const values = readSavedState(
    savedParts && createSavedState(savedParts, version),
    options.parts,
    { version },
  );
  return { values, savedParts: savedParts ?? {} };
}

/** The keys already warned about, so each is named once. */
const warnedKeys = new Set<string>();

// Not there in a plain browser page. `isProductionBuild` deals with that.
declare const process: { env: { NODE_ENV?: string } };

/** Whether this is a production build. Also true where the build mode cannot be told. */
function isProductionBuild(): boolean {
  try {
    // Bundlers put the build mode in place of this expression as it is written here. It must
    // not hide behind a check that `process` exists: a browser has no `process`, so the
    // check would fail in a development build too.
    return process.env.NODE_ENV === "production";
  } catch {
    // No bundler and no `process`, as in a plain browser page.
    return true;
  }
}

/**
 * Tells a developer, once per key, that two tables on screen save under the same key. One
 * hook call per key is the rule. When an app breaks it, the shared channel still keeps every
 * hook's parts, but parts of the same name overwrite each other.
 */
function warnAboutSharedKey(key: string): void {
  if (isProductionBuild() || warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(
    `useSavedTableState: two tables on screen save their state under the key "${key}". ` +
      "Parts of the same name overwrite each other. Give each table its own `id` or `name`.",
  );
}

// One channel per store and key. It is the single place that writes to that key, so the hooks
// that share the key cannot overtake each other, and all of them see the same saved parts.
//
// Plain code with no React in it. `useSavedTableState` joins a channel while its table is on
// screen, and hands it every save and remove.

import type { SavedState, StateStore } from "@arvilmena/filter-core";

/** The parts saved under a key, by name. They are not checked, and may be anything. */
export type SavedParts = Readonly<Record<string, unknown>>;

/** How a save or a remove ended. */
export type WriteOutcome =
  /** The store took it, or already held exactly this state. */
  | { status: "accepted" }
  | { status: "failed"; error: unknown }
  /** It never reached the store: a newer save of the same owner took its place. */
  | { status: "replaced" };

/** A save or a remove for a channel to send. `done` is called once, with how it ended. */
export type Write =
  | {
      kind: "save";
      /** Who asks. A newer save of the same owner replaces one that still waits. */
      owner: object;
      /**
       * Makes the state to save, from the parts the store holds at that moment. It is called
       * when the save is sent, not when it is asked for, so it never misses a part that another
       * hook saved in between.
       */
      build: (stored: SavedParts) => SavedState;
      done: (outcome: WriteOutcome) => void;
    }
  | { kind: "remove"; done: (outcome: WriteOutcome) => void };

/** The one queue of saves and removes for a key in a store, and what that key holds. */
export interface StateChannel {
  readonly store: StateStore;
  readonly key: string;
  /** How many hooks on screen use this channel. More than one means they share the key. */
  hookCount(): number;
  /** The parts the store holds under the key, as far as its last answer tells. */
  storedParts(): SavedParts;
  /**
   * Queues a save or a remove. Each is sent once the store has answered the one before it, so
   * a slow answer cannot leave an older state in the store.
   */
  write(write: Write): void;
  /**
   * Sends what waits now, as one request, without waiting for the answer to a write already
   * on its way. For a closing page only.
   *
   * The one request holds the state the waiting writes would have left in the store, so the
   * writes that waited cannot arrive in the wrong order. A write already on its way is another
   * matter: it may reach the store after this request, or not at all.
   */
  sendNewestNow(): void;
  /** Whether nothing waits and the store has answered everything. */
  isIdle(): boolean;
  /** Calls `then` once the channel is idle: at once when it already is. */
  whenIdle(then: () => void): void;
  /** A number that goes up with every save and remove sent. See `noteRead`. */
  writeCount(): number;
  /**
   * Takes over what a read of the store found: `saved` is the value as the store gave it, and
   * `parts` are its parts in today's shape. A save of exactly that value is then skipped, and
   * any other save is sent.
   *
   * `countAtRead` is `writeCount()` from the moment the read began. When a write was sent
   * since, the read is older than what the channel knows and is left out.
   */
  noteRead(saved: unknown, parts: SavedParts, countAtRead: number): void;
  /**
   * Whether a newer channel was made for the store and key after this one was forgotten. What
   * this one knows about the store may then be out of date, so its holder must read the store
   * again before it saves.
   */
  isSuperseded(): boolean;
}

/** A channel, with the count that only this file changes. */
interface ListedChannel extends StateChannel {
  hooks: number;
}

/** One key in one store. */
interface Place {
  /** The channel in use. `undefined` once it was forgotten. */
  channel: ListedChannel | undefined;
  /** How many channels were made for the place so far. */
  made: number;
}

/**
 * The places that had a channel, by store and key. A store is held weakly (it does not keep
 * the store alive), so a store the app has dropped takes its places with it.
 *
 * A place outlives its channel, so that a channel a hook kept can tell whether a newer one was
 * made since. That costs one small entry per key, for as long as the store lives.
 */
const placesByStore = new WeakMap<StateStore, Map<string, Place>>();

/** The place of a store and key. It is listed when it is new. */
function placeOf(store: StateStore, key: string): Place {
  let byKey = placesByStore.get(store);
  if (byKey === undefined) {
    byKey = new Map();
    placesByStore.set(store, byKey);
  }
  let place = byKey.get(key);
  if (place === undefined) {
    place = { channel: undefined, made: 0 };
    byKey.set(key, place);
  }
  return place;
}

/**
 * Joins the channel of a store and key, and makes it when there is none.
 *
 * `kept` is the channel a hook held before it left, if any. When it is for the same store and
 * key and no newer channel was made since, it is put back, so a table that was hidden and is
 * shown again still knows what the store holds. Otherwise the hook gets another channel, and
 * must read the store again: see `isSuperseded`.
 */
export function joinChannel(
  store: StateStore,
  key: string,
  kept?: StateChannel,
): StateChannel {
  const channel = findOrList(store, key, kept as ListedChannel | undefined);
  channel.hooks += 1;
  return channel;
}

/** Leaves a channel joined with `joinChannel`. A channel nobody uses any more is forgotten. */
export function leaveChannel(channel: StateChannel): void {
  const listed = channel as ListedChannel;
  listed.hooks -= 1;
  forgetWhenUnused(listed, placeOf(listed.store, listed.key));
}

/** The channel in use for a store and key. With none in use, `kept` or a new one is listed. */
function findOrList(
  store: StateStore,
  key: string,
  kept: ListedChannel | undefined,
): ListedChannel {
  const place = placeOf(store, key);
  if (place.channel === undefined) {
    if (kept?.store === store && kept.key === key && !kept.isSuperseded()) {
      place.channel = kept;
    } else {
      place.made += 1;
      place.channel = createChannel(store, key, place);
    }
  }
  return place.channel;
}

/** Stops listing a channel once no hook uses it and it has nothing left to send. */
function forgetWhenUnused(channel: ListedChannel, place: Place): void {
  if (channel.hooks > 0 || !channel.isIdle()) return;
  if (place.channel === channel) place.channel = undefined;
}

const ACCEPTED: WriteOutcome = { status: "accepted" };

/** What the store holds once it has taken a write. */
interface StateAfterWrite {
  parts: SavedParts;
  /** The saved state as text. `undefined` after a remove. */
  text: string | undefined;
  /** The write's place among all writes sent. */
  order: number;
}

function createChannel(
  store: StateStore,
  key: string,
  place: Place,
): ListedChannel {
  /** This channel's number among the channels made for the place. */
  const madeAs = place.made;
  /** The writes not yet handed to the store, oldest first. */
  const queue: Write[] = [];
  /** How many writes were handed to the store and have not ended yet. */
  let unanswered = 0;
  let writeCount = 0;
  /** What the store holds, as far as its answers tell. */
  let stored: StateAfterWrite = { parts: {}, text: undefined, order: 0 };
  /** The parts of the newest write that was sent and not answered yet. */
  let onItsWay: SavedParts | undefined;
  /** Called once the channel is idle. A load and `forgetWhenUnused` wait here. */
  const idleWaiters: (() => void)[] = [];

  const isIdle = (): boolean => unanswered === 0 && queue.length === 0;

  /** Notes what the store holds now. An answer that comes back late does not undo a newer one. */
  const accept = (after: StateAfterWrite): void => {
    if (after.order >= stored.order) stored = after;
  };

  /**
   * Ends a write the store turned down. The store may hold the write all the same: a request
   * can reach a server and still fail on its way back. So the saved text is no longer known,
   * and the next save is sent even when it equals the last one the store took.
   *
   * The parts stay as they were. The parts of other owners were the same in the write that
   * failed, so they are right whichever state the store holds.
   */
  const fail = (done: Write["done"], error: unknown): void => {
    stored = { ...stored, text: undefined };
    done({ status: "failed", error });
  };

  /**
   * Hands one state to the store, and deals with its answer. `wanted` makes the state from the
   * parts the store holds: a state to save, or `undefined` to remove what is saved.
   */
  const send = (
    wanted: (base: SavedParts) => SavedState | undefined,
    done: Write["done"],
  ): void => {
    // The write takes its turn before any code of the app or the store runs. Such code may
    // ask for another save in the middle of this one. That save then waits, and builds on
    // what this one leaves in the store.
    unanswered += 1;
    let after: StateAfterWrite;
    let answer: unknown;
    try {
      // The base is the newest state sent: a closing page sends without waiting, and its
      // save must build on the one still on its way.
      const saved = wanted(onItsWay ?? stored.parts);
      const text = saved && JSON.stringify(saved);
      // The store holds exactly this already. Only this write is counted in `unanswered`.
      if (saved && unanswered === 1 && text === stored.text) {
        unanswered -= 1;
        done(ACCEPTED);
        return;
      }
      writeCount += 1;
      after = { parts: saved?.parts ?? {}, text, order: writeCount };
      answer = saved ? store.save(key, saved) : store.remove(key);
    } catch (error) {
      unanswered -= 1;
      fail(done, error);
      return;
    }

    if (!isPromiseLike(answer)) {
      accept(after);
      unanswered -= 1;
      done(ACCEPTED);
      return;
    }
    onItsWay = after.parts;
    const answered = (end: () => void): void => {
      unanswered -= 1;
      if (onItsWay === after.parts) onItsWay = undefined;
      end();
      sendNext();
    };
    answer.then(
      () =>
        answered(() => {
          accept(after);
          done(ACCEPTED);
        }),
      (error: unknown) => answered(() => fail(done, error)),
    );
  };

  /** Sends what waits, for as long as the store has answered everything before it. */
  const sendNext = (): void => {
    while (unanswered === 0) {
      const write = queue.shift();
      if (write === undefined) break;
      send((base) => stateOf(write, base), write.done);
    }
    if (!isIdle()) return;
    for (const tell of idleWaiters.splice(0)) tell();
    forgetWhenUnused(channel, place);
  };

  const channel: ListedChannel = {
    store,
    key,
    hooks: 0,
    hookCount: () => channel.hooks,
    storedParts: () => stored.parts,
    isIdle,
    writeCount: () => writeCount,
    isSuperseded: () => place.made !== madeAs,

    write(write) {
      // A hook may still write after it left, and the channel may have been forgotten since.
      // The write then goes through the listed channel, so that the key keeps one queue.
      const listed = findOrList(store, key, channel);
      if (listed !== channel) {
        listed.write(write);
        return;
      }
      // A save of the same owner that still waits is out of date now.
      const last = queue.at(-1);
      if (
        write.kind === "save" &&
        last?.kind === "save" &&
        last.owner === write.owner
      ) {
        queue.pop();
        last.done({ status: "replaced" });
      }
      queue.push(write);
      sendNext();
    },

    sendNewestNow() {
      const waiting = queue.splice(0);
      if (waiting.length > 0) {
        send(
          // Each waiting write is worked out on top of the one before it, and only the last
          // result is sent. A remove empties the parts, as it would in the store.
          (base) => {
            let saved: SavedState | undefined;
            let parts = base;
            for (const write of waiting) {
              saved = stateOf(write, parts);
              parts = saved?.parts ?? {};
            }
            return saved;
          },
          (outcome) => {
            for (const write of waiting) write.done(outcome);
          },
        );
      }
      // A write asked for in the middle of the one above waits in the queue.
      sendNext();
    },

    whenIdle(then) {
      if (isIdle()) then();
      else idleWaiters.push(then);
    },

    noteRead(saved, parts, countAtRead) {
      if (countAtRead !== writeCount) return;
      stored = { ...stored, parts, text: textOf(saved) };
    },
  };
  return channel;
}

/** The state a write leaves in the store, given the parts there before. `undefined` for none. */
function stateOf(write: Write, base: SavedParts): SavedState | undefined {
  return write.kind === "save" ? write.build(base) : undefined;
}

/** A value read from a store, as the text a save of it would send. `undefined` for none. */
function textOf(saved: unknown): string | undefined {
  if (saved === null || saved === undefined) return undefined;
  try {
    return JSON.stringify(saved);
  } catch {
    // Not plain JSON, so no save can equal it.
    return undefined;
  }
}

/** Whether a store answered with a promise, and not at once. */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

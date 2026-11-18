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
   * Sends everything that waits at once, in order, without waiting for answers. For a closing
   * page only: the answers may come back in another order.
   */
  sendAllNow(): void;
  /** Whether nothing waits and the store has answered everything. */
  isIdle(): boolean;
  /** Calls `then` once the channel is idle: at once when it already is. */
  whenIdle(then: () => void): void;
  /** A number that goes up with every save and remove sent. See `noteRead`. */
  writeCount(): number;
  /**
   * Takes over the parts that a read of the store found. `countAtRead` is `writeCount()` from
   * the moment the read began. When a write was sent since, the read is older than what the
   * channel knows and is left out.
   */
  noteRead(parts: SavedParts, countAtRead: number): void;
}

/** A channel, with the count that only this file changes. */
interface ListedChannel extends StateChannel {
  hooks: number;
}

/**
 * The channels in use, by store and key. A store is held weakly (it does not keep the store
 * alive), so a store the app has dropped takes its channels with it.
 */
const channelsByStore = new WeakMap<StateStore, Map<string, ListedChannel>>();

/**
 * Joins the channel of a store and key, and makes it when there is none.
 *
 * `kept` is the channel a hook held before it left, if any. When it is for the same store and
 * key and nothing took its place, it is put back, so a table that was hidden and is shown again
 * still knows what the store holds.
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
  forgetWhenUnused(listed);
}

/** The listed channel of a store and key. With none listed, `kept` or a new one is listed. */
function findOrList(
  store: StateStore,
  key: string,
  kept: ListedChannel | undefined,
): ListedChannel {
  let byKey = channelsByStore.get(store);
  if (byKey === undefined) {
    byKey = new Map();
    channelsByStore.set(store, byKey);
  }
  let channel = byKey.get(key);
  if (channel === undefined) {
    const isSamePlace = kept?.store === store && kept.key === key;
    channel = isSamePlace && kept ? kept : createChannel(store, key);
    byKey.set(key, channel);
  }
  return channel;
}

/** Drops a channel from the list once no hook uses it and it has nothing left to send. */
function forgetWhenUnused(channel: ListedChannel): void {
  if (channel.hooks > 0 || !channel.isIdle()) return;
  const byKey = channelsByStore.get(channel.store);
  if (byKey?.get(channel.key) !== channel) return;
  byKey.delete(channel.key);
  if (byKey.size === 0) channelsByStore.delete(channel.store);
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

function createChannel(store: StateStore, key: string): ListedChannel {
  /** The writes not yet handed to the store, oldest first. */
  const queue: Write[] = [];
  /** How many writes the store has not answered yet. */
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

  /** Hands one write to the store, and deals with its answer. */
  const send = (write: Write): void => {
    let after: StateAfterWrite;
    let answer: unknown;
    try {
      if (write.kind === "save") {
        // The base is the newest state sent, so that saves sent without waiting (on a
        // closing page) still build on each other.
        const saved = write.build(onItsWay ?? stored.parts);
        const text = JSON.stringify(saved);
        // The store holds exactly this already.
        if (unanswered === 0 && text === stored.text) {
          write.done(ACCEPTED);
          return;
        }
        writeCount += 1;
        after = { parts: saved.parts, text, order: writeCount };
        answer = store.save(key, saved);
      } else {
        writeCount += 1;
        after = { parts: {}, text: undefined, order: writeCount };
        answer = store.remove(key);
      }
    } catch (error) {
      write.done({ status: "failed", error });
      return;
    }

    if (!isPromiseLike(answer)) {
      accept(after);
      write.done(ACCEPTED);
      return;
    }
    unanswered += 1;
    onItsWay = after.parts;
    const answered = (outcome: WriteOutcome): void => {
      unanswered -= 1;
      if (onItsWay === after.parts) onItsWay = undefined;
      if (outcome.status === "accepted") accept(after);
      write.done(outcome);
      sendNext();
    };
    answer.then(
      () => answered(ACCEPTED),
      (error: unknown) => answered({ status: "failed", error }),
    );
  };

  /** Sends what waits, for as long as the store has answered everything before it. */
  const sendNext = (): void => {
    while (unanswered === 0) {
      const write = queue.shift();
      if (write === undefined) break;
      send(write);
    }
    if (!isIdle()) return;
    for (const tell of idleWaiters.splice(0)) tell();
    forgetWhenUnused(channel);
  };

  const channel: ListedChannel = {
    store,
    key,
    hooks: 0,
    hookCount: () => channel.hooks,
    storedParts: () => stored.parts,
    isIdle,
    writeCount: () => writeCount,

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

    sendAllNow() {
      for (const write of queue.splice(0)) send(write);
    },

    whenIdle(then) {
      if (isIdle()) then();
      else idleWaiters.push(then);
    },

    noteRead(parts, countAtRead) {
      if (countAtRead !== writeCount) return;
      stored = { ...stored, parts };
    },
  };
  return channel;
}

/** Whether a store answered with a promise, and not at once. */
export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

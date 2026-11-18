import type { SavedState, StateStore } from "@arvilmena/filter-core";
import { describe, expect, it, vi } from "vitest";
import {
  joinChannel,
  leaveChannel,
  type StateChannel,
  type WriteOutcome,
} from "./savedStateChannel";

/** A store that answers a save only when the test says so. */
function slowStore() {
  const answers: (() => void)[] = [];
  const store = {
    answers,
    load: vi.fn(),
    save: vi.fn(
      (_key: string, _value: unknown) =>
        new Promise<void>((resolve) => {
          answers.push(resolve);
        }),
    ),
    remove: vi.fn(),
  };
  return store satisfies StateStore;
}

/** A store that answers at once. */
const quickStore = (): StateStore => ({
  load: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
});

const savedWith = (parts: Record<string, unknown>): SavedState => ({
  version: 1,
  parts,
});

/** Queues a save of one part on the channel. `ended` hears how it went. */
function save(
  channel: StateChannel,
  part: Record<string, unknown>,
  owner: object = {},
) {
  const ended = vi.fn<(outcome: WriteOutcome) => void>();
  channel.write({
    kind: "save",
    owner,
    build: (stored) => savedWith({ ...stored, ...part }),
    done: ended,
  });
  return ended;
}

describe("the channel of a store and key", () => {
  it("should be one channel for all who join the same store and key", () => {
    const store = quickStore();
    const first = joinChannel(store, "orders");
    expect(joinChannel(store, "orders")).toBe(first);
    expect(first.hookCount()).toBe(2);
    expect(joinChannel(store, "archive")).not.toBe(first);
    expect(joinChannel(quickStore(), "orders")).not.toBe(first);
  });

  it("should send one write at a time, and build each save when it is sent", async () => {
    const store = slowStore();
    const channel = joinChannel(store, "orders");
    save(channel, { sort: "price" });
    const second = save(channel, { pageSize: 50 });
    expect(store.save).toHaveBeenCalledOnce();

    store.answers[0]?.();
    await Promise.resolve();
    // Built after the first save was taken, so it carries that save's part.
    expect(store.save).toHaveBeenLastCalledWith(
      "orders",
      savedWith({ sort: "price", pageSize: 50 }),
    );
    store.answers[1]?.();
    await Promise.resolve();
    expect(second).toHaveBeenCalledExactlyOnceWith({ status: "accepted" });
    expect(channel.storedParts()).toEqual({ sort: "price", pageSize: 50 });
  });

  it("should not take over the parts of a save the store turned down", () => {
    const store = quickStore();
    vi.mocked(store.save).mockImplementationOnce(() => {
      throw new Error("full");
    });
    const channel = joinChannel(store, "orders");
    const ended = save(channel, { sort: "price" });
    expect(ended).toHaveBeenCalledExactlyOnceWith({
      status: "failed",
      error: expect.any(Error),
    });
    expect(channel.storedParts()).toEqual({});
  });

  it.each([
    ["answers at once", false],
    ["answers later", true],
  ])(
    "should make a save asked for inside the store's own save wait, when the store %s",
    async (_label, isSlow) => {
      const store = quickStore();
      const sent: unknown[] = [];
      let channel: StateChannel | undefined;
      vi.mocked(store.save).mockImplementation((_key, value) => {
        sent.push(value);
        // The store calls back into the channel in the middle of its first save.
        if (sent.length === 1 && channel) save(channel, { pageSize: 50 });
        return isSlow ? Promise.resolve() : undefined;
      });
      channel = joinChannel(store, "orders");
      save(channel, { sort: "price" });
      await Promise.resolve();

      // The inner save was sent second, and carries the part of the save it interrupted.
      expect(sent).toEqual([
        savedWith({ sort: "price" }),
        savedWith({ sort: "price", pageSize: 50 }),
      ]);
      await Promise.resolve();
      expect(channel.storedParts()).toEqual({ sort: "price", pageSize: 50 });
      expect(channel.isIdle()).toBe(true);
    },
  );

  it("should free the queue when the store's save throws", () => {
    const store = quickStore();
    vi.mocked(store.save).mockImplementationOnce(() => {
      throw new Error("full");
    });
    const channel = joinChannel(store, "orders");
    save(channel, { sort: "price" });
    expect(channel.isIdle()).toBe(true);
    const next = save(channel, { sort: "name" });
    expect(next).toHaveBeenCalledExactlyOnceWith({ status: "accepted" });
  });

  it("should replace a waiting save of the same owner only", async () => {
    const store = slowStore();
    const channel = joinChannel(store, "orders");
    const owner = {};
    save(channel, { sort: "price" });
    const older = save(channel, { pageSize: 25 }, owner);
    const newer = save(channel, { pageSize: 50 }, owner);
    expect(older).toHaveBeenCalledExactlyOnceWith({ status: "replaced" });

    store.answers[0]?.();
    await Promise.resolve();
    store.answers[1]?.();
    await Promise.resolve();
    expect(store.save).toHaveBeenCalledTimes(2);
    expect(newer).toHaveBeenCalledExactlyOnceWith({ status: "accepted" });
    expect(channel.storedParts()).toEqual({ sort: "price", pageSize: 50 });
  });

  it("should leave out a read that is older than a write", () => {
    const channel = joinChannel(quickStore(), "orders");
    const countAtRead = channel.writeCount();
    save(channel, { sort: "price" });
    const read = savedWith({ sort: "name" });
    channel.noteRead(read, read.parts, countAtRead);
    expect(channel.storedParts()).toEqual({ sort: "price" });

    channel.noteRead(read, read.parts, channel.writeCount());
    expect(channel.storedParts()).toEqual({ sort: "name" });
  });

  it("should skip a save of what a read found, and send any other", () => {
    const store = quickStore();
    const channel = joinChannel(store, "orders");
    save(channel, { sort: "price" });
    // The store was changed from outside, and read again.
    const read = savedWith({ sort: "name" });
    channel.noteRead(read, read.parts, channel.writeCount());

    const same = save(channel, { sort: "name" });
    expect(same).toHaveBeenCalledExactlyOnceWith({ status: "accepted" });
    expect(store.save).toHaveBeenCalledOnce();
    save(channel, { sort: "price" });
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it("should send a save after a read that found nothing", () => {
    const store = quickStore();
    const channel = joinChannel(store, "orders");
    save(channel, { sort: "price" });
    channel.noteRead(undefined, {}, channel.writeCount());
    save(channel, { sort: "price" });
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  describe("when its last hook leaves", () => {
    it("should be forgotten, so the next to join starts a new one", () => {
      const store = quickStore();
      const first = joinChannel(store, "orders");
      save(first, { sort: "price" });
      leaveChannel(first);

      const next = joinChannel(store, "orders");
      expect(next).not.toBe(first);
      expect(next.storedParts()).toEqual({});
    });

    it("should stay until the store has answered what it still sends", async () => {
      const store = slowStore();
      const first = joinChannel(store, "orders");
      save(first, { sort: "price" });
      leaveChannel(first);
      // A hook that joins now must wait behind the save on its way.
      const second = joinChannel(store, "orders");
      expect(second).toBe(first);
      leaveChannel(second);

      store.answers[0]?.();
      await Promise.resolve();
      expect(joinChannel(store, "orders")).not.toBe(first);
    });

    it("should come back for the hook that kept it, when nothing took its place", () => {
      const store = quickStore();
      const kept = joinChannel(store, "orders");
      save(kept, { sort: "price" });
      leaveChannel(kept);
      expect(joinChannel(store, "orders", kept)).toBe(kept);
      leaveChannel(kept);

      const taken = joinChannel(store, "orders");
      expect(joinChannel(store, "orders", kept)).toBe(taken);
    });

    it("should pass a late write on to the channel that took its place", () => {
      const store = quickStore();
      const left = joinChannel(store, "orders");
      leaveChannel(left);
      const current = joinChannel(store, "orders");
      save(left, { sort: "price" });
      expect(current.storedParts()).toEqual({ sort: "price" });
    });
  });
});

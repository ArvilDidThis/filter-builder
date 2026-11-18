import { flushSync } from "react-dom";
import { describe, expect, test } from "vitest";
import { manyColumns, PickerApp, pickerParts } from "./support/apps";
import { mount, unmountAll } from "./support/mount";
import { pointOn } from "./support/pointer";

// A timing check with 200 columns. It is here to catch a large slowdown, such as every row
// being measured or redrawn on every pointer move. It is not a benchmark.

const COLUMNS = manyColumns(200);

/**
 * The most each step may take, in milliseconds.
 *
 * Measured on a laptop over 10 runs in each of the three browsers, the slowest run of each
 * step took: opening 33, a tick 6, a key move 21, a drag of 60 moves 48. Each limit is about
 * 10 times its step or more, with a floor of 200. A shared CI machine a few times slower
 * still passes with room to spare.
 *
 * So this fails only when a step gets about ten times slower. A smaller slowdown is not
 * caught here. As a measure: a drag that redraws all 200 rows on every move took 106 to 390
 * on the same laptop, which is under the limit. The redraw tests catch that kind of change
 * by counting, which does not depend on the machine.
 */
const LIMIT_MS = { open: 400, tick: 200, keyMove: 300, drag: 500 } as const;

/** The time each step took, in milliseconds. */
type Took = Record<keyof typeof LIMIT_MS, number>;

/**
 * How many times the steps are timed. Each step's fastest time is the one that counts. A
 * machine that is busy with something else for a moment slows one time, not all of them,
 * while a real slowdown of the picker slows every one.
 */
const ROUNDS = 3;

/**
 * Sends one event and lets React redraw for it at once. React puts off the redraw after an
 * event that a script sent, and would then draw several events as one.
 */
function send(event: () => void): void {
  flushSync(event);
}

/** Runs `step`, makes the browser lay the page out, and gives the time both took. */
function timed(step: () => void): number {
  const start = performance.now();
  step();
  // Reading a size makes the browser finish the layout now, so its cost is counted.
  document.body.getBoundingClientRect();
  return performance.now() - start;
}

/** A pointer event as a mouse with its main button held would cause. */
function pointerEvent(type: string, y: number, x: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 1,
    pointerType: "mouse",
    button: type === "pointermove" ? -1 : 0,
    buttons: type === "pointerup" ? 0 : 1,
    clientX: x,
    clientY: y,
  });
}

/** Draws a new picker with 200 columns and times each step on it once. */
async function timeSteps(): Promise<Took> {
  mount(<PickerApp columns={COLUMNS} />);
  const picker = pickerParts();
  await expect
    .poll(() => document.querySelector(".fb-columns-trigger"))
    .not.toBeNull();

  // The steps are sent from the page itself, not by the real mouse, so that the time
  // counted is the picker's own and not the time the test tool takes to send input.
  const open = timed(() => send(() => picker.trigger().click()));
  expect(picker.rows().length).toBe(200);

  const tick = timed(() => send(() => picker.checkbox("Column 5").click()));
  expect(picker.checkbox("Column 5").checked).toBe(false);

  const handle = picker.handle("Column 0");
  const keyMove = timed(() =>
    send(() =>
      handle.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "End",
          bubbles: true,
          cancelable: true,
        }),
      ),
    ),
  );
  expect(picker.listed().at(-1)).toBe("Column 0");

  // A drag from the first row down the visible part of the list, in 60 moves.
  picker.list().scrollTop = 0;
  const first = picker.handle("Column 1");
  const from = pointOn(first);
  const listBox = picker.list().getBoundingClientRect();
  const drag = timed(() => {
    send(() =>
      first.dispatchEvent(pointerEvent("pointerdown", from.y, from.x)),
    );
    for (let move = 1; move <= 60; move++) {
      const y = from.y + ((listBox.bottom - 40 - from.y) * move) / 60;
      send(() =>
        document.dispatchEvent(pointerEvent("pointermove", y, from.x)),
      );
      // Each move is laid out, as each would be on screen.
      picker.list().getBoundingClientRect();
    }
    send(() =>
      document.dispatchEvent(
        pointerEvent("pointerup", listBox.bottom - 40, from.x),
      ),
    );
  });
  expect(picker.listed()[0]).not.toBe("Column 1");

  return { open, tick, keyMove, drag };
}

describe("a picker with 200 columns (item 16)", () => {
  test("opens, ticks, moves and drags within loose time limits", async () => {
    const rounds: Took[] = [];
    for (let round = 0; round < ROUNDS; round++) {
      rounds.push(await timeSteps());
      unmountAll();
    }
    console.info(`200 columns, milliseconds: ${JSON.stringify(rounds)}`);
    for (const step of Object.keys(LIMIT_MS) as (keyof typeof LIMIT_MS)[]) {
      const fastest = Math.min(...rounds.map((took) => took[step]));
      expect(fastest, `${step} took too long`).toBeLessThan(LIMIT_MS[step]);
    }
  });
});

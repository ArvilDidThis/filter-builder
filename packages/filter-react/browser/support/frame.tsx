import type { ReactNode } from "react";
import { BLANK_PAGE_PATH } from "../fixture-paths";
import { type Counter, openPicker, PickerApp, type PickerParts } from "./apps";
import { untilBlank } from "./fixture-page";
import { mount } from "./mount";
import { addStyles } from "./shadow";

// The picker in a frame: a page within the page, with a document of its own.

/** An open picker in a frame, with what a test needs around it. */
export interface FramedPicker {
  picker: PickerParts;
  frame: HTMLIFrameElement;
  /** The frame's own document. */
  inner: Document;
  /** A button on the outer page, before the frame. */
  outside: HTMLButtonElement;
  /** A button on the outer page, after the frame. It is where Tab goes on leaving the frame. */
  after: HTMLButtonElement;
}

/**
 * Draws the app into a frame from the outer page, as an app does that draws into a preview
 * pane, and opens its picker.
 */
export async function openInFrame(
  changed?: Counter,
  /** Drawn in the frame in place of the usual app around the picker. */
  app?: ReactNode,
): Promise<FramedPicker> {
  const outside = document.createElement("button");
  outside.textContent = "Outside the frame";
  const frame = document.createElement("iframe");
  frame.title = "Embedded page";
  frame.style.cssText =
    "display: block; width: 480px; height: 400px; margin: 24px;";
  frame.src = BLANK_PAGE_PATH;
  const after = document.createElement("button");
  after.textContent = "After the frame";
  // A place in the Tab order spelled out. Safari on a Mac leaves a plain button out of that
  // order unless a system setting is on.
  after.tabIndex = 0;
  document.body.append(outside, frame, after);
  // A frame starts with a throwaway empty page. The real one is there once it has loaded.
  await untilBlank(frame);
  const inner = frame.contentDocument as Document;
  addStyles(inner.head);
  mount(
    app ?? <PickerApp changed={changed} />,
    inner.body.appendChild(inner.createElement("div")),
  );
  return { picker: await openPicker(inner), frame, inner, outside, after };
}

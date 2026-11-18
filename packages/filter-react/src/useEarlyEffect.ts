import { useEffect, useLayoutEffect } from "react";

/**
 * A layout effect (one that runs after React has changed the page and before the browser
 * paints) where there is a window, and a plain effect where there is none. On a server there
 * is no screen, and older React warns about `useLayoutEffect` there.
 *
 * It does not run before every other effect. Layout effects run before plain ones, and a
 * child component's layout effect runs before its parent's.
 */
export const useEarlyEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

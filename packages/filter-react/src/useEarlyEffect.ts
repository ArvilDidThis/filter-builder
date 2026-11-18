import { useEffect, useLayoutEffect } from "react";

/**
 * Runs before any other effect of the same render. On a server there is no screen, and older
 * React warns about `useLayoutEffect` there, so the plain effect stands in.
 */
export const useEarlyEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

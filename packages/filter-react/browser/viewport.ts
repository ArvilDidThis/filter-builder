/**
 * The window size the browser tests run at. It is fixed, so layouts and screenshots do not
 * depend on the machine. A test that changes the size gets this one back afterwards.
 */
export const VIEWPORT = { width: 1024, height: 768 } as const;

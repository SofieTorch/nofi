/** On macOS the top bar replaces the native title bar, so it leaves room for the window buttons. */
export const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");

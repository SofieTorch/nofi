// The fonts a note can use. Finding the computer's fonts takes a moment, so they're asked for once.

import * as api from "../api";

let fonts: Promise<string[]> | undefined;

export const loadFonts = () => (fonts ??= api.listFonts().catch(() => []));

/** Forgets the fonts (for tests, which each use their own fake backend). */
export function forgetFonts() {
  fonts = undefined;
}

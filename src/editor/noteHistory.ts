// Each note's editor state (text, cursor and undo history) while the workspace is open, so
// switching to another note and back keeps what Undo can undo.

import type { EditorState } from "@codemirror/state";

const states = new Map<string, EditorState>();

export function rememberNoteState(path: string, state: EditorState) {
  states.set(path, state);
}

/** The note's last state, unless the note changed outside the app since (then it's stale). */
export function recallNoteState(path: string, text: string): EditorState | undefined {
  const state = states.get(path);
  return state && state.doc.toString() === text ? state : undefined;
}

/** The note was renamed: its history goes with it. */
export function moveNoteHistory(from: string, to: string) {
  const state = states.get(from);
  states.delete(from);
  if (state) states.set(to, state);
}

/** Forgets one note's history, or every note's (e.g. when the workspace closes). */
export function forgetNoteHistory(path?: string) {
  if (path === undefined) states.clear();
  else states.delete(path);
}

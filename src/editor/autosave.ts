// Saves what's typed into a note shortly after you pause typing, so the file on disk is always
// up to date without a save button.

import * as api from "../api";

/** How long typing has to pause before the note is saved. */
const SAVE_DELAY_MS = 300;

export type Autosave = {
  /** The note's text changed: save it once typing pauses. */
  change: (path: string, text: string) => void;
  /** Saves any change that's still waiting, right now. */
  flush: () => Promise<void>;
  dispose: () => void;
};

const everyAutosave = new Set<Autosave>();

/** Saves every change still waiting, e.g. before the workspace closes. */
export async function flushAllSaves() {
  await Promise.all([...everyAutosave].map((autosave) => autosave.flush()));
}

export function createAutosave(events: {
  onSaved: () => void;
  onFailed: (reason: string) => void;
}): Autosave {
  let waiting: { path: string; text: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function flush() {
    clearTimeout(timer);
    if (!waiting) return;
    const { path, text } = waiting;
    waiting = null;
    try {
      await api.saveNote(path, text);
      events.onSaved();
    } catch (reason) {
      // Keep it, so the next save tries again (unless something newer is waiting).
      waiting ??= { path, text };
      events.onFailed(String(reason));
    }
  }

  const autosave: Autosave = {
    change(path, text) {
      waiting = { path, text };
      clearTimeout(timer);
      timer = setTimeout(flush, SAVE_DELAY_MS);
    },
    flush,
    dispose() {
      everyAutosave.delete(autosave);
    },
  };
  everyAutosave.add(autosave);
  return autosave;
}

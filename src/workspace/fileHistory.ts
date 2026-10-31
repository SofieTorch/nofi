// The list of file actions (creating, renaming notes…) that Undo and Redo walk through.
// New kinds of actions only need to say how to undo and redo themselves.

export type FileAction = {
  /** Says what was done, e.g. `renaming "Untitled.typ" to "Ideas.typ"`. */
  description: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

export class FileHistory {
  private done: FileAction[] = [];
  private undone: FileAction[] = [];
  // Undo and redo run one at a time, even if the shortcut is pressed quickly.
  private queue: Promise<unknown> = Promise.resolve();

  /** Something new was done: it can be undone, and what was undone before can't be redone. */
  record(action: FileAction) {
    this.done.push(action);
    this.undone = [];
  }

  /** Undoes the latest action and returns it (or nothing if there's nothing to undo). */
  undo() {
    return this.step(this.done, this.undone, "undo");
  }

  redo() {
    return this.step(this.undone, this.done, "redo");
  }

  private step(from: FileAction[], to: FileAction[], kind: "undo" | "redo") {
    const result = this.queue.then(async () => {
      const action = from.pop();
      if (!action) return undefined;
      // If it fails (e.g. the new note has text now), it's dropped: trying again won't help.
      await action[kind]();
      to.push(action);
      return action;
    });
    this.queue = result.catch(() => {});
    return result;
  }
}

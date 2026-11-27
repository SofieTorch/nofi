// Naming a Zotero paper's source note, the first time a note is added on the paper (see
// tests/zotero-notes.test.tsx). The name is a path from the top of the workspace, without `.typ`:
// folders in it are made if they're missing. A name that's a note already isn't written into
// straight away: that note can be used as the paper's note instead.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** A note's path for a name typed (`Papers/gpt3` → `Papers/gpt3.typ`), or null if it can't be one. */
export function notePathFor(name: string): string | null {
  const parts = name
    .trim()
    .replace(/\.typ$/i, "")
    .split("/")
    .map((part) => part.trim());
  // (No empty parts, nothing hidden, and nothing going up out of the workspace.)
  if (parts.some((part) => part === "" || part.startsWith("."))) return null;
  return `${parts.join("/")}.typ`;
}

/** The name first suggested for a paper's note: its title, without characters a file name can't have. */
export const suggestedName = (title: string) =>
  `${title.replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, " ").trim() || "Paper"} notes`;

export function NoteNameDialog({
  suggested,
  taken,
  onCreate,
  onUse,
  onCancel,
}: {
  suggested: string;
  /** Whether a note is already at a path. */
  taken: (path: string) => Promise<boolean>;
  onCreate: (path: string) => void;
  /** Uses the note that's at a path as the paper's note. */
  onUse: (path: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(suggested);
  const [problem, setProblem] = useState<string>();
  /** The note that's there at the name typed (offered to use instead). */
  const [existing, setExisting] = useState<string>();
  const field = useRef<HTMLInputElement>(null);
  const path = notePathFor(name);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, []);

  async function create() {
    if (!path) return;
    if (await taken(path)) {
      setExisting(path);
      return setProblem(`There's already a note called “${path.replace(/\.typ$/, "")}”.`);
    }
    onCreate(path);
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-[20vh]" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form
        role="dialog"
        aria-label="Name the paper's note"
        className="w-96 rounded-lg bg-white p-3 text-sm shadow-[0_4px_24px_rgba(0,0,0,0.16)] ring-1 ring-neutral-200"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
        onKeyDown={(event) => event.key === "Escape" && onCancel()}
      >
        <label className="block text-[11px] tracking-wide text-neutral-400 uppercase" htmlFor="paper-note-name">
          Name
        </label>
        <input
          id="paper-note-name"
          ref={field}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setProblem(undefined);
            setExisting(undefined);
          }}
          className="mt-1 w-full rounded-md px-2 py-1 ring-1 ring-neutral-300 outline-none focus:ring-neutral-500"
        />
        <p className="mt-1.5 text-xs text-neutral-500">
          {problem ?? "At the top of the workspace. Use / to put it in folders, made if they're missing."}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1 text-neutral-600 hover:bg-neutral-100">
            Cancel
          </button>
          {existing ? (
            <button type="button" onClick={() => onUse(existing)} className="rounded-md bg-neutral-800 px-3 py-1 text-white">
              Use it as the paper's note
            </button>
          ) : (
            <button type="submit" disabled={!path} className="rounded-md bg-neutral-800 px-3 py-1 text-white disabled:opacity-40">
              Create
            </button>
          )}
        </div>
      </form>
    </div>,
    document.body,
  );
}

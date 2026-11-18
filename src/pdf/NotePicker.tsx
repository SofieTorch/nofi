// Where a new note about a part of a PDF goes (see tests/pdf-annotations.test.tsx): the PDF's
// source notes first, then the notes citing it, or any note found by name, or a new source note.
// The first is chosen to start with: Enter takes it; Escape leaves without adding anything.

import { useEffect, useRef, useState } from "react";
import { fuzzyScore } from "../ui/fuzzy";

/** A note to put it in (its path), or a new source note. */
export type Choice = { note: string } | { newNote: true };

type Option = { label: string; detail?: string; choice: Choice };

const nameOf = (path: string) => path.split("/").pop()!;
const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");

export function NotePicker({
  at,
  sources,
  citing,
  notes,
  onPick,
  onClose,
}: {
  /** Where it opens (in the scrolled pages). */
  at: { x: number; y: number };
  /** The PDF's source notes, and the other notes citing it. */
  sources: string[];
  citing: string[];
  /** Every note in the workspace (to find one by name). */
  notes: string[];
  onPick: (choice: Choice) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const known = [...sources, ...citing.filter((n) => !sources.includes(n))];
  const option = (note: string): Option => ({
    label: nameOf(note),
    detail: sources.includes(note) ? "source" : citing.includes(note) ? "cites it" : folderOf(note) || undefined,
    choice: { note },
  });
  const found = query.trim()
    ? [
        ...known.filter((note) => fuzzyScore(nameOf(note), query) !== null),
        ...notes
          .filter((note) => !known.includes(note))
          .map((note) => ({ note, score: fuzzyScore(nameOf(note), query) }))
          .filter((n): n is { note: string; score: number } => n.score !== null)
          .sort((a, b) => a.score - b.score)
          .slice(0, 20)
          .map((n) => n.note),
      ]
    : known;
  const options: Option[] = [...found.map(option), { label: "New note", detail: "for this PDF", choice: { newNote: true } }];
  const chosen = Math.min(active, options.length - 1);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [chosen]);

  return (
    <div
      role="dialog"
      aria-label="Add the note to"
      data-selection-actions
      onMouseDown={(event) => event.stopPropagation()}
      className="absolute z-20 w-72 overflow-hidden rounded-lg bg-white text-sm shadow-[0_4px_24px_rgba(0,0,0,0.16)] ring-1 ring-neutral-200"
      style={{ left: at.x, top: at.y }}
    >
      <p className="px-3 pt-2 text-[11px] tracking-wide text-neutral-400 uppercase">Add the note to</p>
      <input
        autoFocus
        aria-label="Find a note"
        placeholder="Find a note…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((chosen + 1) % options.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((chosen - 1 + options.length) % options.length);
          } else if (event.key === "Enter") {
            event.preventDefault();
            onPick(options[chosen].choice);
          } else if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          }
        }}
        onBlur={(event) => {
          // (Clicking elsewhere closes it; clicking in it doesn't.)
          if (!event.currentTarget.closest('[role="dialog"]')?.contains(event.relatedTarget as Node)) onClose();
        }}
        className="w-full border-b border-neutral-100 px-3 py-2 outline-none placeholder:text-neutral-400"
      />
      <ul ref={list} role="listbox" aria-label="Notes" className="max-h-64 overflow-y-auto p-1">
        {options.map((o, i) => (
          <li
            key={"note" in o.choice ? o.choice.note : "new"}
            role="option"
            aria-label={o.label}
            aria-selected={i === chosen}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(o.choice)}
            className={`flex cursor-default items-baseline gap-2 rounded-md px-2 py-1.5 ${i === chosen ? "bg-neutral-100" : ""} ${
              "newNote" in o.choice ? "mt-1 border-t border-neutral-100 text-sky-700" : "text-neutral-800"
            }`}
          >
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.detail && <span className="shrink-0 truncate text-[11px] text-neutral-400">{o.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

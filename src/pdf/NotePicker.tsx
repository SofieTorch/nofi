// Where a new note about a part of a PDF goes (see tests/pdf-annotations.test.tsx): the PDF's
// source notes first, then the notes citing it, or any note found by name, or a new source note.
// The first is chosen to start with: Enter takes it; Escape leaves without adding anything.
// It also chooses what words in a PDF link to (see tests/pdf-links.test.tsx): any note found by
// name (the words typed in to start with), a PDF (the workspace's, or a Zotero paper) found by its
// name, title, authors or year, or by a whole reference to it, or a new note named after what's typed.

import { useEffect, useRef, useState } from "react";
import { fuzzyScore } from "../ui/fuzzy";

/** A note chosen, a file (a PDF: its path, and its title if it has one), or a new note (at a path, if one was chosen for it). */
export type Choice = { note: string } | { file: string; title?: string } | { newNote: true; at?: string };

/** A file that can be chosen: what it's called, what's shown beside, and its words to find it by. */
export type FileOption = { path: string; label: string; detail?: string; title?: string; words: string; authors?: string[]; year?: number | null };

/**
 * A text's words, lower case, as plain letters: a PDF's joined letters (ligatures, "ﬁ") are the
 * letters, and accents are left out ("é" is "e"), so they're found however they're written.
 */
const wordsOf = (text: string): string[] =>
  text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * How well a file matches what's typed (lower is better), or null if it doesn't: every word typed
 * is in its name, title, authors or year; or, when a whole reference is typed (or selected), most
 * of its title's words are in it, in its order (4 in 5), or many of them (3 in 5) with its first author's name
 * and its year (and more of them, and its authors and year, match it better).
 */
export function fileScore(file: FileOption, query: string): number | null {
  const typed = wordsOf(query);
  if (!typed.length) return null;
  const own = wordsOf(file.words);
  if (typed.every((word) => own.some((w) => w.startsWith(word)))) return 0;
  const said = new Set(typed);
  const all = wordsOf(file.title ?? file.label);
  const titleWords = all.filter((w) => w.length > 2);
  if (titleWords.length < 2) return null;
  // How many of the title's words are in it in the title's order (a paper sharing words with
  // another's title, in another order, isn't the one cited). A word written together with the
  // next, as a hyphenated word broken over two lines is ("few-shot" as "fewshot"), is both.
  const written = typed.flatMap((word) => {
    const at = all.findIndex((w, i) => i + 1 < all.length && w + all[i + 1] === word);
    return at >= 0 ? [all[at], all[at + 1]] : [word];
  });
  const inOrder = Array.from({ length: all.length + 1 }, () => new Array<number>(written.length + 1).fill(0));
  for (let i = all.length - 1; i >= 0; i--) {
    for (let j = written.length - 1; j >= 0; j--) {
      inOrder[i][j] =
        all[i] === written[j] ? inOrder[i + 1][j + 1] + (all[i].length > 2 ? 1 : 0) : Math.max(inOrder[i + 1][j], inOrder[i][j + 1]);
    }
  }
  const share = inOrder[0][0] / titleWords.length;
  const firstAuthor = wordsOf(file.authors?.[0] ?? "");
  const byAuthorAndYear = !!firstAuthor.length && firstAuthor.every((w) => said.has(w)) && !!file.year && said.has(String(file.year));
  if (share < 0.8 && !(share >= 0.6 && byAuthorAndYear)) return null;
  const others = own.filter((w) => !all.includes(w) && w.length > 2 && said.has(w)).length;
  return 1 + (1 - share) - others * 0.01;
}

type Option = { label: string; detail?: string; choice: Choice };

const nameOf = (path: string) => path.split("/").pop()!;
const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");

export function NotePicker({
  at,
  sources,
  citing,
  notes,
  files = [],
  onPick,
  onClose,
  title = "Add the note to",
  startWith = "",
  newNote = () => ({ label: "New note", detail: "for this PDF" }),
}: {
  /** Where it opens (in the scrolled pages). */
  at: { x: number; y: number };
  /** The PDF's source notes, and the other notes citing it. */
  sources: string[];
  citing: string[];
  /** Every note in the workspace (to find one by name). */
  notes: string[];
  /** Files that can be chosen too, found by what's typed (none while nothing is). */
  files?: FileOption[];
  /** Called with the choice, and what was typed. */
  onPick: (choice: Choice, query: string) => void;
  onClose: () => void;
  /** What it's asked for (its heading, and the dialog's name). */
  title?: string;
  /** Typed in to start with. */
  startWith?: string;
  /** The new note offered last, for what's typed (none if null). */
  newNote?: (query: string) => { label: string; detail?: string } | null;
}) {
  const [query, setQuery] = useState(startWith);
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
  const foundFiles = query.trim()
    ? files
        .map((file) => ({ file, score: fileScore(file, query) }))
        .filter((f): f is { file: FileOption; score: number } => f.score !== null)
        .sort((a, b) => a.score - b.score)
        .slice(0, 20)
        .map(({ file }): Option => ({ label: file.label, detail: file.detail, choice: { file: file.path, ...(file.title && { title: file.title }) } }))
    : [];
  const offered = newNote(query);
  const options: Option[] = [
    ...found.map(option),
    ...foundFiles,
    ...(offered ? [{ ...offered, choice: { newNote: true } as Choice }] : []),
  ];
  const chosen = Math.min(active, options.length - 1);

  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [chosen]);

  return (
    <div
      role="dialog"
      aria-label={title}
      data-selection-actions
      onMouseDown={(event) => event.stopPropagation()}
      className="absolute z-20 w-72 overflow-hidden rounded-lg bg-white text-sm shadow-[0_4px_24px_rgba(0,0,0,0.16)] ring-1 ring-neutral-200"
      style={{ left: at.x, top: at.y }}
    >
      <p className="px-3 pt-2 text-[11px] tracking-wide text-neutral-400 uppercase">{title}</p>
      <input
        autoFocus
        onFocus={(event) => event.currentTarget.select()}
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
            if (options.length) onPick(options[chosen].choice, query);
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
            key={"note" in o.choice ? o.choice.note : "file" in o.choice ? o.choice.file : "new"}
            role="option"
            aria-label={o.label}
            aria-selected={i === chosen}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(o.choice, query)}
            className={`flex cursor-default items-baseline gap-2 rounded-md px-2 py-1.5 ${i === chosen ? "bg-neutral-100" : ""} ${
              "newNote" in o.choice ? "mt-1 border-t border-neutral-100 text-sky-700" : "text-neutral-800"
            }`}
          >
            {"file" in o.choice ? (
              // (A paper: its title, on two lines if it's long, and who wrote it and when below.)
              <span className="min-w-0 flex-1" title={o.label}>
                <span className="line-clamp-2 leading-snug">{o.label}</span>
                {o.detail && <span className="block truncate text-[11px] text-neutral-400">{o.detail}</span>}
              </span>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.detail && <span className="shrink-0 truncate text-[11px] text-neutral-400">{o.detail}</span>}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

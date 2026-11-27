// The sidebar's search (⌘⇧F): a text to find in every note and PDF, and what's found, by file.
// Clicking a match opens it there, with that match found (see tests/find.test.tsx).

import { mdiClose, mdiFileDocumentOutline, mdiFilePdfBox } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "../api";
import { IconButton } from "../ui/IconButton";
import { type FileMatches, type Match, searchWorkspace } from "./searchWorkspace";

type Props = {
  files: FileEntry[] | null;
  /** Counts the times it was asked for (⌘⇧F): its field gets the focus each time. */
  focusSignal: number;
  /** Opens a match: a note's nth match, or a PDF's nth match on a page. */
  onOpen: (path: string, query: string, match: Match, newPane: boolean) => void;
  onClose: () => void;
};

const allFiles = (entries: FileEntry[]): string[] =>
  entries.flatMap((entry) => (entry.kind === "folder" ? allFiles(entry.children) : [entry.path]));

/** What was searched last, kept while the app is open (closing and opening the search keeps it). */
let lastQuery = "";

export function SearchPanel({ files, focusSignal, onOpen, onClose }: Props) {
  const [query, setQuery] = useState(lastQuery);
  const [results, setResults] = useState<FileMatches[]>([]);
  const [searching, setSearching] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    field.current?.focus();
    field.current?.select();
  }, [focusSignal]);

  useEffect(() => {
    lastQuery = query;
    setResults([]);
    if (!query.trim() || !files) {
      setSearching(false);
      return;
    }
    let stopped = false;
    setSearching(true);
    // (A moment after typing stops, so each letter isn't a search of its own.)
    const timer = setTimeout(() => {
      const found: FileMatches[] = [];
      searchWorkspace(
        allFiles(files),
        query,
        (file) => {
          found.push(file);
          setResults([...found]);
        },
        () => stopped,
      ).finally(() => !stopped && setSearching(false));
    }, 200);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [query, files]);

  const count = results.reduce((sum, file) => sum + file.matches.length, 0);
  const status = !query.trim()
    ? ""
    : searching
      ? "Searching…"
      : count === 0
        ? "No results"
        : `${count} ${count === 1 ? "result" : "results"} in ${results.length} ${results.length === 1 ? "file" : "files"}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center py-1 pr-1.5 pl-3">
        <h2 className="flex-1 text-[11px] font-semibold tracking-wide text-neutral-500 uppercase">Search</h2>
        <IconButton icon={mdiClose} label="Close search" onClick={onClose} />
      </div>
      <div className="shrink-0 px-2 pb-1.5">
        <input
          ref={field}
          type="search"
          aria-label="Search the workspace"
          placeholder="Search notes and PDFs"
          value={query}
          spellCheck={false}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
          }}
          className="h-7 w-full rounded border border-neutral-200 bg-white px-2 text-sm text-neutral-800 outline-none focus:border-sky-400"
        />
      </div>
      <section aria-label="Search results" className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        <p aria-live="polite" className="h-4 px-1.5 pb-1 text-[11px] text-neutral-400">
          {status}
        </p>
        {results.map((file) => {
          const name = file.path.split("/").pop()!;
          const folder = file.path.slice(0, -name.length - 1);
          return (
            <div key={file.path} role="group" aria-label={name} className="mb-1">
              <div className="flex items-center gap-1.5 px-1.5 py-0.5 text-[13px] text-neutral-700" title={file.path}>
                <Icon path={file.kind === "pdf" ? mdiFilePdfBox : mdiFileDocumentOutline} size={0.6} className="shrink-0 text-neutral-400" />
                <span className="truncate font-medium">{name}</span>
                {folder && <span className="truncate text-[11px] text-neutral-400">{folder}</span>}
                <span className="ml-auto shrink-0 rounded-full bg-neutral-100 px-1.5 text-[10px] text-neutral-500 tabular-nums">{file.matches.length}</span>
              </div>
              {file.matches.map((match) => (
                <button
                  key={`${match.page ?? 0}-${match.nth}`}
                  type="button"
                  onClick={(event) => onOpen(file.path, query, match, event.metaKey || event.ctrlKey)}
                  className="block w-full truncate rounded py-0.5 pr-1.5 pl-6 text-left text-xs text-neutral-500 hover:bg-neutral-100"
                >
                  {match.page !== undefined && <span className="mr-1.5 text-neutral-400">{`p. ${match.page} `}</span>}
                  {match.before}
                  <mark className="rounded-[2px] bg-yellow-200 text-neutral-800">{match.text}</mark>
                  {match.after}
                </button>
              ))}
            </div>
          );
        })}
      </section>
    </div>
  );
}

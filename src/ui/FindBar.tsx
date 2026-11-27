// The find bar of notes and PDFs (see tests/find.test.tsx): what to find, which match you're on
// out of how many, previous and next, and in a note, what to replace it with.

import { mdiArrowDown, mdiArrowUp, mdiChevronDown, mdiChevronRight, mdiClose } from "@mdi/js";
import { useEffect, useRef } from "react";
import { IconButton } from "./IconButton";

type Props = {
  query: string;
  onQuery: (query: string) => void;
  /** How many matches there are, and which one is current (from 0), if any; null while finding. */
  count: number | null;
  current: number | null;
  onNext: () => void;
  onPrevious: () => void;
  /** Closes it (Esc). */
  onClose: () => void;
  /** Counts the times it was asked to be ready (⌘F again): its field gets the focus, selected. */
  focusSignal?: number;
  /** In a note: replacing. */
  replace?: {
    shown: boolean;
    onShown: (shown: boolean) => void;
    value: string;
    onValue: (value: string) => void;
    onReplace: () => void;
    onReplaceAll: () => void;
  };
};

export function FindBar({ query, onQuery, count, current, onNext, onPrevious, onClose, focusSignal = 0, replace }: Props) {
  const field = useRef<HTMLInputElement>(null);
  const replaceField = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // (Ready to replace: there, once there's something to find.)
    const into = replace?.shown && query ? replaceField.current : field.current;
    into?.focus();
    into?.select();
  }, [focusSignal]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = !query ? "" : count === null ? "…" : count === 0 ? "No results" : `${(current ?? 0) + 1} of ${count}`;
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };
  const fieldClass = "h-6 min-w-0 flex-1 rounded border border-neutral-200 bg-white px-1.5 text-xs text-neutral-800 outline-none focus:border-sky-400";

  return (
    <div
      role="search"
      aria-label="Find"
      onKeyDown={keys}
      // (Its own keys and clicks: not the note's or the pages'.)
      onMouseDown={(event) => event.stopPropagation()}
      style={{ pointerEvents: "auto" }}
      className="flex w-80 max-w-[calc(100%-1rem)] gap-1 rounded-md border border-neutral-200 bg-white/95 p-1 text-xs text-neutral-500 shadow-[0_4px_16px_rgba(0,0,0,0.1)] backdrop-blur"
    >
      {replace && (
        <IconButton
          icon={replace.shown ? mdiChevronDown : mdiChevronRight}
          label={replace.shown ? "Hide replace" : "Show replace"}
          onClick={() => replace.onShown(!replace.shown)}
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          <input
            ref={field}
            type="search"
            aria-label="Find"
            placeholder="Find"
            value={query}
            spellCheck={false}
            onChange={(event) => onQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (event.shiftKey) onPrevious();
              else onNext();
            }}
            className={fieldClass}
          />
          <span aria-live="polite" className="w-16 shrink-0 text-center tabular-nums">
            {status}
          </span>
          <IconButton icon={mdiArrowUp} label="Previous match" onClick={onPrevious} />
          <IconButton icon={mdiArrowDown} label="Next match" onClick={onNext} />
          <IconButton icon={mdiClose} label="Close find" onClick={onClose} />
        </div>
        {replace?.shown && (
          <div className="flex items-center gap-1">
            <input
              ref={replaceField}
              aria-label="Replace"
              placeholder="Replace"
              value={replace.value}
              spellCheck={false}
              onChange={(event) => replace.onValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (event.metaKey || event.ctrlKey) replace.onReplaceAll();
                else replace.onReplace();
              }}
              className={fieldClass}
            />
            <button type="button" onClick={replace.onReplace} className="h-6 rounded px-1.5 hover:bg-neutral-100 hover:text-neutral-800">
              Replace
            </button>
            <button type="button" onClick={replace.onReplaceAll} className="h-6 rounded px-1.5 hover:bg-neutral-100 hover:text-neutral-800">
              Replace all
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Characters found as each other in a PDF: quotes, and dashes (a dash also as a space). */
const LOOSE: Record<string, string> = {
  '"': "[\"“”„«»]",
  "“": "[\"“”„«»]",
  "”": "[\"“”„«»]",
  "'": "['‘’‚]",
  "‘": "['‘’‚]",
  "’": "['‘’‚]",
  "-": "[-‐‑‒–—\\s]",
  "–": "[-‐‑‒–—\\s]",
  "—": "[-‐‑‒–—\\s]",
};
/** What may come between two letters of a word in a PDF: a line's end, or a hyphen breaking it there. */
const BREAK = "(?:-?\\s|\u00ad)?";

/**
 * Where a text is in some text, every time (from, to), ignoring case; spaces in it match any run of
 * them. `loose`, for a PDF's text: a word broken over two lines (or split where pdf.js split it) is
 * found, and quotes and dashes are found as each other.
 */
export function matchesIn(text: string, query: string, loose = false): { from: number; to: number }[] {
  const wanted = query.trim();
  if (!wanted) return [];
  const words = wanted.split(/\s+/);
  const word = (w: string) => (loose ? [...w].map((c) => LOOSE[c] ?? escape(c)).join(BREAK) : escape(w));
  const pattern = new RegExp(words.map(word).join("\\s+"), "giu");
  return [...text.matchAll(pattern)].filter((m) => m[0]).map((match) => ({ from: match.index, to: match.index + match[0].length }));
}

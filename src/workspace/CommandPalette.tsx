import { mdiConsoleLine, mdiFileDocumentEditOutline, mdiFileDocumentOutline, mdiTextSearchVariant } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry, TextMatch } from "../api";
import { noteFormat } from "../editor/formatting";
import { fuzzyScore as score } from "../ui/fuzzy";

export type Command = { label: string; run: () => void };

type Props = {
  /** What's typed at first: "" to look for notes, ">" for commands. */
  initial: string;
  files: FileEntry[];
  commands: Command[];
  onOpenFile: (path: string) => void;
  /** Looks for text inside the notes. */
  searchText: (query: string) => Promise<TextMatch[]>;
  /** Opens a note with a match selected. */
  onOpenMatch: (match: TextMatch) => void;
  onClose: () => void;
};

type Item = {
  key: string;
  label: ReactNode;
  detail?: string;
  icon: string;
  choose: () => void;
  /** A heading shown above it, starting a group. */
  heading?: string;
};

/** Text inside notes is looked for from this many characters typed. */
const SEARCH_FROM = 2;

/** A line with the words found highlighted. */
function Preview({ match }: { match: TextMatch }) {
  // (Its column counts characters; the length counts like the editor, as JavaScript strings do.)
  const at = Array.from(match.preview).slice(0, match.previewColumn).join("").length;
  return (
    <>
      {match.preview.slice(0, at)}
      <mark className="rounded-sm bg-yellow-100 text-inherit">{match.preview.slice(at, at + match.length)}</mark>
      {match.preview.slice(at + match.length)}
    </>
  );
}

/** Every note in the workspace (only notes can be opened). */
function notesIn(entries: FileEntry[]): FileEntry[] {
  return entries.flatMap((entry) => (entry.kind === "folder" ? notesIn(entry.children) : noteFormat(entry.path) ? [entry] : []));
}

/**
 * One panel to find things, like VS Code's: notes by name, or, starting with ">", commands.
 * Typing or deleting the ">" switches between the two.
 */
export function CommandPalette({ initial, files, commands, onOpenFile, searchText, onOpenMatch, onClose }: Props) {
  const [query, setQuery] = useState(initial);
  /** Lines inside notes with what's typed (only when looking for notes). */
  const [found, setFound] = useState<TextMatch[]>([]);
  const [selected, setSelected] = useState(0);
  const card = useRef<HTMLDivElement>(null);
  const forCommands = query.startsWith(">");

  const items = useMemo<Item[]>(() => {
    const done = (action: () => void) => () => {
      onClose();
      action();
    };
    if (forCommands) {
      const words = query.slice(1).toLowerCase().split(/\s+/).filter(Boolean);
      return commands
        .filter((command) => words.every((word) => command.label.toLowerCase().includes(word)))
        .map((command) => ({ key: command.label, label: command.label, icon: mdiConsoleLine, choose: done(command.run) }));
    }
    const named: Item[] = notesIn(files)
      // By name first; by its folder too (like "papers/att"), after those.
      .map((note) => {
        const byName = score(note.name, query);
        const byPath = score(note.path, query);
        return { note, score: byName ?? (byPath === null ? null : 1000 + byPath) };
      })
      .filter((match): match is { note: FileEntry; score: number } => match.score !== null)
      .sort((a, b) => a.score - b.score || a.note.name.localeCompare(b.note.name))
      .map(({ note }) => {
        const folder = note.path.includes("/") ? note.path.slice(0, note.path.lastIndexOf("/")) : undefined;
        return {
          key: note.path,
          label: note.name,
          detail: folder,
          icon: noteFormat(note.path) === "typst" ? mdiFileDocumentEditOutline : mdiFileDocumentOutline,
          choose: done(() => onOpenFile(note.path)),
        };
      });
    const inside: Item[] = found.map((match, i) => ({
      key: `${match.path}:${match.line}`,
      label: <Preview match={match} />,
      detail: match.path.split("/").pop(),
      icon: mdiTextSearchVariant,
      choose: done(() => onOpenMatch(match)),
      heading: i === 0 ? "In notes" : undefined,
    }));
    return [...named, ...inside];
  }, [query, forCommands, files, commands, found, onOpenFile, onOpenMatch, onClose]);

  useEffect(() => setSelected(0), [query]);

  // Looks inside the notes a moment after typing stops.
  useEffect(() => {
    const typed = query.trim();
    if (forCommands || typed.length < SEARCH_FROM) {
      setFound([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      searchText(typed).then(
        (matches) => current && setFound(matches),
        () => current && setFound([]),
      );
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, forCommands, searchText]);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (!card.current?.contains(event.target as Node)) onClose();
    }
    window.addEventListener("mousedown", onMouseDown, true);
    return () => window.removeEventListener("mousedown", onMouseDown, true);
  }, [onClose]);

  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center pt-[12vh]">
      <div
        ref={card}
        role="dialog"
        aria-label="Go to file or command"
        className="pointer-events-auto w-[34rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-white shadow-[0_4px_24px_rgba(0,0,0,0.14)]"
      >
        <input
          autoFocus
          role="combobox"
          aria-label="Search files, or > for commands"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[selected] ? `palette-${selected}` : undefined}
          value={query}
          spellCheck={false}
          placeholder="Search notes by name, or type > for commands"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            else if (event.key === "Enter") items[selected]?.choose();
            else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setSelected((at) => (items.length ? (at + step + items.length) % items.length : 0));
            } else return;
            event.stopPropagation();
          }}
          className="w-full border-b border-neutral-100 px-4 py-3 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
        />
        <ul id="palette-list" role="listbox" aria-label={forCommands ? "Commands" : "Notes"} className="max-h-80 overflow-y-auto p-1.5">
          {items.map((item, i) => [
            item.heading && (
              <li key={`${item.key}-heading`} role="presentation" className="px-2.5 pt-2 pb-1 text-xs font-medium text-neutral-400">
                {item.heading}
              </li>
            ),
            <li
              key={item.key}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === selected}
              onMouseMove={() => setSelected(i)}
              onClick={item.choose}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm ${
                i === selected ? "bg-neutral-100 text-neutral-900" : "text-neutral-700"
              }`}
            >
              <Icon path={item.icon} size="16px" className="shrink-0 text-neutral-400" />
              <span className="truncate">{item.label}</span>
              {item.detail && <span className="ml-auto shrink-0 truncate text-xs text-neutral-400">{item.detail}</span>}
            </li>,
          ])}
          {items.length === 0 && (
            <li className="px-2.5 py-1.5 text-sm text-neutral-400">{forCommands ? "No commands match." : "No notes match."}</li>
          )}
        </ul>
      </div>
    </div>
  );
}

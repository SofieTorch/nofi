import {
  mdiChevronRight,
  mdiFileDocumentEditOutline,
  mdiFileDocumentOutline,
  mdiFileImageOutline,
  mdiFileOutline,
  mdiFilePdfBox,
  mdiFileTableOutline,
  mdiFolderOpenOutline,
  mdiFolderOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "../api";

/** A note whose name is being typed, e.g. right after it was created. */
export type Renaming = {
  path: string;
  /** Rejects with a readable reason if the name can't be used. */
  onRename: (newName: string) => Promise<void>;
  onCancel: () => void;
};

type Props = {
  entries: FileEntry[];
  /** A file to highlight, e.g. the note that was just created. */
  highlightedPath?: string;
  renaming?: Renaming;
  depth?: number;
};

export function FileTree({ entries, highlightedPath, renaming, depth = 0 }: Props) {
  return (
    <ul className="flex flex-col">
      {entries.map((entry) =>
        entry.kind === "folder" ? (
          <FolderItem
            key={entry.path}
            folder={entry}
            highlightedPath={highlightedPath}
            renaming={renaming}
            depth={depth}
          />
        ) : (
          <li
            key={entry.path}
            aria-current={entry.path === highlightedPath ? "true" : undefined}
            className={`${row} relative ${entry.path === highlightedPath ? "bg-neutral-100" : ""}`}
            style={{ paddingLeft: indent(depth) }}
          >
            <span className="size-3.5 shrink-0" />
            <Icon path={fileIcon(entry.name)} size="16px" className="shrink-0 text-neutral-400" />
            {renaming?.path === entry.path ? (
              <NameField fileName={entry.name} renaming={renaming} />
            ) : (
              <span className="truncate">{entry.name}</span>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

function FolderItem({
  folder,
  highlightedPath,
  renaming,
  depth,
}: {
  folder: FileEntry;
  highlightedPath?: string;
  renaming?: Renaming;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li>
      <button
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        className={`${row} w-full text-left hover:bg-neutral-100`}
        style={{ paddingLeft: indent(depth) }}
      >
        <Icon
          path={mdiChevronRight}
          size="14px"
          className={`shrink-0 text-neutral-400 transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Icon
          path={expanded ? mdiFolderOpenOutline : mdiFolderOutline}
          size="16px"
          className="shrink-0 text-neutral-500"
        />
        <span className="truncate">{folder.name}</span>
      </button>
      {expanded && (
        <FileTree
          entries={folder.children}
          highlightedPath={highlightedPath}
          renaming={renaming}
          depth={depth + 1}
        />
      )}
    </li>
  );
}

/**
 * The note's name, ready to type over: Enter or clicking elsewhere saves it, Escape keeps the
 * old one. The extension is shown after the field but isn't part of it, so the format can't change.
 */
function NameField({ fileName, renaming }: { fileName: string; renaming: Renaming }) {
  const dot = fileName.lastIndexOf(".");
  const name = dot > 0 ? fileName.slice(0, dot) : fileName;
  const extension = dot > 0 ? fileName.slice(dot) : "";
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  // Set while saving or after Escape, so the blur that follows doesn't save (again).
  const done = useRef(false);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  async function save() {
    if (done.current) return;
    if (value.trim() === name) return renaming.onCancel();
    done.current = true;
    try {
      await renaming.onRename(value);
    } catch (reason) {
      done.current = false;
      setError(String(reason));
    }
  }

  return (
    <>
      <span className="flex min-w-0 flex-1 items-center">
        <input
          ref={input}
          aria-label="Note name"
          aria-invalid={error ? true : undefined}
          value={value}
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value);
            setError(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") save();
            if (event.key === "Escape") {
              done.current = true;
              renaming.onCancel();
            }
          }}
          onBlur={save}
          className={`min-w-0 flex-1 rounded-sm bg-white px-1 outline-none ring-1 ${
            error ? "ring-red-400" : "ring-neutral-300 focus:ring-neutral-400"
          }`}
        />
        <span className="shrink-0 pl-1 text-neutral-400">{extension}</span>
      </span>
      {error && (
        <p
          role="alert"
          className="absolute top-full right-2 left-6 z-20 mt-1 rounded-md bg-white px-2 py-1 text-xs text-red-600 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
        >
          {error}
        </p>
      )}
    </>
  );
}

const row = "flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-neutral-700";

const indent = (depth: number) => `${0.25 + depth * 0.875}rem`;

function fileIcon(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "typ":
      return mdiFileDocumentEditOutline;
    case "md":
    case "txt":
      return mdiFileDocumentOutline;
    case "pdf":
      return mdiFilePdfBox;
    case "csv":
    case "tsv":
    case "xlsx":
      return mdiFileTableOutline;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return mdiFileImageOutline;
    default:
      return mdiFileOutline;
  }
}

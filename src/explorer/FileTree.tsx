import {
  mdiChevronRight,
  mdiFileDocumentEditOutline,
  mdiFileDocumentOutline,
  mdiFileImageOutline,
  mdiFileOutline,
  mdiFilePdfBox,
  mdiDraw,
  mdiFileTableOutline,
  mdiFolderOpenOutline,
  mdiFolderOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import type { FileEntry } from "../api";
import { noteFormat } from "../editor/formatting";
import { startDraggingNote, stopDragging } from "../workspace/Panes";

/** A note (or folder) whose name is being typed, e.g. right after it was created. */
export type Renaming = {
  path: string;
  /** Rejects with a readable reason if the name can't be used. */
  onRename: (newName: string) => Promise<void>;
  onCancel: () => void;
};

/** What's dragged from the explorer, in the drag's data. */
export const DRAGGED_PATH = "application/x-marginalia-path";

type Props = {
  entries: FileEntry[];
  /** A file to highlight, e.g. the note that was just created. */
  highlightedPath?: string;
  /** The row clicked last (a folder or a file): where new notes and folders go. */
  selected?: string | null;
  /** The open folders' paths. */
  openFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onSelect?: (path: string) => void;
  renaming?: Renaming;
  /** Opens a file; `newPane` with ⌘ (Ctrl elsewhere) held, beside the active pane. */
  onOpen?: (path: string, newPane: boolean) => void;
  /** Notes known to have mistakes: they get a red dot. */
  withMistakes?: ReadonlySet<string>;
  /** Double-clicking a file's name: to type a new one. */
  onStartRenaming?: (path: string) => void;
  /** Right-clicking a file or folder: its menu, at the mouse. */
  onFileMenu?: (path: string, at: { x: number; y: number }, folder: boolean) => void;
  /** The folder something dragged would go in ("" for the top), outlined. */
  dropTarget?: string | null;
  /** Something dragged is over a row: the folder it would go in. */
  onDragInto?: (event: React.DragEvent, folder: string) => void;
  onDropInto?: (event: React.DragEvent, folder: string) => void;
  depth?: number;
};

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** The file or folder being dragged from the explorer, if one is. */
let dragged: string | null = null;
export const draggedPath = () => dragged;

/** Starts dragging a row: a file to a pane (it opens there), or either to a folder (it moves there). */
function startDragging(event: React.DragEvent, path: string, folder = false) {
  dragged = path;
  if (!folder) startDraggingNote(path);
  event.dataTransfer?.setData("text/plain", path);
  event.dataTransfer?.setData(DRAGGED_PATH, path);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove";
}

function endDragging() {
  dragged = null;
  stopDragging();
}

/** A row's drop handlers: dropped on it, something goes in the folder it is (or is in). */
function dropOn(props: Props, folder: string) {
  return {
    onDragEnter: (event: React.DragEvent) => props.onDragInto?.(event, folder),
    onDragOver: (event: React.DragEvent) => props.onDragInto?.(event, folder),
    onDrop: (event: React.DragEvent) => props.onDropInto?.(event, folder),
  };
}

export function FileTree(props: Props) {
  const { entries, highlightedPath, selected, renaming, onOpen, onSelect, withMistakes, onStartRenaming, onFileMenu, depth = 0 } = props;
  return (
    <ul className="flex flex-col">
      {entries.map((entry) =>
        entry.kind === "folder" ? (
          <FolderItem key={entry.path} folder={entry} {...props} depth={depth} />
        ) : (
          <li
            key={entry.path}
            onDoubleClick={() => renaming?.path !== entry.path && onStartRenaming?.(entry.path)}
            onContextMenu={(event) => {
              if (!onFileMenu) return;
              event.preventDefault();
              event.stopPropagation();
              onSelect?.(entry.path);
              onFileMenu(entry.path, { x: event.clientX, y: event.clientY }, false);
            }}
            {...dropOn(props, parentOf(entry.path))}
            aria-current={entry.path === highlightedPath ? "true" : undefined}
            className={`relative rounded-md ${entry.path === highlightedPath ? "bg-neutral-100" : ""} ${
              entry.path === selected && entry.path !== highlightedPath ? "bg-neutral-50 ring-1 ring-neutral-200 ring-inset" : ""
            }`}
          >
            {renaming?.path === entry.path ? (
              <div className={row} style={{ paddingLeft: indent(depth) }}>
                <FileLabel name={entry.name} />
                <NameField fileName={entry.name} renaming={renaming} folder={false} />
              </div>
            ) : (
              <button
                data-path={entry.path}
                data-kind="file"
                onClick={(event) => {
                  onSelect?.(entry.path);
                  if (opens(entry.path)) onOpen?.(entry.path, event.metaKey || event.ctrlKey);
                }}
                draggable
                onDragStart={(event) => startDragging(event, entry.path)}
                onDragEnd={endDragging}
                aria-description={withMistakes?.has(entry.path) ? "Has mistakes" : undefined}
                className={`${row} w-full text-left outline-none hover:bg-neutral-100 focus-visible:ring-1 focus-visible:ring-sky-400 ${opens(entry.path) && onOpen ? "" : "cursor-default"}`}
                style={{ paddingLeft: indent(depth) }}
              >
                <FileLabel name={entry.name} />
                <span className="truncate">{entry.name}</span>
                {withMistakes?.has(entry.path) && (
                  <span title="Has mistakes" className="ml-auto size-1.5 shrink-0 rounded-full bg-red-400" />
                )}
              </button>
            )}
          </li>
        ),
      )}
    </ul>
  );
}

/** Files the app opens itself: notes, PDFs and boards. */
export const opens = (path: string) => !!noteFormat(path) || /\.(pdf|canvas)$/i.test(path);

/** The space where a folder has its chevron, then the file's icon. */
function FileLabel({ name }: { name: string }) {
  return (
    <>
      <span className="size-3.5 shrink-0" />
      <Icon path={fileIcon(name)} size="16px" className="shrink-0 text-neutral-400" />
    </>
  );
}

function FolderItem({ folder, depth, ...props }: Props & { folder: FileEntry; depth: number }) {
  const { openFolders, onToggleFolder, onSelect, selected, renaming, onFileMenu, dropTarget } = props;
  const expanded = openFolders.has(folder.path);
  const label = (
    <>
      <Icon path={mdiChevronRight} size="14px" className={`shrink-0 text-neutral-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
      <Icon path={expanded ? mdiFolderOpenOutline : mdiFolderOutline} size="16px" className="shrink-0 text-neutral-500" />
    </>
  );
  return (
    <li
      data-drop-target={dropTarget === folder.path ? "" : undefined}
      onContextMenu={(event) => {
        if (!onFileMenu) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect?.(folder.path);
        onFileMenu(folder.path, { x: event.clientX, y: event.clientY }, true);
      }}
      className={`rounded-md ${dropTarget === folder.path ? "bg-sky-50 ring-1 ring-sky-300 ring-inset" : ""}`}
    >
      {renaming?.path === folder.path ? (
        <div className={`${row} relative`} style={{ paddingLeft: indent(depth) }}>
          {label}
          <NameField fileName={folder.name} renaming={renaming} folder />
        </div>
      ) : (
        <button
          data-path={folder.path}
          data-kind="folder"
          aria-expanded={expanded}
          onClick={() => {
            onSelect?.(folder.path);
            onToggleFolder(folder.path);
          }}
          draggable
          onDragStart={(event) => startDragging(event, folder.path, true)}
          onDragEnd={endDragging}
          {...dropOn(props, folder.path)}
          className={`${row} w-full text-left outline-none hover:bg-neutral-100 focus-visible:ring-1 focus-visible:ring-sky-400 ${
            folder.path === selected ? "bg-neutral-50 ring-1 ring-neutral-200 ring-inset" : ""
          }`}
          style={{ paddingLeft: indent(depth) }}
        >
          {label}
          <span className="truncate">{folder.name}</span>
        </button>
      )}
      {expanded && <FileTree {...props} entries={folder.children} depth={depth + 1} />}
    </li>
  );
}

/**
 * The note's name, ready to type over: Enter or clicking elsewhere saves it, Escape keeps the
 * old one. The extension is shown after the field but isn't part of it, so the format can't change.
 */
function NameField({ fileName, renaming, folder }: { fileName: string; renaming: Renaming; folder: boolean }) {
  const dot = folder ? -1 : fileName.lastIndexOf(".");
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
          aria-label={folder ? "Folder name" : noteFormat(fileName) ? "Note name" : "File name"}
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
    case "canvas":
      return mdiDraw;
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

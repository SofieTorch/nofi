import {
  mdiChevronRight,
  mdiFileDocumentOutline,
  mdiFileImageOutline,
  mdiFileOutline,
  mdiFilePdfBox,
  mdiFileTableOutline,
  mdiFolderOpenOutline,
  mdiFolderOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import type { FileEntry } from "../api";

export function FileTree({ entries, depth = 0 }: { entries: FileEntry[]; depth?: number }) {
  return (
    <ul className="flex flex-col">
      {entries.map((entry) =>
        entry.kind === "folder" ? (
          <FolderItem key={entry.path} folder={entry} depth={depth} />
        ) : (
          <li key={entry.path} className={row} style={{ paddingLeft: indent(depth) }}>
            <span className="size-3.5 shrink-0" />
            <Icon path={fileIcon(entry.name)} size="16px" className="shrink-0 text-neutral-400" />
            <span className="truncate">{entry.name}</span>
          </li>
        ),
      )}
    </ul>
  );
}

function FolderItem({ folder, depth }: { folder: FileEntry; depth: number }) {
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
      {expanded && <FileTree entries={folder.children} depth={depth + 1} />}
    </li>
  );
}

const row = "flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-neutral-700";

const indent = (depth: number) => `${0.25 + depth * 0.875}rem`;

function fileIcon(name: string) {
  const extension = name.split(".").pop()?.toLowerCase();
  switch (extension) {
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

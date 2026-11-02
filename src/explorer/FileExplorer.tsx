import { mdiFilePlusOutline, mdiPin, mdiPinOutline } from "@mdi/js";
import { useState } from "react";
import type { ExplorerLayout, FileEntry } from "../api";
import { IconButton } from "../ui/IconButton";
import { FileMenu } from "./FileMenu";
import { FileTree, type Renaming } from "./FileTree";

type Props = {
  layout: ExplorerLayout;
  /** Shown over the content while hovered, instead of next to it. */
  floating: boolean;
  /** Only false while floating and not hovered: then it's out of view and can't be clicked. */
  visible: boolean;
  /** The workspace's files; null while they're still loading. */
  files: FileEntry[] | null;
  /** Why the files couldn't be listed, if they couldn't. */
  error?: string;
  /** A file to highlight: the open note. */
  highlightedPath?: string;
  /** Notes known to have mistakes. */
  withMistakes?: ReadonlySet<string>;
  /** The note whose name is being typed, if any. */
  renaming?: Renaming;
  onOpen: (path: string) => void;
  onTogglePinned: () => void;
  onNewNote: () => void;
  /** Rename (double-click, or right-click › Rename): to type a file's new name. */
  onStartRenaming: (path: string) => void;
  /** Right-click › Delete: asks first. */
  onDelete: (path: string) => void;
};

export function FileExplorer({
  layout,
  floating,
  visible,
  files,
  error,
  highlightedPath,
  renaming,
  withMistakes,
  onOpen,
  onTogglePinned,
  onNewNote,
  onStartRenaming,
  onDelete,
}: Props) {
  const [menu, setMenu] = useState<{ path: string; at: { x: number; y: number } }>();
  const pinned = layout.mode === "pinned";
  const fromLeft = layout.side === "left";
  // Slides in from its edge of the window with a light fade; when hidden it waits fully outside the window.
  const slide = visible
    ? "translate-x-0 opacity-100"
    : `pointer-events-none opacity-50 ${fromLeft ? "-translate-x-[calc(100%+1rem)]" : "translate-x-[calc(100%+1rem)]"}`;
  const placement = floating
    ? // Notion-like: a borderless card with a soft shadow that doesn't take the full height.
      `absolute top-3 bottom-16 z-10 rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.06)] ${
        fromLeft ? "left-2" : "right-2"
      } ${slide} transition-[translate,opacity] duration-200 ease-in motion-reduce:transition-none`
    : // A hairline divider (half a pixel on Retina screens).
      `h-full ${fromLeft ? "border-r-[0.5px]" : "border-l-[0.5px]"} border-neutral-200`;

  return (
    <aside
      aria-label="File explorer"
      aria-hidden={!visible}
      inert={!visible}
      data-side={layout.side}
      className={`flex w-64 shrink-0 flex-col bg-white ${placement}`}
    >
      <div className="flex items-center justify-between py-1.5 pr-1.5 pl-3">
        <span className="text-xs font-medium tracking-wide text-neutral-500 uppercase">Files</span>
        <div className="flex items-center gap-0.5">
          <IconButton icon={mdiFilePlusOutline} label="New note" onClick={onNewNote} />
          <IconButton
            icon={pinned ? mdiPin : mdiPinOutline}
            label="Pin file explorer"
            pressed={pinned}
            onClick={onTogglePinned}
          />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-1.5 pb-2">
        {error ? (
          <p role="alert" className="px-2 text-sm text-red-600">
            Couldn't list the files: {error}
          </p>
        ) : files?.length === 0 ? (
          <p className="px-2 text-sm text-neutral-500">This workspace is empty.</p>
        ) : (
          files && (
            <FileTree
              entries={files}
              highlightedPath={highlightedPath}
              renaming={renaming}
              withMistakes={withMistakes}
              onOpen={onOpen}
              onStartRenaming={onStartRenaming}
              onFileMenu={(path, at) => setMenu({ path, at })}
            />
          )
        )}
      </nav>
      {menu && (
        <FileMenu
          at={menu.at}
          onRename={() => onStartRenaming(menu.path)}
          onDelete={() => onDelete(menu.path)}
          onClose={() => setMenu(undefined)}
        />
      )}
    </aside>
  );
}

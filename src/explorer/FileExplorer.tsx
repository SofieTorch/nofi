import { mdiChevronRight, mdiCogOutline, mdiCollapseAllOutline, mdiFilePlusOutline, mdiFolderPlusOutline, mdiMagnify, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { ExplorerLayout, FileEntry, SidebarSizes, ZoteroItem } from "../api";
import { IconButton } from "../ui/IconButton";
import { sidebarLeft } from "../ui/icons";
import { FileMenu } from "./FileMenu";
import { DRAGGED_PATH, draggedPath, FileTree, type Renaming } from "./FileTree";
import { isMac } from "../ui/platform";
import { Library } from "./Library";
import { SearchPanel } from "./SearchPanel";
import type { Match } from "./searchWorkspace";

export type Section = "files" | "library";

/** The sidebar's width: 256 pixels at first, between 180 and 600; the arrow keys move it 16 at a time. */
const WIDTH = { start: 256, min: 180, max: 600, step: 16 };
/** The Files section's share of the height, when both are open: neither gets less than a tenth. */
const SHARE = { min: 0.1, max: 0.9, step: 0.05 };

const clamp = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, value));
const hundredths = (share: number) => Math.round(share * 100) / 100;

type Props = {
  /** The open workspace's name, at the top. */
  workspaceName: string;
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
  /** Opens a file; `newPane` with ⌘ (Ctrl elsewhere) held, beside the active pane. */
  onOpen: (path: string, newPane: boolean) => void;
  onTogglePinned: () => void;
  /** A new note or folder in a folder (else the selected one's). */
  onNewNote: (folder?: string) => void;
  onNewFolder: (folder?: string) => void;
  /** The open folders, and opening or closing one (Collapse folders closes them all). */
  openFolders: ReadonlySet<string>;
  onToggleFolder: (path: string) => void;
  onCollapseAll: () => void;
  /** The row clicked last (null: the empty space, the top of the workspace). */
  selected: string | null;
  onSelect: (path: string | null) => void;
  /** Dropping a dragged file or folder on a folder ("" for the top): moved there, or copied. */
  onMove: (path: string, folder: string, copy: boolean) => void;
  /** Rename (double-click, or right-click › Rename): to type a file's new name. */
  onStartRenaming: (path: string) => void;
  /** Delete (right-click, or the keyboard): asks first, unless it's an empty folder. */
  onDelete: (path: string) => void;
  /** Folds a section away, or opens it again. */
  onToggleSection: (section: Section) => void;
  /** Opens a Zotero paper's PDF. */
  onOpenPaper: (paper: ZoteroItem, newPane: boolean) => void;
  /** The search of the whole workspace (⌘⇧F), shown instead of the files while it's open. */
  search: {
    open: boolean;
    /** Counts the times it was asked for: its field gets the focus. */
    focus: number;
    onOpen: () => void;
    onClose: () => void;
    onOpenMatch: (path: string, query: string, match: Match, newPane: boolean) => void;
  };
};

export function FileExplorer({
  workspaceName,
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
  onNewFolder,
  openFolders,
  onToggleFolder,
  onCollapseAll,
  selected,
  onSelect,
  onMove,
  onStartRenaming,
  onDelete,
  onToggleSection,
  onOpenPaper,
  search,
}: Props) {
  const collapsed = layout.collapsed ?? { files: false, library: false };
  /** Counts Refresh clicks: the library is read again for each. */
  const [readLibrary, setReadLibrary] = useState(0);
  /** Whether the Library's search field is shown. */
  const [searching, setSearching] = useState(false);
  /** Where the Library's settings are open, if they are. */
  const [librarySettings, setLibrarySettings] = useState<{ x: number; y: number } | null>(null);
  const openLibrarySettings = (at: { x: number; y: number } | null) => {
    if (at && collapsed.library) onToggleSection("library");
    setLibrarySettings(at);
  };

  // The sidebar's sizes: the same in every workspace; saved when a change is done (a drag ends).
  const [sizes, setSizes] = useState<SidebarSizes>({ width: WIDTH.start, filesShare: 0.5 });
  const latest = useRef(sizes);
  latest.current = sizes;
  useEffect(() => {
    let current = true;
    api.getSidebarSizes().then(
      (saved) => current && setSizes(saved),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);
  const resize = (change: Partial<SidebarSizes>, save = true) => {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setSizes(next);
    if (save) api.saveSidebarSizes(next).catch(console.error);
  };
  /** Follows the mouse from where a drag started, until it's let go; then saves. */
  const follow = (event: React.PointerEvent, move: (dx: number, dy: number) => void, cursor: string) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY };
    const onMove = (e: PointerEvent) => move(e.clientX - start.x, e.clientY - start.y);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove(cursor);
      resize({});
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add(cursor);
  };
  const sections = useRef<HTMLDivElement>(null);

  // The window's buttons, like in Zen: while it floats on the left (flush in the window's corner,
  // so they sit where they do when it's pinned), they're part of it: shown only while it is,
  // fading in once it's slid in and out as it leaves. Otherwise always shown. Shown again when it
  // goes (the workspace closes, or it's pinned).
  const onTheLeft = layout.side === "left";
  const buttonsShown = !floating || !onTheLeft || visible;
  const firstButtons = useRef(true);
  useEffect(() => {
    // (At first they're just hidden or shown: nothing fades as the window opens.)
    const fade = floating && onTheLeft && !firstButtons.current;
    firstButtons.current = false;
    api.showWindowButtons(buttonsShown, fade).catch(() => {});
  }, [buttonsShown, floating, onTheLeft]);
  useEffect(() => () => void api.showWindowButtons(true).catch(() => {}), []);
  const both = !collapsed.files && !collapsed.library;
  const [menu, setMenu] = useState<{ path: string; at: { x: number; y: number }; on: "file" | "folder" | "space" }>();
  /** The folder something dragged would go in ("" for the top), while dragging over it. */
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  /** Hovering a closed folder while dragging opens it after a moment. */
  const opening = useRef<{ folder: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const stopOpening = () => {
    if (opening.current) clearTimeout(opening.current.timer);
    opening.current = null;
  };
  const copies = (event: React.DragEvent) => (isMac ? event.altKey : event.ctrlKey);
  /** Whether what's dragged can go in a folder: not a folder into itself. */
  const canGo = (path: string | null, folder: string): path is string => !!path && folder !== path && !folder.startsWith(`${path}/`);
  function dragInto(event: React.DragEvent, folder: string) {
    const path = draggedPath();
    if (!canGo(path, folder)) {
      if (path) event.stopPropagation();
      return setDropTarget(null);
    }
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = copies(event) ? "copy" : "move";
    setDropTarget(folder);
    if (folder && !openFolders.has(folder) && opening.current?.folder !== folder) {
      stopOpening();
      opening.current = { folder, timer: setTimeout(() => (stopOpening(), onToggleFolder(folder)), 700) };
    }
  }
  function dropInto(event: React.DragEvent, folder: string) {
    const path = draggedPath() ?? event.dataTransfer?.getData(DRAGGED_PATH) ?? null;
    setDropTarget(null);
    stopOpening();
    if (!canGo(path, folder)) return;
    event.preventDefault();
    event.stopPropagation();
    const copy = copies(event);
    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (copy || parent !== folder) onMove(path, folder, copy);
  }
  /** The keyboard in the files: ↑ ↓ between rows, → ← into and out of folders, F2 renames, ⌘⌫ (Delete) deletes. */
  function treeKeys(event: React.KeyboardEvent<HTMLElement>) {
    const current = (event.target as HTMLElement).closest<HTMLElement>("button[data-path]");
    if (!current || (event.target as HTMLElement).tagName === "INPUT") return;
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>("button[data-path]")];
    const at = rows.indexOf(current);
    const path = current.dataset.path!;
    const folder = current.dataset.kind === "folder";
    const go = (row: HTMLElement | undefined) => {
      if (!row) return;
      row.focus();
      onSelect(row.dataset.path!);
    };
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (event.key === "ArrowDown") return handled(), go(rows[at + 1]);
    if (event.key === "ArrowUp") return handled(), go(rows[at - 1]);
    if (event.key === "ArrowRight" && folder) {
      handled();
      if (!openFolders.has(path)) return onToggleFolder(path);
      const next = rows[at + 1];
      if (next?.dataset.path?.startsWith(`${path}/`)) go(next);
      return;
    }
    if (event.key === "ArrowLeft") {
      handled();
      if (folder && openFolders.has(path)) return onToggleFolder(path);
      const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
      return go(rows.find((row) => row.dataset.path === parent));
    }
    if (event.key === "F2") return handled(), onStartRenaming(path);
    if ((isMac && event.metaKey && event.key === "Backspace") || (!isMac && event.key === "Delete")) return handled(), onDelete(path);
  }
  const pinned = layout.mode === "pinned";
  const fromLeft = layout.side === "left";
  // Slides in from its edge of the window with a light fade; when hidden it waits fully outside the window.
  const slide = visible
    ? "translate-x-0 opacity-100"
    : `pointer-events-none opacity-50 ${fromLeft ? "-translate-x-[calc(100%+1rem)]" : "translate-x-[calc(100%+1rem)]"}`;
  const placement = floating
    ? // On the left, flush in the window's top left corner (where the window's buttons are), the
      // full height; on the right, a borderless card with a soft shadow that doesn't take it all.
      `absolute z-10 shadow-[0_2px_12px_rgba(0,0,0,0.06)] ${
        fromLeft ? "inset-y-0 left-0 rounded-r-xl" : "top-3 right-2 bottom-16 rounded-xl"
      } ${slide} transition-[translate,opacity] duration-200 ease-in motion-reduce:transition-none`
    : // A hairline divider (half a pixel on Retina screens).
      `relative h-full ${fromLeft ? "border-r-[0.5px]" : "border-l-[0.5px]"} border-neutral-200`;

  return (
    <aside
      aria-label="File explorer"
      aria-hidden={!visible}
      inert={!visible}
      data-side={layout.side}
      style={{ width: sizes.width }}
      className={`group/sidebar flex shrink-0 flex-col bg-white ${placement}`}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the sidebar"
        aria-valuenow={sizes.width}
        aria-valuemin={WIDTH.min}
        aria-valuemax={WIDTH.max}
        tabIndex={0}
        onPointerDown={(event) => {
          const from = latest.current.width;
          follow(event, (dx) => resize({ width: clamp(from + (fromLeft ? dx : -dx), WIDTH) }, false), "resizing-column");
        }}
        onKeyDown={(event) => {
          const wider = fromLeft ? "ArrowRight" : "ArrowLeft";
          const narrower = fromLeft ? "ArrowLeft" : "ArrowRight";
          if (event.key !== wider && event.key !== narrower) return;
          event.preventDefault();
          resize({ width: clamp(latest.current.width + (event.key === wider ? WIDTH.step : -WIDTH.step), WIDTH) });
        }}
        onDoubleClick={() => resize({ width: WIDTH.start })}
        className={`absolute inset-y-0 z-20 w-1.5 cursor-col-resize outline-none hover:bg-neutral-300/40 focus-visible:bg-sky-400/40 ${
          fromLeft ? "-right-[3px]" : "-left-[3px]"
        }`}
      />
      {/* Its top row, as tall as the tabs' (it moves the window): New note and Pin on the right; on
          the left of the window, room for the window's buttons (on a Mac), centred with them. */}
      <div role="toolbar" aria-label="Sidebar" data-tauri-drag-region className="flex h-10 shrink-0 items-center justify-end gap-0.5 pr-1.5">
        <IconButton
          icon={mdiMagnify}
          label="Search the workspace"
          pressed={search.open}
          onClick={search.open ? search.onClose : search.onOpen}
        />
        <IconButton icon={sidebarLeft} label="Pin file explorer" pressed={pinned} onClick={onTogglePinned} />
      </div>
      {search.open && <SearchPanel files={files} focusSignal={search.focus} onOpen={search.onOpenMatch} onClose={search.onClose} />}
      <div ref={sections} className={`min-h-0 flex-1 flex-col ${search.open ? "hidden" : "flex"}`}>
      <SidebarSection
        name="Files"
        heading={workspaceName}
        style={both ? { flexGrow: sizes.filesShare } : undefined}
        collapsed={collapsed.files}
        onToggle={() => onToggleSection("files")}
        revealActions
        actions={
          <>
            <IconButton icon={mdiFilePlusOutline} label="New note" onClick={() => onNewNote()} />
            <IconButton icon={mdiFolderPlusOutline} label="New folder" onClick={() => onNewFolder()} />
            <IconButton icon={mdiCollapseAllOutline} label="Collapse folders" onClick={onCollapseAll} />
          </>
        }
      >
        <nav
          className="flex min-h-full flex-col px-1.5 pb-2"
          onKeyDown={treeKeys}
          onDragEnd={() => {
            setDropTarget(null);
            stopOpening();
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
          }}
        >
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
                onFileMenu={(path, at, folder) => setMenu({ path, at, on: folder ? "folder" : "file" })}
                openFolders={openFolders}
                onToggleFolder={onToggleFolder}
                selected={selected}
                onSelect={onSelect}
                dropTarget={dropTarget}
                onDragInto={dragInto}
                onDropInto={dropInto}
              />
            )
          )}
          {/* Below the files: clicking it selects the top of the workspace; dropping there moves to the top. */}
          <div
            data-testid="files-empty-space"
            data-drop-target={dropTarget === "" ? "" : undefined}
            onClick={() => onSelect(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              onSelect(null);
              setMenu({ path: "", at: { x: event.clientX, y: event.clientY }, on: "space" });
            }}
            onDragEnter={(event) => dragInto(event, "")}
            onDragOver={(event) => dragInto(event, "")}
            onDrop={(event) => dropInto(event, "")}
            className={`min-h-8 flex-1 rounded-md ${dropTarget === "" ? "bg-sky-50 ring-1 ring-sky-300 ring-inset" : ""}`}
          />
        </nav>
      </SidebarSection>
      {both && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the sections"
          aria-valuenow={Math.round(sizes.filesShare * 100)}
          aria-valuemin={SHARE.min * 100}
          aria-valuemax={SHARE.max * 100}
          tabIndex={0}
          onPointerDown={(event) => {
            const from = latest.current.filesShare;
            const height = sections.current?.getBoundingClientRect().height ?? 0;
            if (height > 0) follow(event, (_, dy) => resize({ filesShare: hundredths(clamp(from + dy / height, SHARE)) }, false), "resizing-row");
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const step = event.key === "ArrowDown" ? SHARE.step : -SHARE.step;
            resize({ filesShare: hundredths(clamp(latest.current.filesShare + step, SHARE)) });
          }}
          className="relative h-px shrink-0 cursor-row-resize bg-neutral-100 outline-none focus-visible:bg-sky-400"
        >
          {/* A taller area to grab than the hairline. */}
          <span className="absolute inset-x-0 -top-1 -bottom-1 hover:bg-neutral-300/40" />
        </div>
      )}
      <SidebarSection
        name="Library"
        style={both ? { flexGrow: hundredths(1 - sizes.filesShare) } : undefined}
        collapsed={collapsed.library}
        onToggle={() => onToggleSection("library")}
        actions={
          <>
            <IconButton icon={mdiRefresh} label="Refresh the library" onClick={() => setReadLibrary((n) => n + 1)} />
            <IconButton
              icon={mdiMagnify}
              label="Search the library"
              pressed={searching}
              onClick={() => {
                if (!searching && collapsed.library) onToggleSection("library");
                setSearching(!searching);
              }}
            />
            <IconButton
              icon={mdiCogOutline}
              label="Library settings"
              pressed={!!librarySettings}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                openLibrarySettings(librarySettings ? null : { x: box.left, y: box.bottom });
              }}
            />
          </>
        }
      >
        <Library
          version={readLibrary}
          searching={searching}
          onSearching={setSearching}
          settingsAt={librarySettings}
          onSettings={openLibrarySettings}
          highlightedPath={highlightedPath}
          onOpen={onOpenPaper}
        />
      </SidebarSection>
      </div>
      {menu && (
        <FileMenu
          at={menu.at}
          on={menu.on}
          onNewNote={() => onNewNote(menu.path)}
          onNewFolder={() => onNewFolder(menu.path)}
          onRename={() => onStartRenaming(menu.path)}
          onDelete={() => onDelete(menu.path)}
          onClose={() => setMenu(undefined)}
        />
      )}
    </aside>
  );
}

/**
 * One of the sidebar's sections, like VS Code's: a header that folds it away (its actions on the
 * right), and what's in it, scrolling on its own. Open sections share the sidebar's height.
 */
function SidebarSection({
  name,
  heading,
  style,
  collapsed,
  onToggle,
  actions,
  revealActions = false,
  children,
}: {
  name: string;
  /** Shown on its header instead of its name, as a heading (the Files section: the workspace's name). */
  heading?: string;
  /** Its share of the height, when the other section is open too. */
  style?: CSSProperties;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  /** Its actions show only while the mouse is over the sidebar (or one has the focus), like VS Code's. */
  revealActions?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      style={collapsed ? undefined : { flexBasis: 0, ...style }}
      className={`group/section flex min-h-0 flex-col ${collapsed ? "shrink-0" : "flex-1"}`}
    >
      <div className="flex shrink-0 items-center py-1 pr-1.5 pl-1">
        {heading ? (
          <h1 className="flex min-w-0 flex-1">
            <SectionToggle label={heading} collapsed={collapsed} onToggle={onToggle} />
          </h1>
        ) : (
          <SectionToggle label={name} collapsed={collapsed} onToggle={onToggle} />
        )}
        {actions && (
          <div
            role="toolbar"
            aria-label={name}
            className={`flex items-center gap-0.5 ${revealActions ? "opacity-0 transition-opacity group-hover/sidebar:opacity-100 focus-within:opacity-100" : ""}`}
          >
            {actions}
          </div>
        )}
      </div>
      {!collapsed && (
        <section aria-label={name} className="min-h-0 flex-1 overflow-y-auto">
          {children}
        </section>
      )}
    </div>
  );
}

/** A section's header button: folds it away, or opens it again. */
function SectionToggle({ label, collapsed, onToggle }: { label: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      aria-expanded={!collapsed}
      onClick={onToggle}
      className="flex min-w-0 flex-1 items-center gap-0.5 rounded-md py-0.5 text-left text-xs font-medium tracking-wide text-neutral-500 uppercase hover:text-neutral-700"
    >
      <Icon path={mdiChevronRight} size="14px" className={`shrink-0 text-neutral-400 transition-transform ${collapsed ? "" : "rotate-90"}`} />
      <span className="truncate">{label}</span>
    </button>
  );
}

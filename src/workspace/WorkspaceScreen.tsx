import { startCompletion } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { EditorSettings, ExplorerLayout, FileEntry, NoteFormat, Workspace } from "../api";
import { createAutosave } from "../editor/autosave";
import { forgetNoteHistory, moveNoteHistory } from "../editor/noteHistory";
import { NotePane } from "../editor/NotePane";
import { showBlockHandles } from "../editor/blockHandles";
import { type LinkTarget, setLinkCopiedReporter, setNoteLinkOpener, setWorkspaceNotes } from "../editor/noteLinks";
import { noteFormat } from "../editor/formatting";
import { setImageProblemReporter } from "../editor/images";
import { type Command, CommandPalette } from "./CommandPalette";
import { ConfirmDelete } from "./ConfirmDelete";
import { SettingsDialog } from "./SettingsDialog";
import { FileExplorer } from "../explorer/FileExplorer";
import { isMac } from "../ui/platform";
import { UNDO_IN_FIELD } from "../editor/TableGrid";
import { SHOW_SUGGESTIONS } from "../ui/SuggestingInput";
import { FileHistory } from "./fileHistory";
import { GraphView } from "./GraphView";
import { activeFile, activePath, closeGroup, closeTab, emptyLayout, findTab, groups, keepTab, placeTab, tabFor, type Layout, openTab, removePath, renamePath, split } from "./layout";
import { Panes } from "./Panes";
import { PdfView } from "./PdfView";
import { BoardView } from "../board/BoardView";
import { TopBar } from "./TopBar";

const SAVE_PROBLEM = "Couldn't save the note:";

const fileName = (path: string) => path.split("/").pop()!;
/** A note's name as the user types it: without folder or extension. */
const nameOf = (path: string) => fileName(path).replace(/\.[^.]*$/, "");

export function WorkspaceScreen({ workspace }: { workspace: Workspace }) {
  const [layout, setLayout] = useState<ExplorerLayout | null>(null);
  // Mirrors `layout`, so menu events always change the latest layout.
  const layoutRef = useRef<ExplorerLayout | null>(null);
  const [hovering, setHovering] = useState(false);
  // Whether Typst notes are also shown as pages; mirrored in a ref for menu events.
  const [showPages, setShowPages] = useState(false);
  const showPagesRef = useRef(false);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [filesError, setFilesError] = useState<string>();
  /** The panes and their tabs; the active pane's note is highlighted in the explorer. */
  const [panes, setPanes] = useState<Layout>(emptyLayout);
  const openPath = activePath(panes);
  // The note last shown, even while the graph's pane is the active one.
  const lastNoteRef = useRef<string>(undefined);
  if (openPath) lastNoteRef.current = openPath;
  const lastNote = lastNoteRef.current;
  /**
   * Opens a note (or a PDF, in the reader) in the active pane, or shows it where it's open already.
   * By default in a preview tab (the next file opened replaces it); `newPane` opens it beside the
   * active pane (⌘-click).
   */
  const openNote = (path: string, { preview = true, newPane = false } = {}) =>
    setPanes((current) => {
      const tab = { ...tabFor(path), preview };
      return newPane ? placeTab(current, tab, { group: current.active, side: "right" }) : openTab(current, tab);
    });
  /** A note typed in is kept: its preview tab becomes an ordinary one. */
  const keepNote = (path: string) => setPanes((current) => keepTab(current, tabFor(path)));
  const closeNote = (path: string) => setPanes((current) => removePath(current, path));
  // A new note's name is ready to type over until it's saved or kept.
  const [renamingPath, setRenamingPath] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [editorSettings, setEditorSettings] = useState<EditorSettings>({ blockHandles: true, boardBackground: "plain" });
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** The palette, when open: what was typed at first ("" for notes, ">" for commands). */
  const [palette, setPalette] = useState<string>();
  /** A match to select in a note, once it's open (a new object each time, to select it again). */
  const [reveal, setReveal] = useState<api.TextMatch>();
  /** A part of a file to go to, once it's open (from a link; a new object each time). */
  const [goTo, setGoTo] = useState<{ path: string; part: string }>();
  /** A file the user asked to delete, waiting for them to confirm. */
  const [deleting, setDeleting] = useState<string>();
  /** Notes found to have mistakes (only notes opened in this session are known). */
  const [withMistakes, setWithMistakes] = useState<ReadonlySet<string>>(new Set());
  function noteMistakes(path: string, hasMistakes: boolean) {
    setWithMistakes((current) => {
      if (current.has(path) === hasMistakes) return current;
      const next = new Set(current);
      if (hasMistakes) next.add(path);
      else next.delete(path);
      return next;
    });
  }
  /** Counts saves, for the graph to look at the links again. */
  const [saves, setSaves] = useState(0);
  const [autosave] = useState(() =>
    createAutosave({
      onSaved: () => {
        setProblem((p) => (p?.startsWith(SAVE_PROBLEM) ? undefined : p));
        setSaves((count) => count + 1);
      },
      onFailed: (reason) => setProblem(`${SAVE_PROBLEM} ${reason}`),
    }),
  );
  useEffect(() => () => autosave.dispose(), [autosave]);
  // What was just typed is saved first, so it's found too.
  const searchText = useCallback(
    async (query: string) => {
      await autosave.flush();
      return api.searchNotes(query);
    },
    [autosave],
  );
  const [fileHistory] = useState(() => new FileHistory());
  /** A short message about what Undo or Redo just did. */
  const [notice, setNotice] = useState<string>();
  // Notes' undo histories only last while the workspace is open.
  useEffect(() => () => forgetNoteHistory(), []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function loadFiles() {
    try {
      setFiles(await api.listFiles());
      setFilesError(undefined);
    } catch (error) {
      setFilesError(String(error));
    }
  }

  useEffect(() => {
    loadFiles();
    // Files made, renamed or deleted outside the app show up (or go) by themselves.
    const unlisten = api.onFilesChanged(() => loadFiles());
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  // Notes for the editor's [[ list, and what clicking a link to a note does.
  const filesRef = useRef<FileEntry[]>([]);
  useEffect(() => {
    filesRef.current = files ?? [];
    setWorkspaceNotes(files ?? []);
  }, [files]);
  useEffect(() => {
    setNoteLinkOpener(followLink);
    setLinkCopiedReporter(setNotice);
    setImageProblemReporter(setProblem);
    return () => {
      setNoteLinkOpener(null);
      setLinkCopiedReporter(null);
    };
  }, []);

  /** A new note (Typst unless told), or a new board, opened to name it. */
  async function newNote(format?: NoteFormat | "board") {
    try {
      const path = format === "board" ? await api.createBoard() : format ? await api.createNote(format) : await api.createNote();
      setProblem(undefined);
      openNote(path, { preview: false });
      setRenamingPath(path);
      await loadFiles();
      fileHistory.record({
        description: `creating "${fileName(path)}"`,
        undo: async () => {
          await autosave.flush(); // anything typed in it counts, so it's kept
          await api.removeEmptyNote(path);
          forgetNoteHistory(path);
          setRenamingPath(undefined);
          closeNote(path);
          await loadFiles();
        },
        redo: async () => {
          await api.restoreEmptyNote(path);
          await loadFiles();
          openNote(path, { preview: false });
        },
      });
    } catch (error) {
      setProblem(`Couldn't create the ${format === "board" ? "board" : "note"}: ${error}`);
    }
  }

  /** Renames a note on disk; its open editor and undo history follow it. */
  async function renameFile(path: string, newName: string) {
    // Save what was typed first, or it would be saved under the old name afterwards.
    await autosave.flush();
    const newPath = await api.renameNote(path, newName);
    moveNoteHistory(path, newPath);
    await loadFiles();
    setPanes((current) => renamePath(current, path, newPath));
    return newPath;
  }

  async function renameNote(path: string, newName: string) {
    const newPath = await renameFile(path, newName);
    setRenamingPath(undefined);
    fileHistory.record({
      description: `renaming "${fileName(path)}" to "${fileName(newPath)}"`,
      undo: () => renameFile(newPath, nameOf(path)).then(() => {}),
      redo: () => renameFile(path, nameOf(newPath)).then(() => {}),
    });
  }

  /** Makes sure a note exists, creating it if a link points to it but it isn't created yet. */
  async function ensureNote(path: string) {
    const exists = (entries: FileEntry[]): boolean =>
      entries.some((entry) => entry.path === path || (entry.kind === "folder" && exists(entry.children)));
    if (exists(filesRef.current)) return true;
    try {
      await api.createNoteAt(path);
      await loadFiles();
      return true;
    } catch (reason) {
      setProblem(`Couldn't create “${fileName(path)}”: ${reason}`);
      return false;
    }
  }

  /**
   * Follows a link: a note opens (created first if it doesn't exist yet, like in Obsidian), and so
   * does a PDF, in the reader; other files open in their own app, websites in the browser. With
   * ⌘ (`newPane`), the note or PDF opens in a new pane beside the one the link is in.
   */
  async function followLink(target: LinkTarget, newPane: boolean) {
    try {
      if ("url" in target) return await api.openUrl(target.url);
      const { path } = target;
      const exists = (entries: FileEntry[]): boolean =>
        entries.some((entry) => entry.path === path || (entry.kind === "folder" && exists(entry.children)));
      const inApp = noteFormat(path) || /\.(pdf|canvas)$/i.test(path);
      if (!inApp) return await api.openFile(path);
      if (noteFormat(path)) {
        if (!(await ensureNote(path))) return;
      } else if (!exists(filesRef.current)) {
        return setProblem(`“${fileName(path)}” isn't in the workspace.`);
      }
      openNote(path, { newPane });
      if (target.part) setGoTo({ path, part: target.part });
    } catch (reason) {
      setProblem(`Couldn't open the link: ${reason}`);
    }
  }

  /** The graph view, as a tab in the active pane (or shown where it's open already). */
  const openGraph = () => setPanes((current) => openTab(current, { kind: "graph" }));

  /** A note chosen in the graph opens beside it, in another pane if there's one, so the graph stays. */
  async function openFromGraph(path: string, graphPane: string) {
    if (!(await ensureNote(path))) return;
    setPanes((current) => {
      const tab = { kind: "note", path, preview: true } as const;
      if (findTab(current, tab)) return openTab(current, tab);
      const other = groups(current).find((group) => group.id !== graphPane);
      return other ? openTab(current, tab, other.id) : split(current, graphPane, "right", tab);
    });
  }

  /**
   * Opens a file beside a pane (what a board's card shows, a PDF's note), so that pane stays in
   * view: in the pane next to it (or a new one at its right), at a part. With ⌘, in a new pane.
   */
  function openBeside(path: string, part: string | undefined, newPane: boolean, boardPane: string) {
    const tab = { ...tabFor(path), preview: true };
    setPanes((current) => {
      if (newPane) return placeTab(current, tab, { group: boardPane, side: "right" });
      if (findTab(current, tab)) return openTab(current, tab);
      const other = groups(current).find((group) => group.id !== boardPane);
      return other ? openTab(current, tab, other.id) : split(current, boardPane, "right", tab);
    });
    if (part) setGoTo({ path, part });
  }

  const closeActivePane = () => setPanes((current) => closeGroup(current, current.active));

  function closeActiveTab() {
    setPanes((current) => {
      const group = groups(current).find((g) => g.id === current.active);
      return group && group.tabs.length ? closeTab(current, group.id, group.active) : current;
    });
  }

  /** Deletes a file (after the user confirmed): it goes to the system's Trash. */
  async function deleteFile(path: string) {
    setDeleting(undefined);
    try {
      // What was typed is saved first, so the Trash has the note as it was.
      await autosave.flush();
      await api.deleteFile(path);
      forgetNoteHistory(path);
      closeNote(path);
      setProblem(undefined);
    } catch (reason) {
      setProblem(`Couldn't delete “${fileName(path)}”: ${reason}`);
    }
    await loadFiles();
  }

  /** Edit › Show Suggestions: opens suggestions wherever the cursor is (a note, or a property). */
  function showSuggestions() {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement)) return;
    // Property fields live inside the editor, so they're checked first.
    if (focused.getAttribute("role") === "combobox") {
      focused.dispatchEvent(new Event(SHOW_SUGGESTIONS));
    } else if (focused.closest(".cm-editor")) {
      // From the editor's outer element: its text area can hold a column's editor too.
      const view = EditorView.findFromDOM(focused.closest<HTMLElement>(".cm-editor")!);
      if (view) startCompletion(view);
    }
  }

  /** Undo or redo the latest file action, and say what it was. */
  async function stepFileHistory(kind: "undo" | "redo") {
    try {
      const action = await (kind === "undo" ? fileHistory.undo() : fileHistory.redo());
      if (action) setNotice(`${kind === "undo" ? "Undone" : "Redone"}: ${action.description}`);
    } catch (reason) {
      setProblem(`Couldn't ${kind}: ${reason}`);
    }
  }

  /**
   * Edit › Undo / Redo: in a note they undo typing; in a text field (like a note's name) they
   * undo what was typed there; anywhere else they undo file actions.
   */
  function undoOrRedo(kind: "undo" | "redo") {
    const focused = document.activeElement;
    // The note's editor: the outermost one (a column has a small editor of its own inside it).
    let editor = focused instanceof HTMLElement ? focused.closest<HTMLElement>(".cm-editor") : null;
    while (editor?.parentElement?.closest(".cm-editor")) editor = editor.parentElement.closest<HTMLElement>(".cm-editor");
    // A field inside the note (like a table's cell) decides itself: its typing, or the note's.
    if (editor && focused instanceof HTMLInputElement) {
      const asked = new CustomEvent(UNDO_IN_FIELD, { detail: kind, bubbles: true, cancelable: true });
      if (focused.dispatchEvent(asked)) document.execCommand?.(kind);
      return;
    }
    if (editor) {
      const view = EditorView.findFromDOM(editor);
      if (view) (kind === "undo" ? undo : redo)(view);
      return;
    }
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) {
      document.execCommand?.(kind);
      return;
    }
    stepFileHistory(kind);
  }

  // ⌘Z / ⌘⇧Z (Ctrl on Windows and Linux) outside the editor and text fields: file actions.
  // The editor handles its own shortcut first, so typing is never undone from here.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.altKey) return;
      if (!(isMac ? event.metaKey : event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const isRedo = (key === "z" && event.shiftKey) || (!isMac && key === "y");
      if (key !== "z" && !isRedo) return;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) {
        return;
      }
      event.preventDefault();
      stepFileHistory(isRedo ? "redo" : "undo");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function showLayout(next: ExplorerLayout) {
    layoutRef.current = next;
    setLayout(next);
  }

  useEffect(() => {
    api.getExplorerLayout().then(showLayout, () => showLayout({ side: "left", mode: "pinned" }));
  }, []);

  function changeLayout(change: (current: ExplorerLayout) => ExplorerLayout) {
    if (!layoutRef.current) return;
    const next = change(layoutRef.current);
    showLayout(next);
    api.saveExplorerLayout(next).catch(console.error);
  }

  function applyEditorSettings(settings: EditorSettings) {
    setEditorSettings(settings);
    showBlockHandles(settings.blockHandles);
  }

  useEffect(() => {
    api.getEditorSettings().then(applyEditorSettings, () => applyEditorSettings({ blockHandles: true, boardBackground: "plain" }));
  }, []);

  function changeEditorSettings(settings: EditorSettings) {
    applyEditorSettings(settings);
    api.saveEditorSettings(settings).catch((reason) => setProblem(`Couldn't save the settings: ${reason}`));
  }

  useEffect(() => {
    api.getShowPages().then(
      (show) => {
        showPagesRef.current = show;
        setShowPages(show);
      },
      () => {},
    );
  }, []);

  function toggleShowPages() {
    const show = !showPagesRef.current;
    showPagesRef.current = show;
    setShowPages(show);
    api.saveShowPages(show).catch(console.error);
  }

  const togglePinned = () =>
    changeLayout((l) => ({ ...l, mode: l.mode === "pinned" ? "auto-hide" : "pinned" }));
  const moveToOtherSide = () =>
    changeLayout((l) => ({ ...l, side: l.side === "left" ? "right" : "left" }));

  useEffect(() => {
    const unlisten = api.onMenuAction((action) => {
      if (action === "new-note") newNote();
      if (action === "new-markdown-note") newNote("markdown");
      if (action === "new-board") newNote("board");
      if (action === "toggle-explorer-pinned") togglePinned();
      if (action === "move-explorer-to-other-side") moveToOtherSide();
      if (action === "toggle-pages") toggleShowPages();
      if (action === "undo" || action === "redo") undoOrRedo(action);
      if (action === "show-suggestions") showSuggestions();
      if (action === "open-settings") setSettingsOpen(true);
      if (action === "go-to-file") setPalette("");
      if (action === "command-palette") setPalette(">");
      if (action === "graph-view") openGraph();
      if (action === "close-pane") closeActivePane();
    });
    return () => {
      unlisten.then((stopListening) => stopListening());
    };
  }, []);

  // Don't show anything until we know where the explorer goes, so it doesn't jump.
  if (!layout) return null;

  const explorerProps = {
    layout,
    files,
    error: filesError,
    highlightedPath: activeFile(panes),
    withMistakes,
    onOpen: (path: string, newPane: boolean) => openNote(path, { newPane }),
    renaming: renamingPath
      ? {
          path: renamingPath,
          onRename: (newName: string) => renameNote(renamingPath, newName),
          onCancel: () => setRenamingPath(undefined),
        }
      : undefined,
    onTogglePinned: togglePinned,
    onNewNote: () => newNote(),
    onStartRenaming: setRenamingPath,
    onDelete: setDeleting,
  };

  // What the command palette (⌘⇧P) can do, named like the menus.
  const commands: Command[] = [
    { label: "Settings: Open Settings", run: () => setSettingsOpen(true) },
    {
      label: `Settings: Turn ${editorSettings.blockHandles ? "Off" : "On"} Block Handles`,
      run: () => changeEditorSettings({ ...editorSettings, blockHandles: !editorSettings.blockHandles }),
    },
    { label: "File: New Note", run: () => newNote() },
    { label: "File: New Board", run: () => newNote("board") },
    { label: "File: New Markdown Note", run: () => newNote("markdown") },
    { label: `View: ${showPages ? "Hide" : "Show"} Pages`, run: toggleShowPages },
    { label: `View: ${layout.mode === "pinned" ? "Unpin" : "Pin"} File Explorer`, run: togglePinned },
    { label: "View: Move File Explorer to Other Side", run: moveToOtherSide },
    { label: "View: Open Graph View", run: openGraph },
    { label: "View: Close Tab", run: closeActiveTab },
    { label: "View: Close Pane", run: closeActivePane },
  ];

  return (
    <div className="flex h-screen flex-col bg-white">
      <TopBar
        workspaceName={workspace.name}
        explorerSide={layout.side}
        onExplorerSideChange={(side) => changeLayout((l) => ({ ...l, side }))}
        showPages={showPages}
        onToggleShowPages={toggleShowPages}
      />
      <div
        className={`relative flex min-h-0 flex-1 ${layout.side === "right" ? "flex-row-reverse" : ""}`}
      >
        {layout.mode === "pinned" ? (
          <FileExplorer {...explorerProps} floating={false} visible />
        ) : (
          <div
            aria-label="Show file explorer"
            data-side={layout.side}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            className="relative z-10 h-full w-2 shrink-0"
          >
            {/* Always mounted so it can animate out and keeps its open folders.
                Stays out while a new note is being named, so the name field doesn't vanish. */}
            <FileExplorer {...explorerProps} floating visible={hovering || !!renamingPath} />
          </div>
        )}
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <Panes
            layout={panes}
            onChange={setPanes}
            label={(tab) => (tab.kind === "graph" ? "Graph" : tab.kind === "pdf" ? fileName(tab.path) : nameOf(tab.path))}
            title={(tab) => (tab.kind === "graph" ? "Graph" : tab.path)}
            content={(tab, group) =>
              tab.kind === "board" ? (
                <BoardView
                  key={tab.path}
                  path={tab.path}
                  autosave={autosave}
                  version={saves}
                  background={editorSettings.boardBackground}
                  onEdited={keepNote}
                  onOpen={(path, part, newPane) => openBeside(path, part, newPane, group.id)}
                />
              ) : tab.kind === "pdf" ? (
                <PdfView
                  key={tab.path}
                  path={tab.path}
                  goTo={goTo?.path === tab.path ? goTo : undefined}
                  version={saves}
                  onOpenNote={(note, part) => openBeside(note, part, false, group.id)}
                />
              ) : tab.kind === "graph" ? (
                <GraphView
                  files={files ?? []}
                  activePath={lastNote}
                  version={saves}
                  onOpen={(path) => openFromGraph(path, group.id)}
                />
              ) : (
                <NotePane
                  key={tab.path}
                  path={tab.path}
                  autosave={autosave}
                  showPages={showPages}
                  reveal={reveal?.path === tab.path ? reveal : undefined}
                  goTo={goTo?.path === tab.path ? goTo : undefined}
                  onEdited={keepNote}
                  onMissingPart={(path, part) => setProblem(`Couldn't find “${part}” in ${fileName(path)}.`)}
                  onMistakes={noteMistakes}
                />
              )
            }
            empty={
              <p className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-400">
                Open a note from the explorer, or create one with {isMac ? "⌘N" : "Ctrl+N"}.
              </p>
            }
          />
          {notice && !problem && (
            <p
              role="status"
              className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-white px-4 py-2 text-sm text-neutral-700 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
            >
              {notice}
            </p>
          )}
          {problem && (
            <p
              role="alert"
              className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-white px-4 py-2 text-sm text-red-600 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
            >
              {problem}
            </p>
          )}
        </main>
      </div>
      {palette !== undefined && (
        <CommandPalette
          initial={palette}
          files={files ?? []}
          commands={commands}
          onOpenFile={(path) => openNote(path)}
          searchText={searchText}
          onOpenMatch={(match) => {
            openNote(match.path);
            setReveal({ ...match });
          }}
          onClose={() => setPalette(undefined)}
        />
      )}
      {deleting && (
        <ConfirmDelete name={fileName(deleting)} onDelete={() => deleteFile(deleting)} onCancel={() => setDeleting(undefined)} />
      )}
      {settingsOpen && (
        <SettingsDialog settings={editorSettings} onChange={changeEditorSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

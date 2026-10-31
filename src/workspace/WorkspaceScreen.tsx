import { startCompletion } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { ExplorerLayout, FileEntry, NoteFormat, Workspace } from "../api";
import { createAutosave } from "../editor/autosave";
import { forgetNoteHistory, moveNoteHistory } from "../editor/noteHistory";
import { NotePane } from "../editor/NotePane";
import { FileExplorer } from "../explorer/FileExplorer";
import { isMac } from "../ui/platform";
import { UNDO_IN_FIELD } from "../editor/TableGrid";
import { SHOW_SUGGESTIONS } from "../ui/SuggestingInput";
import { FileHistory } from "./fileHistory";
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
  /** The note shown in the editor (and highlighted in the explorer). */
  const [openPath, setOpenPath] = useState<string>();
  // A new note's name is ready to type over until it's saved or kept.
  const [renamingPath, setRenamingPath] = useState<string>();
  const [problem, setProblem] = useState<string>();
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
  const [autosave] = useState(() =>
    createAutosave({
      onSaved: () => setProblem((p) => (p?.startsWith(SAVE_PROBLEM) ? undefined : p)),
      onFailed: (reason) => setProblem(`${SAVE_PROBLEM} ${reason}`),
    }),
  );
  useEffect(() => () => autosave.dispose(), [autosave]);
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
  }, []);

  async function newNote(format?: NoteFormat) {
    try {
      const path = format ? await api.createNote(format) : await api.createNote();
      setProblem(undefined);
      setOpenPath(path);
      setRenamingPath(path);
      await loadFiles();
      fileHistory.record({
        description: `creating "${fileName(path)}"`,
        undo: async () => {
          await autosave.flush(); // anything typed in it counts, so it's kept
          await api.removeEmptyNote(path);
          forgetNoteHistory(path);
          setRenamingPath(undefined);
          setOpenPath((open) => (open === path ? undefined : open));
          await loadFiles();
        },
        redo: async () => {
          await api.restoreEmptyNote(path);
          await loadFiles();
          setOpenPath(path);
        },
      });
    } catch (error) {
      setProblem(`Couldn't create the note: ${error}`);
    }
  }

  /** Renames a note on disk; its open editor and undo history follow it. */
  async function renameFile(path: string, newName: string) {
    // Save what was typed first, or it would be saved under the old name afterwards.
    await autosave.flush();
    const newPath = await api.renameNote(path, newName);
    moveNoteHistory(path, newPath);
    await loadFiles();
    setOpenPath((open) => (open === path ? newPath : open));
    return newPath;
  }

  async function renameNote(path: string, newName: string) {
    const newPath = await renameFile(path, newName);
    setOpenPath(newPath);
    setRenamingPath(undefined);
    fileHistory.record({
      description: `renaming "${fileName(path)}" to "${fileName(newPath)}"`,
      undo: () => renameFile(newPath, nameOf(path)).then(() => {}),
      redo: () => renameFile(path, nameOf(newPath)).then(() => {}),
    });
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
      if (action === "toggle-explorer-pinned") togglePinned();
      if (action === "move-explorer-to-other-side") moveToOtherSide();
      if (action === "toggle-pages") toggleShowPages();
      if (action === "undo" || action === "redo") undoOrRedo(action);
      if (action === "show-suggestions") showSuggestions();
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
    highlightedPath: openPath,
    withMistakes,
    onOpen: setOpenPath,
    renaming: renamingPath
      ? {
          path: renamingPath,
          onRename: (newName: string) => renameNote(renamingPath, newName),
          onCancel: () => setRenamingPath(undefined),
        }
      : undefined,
    onTogglePinned: togglePinned,
    onNewNote: () => newNote(),
  };

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
          {openPath ? (
            <NotePane
              key={openPath}
              path={openPath}
              autosave={autosave}
              showPages={showPages}
              onMistakes={noteMistakes}
            />
          ) : (
            <p className="flex h-full items-center justify-center text-sm text-neutral-400">
              Open a note from the explorer, or create one with {isMac ? "⌘N" : "Ctrl+N"}.
            </p>
          )}
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
    </div>
  );
}

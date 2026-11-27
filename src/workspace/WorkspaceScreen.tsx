import { startCompletion } from "@codemirror/autocomplete";
import { mdiCodeTags, mdiFileDocumentMultipleOutline } from "@mdi/js";
import { redo, undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { EditorSettings, ExplorerLayout, FileEntry, NoteFormat, Workspace } from "../api";
import { createAutosave } from "../editor/autosave";
import { forgetNoteHistory, moveNoteHistory } from "../editor/noteHistory";
import { NotePane } from "../editor/NotePane";
import { showBlockHandles } from "../editor/blockHandles";
import { forgetZoteroPapers, type LinkTarget, setLinkCopiedReporter, setNoteLinkOpener, setWorkspaceNotes } from "../editor/noteLinks";
import { noteFormat } from "../editor/formatting";
import { setImageProblemReporter } from "../editor/images";
import { type Command, CommandPalette } from "./CommandPalette";
import { ConfirmDelete } from "./ConfirmDelete";
import { SettingsDialog } from "./SettingsDialog";
import { FileExplorer, type Section } from "../explorer/FileExplorer";
import { findPaper, zoteroPath } from "../explorer/Library";
import { type Moved, pdfsIn, relink, relinkPdfs } from "../explorer/relink";
import { isMac } from "../ui/platform";
import type { FindAt } from "./PdfView";
import type { Match } from "../explorer/searchWorkspace";
import { UNDO_IN_FIELD } from "../editor/TableGrid";
import { SHOW_SUGGESTIONS } from "../ui/SuggestingInput";
import { FileHistory } from "./fileHistory";
import { GraphView } from "./GraphView";
import { activeFile, activePath, closeGroup, closeTab, emptyLayout, findTab, groups, keepTab, placeTab, tabFor, type Layout, openTab, removePath, renamePath, split } from "./layout";
import { Panes } from "./Panes";
import { PdfView, UNDO_IN_READER } from "./PdfView";
import { BoardView } from "../board/BoardView";

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
  /** The Typst notes shown as code (their raw text), not formatted: each note has its own switch. */
  const [codeNotes, setCodeNotes] = useState<ReadonlySet<string>>(new Set());
  /** Shows a Typst note as code, or formatted again (the active note's, if none is said). */
  function toggleCode(path = activePath(panesRef.current)) {
    if (!path || noteFormat(path) !== "typst") return;
    setCodeNotes((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }
  const [showPages, setShowPages] = useState(false);
  const showPagesRef = useRef(false);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [filesError, setFilesError] = useState<string>();
  /** The panes and their tabs; the active pane's note is highlighted in the explorer. */
  const [panes, setPanes] = useState<Layout>(emptyLayout);
  // (For the menu's handler, set up once.)
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const openPath = activePath(panes);
  const openPathRef = useRef(openPath);
  openPathRef.current = openPath;
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
  /** Where a note or PDF just opened goes: a part of it, or a match of a text found in it. */
  const [goTo, setGoTo] = useState<{ path: string; part?: string; find?: FindAt }>();
  /** The search of the whole workspace (⌘⇧F): whether it's open, and the times it was asked for. */
  const [search, setSearch] = useState({ open: false, focus: 0 });
  /** A hidden sidebar comes out for ⌘⇧F, until a match is opened or the mouse leaves it. */
  const [searchShown, setSearchShown] = useState(false);
  const openSearch = () => {
    setSearch((current) => ({ open: true, focus: current.focus + 1 }));
    setSearchShown(true);
  };
  /** A file or folder the user asked to delete, waiting for them to confirm (a folder: with how many files are in it). */
  const [deleting, setDeleting] = useState<{ path: string; files?: number }>();
  /** The explorer's open folders (kept for the workspace), and the row clicked last. */
  const [openFolders, setOpenFolders] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  function changeOpenFolders(change: (open: Set<string>) => void) {
    setOpenFolders((current) => {
      const next = new Set(current);
      change(next);
      api.saveOpenFolders([...next]).catch(() => {});
      return next;
    });
  }
  useEffect(() => {
    api.getOpenFolders().then(
      (open) => setOpenFolders((current) => (current.size ? current : new Set(open))),
      () => {},
    );
  }, []);
  /** Opens a folder and the folders it's in, to show something in it. */
  const showFolder = (folder: string) =>
    changeOpenFolders((open) => {
      for (let at = folder; at; at = parentOf(at)) open.add(at);
    });
  const isFolder = (path: string) => {
    const find = (entries: FileEntry[]): FileEntry | undefined => {
      for (const entry of entries) {
        if (entry.path === path) return entry;
        const inside = entry.kind === "folder" && path.startsWith(`${entry.path}/`) ? find(entry.children) : undefined;
        if (inside) return inside;
      }
    };
    return find(filesRef.current)?.kind === "folder";
  };
  /** Where new notes and folders go: the selected folder, or the selected file's, or the top. */
  const targetFolder = () => (selected === null ? "" : isFolder(selected) ? selected : parentOf(selected));
  const selectedRef = useRef(targetFolder);
  selectedRef.current = targetFolder;
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
      const listed = await api.listFiles();
      setFiles(listed);
      filesRef.current = listed;
      setFilesError(undefined);
      return listed;
    } catch (error) {
      setFilesError(String(error));
      return filesRef.current;
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
  // (Zotero's papers, for the [[ list, are read again once Zotero changes.)
  useEffect(() => {
    const unlisten = api.onZoteroChanged(forgetZoteroPapers);
    return () => {
      unlisten.then((stop) => stop(), () => {});
    };
  }, []);
  useEffect(() => {
    setNoteLinkOpener(followLink);
    setLinkCopiedReporter(setNotice);
    setImageProblemReporter(setProblem);
    return () => {
      setNoteLinkOpener(null);
      setLinkCopiedReporter(null);
    };
  }, []);

  /**
   * A new note (Typst unless told), or a new board, opened to name it. Notes go in a folder (else
   * the one selected in the explorer); boards at the top.
   */
  async function newNote(format?: NoteFormat | "board", into?: string) {
    try {
      const folder = into ?? selectedRef.current();
      const path =
        format === "board"
          ? await api.createBoard()
          : folder
            ? await api.createNote(format, folder)
            : format
              ? await api.createNote(format)
              : await api.createNote();
      setProblem(undefined);
      if (parentOf(path)) showFolder(parentOf(path));
      setSelected(path);
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

  /** Renames a note (or any file) on disk; its open editor, undo history and the links to it follow it. */
  async function renameFile(path: string, newName: string) {
    // Save what was typed first, or it would be saved under the old name afterwards.
    await autosave.flush();
    const newPath = await api.renameNote(path, newName);
    if (newPath !== path) await followMoves([{ from: path, to: newPath }]);
    return newPath;
  }

  /** A new folder in a folder (else the one selected), its name ready to type. */
  async function newFolder(into?: string) {
    try {
      const path = await api.createFolder(into ?? selectedRef.current());
      setProblem(undefined);
      if (parentOf(path)) showFolder(parentOf(path));
      await loadFiles();
      setSelected(path);
      setRenamingPath(path);
    } catch (error) {
      setProblem(`Couldn't create the folder: ${error}`);
    }
  }

  /**
   * After files or folders moved: open notes, their histories, open folders and the selection
   * follow them, and links to them (or in them) are changed.
   */
  async function followMoves(moves: Moved[]) {
    const after = (path: string) => {
      for (const { from, to } of moves) {
        if (path === from) return to;
        if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
      }
      return path;
    };
    const listed = await loadFiles();
    for (const note of notesIn(listed)) {
      const before = moves.reduce((p, { from, to }) => (p === to || p.startsWith(`${to}/`) ? from + p.slice(to.length) : p), note);
      if (before !== note) moveNoteHistory(before, note);
    }
    await relink(notesIn(listed), moves);
    await relinkPdfs(await pdfsWithLinks(listed), moves);
    // (Open PDFs read their links again.)
    setSaves((count) => count + 1);
    setPanes((current) => {
      let next = current;
      for (const group of groups(current)) {
        for (const tab of group.tabs) if ("path" in tab && after(tab.path) !== tab.path) next = renamePath(next, tab.path, after(tab.path));
      }
      return next;
    });
    changeOpenFolders((open) => {
      const now = [...open].map(after);
      open.clear();
      for (const folder of now) open.add(folder);
    });
    setSelected((current) => (current === null ? null : after(current)));
  }

  /** Every PDF that may have links: the workspace's, and Zotero papers with annotations here. */
  async function pdfsWithLinks(listed: FileEntry[]) {
    const papers = await api.zoteroPapersWithAnnotations().catch(() => [] as string[]);
    return [...pdfsIn(listed), ...papers.map((id) => `zotero:${id}`)];
  }

  async function renameFolder(path: string, newName: string) {
    await autosave.flush();
    const newPath = await api.renameFolder(path, newName);
    setRenamingPath(undefined);
    if (newPath !== path) await followMoves([{ from: path, to: newPath }]);
  }

  /** Moves (or copies) a file or folder into a folder ("" for the top). */
  async function moveInto(path: string, folder: string, copy: boolean) {
    try {
      await autosave.flush();
      const newPath = copy ? await api.copyInto(path, folder) : await api.moveInto(path, folder);
      setProblem(undefined);
      if (folder) showFolder(folder);
      if (copy) {
        const listed = await loadFiles();
        await relink(notesIn(listed), [], [{ from: path, to: newPath }]);
        await relinkPdfs(await pdfsWithLinks(listed), [], [{ from: path, to: newPath }]);
      } else if (newPath !== path) {
        await followMoves([{ from: path, to: newPath }]);
      }
    } catch (reason) {
      setProblem(`Couldn't ${copy ? "copy" : "move"} “${fileName(path)}”: ${reason}`);
    }
  }

  /** Delete (right-click, or the keyboard): a file or a folder with files in it asks first; an empty folder just goes. */
  async function askToDelete(path: string) {
    if (!isFolder(path)) return setDeleting({ path });
    try {
      const count = await api.filesInFolder(path);
      if (count === 0) await deleteFolder(path);
      else setDeleting({ path, files: count });
    } catch (reason) {
      setProblem(`Couldn't delete “${fileName(path)}”: ${reason}`);
    }
  }

  /** Deletes a folder and what's in it (to the system's Trash); notes open from it close. */
  async function deleteFolder(path: string) {
    setDeleting(undefined);
    try {
      await autosave.flush();
      await api.deleteFolder(path);
      const inside = (p: string) => p === path || p.startsWith(`${path}/`);
      for (const note of notesIn(filesRef.current).filter(inside)) forgetNoteHistory(note);
      setPanes((current) => {
        let next = current;
        for (const group of groups(current)) for (const tab of group.tabs) if ("path" in tab && inside(tab.path)) next = removePath(next, tab.path);
        return next;
      });
      changeOpenFolders((open) => {
        for (const folder of [...open]) if (inside(folder)) open.delete(folder);
      });
      setSelected((current) => (current !== null && inside(current) ? null : current));
      setProblem(undefined);
    } catch (reason) {
      setProblem(`Couldn't delete “${fileName(path)}”: ${reason}`);
    }
    await loadFiles();
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
      const inApp = noteFormat(path) || /\.(pdf|canvas)$/i.test(path) || path.startsWith("zotero:");
      if (!inApp) return await api.openFile(path);
      if (path.startsWith("zotero:")) {
        // (A Zotero paper: its PDF opens from Zotero, which says if it can't.)
      } else if (noteFormat(path)) {
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
    // (A note not created yet is made; a PDF opens in the reader.)
    const tab = { ...tabFor(path), preview: true };
    if (tab.kind === "note" && !(await ensureNote(path))) return;
    setPanes((current) => {
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

  /**
   * Exports a Typst note (the one shown, unless said) as a PDF, where the user chooses: the Save
   * dialog starts beside the note, with its name. What's typed counts, even if not saved yet.
   */
  async function exportPdf(path = openPathRef.current) {
    if (!path) return setProblem("Open a Typst note to export it as a PDF.");
    if (noteFormat(path) !== "typst") return setProblem("Only Typst notes can be exported as PDFs.");
    const destination = await api.pickPdfDestination(`${workspace.path}/${path.replace(/\.typ$/i, "")}.pdf`);
    if (!destination) return;
    try {
      await autosave.flush();
      await api.exportPdf(await api.readNote(path), path, destination);
      setProblem(undefined);
      setNotice(`Exported “${fileName(destination)}”.`);
    } catch (reason) {
      setProblem(`Couldn't export “${fileName(path)}”: ${reason}`);
    }
  }

  /** ⌘W: closes the shown tab; with no tab open anywhere, the window (the app quits). */
  function closeTabOrWindow() {
    if (groups(panesRef.current).some((group) => group.tabs.length)) closeActiveTab();
    else api.closeWindow().catch(() => {});
  }

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
    if (!readerTookIt(kind)) stepFileHistory(kind);
  }

  /** A PDF reader with the focus undoes, or redoes, its own changes to its annotations first. */
  function readerTookIt(kind: "undo" | "redo") {
    const focused = document.activeElement;
    const reader = focused instanceof Element ? focused.closest("[data-pdf-reader]") : null;
    return !!reader && !reader.dispatchEvent(new CustomEvent(UNDO_IN_READER, { detail: kind, cancelable: true }));
  }

  // ⌘⇧F (Ctrl+Shift+F elsewhere): search the whole workspace, in the sidebar.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
      event.preventDefault();
      openSearch();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

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
      const kind = isRedo ? "redo" : "undo";
      if (!readerTookIt(kind)) stepFileHistory(kind);
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

  /** Folds a sidebar section away, or opens it again. */
  const toggleSection = (section: Section) =>
    changeLayout((l) => {
      const collapsed = l.collapsed ?? { files: false, library: false };
      return { ...l, collapsed: { ...collapsed, [section]: !collapsed[section] } };
    });

  /** Zotero papers' titles, by the path their PDFs are open with (for their tabs). */
  const [paperTitles, setPaperTitles] = useState<ReadonlyMap<string, string>>(new Map());
  // Zotero papers opened some other way (from a link, or open last time) are named by their titles too.
  const papersOpen = groups(panes)
    .flatMap((group) => group.tabs.flatMap((tab) => ("path" in tab ? [tab.path] : [])))
    .filter((path) => path.startsWith("zotero:"));
  const untitled = papersOpen.filter((path) => !paperTitles.has(path)).join("\n");
  useEffect(() => {
    if (!untitled) return;
    let current = true;
    for (const path of untitled.split("\n")) {
      findPaper(path.slice("zotero:".length)).then((paper) => {
        if (current && paper) setPaperTitles((titles) => new Map(titles).set(path, paper.title));
      });
    }
    return () => {
      current = false;
    };
  }, [untitled]);

  function openPaper(paper: api.ZoteroItem, newPane: boolean) {
    const path = zoteroPath(paper.id);
    setPaperTitles((titles) => new Map(titles).set(path, paper.title));
    openNote(path, { newPane });
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
      if (action === "toggle-code") toggleCode();
      if (action === "undo" || action === "redo") undoOrRedo(action);
      if (action === "show-suggestions") showSuggestions();
      if (action === "open-settings") setSettingsOpen(true);
      if (action === "go-to-file") setPalette("");
      if (action === "command-palette") setPalette(">");
      if (action === "graph-view") openGraph();
      if (action === "close-pane") closeActivePane();
      if (action === "close-tab") closeTabOrWindow();
      if (action === "export-pdf") exportPdf();
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
          onRename: (newName: string) => (isFolder(renamingPath) ? renameFolder(renamingPath, newName) : renameNote(renamingPath, newName)),
          onCancel: () => setRenamingPath(undefined),
        }
      : undefined,
    onTogglePinned: togglePinned,
    onNewNote: (folder?: string) => newNote(undefined, folder),
    onNewFolder: newFolder,
    onStartRenaming: setRenamingPath,
    onDelete: askToDelete,
    openFolders,
    onToggleFolder: (path: string) =>
      changeOpenFolders((open) => {
        if (!open.delete(path)) open.add(path);
      }),
    onCollapseAll: () => changeOpenFolders((open) => open.clear()),
    selected,
    onSelect: setSelected,
    onMove: moveInto,
    workspaceName: workspace.name,
    onToggleSection: toggleSection,
    onOpenPaper: openPaper,
    search: {
      ...search,
      onOpen: openSearch,
      onClose: () => {
        setSearch((current) => ({ ...current, open: false }));
        setSearchShown(false);
      },
      onOpenMatch: (path: string, query: string, match: Match, newPane: boolean) => {
        setSearchShown(false);
        openNote(path, { newPane });
        setGoTo({ path, find: { query, nth: match.nth, ...(match.page === undefined ? {} : { page: match.page }) } });
      },
    },
  };

  // What the command palette (⌘⇧P) can do, named like the menus.
  const commands: Command[] = [
    { label: "Settings: Open Settings", run: () => setSettingsOpen(true) },
    {
      label: `Settings: Turn ${editorSettings.blockHandles ? "Off" : "On"} Block Handles`,
      run: () => changeEditorSettings({ ...editorSettings, blockHandles: !editorSettings.blockHandles }),
    },
    { label: "File: New Note", run: () => newNote() },
    { label: "Search: Find in Workspace", run: openSearch },
    { label: "File: New Board", run: () => newNote("board") },
    { label: "File: New Markdown Note", run: () => newNote("markdown") },
    { label: "File: Export as PDF…", run: () => exportPdf() },
    { label: `View: ${showPages ? "Hide" : "Show"} Preview`, run: toggleShowPages },
    ...(noteFormat(activePath(panes) ?? "") === "typst"
      ? [{ label: `View: ${codeNotes.has(activePath(panes)!) ? "Show Formatted" : "Show Code"}`, run: () => toggleCode() }]
      : []),
    { label: `View: ${layout.mode === "pinned" ? "Unpin" : "Pin"} File Explorer`, run: togglePinned },
    { label: "View: Move File Explorer to Other Side", run: moveToOtherSide },
    { label: "View: Open Graph View", run: openGraph },
    { label: "View: Close Tab", run: closeActiveTab },
    { label: "View: Close Pane", run: closeActivePane },
  ];

  return (
    <div className="flex h-screen flex-col bg-white">
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
            onMouseLeave={() => {
              setHovering(false);
              setSearchShown(false);
            }}
            className="relative z-10 h-full w-2 shrink-0"
          >
            {/* Always mounted so it can animate out and keeps its open folders.
                Stays out while a new note is being named, so the name field doesn't vanish. */}
            <FileExplorer {...explorerProps} floating visible={hovering || !!renamingPath || searchShown} />
          </div>
        )}
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <Panes
            layout={panes}
            onChange={setPanes}
            // (With the sidebar on the left, the window's buttons are on it, or hidden with it.)
            roomForWindowButtons={layout.side === "right"}
            tabMenu={(tab) =>
              tab.kind === "note" && noteFormat(tab.path) === "typst"
                ? [
                    { label: showPages ? "Hide Preview" : "Show Preview", icon: mdiFileDocumentMultipleOutline, run: toggleShowPages },
                    { label: codeNotes.has(tab.path) ? "Show Formatted" : "Show Code", icon: mdiCodeTags, run: () => toggleCode(tab.path) },
                  ]
                : []
            }
            label={(tab) =>
              tab.kind === "graph" ? "Graph" : tab.kind === "pdf" ? (paperTitles.get(tab.path) ?? fileName(tab.path)) : nameOf(tab.path)
            }
            title={(tab) => (tab.kind === "graph" ? "Graph" : (paperTitles.get(tab.path) ?? tab.path))}
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
                  showCode={codeNotes.has(tab.path)}
                  onHidePages={toggleShowPages}
                  onExportPdf={() => exportPdf(tab.path)}
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
        <ConfirmDelete
          name={fileName(deleting.path)}
          files={deleting.files}
          onDelete={() => (deleting.files === undefined ? deleteFile(deleting.path) : deleteFolder(deleting.path))}
          onCancel={() => setDeleting(undefined)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          settings={editorSettings}
          onChange={changeEditorSettings}
          sidebarSide={layout.side}
          onSidebarSideChange={(side) => changeLayout((l) => ({ ...l, side }))}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Every note in the workspace's files. */
function notesIn(entries: FileEntry[]): string[] {
  return entries.flatMap((entry) => (entry.kind === "folder" ? notesIn(entry.children) : noteFormat(entry.path) ? [entry.path] : []));
}

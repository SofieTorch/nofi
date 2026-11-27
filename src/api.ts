// The only place the frontend talks to the Rust backend or native OS dialogs.
// Components use this module, so tests can replace it with a fake.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";

export type Workspace = {
  name: string;
  path: string;
};

/** The workspace used last time, if its folder still exists. */
export function getLastWorkspace(): Promise<Workspace | null> {
  return invoke("get_last_workspace");
}

/** Opens a folder as the workspace and remembers it for next launch. Rejects with a readable message. */
export function openWorkspace(path: string): Promise<Workspace> {
  return invoke("open_workspace", { path });
}

/** Shows the native folder picker. Resolves to null if the user cancels. */
export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  return typeof selected === "string" ? selected : null;
}

/** Closes the current workspace so the next launch shows the workspace picker. */
export function closeWorkspace(): Promise<void> {
  return invoke("close_workspace");
}

/** Recently used workspaces whose folders still exist, most recent first. */
export function getRecentWorkspaces(): Promise<Workspace[]> {
  return invoke("get_recent_workspaces");
}

export type MenuAction =
  | "new-note"
  | "new-markdown-note"
  | "new-board"
  | "close-workspace"
  | "toggle-explorer-pinned"
  | "move-explorer-to-other-side"
  | "toggle-pages"
  | "toggle-code"
  | "undo"
  | "redo"
  | "show-suggestions"
  | "open-settings"
  | "go-to-file"
  | "command-palette"
  | "graph-view"
  | "close-pane"
  | "close-tab"
  | "export-pdf";

/** Closes the app's window (⌘W with no tab open): the app quits. */
export function closeWindow(): Promise<void> {
  return invoke("close_window");
}

/** Calls `handler` whenever the user chooses one of the app's items in the native menu. */
export function onMenuAction(handler: (action: MenuAction) => void): Promise<UnlistenFn> {
  return listen<MenuAction>("menu", (event) => handler(event.payload));
}

/** Calls `handler` whenever files come and go in the open workspace's folder (in any app). */
export function onFilesChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("files-changed", () => handler());
}

/** Calls `handler` whenever the Zotero library changes (once it's been read), to read it again. */
export function onZoteroChanged(handler: () => void): Promise<UnlistenFn> {
  return listen("zotero-changed", () => handler());
}

export type FileEntry = {
  name: string;
  /** Relative to the workspace folder, with "/" separators. */
  path: string;
  kind: "file" | "folder";
  children: FileEntry[];
};

/** Everything in the open workspace except hidden files, folders first, sorted by name. */
export function listFiles(): Promise<FileEntry[]> {
  return invoke("list_files");
}

export type ExplorerLayout = {
  side: "left" | "right";
  /** "pinned" stays visible; "auto-hide" shows up, floating, when hovering its edge of the window. */
  mode: "pinned" | "auto-hide";
  /** Which of its sections are folded away (all open if not said). */
  collapsed?: { files: boolean; library: boolean };
};

/** The explorer layout saved for the open workspace (pinned on the left if never changed). */
export function getExplorerLayout(): Promise<ExplorerLayout> {
  return invoke("get_explorer_layout");
}

export function saveExplorerLayout(layout: ExplorerLayout): Promise<void> {
  return invoke("save_explorer_layout", { layout });
}

export type NoteFormat = "typst" | "markdown";

/**
 * Creates an empty note at the top of the workspace, named "Untitled" (then "Untitled 2"…).
 * Without a format, uses the default (Typst). Resolves to the new note's path in the workspace.
 */
export function createNote(format?: NoteFormat, folder?: string): Promise<string> {
  return invoke("create_note", { format, folder });
}

/** Creates an empty folder, "New folder" (or "New folder 2"…), in a folder ("" for the top); resolves to its path. */
export function createFolder(parent: string): Promise<string> {
  return invoke("create_folder", { parent });
}

/** Gives a folder a new name; resolves to its new path, or rejects with a readable reason. */
export function renameFolder(path: string, newName: string): Promise<string> {
  return invoke("rename_folder", { path, newName });
}

/** How many files are in a folder, in all its folders. */
export function filesInFolder(path: string): Promise<number> {
  return invoke("files_in_folder", { path });
}

/** Deletes a folder and what's in it by sending it to the system's Trash. */
export function deleteFolder(path: string): Promise<void> {
  return invoke("delete_folder", { path });
}

/** Moves a file or folder into a folder ("" for the top); resolves to its new path. */
export function moveInto(path: string, folder: string): Promise<string> {
  return invoke("move_into", { path, folder });
}

/** Copies a file or folder into a folder ("" for the top), "copy" added to its name if taken; resolves to the copy's path. */
export function copyInto(path: string, folder: string): Promise<string> {
  return invoke("copy_into", { path, folder });
}

/** The explorer's open folders in this workspace. */
export function getOpenFolders(): Promise<string[]> {
  return invoke("get_open_folders");
}

export function saveOpenFolders(open: string[]): Promise<void> {
  return invoke("save_open_folders", { open });
}

/** Which libraries and collections are open in the Library, by id; null if never changed. */
export function getOpenInLibrary(): Promise<string[] | null> {
  return invoke("get_open_in_library");
}

export function saveOpenInLibrary(open: string[]): Promise<void> {
  return invoke("save_open_in_library", { open });
}

/**
 * Gives a note a new name, typed without its extension: its format and folder stay the same.
 * Resolves to the note's new path; rejects with a readable reason (e.g. the name is taken).
 */
export function renameNote(path: string, newName: string): Promise<string> {
  return invoke("rename_note", { path, newName });
}

/** What's written in a note (path relative to the workspace). */
export function readNote(path: string): Promise<string> {
  return invoke("read_note", { path });
}

/** Replaces what's written in a note. Rejects with a readable reason. */
export function saveNote(path: string, contents: string): Promise<void> {
  return invoke("save_note", { path, contents });
}

/**
 * Draws a piece of maths, written with its dollars (`$x^2$`, or `$ x^2 $` for a display
 * equation), with the Typst compiler. Resolves to an SVG picture; rejects with what's wrong.
 */
export function renderMaths(maths: string): Promise<string> {
  return invoke("render_maths", { maths });
}

/** Whether Typst notes are shown as pages next to the editor in this workspace (off at first). */
export function getShowPages(): Promise<boolean> {
  return invoke("get_show_pages");
}

export function saveShowPages(show: boolean): Promise<void> {
  return invoke("save_show_pages", { show });
}

/** One page of a note: an SVG picture and its size in points. */
export type PagePicture = { svg: string; width: number; height: number };

/** Draws a Typst note as pages. Rejects with its first mistake, e.g. "Line 2: Unknown variable: x." */
export function renderPages(note: string, path?: string): Promise<PagePicture[]> {
  // (With the note's path, it can use the workspace's files, like images.)
  if (path !== undefined) return invoke("render_pages", { note, path });
  return invoke("render_pages", { note });
}

/**
 * Where in the note's text a click on one of its last drawn pages lands (`x`, `y` in points from
 * the page's top left), counted like the editor counts characters. Null if there's no text there.
 */
/**
 * A place in a note's text on its pages: the text (as the editor counts), its page (from 0), and
 * how far down and across it (points).
 */
export type PagePlace = { offset: number; page: number; y: number; x?: number };

/** Where the note last drawn as pages has its text on them, in the note's order. */
export function pagePlaces(): Promise<PagePlace[]> {
  return invoke("page_places");
}

export function pagePosition(page: number, x: number, y: number): Promise<number | null> {
  return invoke("page_position", { page, x, y });
}

/** Shows the native Save dialog for a PDF, starting at `defaultPath`. Resolves to null if the user cancels. */
export async function pickPdfDestination(defaultPath: string): Promise<string | null> {
  return (await save({ defaultPath, filters: [{ name: "PDF", extensions: ["pdf"] }] })) ?? null;
}

/**
 * Exports a Typst note (its text, and its path in the workspace, for its images and such) as a
 * PDF file at `destination` (a full path). Rejects with the note's first mistake, if it has one.
 */
export function exportPdf(note: string, path: string, destination: string): Promise<void> {
  return invoke("export_pdf", { note, path, destination });
}

/** Undoes creating a note: removes it, but only while it's still empty. */
export function removeEmptyNote(path: string): Promise<void> {
  return invoke("remove_empty_note", { path });
}

/** Redoes creating a note: brings it back, empty, at the same place. Never overwrites a note. */
export function restoreEmptyNote(path: string): Promise<void> {
  return invoke("restore_empty_note", { path });
}

/** Creates an empty note at a path (for a link to a note that doesn't exist yet); returns its path. */
/** The notes that link to a file (like a PDF), maybe to a part of it. */
export function notesLinkingTo(path: string): Promise<string[]> {
  return invoke("notes_linking_to", { path });
}

/** Creates an empty board (whiteboard), `Untitled.canvas`, and returns its path. */
export function createBoard(): Promise<string> {
  return invoke("create_board");
}

export function createNoteAt(path: string): Promise<string> {
  return invoke("create_note_at", { path });
}

/** Deletes a file (any kind, not a folder) by sending it to the system's Trash. */
export function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path });
}

/** A line of a note with the text that was looked for. */
export type TextMatch = {
  path: string;
  /** From 1. */
  line: number;
  /** Where the match starts in its line, and how long it is (counted like the editor). */
  column: number;
  length: number;
  /** The line to show (shortened around the match if long), and where the match is in it. */
  preview: string;
  previewColumn: number;
};

/** The lines of the workspace's notes with some text in them (ignoring case). */
export function searchNotes(query: string): Promise<TextMatch[]> {
  return invoke("search_notes", { query });
}

/** Saves an image (pasted or dropped) in the workspace's `assets` folder; returns its path there. */
export function saveAsset(name: string, bytes: Uint8Array): Promise<string> {
  return invoke("save_asset", bytes, { headers: { name: encodeURIComponent(name) } });
}

/** A paper in the user's Zotero library. */
export type ZoteroItem = {
  /** Its key in the user's own library (`ABCD2345`), or `groups/<group id>/<key>` in a group's. */
  id: string;
  title: string;
  /** Its authors' last names, in order. */
  authors: string[];
  year: number | null;
  /** Zotero's item type, like `journalArticle` (`attachment` for a PDF on its own). */
  kind: string;
  /** Whether it has a PDF. */
  pdf: boolean;
};

export type ZoteroCollection = {
  key: string;
  name: string;
  /** The collection it's in, if it's inside another. */
  parent: string | null;
  /** Its papers' ids. */
  items: string[];
};

export type ZoteroLibrary = {
  /** The user's own library first, then group libraries: their collections and every paper, by title. */
  libraries: {
    /** `user` for the user's own library, `groups/<group id>` for a group's. */
    id: string;
    name: string;
    collections: ZoteroCollection[];
    items: ZoteroItem[];
  }[];
};

/**
 * What's hidden in the sidebar's Library, in the open workspace: libraries by id (`user`,
 * `groups/77`), collections as `<library id>/collections/<key>`.
 */
export function getHiddenInLibrary(): Promise<string[]> {
  return invoke("get_hidden_in_library");
}

export function saveHiddenInLibrary(hidden: string[]): Promise<void> {
  return invoke("save_hidden_in_library", { hidden });
}

/**
 * Shows or hides the window's buttons (close, minimise, zoom; on a Mac). With `fade`, like the
 * floating sidebar they're part of: they fade in once it's slid in (after 200ms), and out as it
 * starts to leave; without, they just show or hide.
 */
export function showWindowButtons(shown: boolean, fade = false): Promise<void> {
  return invoke("show_window_buttons", { shown, fade });
}

/** The sidebar's width (pixels), and the share of its height the Files section has. */
export type SidebarSizes = { width: number; filesShare: number };

/** The sidebar's sizes, the same in every workspace. */
export function getSidebarSizes(): Promise<SidebarSizes> {
  return invoke("get_sidebar_sizes");
}

export function saveSidebarSizes(sizes: SidebarSizes): Promise<void> {
  return invoke("save_sidebar_sizes", { sizes });
}

/** The user's Zotero library, or null if Zotero isn't on this computer. */
/**
 * The Zotero papers with annotations in this workspace (their ids): their annotations are kept in
 * its hidden folder, `.marginalia/zotero/<id>.annotations.json`, so they're not in its files.
 */
export function zoteroPapersWithAnnotations(): Promise<string[]> {
  return invoke("zotero_papers_with_annotations");
}

export function zoteroLibrary(): Promise<ZoteroLibrary | null> {
  return invoke("zotero_library");
}

/** A Zotero paper's PDF (the paper's id), as raw bytes. */
export function readZoteroPdf(id: string): Promise<ArrayBuffer> {
  return invoke("read_zotero_pdf", { id });
}

/** A file in the workspace, as bytes (for images in the editor, and the PDF reader). */
export function readWorkspaceFile(path: string): Promise<ArrayBuffer> {
  return invoke("read_workspace_file", { path });
}

/** Opens a website (or email address) from a link, in the browser (or mail app). */
export function openUrl(url: string): Promise<void> {
  return invoke("open_url", { url });
}

/** Opens a workspace file from a link in its own app (for files the app doesn't show itself). */
export function openFile(path: string): Promise<void> {
  return invoke("open_file", { path });
}

/** A link from one note to another (which may not exist yet). */
export type NoteLink = { from: string; to: string };

/** The links between the workspace's notes, for the graph view. */
export function noteLinks(): Promise<NoteLink[]> {
  return invoke("note_links");
}

/** How the editor behaves, in every workspace. */
export type EditorSettings = {
  /** Whether blocks show a handle in the margin to drag them around. */
  blockHandles: boolean;
  /** What boards are drawn on: plain white (the default), or a grid like Miro's. */
  boardBackground: BoardBackground;
};
export type BoardBackground = "plain" | "grid";

export function getEditorSettings(): Promise<EditorSettings> {
  return invoke("get_editor_settings");
}

export function saveEditorSettings(editor: EditorSettings): Promise<void> {
  return invoke("save_editor_settings", { editor });
}

/** A property's value; its type comes from how it's written in the note. */
export type PropertyValue =
  | { type: "text"; value: string }
  | { type: "number"; value: number }
  | { type: "boolean"; value: boolean }
  | { type: "date"; value: string }
  | { type: "list"; value: string[] }
  /** Something the table can't edit (like a nested group): kept exactly as written. */
  | { type: "other" };

export type Property = {
  key: string;
  value: PropertyValue;
  /** How it's written in the note, while unchanged; set to null when edited. */
  raw: string | null;
};

/** The properties in a note's properties block (its `---` or `#metadata` block). */
export function parseProperties(format: NoteFormat, block: string): Promise<Property[]> {
  return invoke("parse_properties", { format, block });
}

/** The properties block for these properties; empty when there are none. */
export function writeProperties(format: NoteFormat, properties: Property[]): Promise<string> {
  return invoke("write_properties", { format, properties });
}

/** A Typst note's page settings. Missing means Typst's default. */
export type PageSettings = {
  paper?: string | null;
  landscape?: boolean | null;
  columns?: number | null;
  marginCm?: number | null;
  font?: string | null;
  textSizePt?: number | null;
  justify?: boolean | null;
  lineSpacingEm?: number | null;
  firstLineIndentEm?: number | null;
  language?: string | null;
  pageNumbers?: string | null;
  header?: string | null;
  footer?: string | null;
};

export type ReadPageSettings = {
  values: PageSettings;
  /** Settings written another way in the note's code ("paper", "margin", "textSize"…). */
  locked: string[];
};

/** One change; `null` goes back to Typst's default. */
export type PageSetting =
  | { setting: "paper"; value: string | null }
  | { setting: "landscape"; value: boolean | null }
  | { setting: "columns"; value: number | null }
  | { setting: "marginCm"; value: number | null }
  | { setting: "font"; value: string | null }
  | { setting: "textSizePt"; value: number | null }
  | { setting: "justify"; value: boolean | null }
  | { setting: "lineSpacingEm"; value: number | null }
  | { setting: "firstLineIndentEm"; value: number | null }
  | { setting: "language"; value: string | null }
  | { setting: "pageNumbers"; value: string | null }
  | { setting: "header"; value: string | null }
  | { setting: "footer"; value: string | null };

/** A Typst note's page settings, from its `#set page(…)` and `#set text(…)` rules. */
export function readPageSettings(note: string): Promise<ReadPageSettings> {
  return invoke("read_page_settings", { note });
}

/** The note with one page setting changed. Rejects if it's set in the note's own code. */
export function changePageSetting(note: string, setting: PageSetting): Promise<string> {
  return invoke("change_page_setting", { note, setting });
}

/** Every font a note can use, in alphabetical order. */
export function listFonts(): Promise<string[]> {
  return invoke("list_fonts");
}

/** One suggestion while writing Typst. */
export type TypstSuggestion = {
  label: string;
  /** "function", "parameter", "constant", "font", "symbol"… */
  kind: string;
  /** For maths symbols: the symbol itself (like "α"). */
  symbol: string | null;
  /** A short description, at most one sentence. */
  detail: string | null;
  /** What to insert, where the cursor goes in it, and how much to select there. */
  insert: string;
  cursor: number;
  selection: number;
};

/** Suggestions at a cursor position in a Typst note (null if there are none there). */
export function completeTypst(
  note: string,
  cursor: number,
  explicit: boolean,
): Promise<{ from: number; items: TypstSuggestion[] } | null> {
  return invoke("complete_typst", { note, cursor, explicit });
}

/** A property name used in the workspace, for suggestions in the properties table. */
export type KnownProperty = {
  key: string;
  /** The type it's most often given. */
  kind: "text" | "number" | "boolean" | "date" | "list";
  /** How many notes use it (0 for common names suggested to everyone). */
  notes: number;
  /** Text values and list items it has in notes, most used first. */
  values: string[];
};

/** Property names used in the workspace's notes, most used first, then a few common ones. */
export function suggestProperties(): Promise<KnownProperty[]> {
  return invoke("suggest_properties");
}

/** Replacing `from..to` with `insert` fixes a problem. */
export type Fix = { label: string; from: number; to: number; insert: string };

/** A mistake in a Typst note, explained, with fixes that are known to help. */
export type Problem = {
  from: number;
  to: number;
  /** "error": the note can't be drawn. "warning": it can, but something is off. */
  severity: "error" | "warning";
  message: string;
  hints: string[];
  fixes: Fix[];
};

/** The mistakes in a Typst note (empty if there are none). */
export function checkNote(note: string, path?: string): Promise<Problem[]> {
  // (With the note's path, it can use the workspace's files, like images.)
  if (path !== undefined) return invoke("check_note", { note, path });
  return invoke("check_note", { note });
}

/** A block the "/" menu can insert. */
export type SlashCommand = {
  id: string;
  label: string;
  /** The group it's listed under ("Text", "Lists", "Maths"…). */
  section: string;
  /** Other words it can be found by. */
  keywords: string[];
  description: string;
  /** What to insert, where the cursor goes, and how much is selected there to type over. */
  insert: string;
  cursor: number;
  selection: number;
  /** Blocks start on their own line. */
  block: boolean;
};

/** The "/" menu's commands for a note format. */
export function slashCommands(format: NoteFormat): Promise<SlashCommand[]> {
  return invoke("slash_commands", { format });
}

/** Draws a table, figure or grid (as written in the note) as an SVG picture. */
export function renderBlock(block: string): Promise<string> {
  return invoke("render_block", { block });
}

export type TableInfo = {
  columns: number;
  /** Rows under the header. */
  rows: number;
  header: boolean;
  caption: string | null;
  /** The cell the cursor is in (the row is null in the header). */
  row: number | null;
  column: number | null;
};

export type TableAction =
  | { action: "addRowBelow" }
  | { action: "addColumnRight" }
  | { action: "deleteRow" }
  | { action: "deleteColumn" }
  | { action: "toggleHeader" }
  | { action: "setCaption"; value: string | null }
  | { action: "setLines"; value: TableLines }
  | { action: "setStriped"; value: boolean }
  | { action: "setShadedHeader"; value: boolean }
  | { action: "setAlign"; value: { column: number; align: TableAlign } }
  | { action: "setSpacing"; value: TableSpacing }
  | { action: "setWidths"; value: TableWidths }
  /** `row` null is the header. Text that would break the note is written as plain text. */
  | { action: "setCell"; value: { row: number | null; column: number; text: string } };

/** What a table (as written) is like, with the cursor at `cursor` in it. Rejects if it's code-only. */
export function tableInfo(block: string, cursor: number): Promise<TableInfo> {
  return invoke("table_info", { block, cursor });
}

/** The table with one change made, and where the cursor goes in it. */
export function editTable(block: string, cursor: number, action: TableAction): Promise<{ block: string; cursor: number }> {
  return invoke("edit_table", { block, cursor, action });
}

/** One cell as the table editor shows it. */
export type TableCell = {
  /** As typed if it's plain text; as Typst markup otherwise. */
  text: string;
  /** False for cells written as code, which are left as they are. */
  editable: boolean;
  /** Where it starts in the table. */
  start: number;
};

/** Lines around every cell, between rows only, academic (top, under the header, bottom), or none. */
export type TableLines = "all" | "rows" | "academic" | "none";
export type TableAlign = "left" | "center" | "right";
/** The room inside cells. */
export type TableSpacing = "compact" | "normal" | "roomy";
/** Columns as wide as their content, or sharing the width equally. */
export type TableWidths = "auto" | "equal";

/** A table's style. Each is null when it's written some other way, as code ("custom"). */
export type TableStyle = {
  lines: TableLines | null;
  striped: boolean | null;
  shadedHeader: boolean | null;
  /** Each column's alignment. */
  align: TableAlign[] | null;
  spacing: TableSpacing | null;
  widths: TableWidths | null;
};

export type TableCells = {
  columns: number;
  header: TableCell[] | null;
  rows: TableCell[][];
  caption: string | null;
  style: TableStyle;
};

/** A table's cells, for the table editor. Rejects for tables it can't edit. */
export function readTable(block: string): Promise<TableCells> {
  return invoke("read_table", { block });
}

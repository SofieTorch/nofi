// The only place the frontend talks to the Rust backend or native OS dialogs.
// Components use this module, so tests can replace it with a fake.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

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
  | "close-workspace"
  | "toggle-explorer-pinned"
  | "move-explorer-to-other-side";

/** Calls `handler` whenever the user chooses one of the app's items in the native menu. */
export function onMenuAction(handler: (action: MenuAction) => void): Promise<UnlistenFn> {
  return listen<MenuAction>("menu", (event) => handler(event.payload));
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
export function createNote(format?: NoteFormat): Promise<string> {
  return invoke("create_note", { format });
}

/**
 * Gives a note a new name, typed without its extension: its format and folder stay the same.
 * Resolves to the note's new path; rejects with a readable reason (e.g. the name is taken).
 */
export function renameNote(path: string, newName: string): Promise<string> {
  return invoke("rename_note", { path, newName });
}

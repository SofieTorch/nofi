// A fake of src/api.ts for tests. Each test file must also call `vi.mock("../src/api")`.

import { act } from "@testing-library/react";
import { vi } from "vitest";
import * as api from "../../src/api";
import { forgetMathsPictures } from "../../src/editor/mathsPictures";
import { forgetFonts } from "../../src/editor/fonts";
import { forgetPictures } from "../../src/editor/images";
import { forgetSlashCommands } from "../../src/editor/slashMenu";
import { forgetZoteroPapers } from "../../src/editor/noteLinks";
import { forgetTableReads } from "../../src/editor/TableGrid";

let menuHandlers: ((action: api.MenuAction) => void)[] = [];
let fileHandlers: (() => void)[] = [];
let zoteroHandlers: (() => void)[] = [];

/** Defaults: first launch, no recent workspaces, an empty workspace, every call succeeds. */
export function setUpFakeBackend() {
  vi.resetAllMocks();
  forgetMathsPictures();
  forgetSlashCommands();
  forgetZoteroPapers();
  forgetFonts();
  forgetTableReads();
  forgetPictures();
  menuHandlers = [];
  fileHandlers = [];
  zoteroHandlers = [];
  vi.mocked(api.onZoteroChanged).mockImplementation(async (handler) => {
    zoteroHandlers.push(handler);
    return () => {
      zoteroHandlers = zoteroHandlers.filter((h) => h !== handler);
    };
  });
  vi.mocked(api.onFilesChanged).mockImplementation(async (handler) => {
    fileHandlers.push(handler);
    return () => {
      fileHandlers = fileHandlers.filter((h) => h !== handler);
    };
  });
  vi.mocked(api.getLastWorkspace).mockResolvedValue(null);
  vi.mocked(api.getRecentWorkspaces).mockResolvedValue([]);
  vi.mocked(api.closeWorkspace).mockResolvedValue();
  vi.mocked(api.listFiles).mockResolvedValue([]);
  vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "left", mode: "pinned" });
  vi.mocked(api.saveExplorerLayout).mockResolvedValue();
  vi.mocked(api.createNote).mockResolvedValue("Untitled.typ");
  vi.mocked(api.createBoard).mockResolvedValue("Untitled.canvas");
  vi.mocked(api.notesLinkingTo).mockResolvedValue([]);
  vi.mocked(api.renameNote).mockImplementation(async (path, newName) =>
    path.replace(/[^/]*?(\.[^./]+)?$/, `${newName}$1`),
  );
  vi.mocked(api.readNote).mockResolvedValue("");
  vi.mocked(api.saveNote).mockResolvedValue();
  vi.mocked(api.renderMaths).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"/>');
  vi.mocked(api.removeEmptyNote).mockResolvedValue();
  vi.mocked(api.restoreEmptyNote).mockResolvedValue();
  vi.mocked(api.deleteFile).mockResolvedValue();
  vi.mocked(api.createFolder).mockImplementation(async (parent) => (parent ? `${parent}/New folder` : "New folder"));
  vi.mocked(api.renameFolder).mockImplementation(async (path, newName) => path.replace(/[^/]*$/, newName));
  vi.mocked(api.filesInFolder).mockResolvedValue(0);
  vi.mocked(api.deleteFolder).mockResolvedValue();
  vi.mocked(api.moveInto).mockImplementation(async (path, folder) => (folder ? `${folder}/` : "") + path.split("/").pop());
  vi.mocked(api.copyInto).mockImplementation(async (path, folder) => (folder ? `${folder}/` : "") + path.split("/").pop());
  vi.mocked(api.getOpenFolders).mockResolvedValue([]);
  vi.mocked(api.getOpenInLibrary).mockResolvedValue(null);
  vi.mocked(api.saveOpenInLibrary).mockResolvedValue();
  vi.mocked(api.saveOpenFolders).mockResolvedValue();
  vi.mocked(api.createNoteAt).mockImplementation(async (path) => path);
  vi.mocked(api.searchNotes).mockResolvedValue([]);
  vi.mocked(api.noteLinks).mockResolvedValue([]);
  vi.mocked(api.openUrl).mockResolvedValue();
  vi.mocked(api.openFile).mockResolvedValue();
  vi.mocked(api.saveAsset).mockImplementation(async (name) => `assets/${name}`);
  vi.mocked(api.readWorkspaceFile).mockResolvedValue(new ArrayBuffer(8));
  vi.mocked(api.zoteroLibrary).mockResolvedValue(null);
  vi.mocked(api.getHiddenInLibrary).mockResolvedValue([]);
  vi.mocked(api.saveHiddenInLibrary).mockResolvedValue();
  vi.mocked(api.showWindowButtons).mockResolvedValue();
  vi.mocked(api.getSidebarSizes).mockResolvedValue({ width: 256, filesShare: 0.5 });
  vi.mocked(api.saveSidebarSizes).mockResolvedValue();
  vi.mocked(api.readZoteroPdf).mockResolvedValue(new ArrayBuffer(8));
  vi.mocked(api.zoteroPapersWithAnnotations).mockResolvedValue([]);
  vi.mocked(api.getEditorSettings).mockResolvedValue({ blockHandles: true, boardBackground: "plain" });
  vi.mocked(api.saveEditorSettings).mockResolvedValue();
  vi.mocked(api.parseProperties).mockResolvedValue([]);
  vi.mocked(api.writeProperties).mockResolvedValue("");
  vi.mocked(api.readPageSettings).mockResolvedValue({ values: {}, locked: [] });
  vi.mocked(api.changePageSetting).mockImplementation(async (note) => note);
  vi.mocked(api.listFonts).mockResolvedValue([]);
  vi.mocked(api.completeTypst).mockResolvedValue(null);
  vi.mocked(api.suggestProperties).mockResolvedValue([]);
  vi.mocked(api.checkNote).mockResolvedValue([]);
  vi.mocked(api.slashCommands).mockResolvedValue([]);
  vi.mocked(api.renderBlock).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"/>');
  vi.mocked(api.tableInfo).mockRejectedValue("This isn't a table.");
  vi.mocked(api.readTable).mockRejectedValue("This isn't a table.");
  vi.mocked(api.getShowPages).mockResolvedValue(false);
  vi.mocked(api.saveShowPages).mockResolvedValue();
  vi.mocked(api.renderPages).mockResolvedValue([]);
  vi.mocked(api.pagePosition).mockResolvedValue(null);
  vi.mocked(api.pagePlaces).mockResolvedValue([]);
  vi.mocked(api.pickPdfDestination).mockResolvedValue(null);
  vi.mocked(api.exportPdf).mockResolvedValue();
  vi.mocked(api.closeWindow).mockResolvedValue();
  vi.mocked(api.onMenuAction).mockImplementation(async (handler) => {
    menuHandlers.push(handler);
    return () => {
      menuHandlers = menuHandlers.filter((h) => h !== handler);
    };
  });
}

const menuItems = {
  "File › New Note": "new-note",
  "File › New Markdown Note": "new-markdown-note",
  "File › New Board": "new-board",
  "File › Close Workspace": "close-workspace",
  "File › Close Tab": "close-tab",
  "View › Pin File Explorer": "toggle-explorer-pinned",
  "View › Move File Explorer to Other Side": "move-explorer-to-other-side",
  "View › Show Preview": "toggle-pages",
  "View › Show Code": "toggle-code",
  "Edit › Undo": "undo",
  "Edit › Redo": "redo",
  "Edit › Show Suggestions": "show-suggestions",
  "Marginalia › Settings…": "open-settings",
  "File › Go to File…": "go-to-file",
  "View › Command Palette…": "command-palette",
  "View › Graph View": "graph-view",
  "View › Close Pane": "close-pane",
  "File › Export as PDF…": "export-pdf",
} as const satisfies Record<string, api.MenuAction>;

/** Simulates the user choosing an item in the native app menu. */
export async function chooseInMenu(item: keyof typeof menuItems) {
  await vi.waitFor(() => {
    if (menuHandlers.length === 0) throw new Error("App is not listening to the menu");
  });
  await act(async () => menuHandlers.forEach((handler) => handler(menuItems[item])));
}

/** Simulates files changing in the workspace's folder outside the app (the backend watches it). */
export async function filesChangedOnDisk() {
  await vi.waitFor(() => {
    if (fileHandlers.length === 0) throw new Error("App is not watching the files");
  });
  await act(async () => fileHandlers.forEach((handler) => handler()));
}

/** Builders for fake workspace contents. */
export const file = (path: string): api.FileEntry => ({
  name: path.split("/").pop()!,
  path,
  kind: "file",
  children: [],
});

export const folder = (path: string, children: api.FileEntry[] = []): api.FileEntry => ({
  name: path.split("/").pop()!,
  path,
  kind: "folder",
  children,
});

/** Simulates the Zotero library changing (a paper added in Zotero, or synced into it). */
export async function zoteroChangedOnDisk() {
  await vi.waitFor(() => {
    if (zoteroHandlers.length === 0) throw new Error("App is not watching the Zotero library");
  });
  await act(async () => zoteroHandlers.forEach((handler) => handler()));
}

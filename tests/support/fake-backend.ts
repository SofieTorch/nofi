// A fake of src/api.ts for tests. Each test file must also call `vi.mock("../src/api")`.

import { act } from "@testing-library/react";
import { vi } from "vitest";
import * as api from "../../src/api";
import { forgetMathsPictures } from "../../src/editor/mathsPictures";
import { forgetFonts } from "../../src/editor/fonts";
import { forgetSlashCommands } from "../../src/editor/slashMenu";
import { forgetTableReads } from "../../src/editor/TableGrid";

let menuHandlers: ((action: api.MenuAction) => void)[] = [];

/** Defaults: first launch, no recent workspaces, an empty workspace, every call succeeds. */
export function setUpFakeBackend() {
  vi.resetAllMocks();
  forgetMathsPictures();
  forgetSlashCommands();
  forgetFonts();
  forgetTableReads();
  menuHandlers = [];
  vi.mocked(api.getLastWorkspace).mockResolvedValue(null);
  vi.mocked(api.getRecentWorkspaces).mockResolvedValue([]);
  vi.mocked(api.closeWorkspace).mockResolvedValue();
  vi.mocked(api.listFiles).mockResolvedValue([]);
  vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "left", mode: "pinned" });
  vi.mocked(api.saveExplorerLayout).mockResolvedValue();
  vi.mocked(api.createNote).mockResolvedValue("Untitled.typ");
  vi.mocked(api.renameNote).mockImplementation(async (path, newName) =>
    path.replace(/[^/]*?(\.[^./]+)?$/, `${newName}$1`),
  );
  vi.mocked(api.readNote).mockResolvedValue("");
  vi.mocked(api.saveNote).mockResolvedValue();
  vi.mocked(api.renderMaths).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"/>');
  vi.mocked(api.removeEmptyNote).mockResolvedValue();
  vi.mocked(api.restoreEmptyNote).mockResolvedValue();
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
  "File › Close Workspace": "close-workspace",
  "View › Pin File Explorer": "toggle-explorer-pinned",
  "View › Move File Explorer to Other Side": "move-explorer-to-other-side",
  "View › Show Pages": "toggle-pages",
  "Edit › Undo": "undo",
  "Edit › Redo": "redo",
  "Edit › Show Suggestions": "show-suggestions",
} as const satisfies Record<string, api.MenuAction>;

/** Simulates the user choosing an item in the native app menu. */
export async function chooseInMenu(item: keyof typeof menuItems) {
  await vi.waitFor(() => {
    if (menuHandlers.length === 0) throw new Error("App is not listening to the menu");
  });
  await act(async () => menuHandlers.forEach((handler) => handler(menuItems[item])));
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

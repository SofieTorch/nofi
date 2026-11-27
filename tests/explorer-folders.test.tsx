// The explorer as a file explorer, like VS Code's.
//
// - Open folders stay open: when the sidebar hides and shows, when the Files section is folded,
//   and the next time the workspace opens.
// - Clicking a row selects it. New note and New folder (on the Files header, or the right-click
//   menus) go in the selected folder, or the selected file's folder, or the top of the workspace
//   after clicking the empty space below the files.
// - Folders can be renamed (right-click › Rename, or F2) and deleted (to the Trash: asking first
//   if there's anything in them).
// - Dragging a file or folder onto a folder moves it there (onto the empty space: to the top);
//   holding ⌥ (Ctrl on Windows and Linux) copies it instead.
// - Links to what moved or was renamed (a file or a folder) are updated.
// - The keyboard: ↑ ↓ between rows, → ← open and close folders, Enter opens, F2 renames,
//   ⌘⌫ (Delete elsewhere) deletes.

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { isMac } from "../src/ui/platform";
import { chooseInMenu, file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

/** The workspace on disk: files, and folders (ending in /). */
let disk: string[];
let notes: Record<string, string>;

/** The workspace's files as the explorer lists them. */
function listing(within = ""): api.FileEntry[] {
  const prefix = within ? `${within}/` : "";
  const names = new Set(
    disk.filter((p) => p.startsWith(prefix) && p !== prefix).map((p) => p.slice(prefix.length).split("/")[0] + (p.slice(prefix.length).includes("/") ? "/" : "")),
  );
  // (Like the real listing: folders first, then by name.)
  const sorted = [...names].sort((a, b) => Number(b.endsWith("/")) - Number(a.endsWith("/")) || a.localeCompare(b));
  return sorted.map((name) => (name.endsWith("/") ? folder(prefix + name.slice(0, -1), listing(prefix + name.slice(0, -1))) : file(prefix + name)));
}

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");
const nameOf = (path: string) => path.split("/").pop()!;
const join = (folder: string, name: string) => (folder ? `${folder}/${name}` : name);

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  disk = ["Papers/", "Papers/attention.pdf", "Papers/Old/", "Papers/Old/draft.typ", "Empty/", "Ideas.typ"];
  notes = { "Papers/Old/draft.typ": "Draft.", "Ideas.typ": "Ideas." };
  vi.mocked(api.listFiles).mockImplementation(async () => listing());
  vi.mocked(api.readNote).mockImplementation(async (path) => {
    if (!(path in notes)) throw new Error("This note doesn't exist anymore.");
    return notes[path];
  });
  vi.mocked(api.saveNote).mockImplementation(async (path, text) => void (notes[path] = text));
  vi.mocked(api.createNote).mockImplementation(async (format, folder = "") => {
    const path = join(folder, `Untitled.${format === "markdown" ? "md" : "typ"}`);
    disk.push(path);
    notes[path] = "";
    return path;
  });
  vi.mocked(api.createFolder).mockImplementation(async (parent) => {
    const path = join(parent, "New folder");
    disk.push(`${path}/`);
    return path;
  });
  const moveOnDisk = (from: string, to: string) => {
    const moved = (p: string) => (p === from || p === `${from}/` || p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
    disk = disk.map(moved);
    notes = Object.fromEntries(Object.entries(notes).map(([p, t]) => [moved(p), t]));
  };
  vi.mocked(api.renameFolder).mockImplementation(async (path, newName) => {
    const to = join(parentOf(path), newName);
    moveOnDisk(path, to);
    return to;
  });
  vi.mocked(api.renameNote).mockImplementation(async (path, newName) => {
    const to = join(parentOf(path), `${newName}.${path.split(".").pop()}`);
    moveOnDisk(path, to);
    return to;
  });
  vi.mocked(api.moveInto).mockImplementation(async (path, into) => {
    const to = join(into, nameOf(path));
    moveOnDisk(path, to);
    return to;
  });
  vi.mocked(api.copyInto).mockImplementation(async (path, into) => {
    const to = join(into, nameOf(path));
    for (const p of disk.filter((p) => p === path || p.startsWith(`${path}/`))) disk.push(to + p.slice(path.length));
    for (const [p, t] of Object.entries(notes)) if (p === path || p.startsWith(`${path}/`)) notes[to + p.slice(path.length)] = t;
    return to;
  });
  vi.mocked(api.filesInFolder).mockImplementation(async (path) => disk.filter((p) => p.startsWith(`${path}/`) && !p.endsWith("/")).length);
  vi.mocked(api.deleteFolder).mockImplementation(async (path) => {
    disk = disk.filter((p) => !p.startsWith(`${path}/`));
  });
  vi.mocked(api.getOpenFolders).mockResolvedValue([]);
  vi.mocked(api.saveOpenFolders).mockResolvedValue();
});

const sidebar = () => within(screen.getByRole("complementary", { name: "File explorer", hidden: true }));
const files = () => within(screen.getByRole("region", { name: "Files" }));
const row = (name: string) => files().getByRole("button", { name });
const isOpen = (name: string) => row(name).getAttribute("aria-expanded") === "true";
const header = () => within(screen.getByRole("toolbar", { name: "Files" }));

async function openWorkspace() {
  render(<App />);
  await screen.findByRole("button", { name: "Ideas.typ" });
}

function rightClick(element: HTMLElement) {
  fireEvent.contextMenu(element, { clientX: 40, clientY: 80 });
  return within(screen.getByRole("menu"));
}

/** The empty space below the files. */
const emptySpace = () => screen.getByTestId("files-empty-space");

describe("Open folders", () => {
  it("stay open when the sidebar is unpinned and shows again", async () => {
    await openWorkspace();
    await userEvent.click(row("Papers"));
    await userEvent.click(row("Old"));

    await userEvent.click(sidebar().getByRole("button", { name: /pin file explorer/i }));
    fireEvent.mouseEnter(screen.getByLabelText("Show file explorer"));

    expect(isOpen("Papers")).toBe(true);
    expect(isOpen("Old")).toBe(true);
  });

  it("stay open when the Files section is folded and opened again", async () => {
    await openWorkspace();
    await userEvent.click(row("Papers"));

    await userEvent.click(screen.getByRole("button", { name: "Research" }));
    await userEvent.click(screen.getByRole("button", { name: "Research" }));

    expect(isOpen("Papers")).toBe(true);
  });

  it("are remembered for the workspace", async () => {
    await openWorkspace();

    await userEvent.click(row("Papers"));

    expect(api.saveOpenFolders).toHaveBeenLastCalledWith(["Papers"]);
  });

  it("are open again when the workspace opens", async () => {
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers", "Papers/Old"]);

    await openWorkspace();

    await vi.waitFor(() => expect(isOpen("Old")).toBe(true));
    expect(row("draft.typ")).toBeInTheDocument();
  });

  it("Collapse all, on the Files header, closes them all", async () => {
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers", "Papers/Old"]);
    await openWorkspace();
    await vi.waitFor(() => expect(isOpen("Papers")).toBe(true));

    await userEvent.click(header().getByRole("button", { name: "Collapse folders" }));

    expect(isOpen("Papers")).toBe(false);
    expect(api.saveOpenFolders).toHaveBeenLastCalledWith([]);
  });
});

describe("New notes and folders", () => {
  it("the Files header has New note, New folder and Collapse folders; the top row only Pin", async () => {
    await openWorkspace();

    expect(header().getByRole("button", { name: "New note" })).toBeInTheDocument();
    expect(header().getByRole("button", { name: "New folder" })).toBeInTheDocument();
    expect(within(screen.getByRole("toolbar", { name: "Sidebar" })).queryByRole("button", { name: "New note" })).not.toBeInTheDocument();
  });

  it("a new note goes in the folder clicked last", async () => {
    await openWorkspace();
    await userEvent.click(row("Papers"));

    await userEvent.click(header().getByRole("button", { name: "New note" }));

    await vi.waitFor(() => expect(api.createNote).toHaveBeenCalledWith(undefined, "Papers"));
    expect(await screen.findByRole("textbox", { name: "Note name" })).toHaveValue("Untitled");
  });

  it("or in the folder of the file clicked last", async () => {
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers", "Papers/Old"]);
    await openWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "draft.typ" }));

    await userEvent.click(header().getByRole("button", { name: "New note" }));

    await vi.waitFor(() => expect(api.createNote).toHaveBeenCalledWith(undefined, "Papers/Old"));
  });

  it("at the top after clicking the empty space below the files", async () => {
    // (A note at the top is made as File › New Note makes it.)
    await openWorkspace();
    await userEvent.click(row("Papers"));

    await userEvent.click(emptySpace());
    await userEvent.click(header().getByRole("button", { name: "New note" }));

    await vi.waitFor(() => expect(api.createNote).toHaveBeenLastCalledWith());
  });

  it("File › New Markdown Note goes in the selected folder too", async () => {
    await openWorkspace();
    await userEvent.click(row("Empty"));

    await chooseInMenu("File › New Markdown Note");

    await vi.waitFor(() => expect(api.createNote).toHaveBeenCalledWith("markdown", "Empty"));
  });

  it("a closed folder opens to show the new note", async () => {
    await openWorkspace();
    await userEvent.click(row("Papers"));
    await userEvent.click(row("Papers")); // (Selected, and closed again.)

    await userEvent.click(header().getByRole("button", { name: "New note" }));

    await vi.waitFor(() => expect(isOpen("Papers")).toBe(true));
  });

  it("New folder makes one in the selected folder, its name ready to type", async () => {
    await openWorkspace();
    await userEvent.click(row("Papers"));

    await userEvent.click(header().getByRole("button", { name: "New folder" }));

    await vi.waitFor(() => expect(api.createFolder).toHaveBeenCalledWith("Papers"));
    const name = await screen.findByRole("textbox", { name: "Folder name" });
    expect(name).toHaveValue("New folder");
    await userEvent.keyboard("Reading{Enter}");
    await vi.waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith("Papers/New folder", "Reading"));
    expect(await screen.findByRole("button", { name: "Reading" })).toBeInTheDocument();
  });

  it("a folder's right-click menu makes them in that folder", async () => {
    await openWorkspace();

    await userEvent.click(rightClick(row("Empty")).getByRole("menuitem", { name: "New note" }));
    await vi.waitFor(() => expect(api.createNote).toHaveBeenCalledWith(undefined, "Empty"));

    await userEvent.click(rightClick(row("Papers")).getByRole("menuitem", { name: "New folder" }));
    await vi.waitFor(() => expect(api.createFolder).toHaveBeenCalledWith("Papers"));
  });

  it("the empty space's right-click menu makes them at the top", async () => {
    await openWorkspace();

    await userEvent.click(rightClick(emptySpace()).getByRole("menuitem", { name: "New folder" }));

    await vi.waitFor(() => expect(api.createFolder).toHaveBeenCalledWith(""));
  });
});

describe("Renaming a folder", () => {
  it("right-click › Rename lets you type its new name", async () => {
    await openWorkspace();

    await userEvent.click(rightClick(row("Papers")).getByRole("menuitem", { name: "Rename" }));
    const name = screen.getByRole("textbox", { name: "Folder name" });
    expect(name).toHaveValue("Papers");
    await userEvent.clear(name);
    await userEvent.keyboard("Reading{Enter}");

    await vi.waitFor(() => expect(api.renameFolder).toHaveBeenCalledWith("Papers", "Reading"));
    expect(await screen.findByRole("button", { name: "Reading" })).toBeInTheDocument();
  });

  it("an open folder stays open, and notes open from it stay open under its new name", async () => {
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers", "Papers/Old"]);
    await openWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "draft.typ" }));
    await screen.findByRole("textbox", { name: "draft.typ" });

    await userEvent.click(rightClick(row("Papers")).getByRole("menuitem", { name: "Rename" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Folder name" }));
    await userEvent.keyboard("Reading{Enter}");

    await vi.waitFor(() => expect(isOpen("Reading")).toBe(true));
    expect(isOpen("Old")).toBe(true);
    expect(screen.getByRole("tab", { name: "draft" })).toHaveAttribute("title", "Reading/Old/draft.typ");
  });

  it("a name that can't be used is explained", async () => {
    vi.mocked(api.renameFolder).mockRejectedValue("There's already something called \"Empty\" there.");
    await openWorkspace();

    await userEvent.click(rightClick(row("Papers")).getByRole("menuitem", { name: "Rename" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Folder name" }));
    await userEvent.keyboard("Empty{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent("There's already something called \"Empty\" there.");
  });
});

describe("Deleting a folder", () => {
  it("an empty one goes to the Trash straight away", async () => {
    await openWorkspace();

    await userEvent.click(rightClick(row("Empty")).getByRole("menuitem", { name: "Delete" }));

    await vi.waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith("Empty"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("one with files asks first, saying how many", async () => {
    await openWorkspace();

    await userEvent.click(rightClick(row("Papers")).getByRole("menuitem", { name: "Delete" }));

    const dialog = await screen.findByRole("alertdialog", { name: "Delete “Papers”?" });
    expect(dialog).toHaveTextContent("It and the 2 files in it will be moved to the Trash");
    expect(api.deleteFolder).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    await vi.waitFor(() => expect(api.deleteFolder).toHaveBeenCalledWith("Papers"));
  });

  it("notes open from it close", async () => {
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers", "Papers/Old"]);
    await openWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "draft.typ" }));
    await screen.findByRole("tab", { name: "draft" });

    await userEvent.click(rightClick(row("Papers")).getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    await vi.waitFor(() => expect(screen.queryByRole("tab", { name: "draft" })).not.toBeInTheDocument());
  });
});

/** A stand-in for the browser's drag data. */
function dragData() {
  const data = new Map<string, string>();
  return {
    setData: (type: string, value: string) => void data.set(type, value),
    getData: (type: string) => data.get(type) ?? "",
    get types() {
      return [...data.keys()];
    },
    dropEffect: "none",
    effectAllowed: "all",
    setDragImage: () => {},
  };
}

/** Drags a row onto another element and drops it there. */
function drag(from: HTMLElement, to: HTMLElement, keys: { altKey?: boolean; ctrlKey?: boolean } = {}) {
  const dataTransfer = dragData();
  fireEvent.dragStart(from, { dataTransfer });
  fireEvent.dragEnter(to, { dataTransfer, ...keys });
  fireEvent.dragOver(to, { dataTransfer, ...keys });
  fireEvent.drop(to, { dataTransfer, ...keys });
  fireEvent.dragEnd(from, { dataTransfer });
}

const copyKey = isMac ? { altKey: true } : { ctrlKey: true };

describe("Dragging files and folders", () => {
  it("dropped on a folder, a file moves into it", async () => {
    await openWorkspace();

    drag(row("Ideas.typ"), row("Papers"));

    await vi.waitFor(() => expect(api.moveInto).toHaveBeenCalledWith("Ideas.typ", "Papers"));
    // (The folder opens, showing it there.)
    await vi.waitFor(() => expect(row("Ideas.typ")).toHaveAttribute("data-path", "Papers/Ideas.typ"));
  });

  it("dropped on a file, it moves into that file's folder", async () => {
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers"]);
    await openWorkspace();

    drag(row("Ideas.typ"), await screen.findByRole("button", { name: "attention.pdf" }));

    await vi.waitFor(() => expect(api.moveInto).toHaveBeenCalledWith("Ideas.typ", "Papers"));
  });

  it("dropped on the empty space, it moves to the top", async () => {
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers", "Papers/Old"]);
    await openWorkspace();

    drag(await screen.findByRole("button", { name: "draft.typ" }), emptySpace());

    await vi.waitFor(() => expect(api.moveInto).toHaveBeenCalledWith("Papers/Old/draft.typ", ""));
  });

  it("a folder moves with what's in it", async () => {
    await openWorkspace();

    drag(row("Empty"), row("Papers"));

    await vi.waitFor(() => expect(api.moveInto).toHaveBeenCalledWith("Empty", "Papers"));
  });

  it(`holding ${isMac ? "⌥" : "Ctrl"} copies instead`, async () => {
    await openWorkspace();

    drag(row("Ideas.typ"), row("Papers"), copyKey);

    await vi.waitFor(() => expect(api.copyInto).toHaveBeenCalledWith("Ideas.typ", "Papers"));
    expect(api.moveInto).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(files().getAllByRole("button", { name: "Ideas.typ" }).map((b) => b.dataset.path)).toEqual(["Papers/Ideas.typ", "Ideas.typ"]));
  });

  it("a folder can't be dropped inside itself", async () => {
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers"]);
    await openWorkspace();

    drag(row("Papers"), await screen.findByRole("button", { name: "Old" }));

    expect(api.moveInto).not.toHaveBeenCalled();
  });

  it("the folder it would go in is outlined while dragging over it", async () => {
    await openWorkspace();
    const dataTransfer = dragData();

    fireEvent.dragStart(row("Ideas.typ"), { dataTransfer });
    fireEvent.dragEnter(row("Papers"), { dataTransfer });
    fireEvent.dragOver(row("Papers"), { dataTransfer });

    expect(row("Papers").closest("li")).toHaveAttribute("data-drop-target");
    fireEvent.dragEnd(row("Ideas.typ"), { dataTransfer });
    expect(row("Papers").closest("li")).not.toHaveAttribute("data-drop-target");
  });

  it("an open note moved stays open under its new path", async () => {
    await openWorkspace();
    await userEvent.click(row("Ideas.typ"));
    await screen.findByRole("textbox", { name: "Ideas.typ" });

    drag(row("Ideas.typ"), row("Empty"));

    await vi.waitFor(() => expect(screen.getByRole("tab", { name: "Ideas" })).toHaveAttribute("title", "Empty/Ideas.typ"));
  });

  it("when it can't be moved, says why", async () => {
    vi.mocked(api.moveInto).mockRejectedValue("There's already something called \"Ideas.typ\" there.");
    await openWorkspace();

    drag(row("Ideas.typ"), row("Papers"));

    expect(await screen.findByText(/Couldn't move “Ideas.typ”: There's already something called "Ideas.typ" there./)).toBeInTheDocument();
  });
});

describe("Links to what moved", () => {
  it("links to a moved note are changed to its new place", async () => {
    notes["Ideas.typ"] = `See #link("Papers/Old/draft.typ")[the draft].`;
    notes["Papers/Old/draft.typ"] = "Draft.";
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers", "Papers/Old"]);
    await openWorkspace();

    drag(await screen.findByRole("button", { name: "draft.typ" }), row("Empty"));

    await vi.waitFor(() => expect(notes["Ideas.typ"]).toBe(`See #link("Empty/draft.typ")[the draft].`));
  });

  it("a moved note's own links still point to the same files", async () => {
    notes["Ideas.typ"] = `#image("Papers/fig.png")\n\nSee [paper](Papers/attention.pdf#page=2) and #link("Papers/Old/draft.typ")[draft].`;
    await openWorkspace();

    drag(row("Ideas.typ"), row("Empty"));

    await vi.waitFor(() =>
      expect(notes["Empty/Ideas.typ"]).toBe(`#image("../Papers/fig.png")\n\nSee [paper](Papers/attention.pdf#page=2) and #link("../Papers/Old/draft.typ")[draft].`),
    );
  });

  it("links into a renamed folder are changed, parts and Markdown spaces kept", async () => {
    notes["Ideas.md"] = "See [the paper](Papers/attention.pdf#page=3) and [draft](Papers/Old/draft.typ).";
    disk.push("Ideas.md");
    await openWorkspace();

    await userEvent.click(rightClick(row("Papers")).getByRole("menuitem", { name: "Rename" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Folder name" }));
    await userEvent.keyboard("My Reading{Enter}");

    await vi.waitFor(() => expect(notes["Ideas.md"]).toBe("See [the paper](My%20Reading/attention.pdf#page=3) and [draft](My%20Reading/Old/draft.typ)."));
  });

  it("links to a renamed note are changed to its new name, parts kept", async () => {
    notes["Ideas.typ"] = `See #link("Papers/Old/draft.typ#methods")[the draft].`;
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers", "Papers/Old"]);
    await openWorkspace();

    await userEvent.click(rightClick(await screen.findByRole("button", { name: "draft.typ" })).getByRole("menuitem", { name: "Rename" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Note name" }));
    await userEvent.keyboard("Final draft{Enter}");

    await vi.waitFor(() => expect(notes["Ideas.typ"]).toBe(`See #link("Papers/Old/Final draft.typ#methods")[the draft].`));
  });

  it("a renamed PDF's notes follow it, and undoing the rename puts the links back", async () => {
    notes["Ideas.md"] = "See [the paper](Papers/attention.pdf#page=3).";
    disk.push("Ideas.md");
    vi.mocked(api.getOpenFolders).mockResolvedValue(["Papers"]);
    await openWorkspace();

    await userEvent.click(rightClick(await screen.findByRole("button", { name: "attention.pdf" })).getByRole("menuitem", { name: "Rename" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "File name" }));
    await userEvent.keyboard("Attention 2017{Enter}");
    await vi.waitFor(() => expect(notes["Ideas.md"]).toBe("See [the paper](Papers/Attention%202017.pdf#page=3)."));

    await chooseInMenu("Edit › Undo");

    await vi.waitFor(() => expect(notes["Ideas.md"]).toBe("See [the paper](Papers/attention.pdf#page=3)."));
  });

  it("a note's source property follows its PDF", async () => {
    notes["Ideas.typ"] = `#metadata((\n  source: "Papers/attention.pdf",\n)) <properties>\n\nNotes.`;
    await openWorkspace();

    await userEvent.click(rightClick(row("Papers")).getByRole("menuitem", { name: "Rename" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Folder name" }));
    await userEvent.keyboard("Reading{Enter}");

    await vi.waitFor(() => expect(notes["Ideas.typ"]).toContain(`source: "Reading/attention.pdf",`));
  });

  it("a copied note's links still point to the same files; links to the original stay", async () => {
    notes["Ideas.typ"] = `See #link("Papers/Old/draft.typ")[draft].`;
    notes["Other.typ"] = `#link("Ideas.typ")[ideas]`;
    disk.push("Other.typ");
    await openWorkspace();

    drag(row("Ideas.typ"), row("Empty"), copyKey);

    await vi.waitFor(() => expect(notes["Empty/Ideas.typ"]).toBe(`See #link("../Papers/Old/draft.typ")[draft].`));
    expect(notes["Ideas.typ"]).toBe(`See #link("Papers/Old/draft.typ")[draft].`);
    expect(notes["Other.typ"]).toBe(`#link("Ideas.typ")[ideas]`);
  });

  it("websites, Zotero papers and code aren't touched", async () => {
    notes["Ideas.typ"] = 'Go #link("https://typst.app")[here], #link("zotero:ABC#page=1")[p. 1], `#link("Papers/x.typ")`.';
    const before = notes["Ideas.typ"];
    await openWorkspace();

    drag(row("Ideas.typ"), row("Empty"));

    await vi.waitFor(() => expect(notes["Empty/Ideas.typ"]).toBeDefined());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(notes["Empty/Ideas.typ"]).toBe(before);
  });
});

describe("The keyboard in the files", () => {
  it("↓ and ↑ move between rows, selecting them", async () => {
    await openWorkspace();
    row("Empty").focus();

    await userEvent.keyboard("{ArrowDown}");
    expect(row("Papers")).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}{ArrowUp}");
    expect(row("Papers")).toHaveFocus();

    await userEvent.click(header().getByRole("button", { name: "New note" }));
    await vi.waitFor(() => expect(api.createNote).toHaveBeenCalledWith(undefined, "Papers"));
  });

  it("→ opens a folder, then goes into it; ← closes it, or goes up to its folder", async () => {
    await openWorkspace();
    row("Papers").focus();

    await userEvent.keyboard("{ArrowRight}");
    expect(isOpen("Papers")).toBe(true);
    await userEvent.keyboard("{ArrowRight}");
    expect(row("Old")).toHaveFocus();

    await userEvent.keyboard("{ArrowLeft}");
    expect(row("Papers")).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(isOpen("Papers")).toBe(false);
  });

  it("Enter opens a note", async () => {
    await openWorkspace();
    row("Ideas.typ").focus();

    await userEvent.keyboard("{Enter}");

    expect(await screen.findByRole("textbox", { name: "Ideas.typ" })).toBeInTheDocument();
  });

  it("F2 renames a folder or a file", async () => {
    await openWorkspace();

    row("Papers").focus();
    await userEvent.keyboard("{F2}");
    expect(screen.getByRole("textbox", { name: "Folder name" })).toHaveValue("Papers");
    await userEvent.keyboard("{Escape}");

    row("Ideas.typ").focus();
    await userEvent.keyboard("{F2}");
    expect(screen.getByRole("textbox", { name: "Note name" })).toHaveValue("Ideas");
  });

  it(`${isMac ? "⌘⌫" : "Delete"} deletes, asking first`, async () => {
    await openWorkspace();
    row("Ideas.typ").focus();

    await userEvent.keyboard(isMac ? "{Meta>}{Backspace}{/Meta}" : "{Delete}");

    expect(await screen.findByRole("alertdialog", { name: "Delete “Ideas.typ”?" })).toBeInTheDocument();
  });
});

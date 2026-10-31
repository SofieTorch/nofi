// Undo and redo. In the editor they undo typing; anywhere else they undo file actions
// (creating and renaming notes). Edit › Undo and ⌘Z (Ctrl+Z here) do the same thing.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const researchNotes: api.Workspace = { name: "Research Notes", path: "/Users/me/Research Notes" };

/** A small fake workspace: note paths and what's written in them. */
let disk: Map<string, string>;

const extensionOf = (path: string) => path.slice(path.lastIndexOf("."));

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue(researchNotes);
  disk = new Map([
    ["Ideas.typ", "Read more papers."],
    ["Todo.md", "Buy milk."],
  ]);
  vi.mocked(api.listFiles).mockImplementation(async () => [...disk.keys()].sort().map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => disk.get(path)!);
  vi.mocked(api.saveNote).mockImplementation(async (path, text) => void disk.set(path, text));
  vi.mocked(api.createNote).mockImplementation(async () => {
    disk.set("Untitled.typ", "");
    return "Untitled.typ";
  });
  vi.mocked(api.renameNote).mockImplementation(async (path, newName) => {
    const renamed = newName + extensionOf(path);
    disk.set(renamed, disk.get(path)!);
    disk.delete(path);
    return renamed;
  });
  vi.mocked(api.removeEmptyNote).mockImplementation(async (path) => void disk.delete(path));
  vi.mocked(api.restoreEmptyNote).mockImplementation(async (path) => void disk.set(path, ""));
});

async function renderOpenWorkspace() {
  render(<App />);
  await screen.findByRole("heading", { name: "Research Notes" });
}

async function openNote(name: string) {
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name });
}

/** Creates a note and keeps the name "Untitled", leaving the focus outside the editor. */
async function createUntitledNote() {
  await chooseInMenu("File › New Note");
  await screen.findByRole("textbox", { name: "Note name" });
  await userEvent.keyboard("{Escape}");
  await screen.findByText("Untitled.typ");
}

async function createNoteNamed(name: string) {
  await chooseInMenu("File › New Note");
  await screen.findByRole("textbox", { name: "Note name" });
  await userEvent.keyboard(`${name}{Enter}`);
  await screen.findByText(`${name}.typ`);
}

const explorerShows = (name: string) => screen.queryByText(name) !== null;

describe("Undoing typing", () => {
  it("Ctrl+Z in a note undoes what was just typed", async () => {
    await renderOpenWorkspace();
    const editor = await openNote("Ideas.typ");

    await userEvent.click(editor);
    await userEvent.keyboard("Typo ");
    await userEvent.keyboard("{Control>}z{/Control}");

    expect(editor).toHaveTextContent("Read more papers.");
    expect(editor).not.toHaveTextContent("Typo");
  });

  it("Edit › Undo in a note undoes typing, not file actions", async () => {
    await renderOpenWorkspace();
    await createNoteNamed("Draft");
    const editor = await openNote("Ideas.typ");
    await userEvent.click(editor);
    await userEvent.keyboard("Typo ");

    await chooseInMenu("Edit › Undo");

    expect(editor).not.toHaveTextContent("Typo");
    expect(explorerShows("Draft.typ")).toBe(true);
    expect(api.renameNote).toHaveBeenCalledTimes(1);
  });

  it("Edit › Redo in a note puts the typing back", async () => {
    await renderOpenWorkspace();
    const editor = await openNote("Ideas.typ");
    await userEvent.click(editor);
    await userEvent.keyboard("Again ");
    await chooseInMenu("Edit › Undo");
    expect(editor).not.toHaveTextContent("Again");

    await chooseInMenu("Edit › Redo");

    expect(editor).toHaveTextContent("Again");
  });

  it("a note keeps its undo history when you switch to another note and back", async () => {
    await renderOpenWorkspace();
    let editor = await openNote("Ideas.typ");
    await userEvent.click(editor);
    await userEvent.keyboard("Typo ");
    await openNote("Todo.md");

    editor = await openNote("Ideas.typ");
    await userEvent.click(editor);
    await userEvent.keyboard("{Control>}z{/Control}");

    expect(editor).toHaveTextContent("Read more papers.");
    expect(editor).not.toHaveTextContent("Typo");
  });

  it("if the note was changed outside the app in the meantime, its old history is dropped", async () => {
    await renderOpenWorkspace();
    let editor = await openNote("Ideas.typ");
    await userEvent.click(editor);
    await userEvent.keyboard("Typo ");
    await openNote("Todo.md");
    disk.set("Ideas.typ", "Rewritten in another app.");

    editor = await openNote("Ideas.typ");
    await userEvent.click(editor);
    await userEvent.keyboard("{Control>}z{/Control}");

    expect(editor).toHaveTextContent("Rewritten in another app.");
  });
});

describe("Undoing file actions", () => {
  it("undoing a new note removes it", async () => {
    await renderOpenWorkspace();
    await createUntitledNote();

    await chooseInMenu("Edit › Undo");

    expect(api.removeEmptyNote).toHaveBeenCalledWith("Untitled.typ");
    await vi.waitFor(() => expect(explorerShows("Untitled.typ")).toBe(false));
    expect(screen.queryByRole("textbox", { name: "Untitled.typ" })).not.toBeInTheDocument();
  });

  it("redo brings the new note back and opens it", async () => {
    await renderOpenWorkspace();
    await createUntitledNote();
    await chooseInMenu("Edit › Undo");
    await vi.waitFor(() => expect(explorerShows("Untitled.typ")).toBe(false));

    await chooseInMenu("Edit › Redo");

    expect(api.restoreEmptyNote).toHaveBeenCalledWith("Untitled.typ");
    expect(await screen.findByRole("textbox", { name: "Untitled.typ" })).toBeInTheDocument();
  });

  it("undoing a rename gives the note its old name back, and keeps it open", async () => {
    await renderOpenWorkspace();
    await createNoteNamed("Reading list");

    await chooseInMenu("Edit › Undo");

    expect(api.renameNote).toHaveBeenLastCalledWith("Reading list.typ", "Untitled");
    expect(await screen.findByText("Untitled.typ")).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Untitled.typ" })).toBeInTheDocument();
  });

  it("redo renames it again", async () => {
    await renderOpenWorkspace();
    await createNoteNamed("Reading list");
    await chooseInMenu("Edit › Undo");
    await screen.findByText("Untitled.typ");

    await chooseInMenu("Edit › Redo");

    expect(await screen.findByText("Reading list.typ")).toBeInTheDocument();
  });

  it("undoes the most recent action first", async () => {
    await renderOpenWorkspace();
    await createNoteNamed("Reading list");

    await chooseInMenu("Edit › Undo");
    await screen.findByText("Untitled.typ");
    await chooseInMenu("Edit › Undo");

    await vi.waitFor(() => expect(explorerShows("Untitled.typ")).toBe(false));
    expect(explorerShows("Reading list.typ")).toBe(false);
  });

  it("Ctrl+Z outside the editor undoes file actions too", async () => {
    await renderOpenWorkspace();
    await createUntitledNote();

    await userEvent.keyboard("{Control>}z{/Control}");

    await vi.waitFor(() => expect(explorerShows("Untitled.typ")).toBe(false));
  });

  it("Ctrl+Shift+Z outside the editor redoes them", async () => {
    await renderOpenWorkspace();
    await createUntitledNote();
    await userEvent.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(explorerShows("Untitled.typ")).toBe(false));

    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");

    expect(await screen.findByText("Untitled.typ")).toBeInTheDocument();
  });

  it("says what was undone", async () => {
    await renderOpenWorkspace();
    await createNoteNamed("Reading list");

    await chooseInMenu("Edit › Undo");

    expect(await screen.findByRole("status")).toHaveTextContent(
      'Undone: renaming "Untitled.typ" to "Reading list.typ"',
    );
  });

  it("a new note that has text in it now is kept, and says why", async () => {
    vi.mocked(api.removeEmptyNote).mockRejectedValue('"Untitled.typ" has text in it now, so it was kept.');
    await renderOpenWorkspace();
    await createUntitledNote();

    await chooseInMenu("Edit › Undo");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't undo: \"Untitled.typ\" has text in it now, so it was kept.",
    );
    expect(explorerShows("Untitled.typ")).toBe(true);
  });

  it("doing something new after undoing means there's nothing to redo", async () => {
    await renderOpenWorkspace();
    await createUntitledNote();
    await chooseInMenu("Edit › Undo");
    await vi.waitFor(() => expect(explorerShows("Untitled.typ")).toBe(false));
    await createNoteNamed("Fresh");

    await chooseInMenu("Edit › Redo");

    expect(api.restoreEmptyNote).not.toHaveBeenCalled();
  });

  it("with nothing to undo, nothing happens", async () => {
    await renderOpenWorkspace();

    await chooseInMenu("Edit › Undo");

    expect(api.removeEmptyNote).not.toHaveBeenCalled();
    expect(api.renameNote).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// One panel to find things, like VS Code's: ⌘P (File › Go to File…) looks for notes by name;
// ⌘⇧P (View › Command Palette…) is the same panel starting with ">", which looks for commands
// instead (settings, new notes, the explorer, pages…). Typing or deleting the ">" switches.
// Looking for notes also looks inside them: the lines with what's typed are listed after the notes
// whose names match, and choosing one opens the note with the match selected.

import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  vi.mocked(api.listFiles).mockResolvedValue([
    folder("Papers", [file("Papers/Attention.typ"), file("Papers/attention.pdf")]),
    file("Ideas.md"),
    file("Reading list.typ"),
  ]);
  vi.mocked(api.readNote).mockResolvedValue("First.\n\nSecond.");
});

async function openPalette(item: "File › Go to File…" | "View › Command Palette…" = "File › Go to File…") {
  render(<App />);
  await screen.findByText("Ideas.md");
  await chooseInMenu(item);
  return screen.getByRole("dialog", { name: "Go to file or command" });
}

const field = () => screen.getByRole("combobox", { name: "Search files, or > for commands" });
const options = () => screen.queryAllByRole("option").map((option) => option.textContent);

describe("Finding a note (⌘P)", () => {
  it("opens with the field ready to type in, listing the notes", async () => {
    await openPalette();

    expect(field()).toHaveFocus();
    expect(field()).toHaveValue("");
    expect(options()).toEqual(["Attention.typPapers", "Ideas.md", "Reading list.typ"]);
  });

  it("only lists notes, which are what can be opened", async () => {
    await openPalette();

    expect(options().join()).not.toContain(".pdf");
  });

  it("typing narrows the list to the notes whose name matches, letters in order", async () => {
    await openPalette();

    await userEvent.keyboard("rdlst");

    expect(options()).toEqual(["Reading list.typ"]);
  });

  it("a note's folder counts too, after the names that match", async () => {
    await openPalette();

    await userEvent.keyboard("papers");

    expect(options()).toEqual(["Attention.typPapers"]);
  });

  it("Enter opens the first one", async () => {
    await openPalette();

    await userEvent.keyboard("idea{Enter}");

    expect(await screen.findByRole("textbox", { name: "Ideas.md" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Go to file or command" })).not.toBeInTheDocument();
  });

  it("↓ and ↑ choose another", async () => {
    await openPalette();

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");

    expect(screen.getByRole("option", { selected: true })).toHaveTextContent("Ideas");
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("textbox", { name: "Ideas.md" })).toBeInTheDocument();
  });

  it("clicking one opens it", async () => {
    await openPalette();

    await userEvent.click(screen.getByRole("option", { name: /Reading list/ }));

    expect(await screen.findByRole("textbox", { name: "Reading list.typ" })).toBeInTheDocument();
  });

  it("says so when nothing matches", async () => {
    const palette = await openPalette();

    await userEvent.keyboard("zzz");

    expect(within(palette).getByText("No notes match.")).toBeInTheDocument();
  });

  it("Escape closes it", async () => {
    await openPalette();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Go to file or command" })).not.toBeInTheDocument();
  });

  it("clicking outside closes it", async () => {
    await openPalette();

    await userEvent.click(document.body);

    expect(screen.queryByRole("dialog", { name: "Go to file or command" })).not.toBeInTheDocument();
  });
});

describe("Commands (⌘⇧P)", () => {
  it("is the same panel, starting with >", async () => {
    await openPalette("View › Command Palette…");

    expect(field()).toHaveValue(">");
    expect(options()).toContain("Settings: Open Settings");
  });

  it("typing > in the file search switches to commands, and deleting it switches back", async () => {
    await openPalette();

    await userEvent.keyboard(">");
    expect(options()).toContain("Settings: Open Settings");

    await userEvent.keyboard("{Backspace}");
    expect(options()).toContain("Ideas.md");
  });

  it("typing after > narrows the commands", async () => {
    await openPalette("View › Command Palette…");

    await userEvent.keyboard("handles");

    expect(options()).toEqual(["Settings: Turn Off Block Handles"]);
  });

  it("Settings: Open Settings opens the settings panel", async () => {
    await openPalette("View › Command Palette…");

    await userEvent.keyboard("open settings{Enter}");

    expect(screen.getByRole("dialog", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Go to file or command" })).not.toBeInTheDocument();
  });

  it("a setting can be changed straight from here, and is saved", async () => {
    await openPalette("View › Command Palette…");

    await userEvent.keyboard("block handles{Enter}");

    expect(api.saveEditorSettings).toHaveBeenCalledWith({ blockHandles: false, boardBackground: "plain" });
    await chooseInMenu("View › Command Palette…");
    await userEvent.keyboard("block handles");
    expect(options()).toEqual(["Settings: Turn On Block Handles"]);
  });

  it("has the app's actions too, like a new note", async () => {
    await openPalette("View › Command Palette…");

    await userEvent.keyboard("new markdown{Enter}");

    expect(api.createNote).toHaveBeenCalledWith("markdown");
  });

  it("and the views, like showing a note's preview", async () => {
    await openPalette("View › Command Palette…");

    await userEvent.keyboard("show preview{Enter}");

    expect(api.saveShowPages).toHaveBeenCalledWith(true);
  });

  it("says so when no command matches", async () => {
    const palette = await openPalette("View › Command Palette…");

    await userEvent.keyboard("zzz");

    expect(within(palette).getByText("No commands match.")).toBeInTheDocument();
  });
});

describe("Searching the text inside notes (⌘P)", () => {
  const IDEAS = "# Ideas\n\nTry attention.";
  const match: api.TextMatch = { path: "Ideas.md", line: 3, column: 4, length: 9, preview: "Try attention.", previewColumn: 4 };

  beforeEach(() => {
    vi.mocked(api.readNote).mockImplementation(async (path) => (path === "Ideas.md" ? IDEAS : "First.\n\nSecond."));
    vi.mocked(api.searchNotes).mockImplementation(async (query) => (query === "attention" ? [match] : []));
  });

  const noteView = (name: string) =>
    EditorView.findFromDOM(screen.getByRole("textbox", { name }).closest<HTMLElement>(".cm-editor")!)!;

  it("lists the lines with what's typed, after the notes whose names match, with the note each is in", async () => {
    await openPalette();

    await userEvent.keyboard("attention");

    await vi.waitFor(() => expect(options()).toEqual(["Attention.typPapers", "Try attention.Ideas.md"]));
    expect(screen.getByText("In notes")).toBeInTheDocument();
  });

  it("the words found are highlighted", async () => {
    await openPalette();

    await userEvent.keyboard("attention");

    const found = await screen.findByRole("option", { name: /Try attention/ });
    expect(found.querySelector("mark")).toHaveTextContent("attention");
  });

  it("choosing one opens the note with the match selected", async () => {
    await openPalette();
    await userEvent.keyboard("attention");
    const found = await screen.findByRole("option", { name: /Try attention/ });

    await userEvent.click(found);

    await screen.findByRole("textbox", { name: "Ideas.md" });
    await vi.waitFor(() => {
      const { from, to } = noteView("Ideas.md").state.selection.main;
      expect(IDEAS.slice(from, to)).toBe("attention");
    });
    expect(screen.getByRole("textbox", { name: "Ideas.md" })).toHaveFocus();
  });

  it("in the note that's open already, the selection moves to the match", async () => {
    await openPalette();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByText("Ideas.md"));
    await screen.findByRole("textbox", { name: "Ideas.md" });

    await chooseInMenu("File › Go to File…");
    await userEvent.keyboard("attention");
    await userEvent.click(await screen.findByRole("option", { name: /Try attention/ }));

    await vi.waitFor(() => {
      const { from, to } = noteView("Ideas.md").state.selection.main;
      expect(IDEAS.slice(from, to)).toBe("attention");
    });
  });

  it("one letter doesn't search inside notes yet", async () => {
    await openPalette();

    await userEvent.keyboard("a");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(api.searchNotes).not.toHaveBeenCalled();
  });

  it("commands don't search inside notes", async () => {
    await openPalette("View › Command Palette…");

    await userEvent.keyboard("attention");
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(api.searchNotes).not.toHaveBeenCalled();
  });

  it("what was just typed in a note is saved first, so it's found too", async () => {
    render(<App />);
    await userEvent.click(await screen.findByText("Reading list.typ"));
    const view = await vi.waitFor(() => noteView("Reading list.typ"));
    act(() => view.dispatch({ changes: { from: 0, insert: "attention " } }));

    await chooseInMenu("File › Go to File…");
    await userEvent.keyboard("attention");

    await vi.waitFor(() => expect(api.searchNotes).toHaveBeenCalled());
    const saved = vi.mocked(api.saveNote).mock.invocationCallOrder[0];
    expect(saved).toBeLessThan(vi.mocked(api.searchNotes).mock.invocationCallOrder[0]);
  });
});

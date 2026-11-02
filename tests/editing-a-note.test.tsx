import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const researchNotes: api.Workspace = { name: "Research Notes", path: "/Users/me/Research Notes" };

/** What's written in each note of the fake workspace. */
let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue(researchNotes);
  notes = {
    "Ideas.typ": "Read more papers.",
    "Todo.md": "Buy milk.",
    "Papers/Attention.typ": "Notes on attention.",
  };
  vi.mocked(api.listFiles).mockResolvedValue([
    folder("Papers", [file("Papers/Attention.typ"), file("Papers/attention.pdf"), file("Papers/data.csv")]),
    file("Ideas.typ"),
    file("Todo.md"),
  ]);
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

/** Like the real backend: the new note is empty and shows up in the file list. */
function backendCreatesUntitled(contents = "") {
  notes["Untitled.typ"] = contents;
  vi.mocked(api.createNote).mockImplementation(async () => {
    vi.mocked(api.listFiles).mockResolvedValue([file("Untitled.typ")]);
    return "Untitled.typ";
  });
}

async function renderOpenWorkspace() {
  render(<App />);
  await screen.findByRole("heading", { name: "Research Notes" });
}

async function openNote(name: string) {
  await userEvent.click(await screen.findByRole("button", { name }));
  return editorFor(name);
}

/** The editor of an open note is labelled with the note's file name. */
const editorFor = (name: string) => screen.findByRole("textbox", { name });

describe("Opening a note", () => {
  it("nothing is open at first, and the main area says how to open or create a note", async () => {
    await renderOpenWorkspace();

    expect(screen.getByRole("main")).toHaveTextContent(/open a note .* or create one/i);
  });

  it("clicking a note in the explorer opens it in the editor", async () => {
    await renderOpenWorkspace();

    const editor = await openNote("Ideas.typ");

    expect(api.readNote).toHaveBeenCalledWith("Ideas.typ");
    expect(editor).toHaveTextContent("Read more papers.");
  });

  it("highlights the open note in the explorer", async () => {
    await renderOpenWorkspace();

    await openNote("Ideas.typ");

    expect(screen.getByRole("listitem", { current: true })).toHaveTextContent("Ideas.typ");
  });

  it("opens Markdown notes and notes in folders too", async () => {
    await renderOpenWorkspace();

    expect(await openNote("Todo.md")).toHaveTextContent("Buy milk.");
    await userEvent.click(screen.getByRole("button", { name: "Papers" }));
    expect(await openNote("Attention.typ")).toHaveTextContent("Notes on attention.");
  });

  it("only one note is open at a time", async () => {
    await renderOpenWorkspace();

    await openNote("Ideas.typ");
    await openNote("Todo.md");

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("listitem", { current: true })).toHaveTextContent("Todo.md");
  });

  it("files that aren't notes don't open as notes (PDFs open in the PDF reader)", async () => {
    await renderOpenWorkspace();
    await userEvent.click(await screen.findByRole("button", { name: "Papers" }));

    expect(screen.getByText("data.csv")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "data.csv" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "attention.pdf" })).toBeInTheDocument();
  });

  it("a new note opens straight away, while you type its name", async () => {
    backendCreatesUntitled();
    await renderOpenWorkspace();

    await chooseInMenu("File › New Note");

    expect(await editorFor("Untitled.typ")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Note name" })).toHaveFocus();
  });

  it("renaming the open note keeps it open", async () => {
    backendCreatesUntitled("draft");
    notes["Draft.typ"] = "draft";
    await renderOpenWorkspace();
    await chooseInMenu("File › New Note");
    await screen.findByRole("textbox", { name: "Note name" });

    await userEvent.keyboard("Draft{Enter}");

    expect(await editorFor("Draft.typ")).toHaveTextContent("draft");
  });

  it("explains when a note can't be opened", async () => {
    vi.mocked(api.readNote).mockRejectedValue("This note doesn't exist anymore.");
    await renderOpenWorkspace();

    await userEvent.click(await screen.findByRole("button", { name: "Ideas.typ" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't open the note: This note doesn't exist anymore.",
    );
  });
});

describe("Formatting as you type", () => {
  it("shows headings as headings, without their '='", async () => {
    notes["Ideas.typ"] = "= Ideas\nRead more papers.";
    await renderOpenWorkspace();

    const editor = await openNote("Ideas.typ");

    expect(within(editor).getByRole("heading", { level: 1 })).toHaveTextContent(/^Ideas$/);
  });

  it("shows bold and italic text styled, without their markers", async () => {
    notes["Ideas.typ"] = "Read *more* papers _slowly_.";
    await renderOpenWorkspace();

    const editor = await openNote("Ideas.typ");

    expect(within(editor).getByText("more").tagName).toBe("STRONG");
    expect(within(editor).getByText("slowly").tagName).toBe("EM");
    expect(editor).toHaveTextContent("Read more papers slowly.");
  });

  it("uses Markdown's own syntax for Markdown notes", async () => {
    notes["Todo.md"] = "# Todo\n**Buy** milk.";
    await renderOpenWorkspace();

    const editor = await openNote("Todo.md");

    expect(within(editor).getByRole("heading", { level: 1 })).toHaveTextContent(/^Todo$/);
    expect(within(editor).getByText("Buy").tagName).toBe("STRONG");
  });
});

describe("Maths", () => {
  /** Puts the cursor at `offset` in the note, like clicking there. */
  function placeCursor(editor: HTMLElement, offset: number) {
    const view = EditorView.findFromDOM(editor)!;
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: offset } });
    });
  }

  it("is drawn by Typst as a picture", async () => {
    notes["Ideas.typ"] = "So $x^2$ holds.";
    vi.mocked(api.renderMaths).mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"/>');
    await renderOpenWorkspace();

    const editor = await openNote("Ideas.typ");

    expect(api.renderMaths).toHaveBeenCalledWith("$x^2$");
    expect(await within(editor).findByRole("img", { name: "$x^2$" })).toBeInTheDocument();
  });

  it("sits on the line like text: lowered by as much as it reaches below it (like a subscript)", async () => {
    notes["Ideas.typ"] = "So $k_(j+1)$ holds.";
    vi.mocked(api.renderMaths).mockResolvedValue('<svg data-descent="3.20" xmlns="http://www.w3.org/2000/svg"/>');
    await renderOpenWorkspace();

    const editor = await openNote("Ideas.typ");

    expect(await within(editor).findByRole("img", { name: "$k_(j+1)$" })).toHaveStyle({ verticalAlign: "-3.20pt" });
  });

  it("shows its Typst source to edit when the cursor is in it", async () => {
    notes["Ideas.typ"] = "So $x^2$ holds.";
    await renderOpenWorkspace();
    const editor = await openNote("Ideas.typ");
    await within(editor).findByRole("img", { name: "$x^2$" });

    placeCursor(editor, "So $x".length);

    expect(within(editor).queryByRole("img")).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("So $x^2$ holds.");
  });

  it("with a mistake, shows its source and says what's wrong", async () => {
    notes["Ideas.typ"] = "So $alpah$ holds.";
    vi.mocked(api.renderMaths).mockRejectedValue("Unknown variable: alpah.");
    await renderOpenWorkspace();

    const editor = await openNote("Ideas.typ");

    const maths = await within(editor).findByTitle("Unknown variable: alpah.");
    expect(maths).toHaveTextContent("$alpah$");
  });

  it("the same maths is drawn only once, even when it's written several times", async () => {
    notes["Ideas.typ"] = "$x$ and $x$";
    await renderOpenWorkspace();

    const editor = await openNote("Ideas.typ");

    expect(await within(editor).findAllByRole("img", { name: "$x$" })).toHaveLength(2);
    expect(api.renderMaths).toHaveBeenCalledTimes(1);
  });

  it("Markdown notes don't draw maths", async () => {
    notes["Todo.md"] = "Costs $5 or $6";
    await renderOpenWorkspace();

    await openNote("Todo.md");

    expect(api.renderMaths).not.toHaveBeenCalled();
  });
});

describe("Saving a note", () => {
  it("what you type is saved to the note automatically", async () => {
    await renderOpenWorkspace();
    const editor = await openNote("Ideas.typ");

    await userEvent.click(editor);
    await userEvent.keyboard("Today: ");

    await vi.waitFor(() =>
      expect(api.saveNote).toHaveBeenCalledWith("Ideas.typ", expect.stringContaining("Today: ")),
    );
  });

  it("saves once you pause typing, not after every key", async () => {
    await renderOpenWorkspace();
    const editor = await openNote("Ideas.typ");

    await userEvent.click(editor);
    await userEvent.keyboard("Many keys");

    await vi.waitFor(() => expect(api.saveNote).toHaveBeenCalled());
    expect(api.saveNote).toHaveBeenCalledTimes(1);
  });

  it("opening a note doesn't save it", async () => {
    await renderOpenWorkspace();

    await openNote("Ideas.typ");
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(api.saveNote).not.toHaveBeenCalled();
  });

  it("switching to another note saves what you just typed right away", async () => {
    await renderOpenWorkspace();
    const editor = await openNote("Ideas.typ");
    await userEvent.click(editor);
    await userEvent.keyboard("Quick ");

    await userEvent.click(screen.getByRole("button", { name: "Todo.md" }));

    expect(api.saveNote).toHaveBeenCalledWith("Ideas.typ", expect.stringContaining("Quick "));
  });

  it("closing the workspace saves what you just typed first", async () => {
    await renderOpenWorkspace();
    const editor = await openNote("Ideas.typ");
    await userEvent.click(editor);
    await userEvent.keyboard("Last words ");

    await chooseInMenu("File › Close Workspace");

    await vi.waitFor(() => expect(api.closeWorkspace).toHaveBeenCalled());
    const saved = vi.mocked(api.saveNote).mock.invocationCallOrder[0];
    const closed = vi.mocked(api.closeWorkspace).mock.invocationCallOrder[0];
    expect(saved).toBeLessThan(closed);
  });

  it("explains when the note can't be saved, and keeps what you typed", async () => {
    vi.mocked(api.saveNote).mockRejectedValue("The disk is full.");
    await renderOpenWorkspace();
    const editor = await openNote("Ideas.typ");

    await userEvent.click(editor);
    await userEvent.keyboard("Precious ");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't save the note: The disk is full.",
    );
    expect(editor).toHaveTextContent("Precious");
  });
});

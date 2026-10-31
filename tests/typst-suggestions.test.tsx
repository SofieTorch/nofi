// Suggestions while writing Typst: what a function can be set to, valid values, fonts, symbols…
// They come from Typst itself (see src-tauri/tests/typst_completions.rs); these tests are about
// how the editor shows and uses them.

import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const columns: api.TypstSuggestion = {
  label: "columns",
  kind: "parameter",
  symbol: null,
  detail: "How many columns the page has.",
  insert: "columns: ",
  cursor: 9,
  selection: 0,
};
const letBinding: api.TypstSuggestion = {
  label: "let binding",
  kind: "syntax",
  symbol: null,
  detail: "Saves a value in a variable.",
  insert: "let name = value",
  cursor: 4,
  selection: 4,
};

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": "#set page()\nText.", "Todo.md": "# Todo" };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

async function openNote(name = "Paper.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name });
}

/** Puts the cursor at `offset`, like clicking there. */
function placeCursor(editor: HTMLElement, offset: number) {
  const view = EditorView.findFromDOM(editor)!;
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: offset } });
  });
  return view;
}

const suggestionList = () => screen.findByRole("listbox");

/**
 * Waits for the list, and a moment more: right after it opens it ignores Enter for a few
 * milliseconds, so typing fast never picks a suggestion by accident.
 */
async function suggestionListReady() {
  await suggestionList();
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe("Typst suggestions", () => {
  it("typing in a Typst note asks Typst for suggestions at the cursor, and lists them", async () => {
    vi.mocked(api.completeTypst).mockResolvedValue({ from: 10, items: [columns] });
    const editor = await openNote();
    placeCursor(editor, "#set page(".length);

    await userEvent.keyboard("c");

    await vi.waitFor(() =>
      expect(api.completeTypst).toHaveBeenCalledWith("#set page(c)\nText.", 11, false),
    );
    expect(within(await suggestionList()).getByRole("option", { name: /columns/ })).toBeInTheDocument();
  });

  it("shows what the highlighted suggestion is for", async () => {
    vi.mocked(api.completeTypst).mockResolvedValue({ from: 10, items: [columns] });
    const editor = await openNote();
    placeCursor(editor, "#set page(".length);

    await userEvent.keyboard("c");

    expect(await screen.findByText("How many columns the page has.")).toBeInTheDocument();
  });

  it("Enter uses the suggestion and puts the cursor where its value goes", async () => {
    vi.mocked(api.completeTypst).mockResolvedValue({ from: 10, items: [columns] });
    const editor = await openNote();
    const view = placeCursor(editor, "#set page(".length);
    await userEvent.keyboard("c");
    await suggestionListReady();

    await userEvent.keyboard("{Enter}");

    expect(view.state.doc.toString()).toBe("#set page(columns: )\nText.");
    expect(view.state.selection.main.head).toBe("#set page(columns: ".length);
  });

  it("a suggestion with a placeholder selects it, ready to type over", async () => {
    vi.mocked(api.completeTypst).mockResolvedValue({ from: 13, items: [letBinding] });
    notes["Paper.typ"] = "#set page()\n#";
    const editor = await openNote();
    const view = placeCursor(editor, 13);
    await userEvent.keyboard("l");
    await suggestionListReady();

    await userEvent.keyboard("{Enter}");

    expect(view.state.doc.toString()).toBe("#set page()\n#let name = value");
    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe("name");
  });

  it("Ctrl+Space asks for suggestions anywhere, even in plain text", async () => {
    const editor = await openNote();
    placeCursor(editor, "#set page()\nTe".length);

    await userEvent.keyboard("{Control>} {/Control}");

    await vi.waitFor(() =>
      expect(api.completeTypst).toHaveBeenCalledWith("#set page()\nText.", 14, true),
    );
  });

  /** On a Mac, Ctrl+Space usually switches the keyboard language, so ⌘I does the same. */
  it("⌘I (Ctrl+I on Windows and Linux) asks for suggestions too", async () => {
    const editor = await openNote();
    placeCursor(editor, "#set page()\nTe".length);

    await userEvent.keyboard("{Control>}i{/Control}");

    await vi.waitFor(() =>
      expect(api.completeTypst).toHaveBeenCalledWith("#set page()\nText.", 14, true),
    );
    expect(EditorView.findFromDOM(editor)!.state.doc.toString()).toBe("#set page()\nText.");
  });

  it("Edit › Show Suggestions asks for them at the cursor", async () => {
    vi.mocked(api.completeTypst).mockResolvedValue({ from: 10, items: [columns] });
    const editor = await openNote();
    placeCursor(editor, "#set page(".length);

    await chooseInMenu("Edit › Show Suggestions");

    expect(await suggestionList()).toBeInTheDocument();
    expect(api.completeTypst).toHaveBeenCalledWith("#set page()\nText.", 10, true);
  });

  it("Escape closes the suggestions", async () => {
    vi.mocked(api.completeTypst).mockResolvedValue({ from: 10, items: [columns] });
    const editor = await openNote();
    placeCursor(editor, "#set page(".length);
    await userEvent.keyboard("c");
    await suggestionList();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Markdown notes don't get Typst suggestions", async () => {
    const editor = await openNote("Todo.md");
    placeCursor(editor, 6);

    await userEvent.keyboard("x");
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(api.completeTypst).not.toHaveBeenCalled();
  });
});

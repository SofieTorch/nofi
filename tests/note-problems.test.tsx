// Keeping Typst notes valid while they're written: mistakes are underlined where they are, listed
// with plain explanations and fixes (see src-tauri/tests/note_problems.rs for which), and brackets
// close themselves as they're typed.

import { EditorView } from "@codemirror/view";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const NOTE = "It costs $5 today.";
const dollar: api.Problem = {
  from: 9,
  to: 10,
  severity: "error",
  message: "This $ starts maths, but the maths never ends.",
  hints: [],
  fixes: [{ label: "Write $ as text", from: 9, to: 9, insert: "\\" }],
};

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": NOTE, "Clean.typ": "All good.", "Todo.md": "Costs $5" };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  // Like the backend: the $ is a problem until it's written as text.
  vi.mocked(api.checkNote).mockImplementation(async (note) => (note.includes("$5") && !note.includes("\\$") ? [dollar] : []));
});

async function openNote(name = "Paper.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name });
}

const problemsButton = () => screen.findByRole("button", { name: /1 problem/ });
const textIn = (editor: HTMLElement) => EditorView.findFromDOM(editor)!.state.doc.toString();

function placeCursor(editor: HTMLElement, offset: number) {
  const view = EditorView.findFromDOM(editor)!;
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: offset } });
  });
}

describe("Mistakes in a Typst note", () => {
  it("are found as soon as the note opens", async () => {
    await openNote();

    expect(await problemsButton()).toBeInTheDocument();
    expect(api.checkNote).toHaveBeenCalledWith(NOTE, expect.any(String));
  });

  it("are underlined where they are", async () => {
    const editor = await openNote();
    await problemsButton();

    const underlined = editor.querySelector(".cm-lintRange-error");
    expect(underlined).toHaveTextContent("$");
  });

  it("are listed with their explanation and fixes", async () => {
    await openNote();

    await userEvent.click(await problemsButton());

    const list = await screen.findByRole("list", { name: "Problems" });
    expect(list).toHaveTextContent("This $ starts maths, but the maths never ends.");
    expect(within(list).getByRole("button", { name: /Write \$ as text/ })).toBeInTheDocument();
  });

  it("a fix changes the note, and the problem goes away", async () => {
    const editor = await openNote();
    await userEvent.click(await problemsButton());
    const list = await screen.findByRole("list", { name: "Problems" });

    await userEvent.click(within(list).getByRole("button", { name: /Write \$ as text/ }));

    expect(textIn(editor)).toBe("It costs \\$5 today.");
    await vi.waitFor(() => expect(screen.queryByRole("button", { name: /problem/ })).not.toBeInTheDocument());
  });

  it("the note is checked again as it's written", async () => {
    const editor = await openNote("Clean.typ");
    placeCursor(editor, "All good.".length);

    await userEvent.keyboard(" Costs $5");

    await vi.waitFor(() => expect(api.checkNote).toHaveBeenLastCalledWith("All good. Costs $5", "Clean.typ"), { timeout: 2000 });
    expect(await problemsButton()).toBeInTheDocument();
  });

  it("clicking a problem in the list goes to it", async () => {
    const editor = await openNote();
    await userEvent.click(await problemsButton());

    await userEvent.click(screen.getByRole("button", { name: dollar.message }));

    expect(EditorView.findFromDOM(editor)!.state.selection.main.head).toBe(9);
    expect(editor).toHaveFocus();
  });

  it("a note without mistakes shows nothing", async () => {
    await openNote("Clean.typ");
    await vi.waitFor(() => expect(api.checkNote).toHaveBeenCalled());

    expect(screen.queryByRole("button", { name: /problem/ })).not.toBeInTheDocument();
  });

  it("Markdown notes aren't checked as Typst", async () => {
    await openNote("Todo.md");
    await new Promise((resolve) => setTimeout(resolve, 600));

    expect(api.checkNote).not.toHaveBeenCalled();
  });

  it("the explorer marks notes that have mistakes, until they're fixed", async () => {
    await openNote();
    const note = screen.getByRole("button", { name: "Paper.typ" });
    await vi.waitFor(() => expect(note).toHaveAccessibleDescription("Has mistakes"));

    await userEvent.click(await problemsButton());
    await userEvent.click(within(await screen.findByRole("list", { name: "Problems" })).getByRole("button", { name: /Write \$ as text/ }));

    await vi.waitFor(() => expect(note).not.toHaveAccessibleDescription("Has mistakes"), { timeout: 2000 });
  });
});

describe("Brackets while writing Typst", () => {
  it("typing an opening bracket adds its closing one, with the cursor between", async () => {
    notes["Clean.typ"] = "";
    const editor = await openNote("Clean.typ");
    placeCursor(editor, 0);

    await userEvent.keyboard("#set page(");

    expect(textIn(editor)).toBe("#set page()");
    expect(EditorView.findFromDOM(editor)!.state.selection.main.head).toBe("#set page(".length);
  });

  it("typing the closing bracket steps over the one that was added", async () => {
    notes["Clean.typ"] = "";
    const editor = await openNote("Clean.typ");
    placeCursor(editor, 0);

    await userEvent.keyboard("#text(red");
    await userEvent.keyboard(")");

    expect(textIn(editor)).toBe("#text(red)");
  });

  it("a $ isn't paired, so a price like $5 never silently turns into maths", async () => {
    notes["Clean.typ"] = "";
    const editor = await openNote("Clean.typ");
    placeCursor(editor, 0);

    await userEvent.keyboard("$");

    expect(textIn(editor)).toBe("$");
  });
});

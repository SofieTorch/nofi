// Collapsing headings, like Notion's toggle headings: hovering a heading shows an arrow at the end
// of its text (away from the block handle, in the margin). Clicking it hides everything under the
// heading, up to the next heading of the same level or a bigger one; clicking again shows it.
// Only the editor hides it: the note's text stays exactly as it was, and so do its pages.

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const TYPST = "= Intro\n\nHello.\n\n== Details\n\nMore.\n\n= Methods\n\nHow.";
const MARKDOWN = "# Intro\n\nHello.\n\n## Details\n\nMore.\n\n# Methods\n\nHow.";

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": TYPST, "Todo.md": MARKDOWN, "Other.typ": "Other." };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

async function openNote(name = "Paper.typ", first = true) {
  if (first) render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  const editor = await screen.findByRole("textbox", { name });
  return { editor, view: EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)! };
}

const text = (view: EditorView) => view.state.doc.toString();
/** The note's lines as shown (headings without their = or #). */
const shownLines = (editor: HTMLElement) =>
  [...editor.querySelectorAll(":scope > .cm-line")].map((line) => line.textContent!.replace(/^[=#]+ /, ""));
const arrowOf = (editor: HTMLElement, heading: string) =>
  within(within(editor).getByText(heading).closest<HTMLElement>(".cm-line")!).getByRole("button", { name: /section/ });

function toggle(editor: HTMLElement, heading: string) {
  fireEvent.mouseDown(arrowOf(editor, heading), { button: 0 });
}

describe.each([
  ["Paper.typ", TYPST],
  ["Todo.md", MARKDOWN],
])("Collapsing headings in %s", (name, note) => {
  it("a heading has an arrow at the end of its text, to collapse it", async () => {
    const { editor } = await openNote(name);

    const arrow = arrowOf(editor, "Intro");

    expect(arrow).toHaveAccessibleName("Collapse section");
    expect(arrow).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking it hides what's under the heading, smaller headings included, up to the next one as big", async () => {
    const { editor } = await openNote(name);

    toggle(editor, "Intro");

    expect(shownLines(editor)).toEqual(["Intro", "Methods", "How."]);
    expect(arrowOf(editor, "Intro")).toHaveAccessibleName("Expand section");
    expect(arrowOf(editor, "Intro")).toHaveAttribute("aria-expanded", "false");
  });

  it("a smaller heading hides only its own part", async () => {
    const { editor } = await openNote(name);

    toggle(editor, "Details");

    expect(shownLines(editor)).toEqual(["Intro", "Hello.", "Details", "Methods", "How."]);
  });

  it("the last heading hides everything to the end of the note", async () => {
    const { editor } = await openNote(name);

    toggle(editor, "Methods");

    expect(shownLines(editor)).toEqual(["Intro", "Hello.", "Details", "More.", "Methods"]);
  });

  it("clicking again shows it all again", async () => {
    const { editor } = await openNote(name);

    toggle(editor, "Intro");
    toggle(editor, "Intro");

    expect(shownLines(editor)).toEqual(["Intro", "Hello.", "Details", "More.", "Methods", "How."]);
  });

  it("the note's text doesn't change", async () => {
    const { editor, view } = await openNote(name);

    toggle(editor, "Intro");

    expect(text(view)).toBe(note);
    expect(api.saveNote).not.toHaveBeenCalled();
  });

  it("the cursor skips the hidden part: → at the end of the heading goes to the next heading", async () => {
    const { editor, view } = await openNote(name);
    toggle(editor, "Intro");
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: note.indexOf("\n") } });
    });

    await userEvent.keyboard("{ArrowRight}");

    expect(view.state.selection.main.head).toBe(note.indexOf(name.endsWith(".typ") ? "= Methods" : "# Methods"));
  });

  it("the cursor going into the hidden part (like with Undo) shows it again", async () => {
    const { editor, view } = await openNote(name);
    toggle(editor, "Intro");

    act(() => view.dispatch({ selection: { anchor: note.indexOf("Hello.") } }));

    expect(shownLines(editor)).toContain("Hello.");
  });

  it("stays collapsed after going to another note and back", async () => {
    const { editor } = await openNote(name);
    toggle(editor, "Intro");

    await openNote("Other.typ", false);
    const back = await openNote(name, false);

    expect(shownLines(back.editor)).toEqual(["Intro", "Methods", "How."]);
  });
});

describe("Collapsed headings and block handles", () => {
  it("dragging a collapsed heading moves what's hidden under it too", async () => {
    const { editor, view } = await openNote();
    toggle(editor, "Intro");

    fireEvent.mouseMove(within(editor).getByText("Intro"));
    const handle = view.dom.querySelector<HTMLElement>(":scope > .cm-block-handle")!;
    fireEvent.mouseDown(handle, { button: 0 });
    // (Nothing has a size here, so every block's middle is at 0: below it is after it.)
    fireEvent.mouseMove(within(editor).getByText("How."), { clientY: 1 });
    fireEvent.mouseUp(within(editor).getByText("How."), { clientY: 1 });

    expect(text(view)).toBe("= Methods\n\nHow.\n\n= Intro\n\nHello.\n\n== Details\n\nMore.");
    // It stays collapsed where it landed; the heading now first isn't.
    expect(shownLines(editor)).toEqual(["Methods", "How.", "Intro"]);
  });

  it("Undo takes the move back, and the heading is collapsed where it was", async () => {
    const { editor, view } = await openNote();
    toggle(editor, "Intro");
    fireEvent.mouseMove(within(editor).getByText("Intro"));
    const handle = view.dom.querySelector<HTMLElement>(":scope > .cm-block-handle")!;
    fireEvent.mouseDown(handle, { button: 0 });
    fireEvent.mouseMove(within(editor).getByText("How."), { clientY: 1 });
    fireEvent.mouseUp(within(editor).getByText("How."), { clientY: 1 });

    await chooseInMenu("Edit › Undo");

    expect(text(view)).toBe(TYPST);
    expect(shownLines(editor)).toEqual(["Intro", "Methods", "How."]);
  });
});

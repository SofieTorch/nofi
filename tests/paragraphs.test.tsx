// Paragraphs, like Notion's blocks: Enter starts a new paragraph, which in Typst and Markdown is a
// blank line between them. The editor hides that blank line: the new paragraph shows on the next
// line, a little apart, and the cursor goes over the hidden line as if it weren't there.
// Shift+Enter is a line break within the paragraph. Lists and code blocks keep their own Enter.

import { EditorView } from "@codemirror/view";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": "First.", "Todo.md": "First." };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

async function openNote(name = "Paper.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  const editor = await screen.findByRole("textbox", { name });
  return { editor, view: EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)! };
}

const text = (view: EditorView) => view.state.doc.toString();
const head = (view: EditorView) => view.state.selection.main.head;

function cursorAt(view: EditorView, at: number) {
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: at } });
  });
}

describe.each(["Paper.typ", "Todo.md"])("Paragraphs in %s", (name) => {
  it("Enter starts a new paragraph: a blank line in the note", async () => {
    const { view } = await openNote(name);
    cursorAt(view, text(view).length);

    await userEvent.keyboard("{Enter}");
    act(() => view.dispatch(view.state.replaceSelection("Second.")));

    expect(text(view)).toBe("First.\n\nSecond.");
  });

  it("the blank line between two paragraphs isn't shown", async () => {
    notes[name] = "First.\n\nSecond.";
    const { editor } = await openNote(name);

    const lines = [...editor.querySelectorAll(".cm-line")].map((line) => line.textContent);
    expect(lines).toEqual(["First.", "Second."]);
    expect(editor.querySelectorAll(".cm-line")[1]).toHaveClass("cm-paragraph-start");
  });

  it("more blank lines show as empty lines (one fewer)", async () => {
    notes[name] = "First.\n\n\nSecond.";
    const { editor } = await openNote(name);

    const lines = [...editor.querySelectorAll(".cm-line")].map((line) => line.textContent);
    expect(lines).toEqual(["First.", "", "Second."]);
  });

  const shownLines = (editor: HTMLElement) =>
    [...editor.querySelectorAll(".cm-content > .cm-line")].map((line) => line.textContent);

  it("Enter at the end of the note shows one new, empty line", async () => {
    const { editor, view } = await openNote(name);
    cursorAt(view, text(view).length);

    await userEvent.keyboard("{Enter}");

    expect(shownLines(editor)).toEqual(["First.", ""]);
  });

  it("Enter at the end of a paragraph before another shows one new, empty line, ready to type in", async () => {
    notes[name] = "First.\n\nSecond.";
    const { editor, view } = await openNote(name);
    cursorAt(view, "First.".length);

    await userEvent.keyboard("{Enter}");
    expect(shownLines(editor)).toEqual(["First.", "", "Second."]);

    act(() => view.dispatch(view.state.replaceSelection("New.")));
    expect(text(view)).toBe("First.\n\nNew.\n\nSecond.");
    expect(shownLines(editor)).toEqual(["First.", "New.", "Second."]);
  });

  it("⌫ at the start of a paragraph after an empty one removes the empty one", async () => {
    notes[name] = "First.\n\n\n\nSecond.";
    const { view } = await openNote(name);
    cursorAt(view, text(view).indexOf("Second."));

    await userEvent.keyboard("{Backspace}");

    expect(text(view)).toBe("First.\n\nSecond.");
  });

  it("Shift+Enter is a line break within the paragraph", async () => {
    const { view } = await openNote(name);
    cursorAt(view, text(view).length);

    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");

    expect(text(view)).toBe("First.\n");
  });

  it("← from the start of a paragraph goes straight to the end of the one before", async () => {
    notes[name] = "First.\n\nSecond.";
    const { view } = await openNote(name);
    cursorAt(view, "First.\n\n".length);

    await userEvent.keyboard("{ArrowLeft}");

    expect(head(view)).toBe("First.".length);
  });

  it("→ from the end of a paragraph goes straight to the start of the next", async () => {
    notes[name] = "First.\n\nSecond.";
    const { view } = await openNote(name);
    cursorAt(view, "First.".length);

    await userEvent.keyboard("{ArrowRight}");

    expect(head(view)).toBe("First.\n\n".length);
  });

  it("the cursor never stays on a hidden blank line (like after End): it goes to the end of the paragraph", async () => {
    notes[name] = "First.\n\nSecond.";
    const { view } = await openNote(name);

    cursorAt(view, "First.\n".length);

    expect(head(view)).toBe("First.".length);
  });

  it("…and on the hidden line after an empty paragraph, to the empty paragraph", async () => {
    notes[name] = "First.\n\n\n\nSecond.";
    const { view } = await openNote(name);

    cursorAt(view, "First.\n\n\n".length);

    expect(head(view)).toBe("First.\n\n".length);
  });

  it("a click past the end of a paragraph's last line puts the cursor at its end, not on the next paragraph", async () => {
    notes[name] = "First.\n\nSecond.";
    const { editor, view } = await openNote(name);
    cursorAt(view, text(view).length);
    // (Past the line's end, the click lands on the hidden blank line after it.)
    vi.spyOn(view, "posAtCoords").mockReturnValue("First.\n".length);

    await userEvent.pointer({ keys: "[MouseLeft]", target: editor.querySelector(".cm-line")! });

    expect(head(view)).toBe("First.".length);
  });

  it("a paragraph after an empty one keeps its own line, and its style", async () => {
    notes[name] = name.endsWith(".typ") ? "First.\n\n\n\n== Basics" : "First.\n\n\n\n## Basics";
    const { editor } = await openNote(name);

    const lines = [...editor.querySelectorAll(".cm-content > .cm-line")];
    expect(lines.map((line) => line.textContent?.replace(/^=+ |^#+ /, ""))).toEqual(["First.", "", "Basics"]);
    expect(lines[2].className).toMatch(/heading/);
  });

  it("⌫ at the start of a paragraph joins it to the one before", async () => {
    notes[name] = "First.\n\nSecond.";
    const { view } = await openNote(name);
    cursorAt(view, "First.\n\n".length);

    await userEvent.keyboard("{Backspace}");

    expect(text(view)).toBe("First.Second.");
  });

  it("Enter inside bold splits it: each paragraph keeps its bold part", async () => {
    notes[name] = name.endsWith(".typ") ? "*Hello world*" : "**Hello world**";
    const { view } = await openNote(name);
    const mark = name.endsWith(".typ") ? "*" : "**";
    cursorAt(view, `${mark}Hello `.length);

    await userEvent.keyboard("{Enter}");
    act(() => view.dispatch(view.state.replaceSelection("big ")));

    expect(text(view)).toBe(`${mark}Hello ${mark}\n\n${mark}big world${mark}`);
  });

  it("⌫ at the start of the second part joins them back into one bold text", async () => {
    notes[name] = name.endsWith(".typ") ? "*Hello *\n\n*world*" : "**Hello **\n\n**world**";
    const { view } = await openNote(name);
    cursorAt(view, text(view).lastIndexOf(name.endsWith(".typ") ? "*world" : "**world"));

    await userEvent.keyboard("{Backspace}");

    expect(text(view)).toBe(name.endsWith(".typ") ? "*Hello world*" : "**Hello world**");
  });

  it("Delete at the end of the first part joins them back too", async () => {
    notes[name] = name.endsWith(".typ") ? "*Hello *\n\n*world*" : "**Hello **\n\n**world**";
    const { view } = await openNote(name);
    cursorAt(view, text(view).indexOf("\n"));

    await userEvent.keyboard("{Delete}");

    expect(text(view)).toBe(name.endsWith(".typ") ? "*Hello world*" : "**Hello world**");
  });

  it("Enter in a list item keeps the list's own Enter", async () => {
    notes[name] = "- one";
    const { view } = await openNote(name);
    cursorAt(view, text(view).length);

    await userEvent.keyboard("{Enter}");

    expect(text(view)).not.toContain("\n\n");
  });

  it("Enter in a code block is a plain new line", async () => {
    notes[name] = "```\ncode\n```";
    const { view } = await openNote(name);
    cursorAt(view, "```\ncode".length);

    await userEvent.keyboard("{Enter}");

    expect(text(view)).toBe("```\ncode\n\n```");
  });

  it("blank lines in a code block are shown", async () => {
    notes[name] = "```\na\n\nb\n```";
    const { editor } = await openNote(name);

    const lines = [...editor.querySelectorAll(".cm-line.cm-codeblock")].map((line) => line.textContent?.replace(/^\d+/, ""));
    expect(lines).toContain("");
  });
});

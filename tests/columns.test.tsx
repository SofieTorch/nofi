// Columns while writing: #columns(2)[… #colbreak() …] is shown as real columns, side by side, each
// a small editor of its own that works like the note's (formatting, the toolbar, the "/" menu…).
// What's typed in a column goes into the note, in that column; Undo and Redo are the note's.
// A bar above them adds and removes columns, or shows the code.

import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const COLUMNS = "#columns(2)[\nTransformers use *attention*.\n#colbreak()\nBERT came next.\n]";
const NOTE = `Intro.\n${COLUMNS}\nAfter.`;

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": NOTE };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  vi.mocked(api.slashCommands).mockResolvedValue([
    {
      id: "heading-1",
      label: "Heading 1",
      section: "Text",
      keywords: [],
      description: "A heading.",
      insert: "= Heading",
      cursor: 2,
      selection: 7,
      block: true,
    },
  ]);
});

async function openNote() {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Paper.typ" }));
  const editor = await screen.findByRole("textbox", { name: "Paper.typ" });
  // (From the editor's outer element: its text area holds the columns' editors too.)
  return { editor, view: EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)! };
}

const column = (n: number) => screen.getByRole("textbox", { name: `Column ${n}` });
const columnView = (n: number) => EditorView.findFromDOM(column(n).closest<HTMLElement>(".cm-editor")!)!;
const text = (view: EditorView) => view.state.doc.toString();
const bar = () => within(screen.getByRole("toolbar", { name: "Columns" }));

/** Types at the end of a column (as its editor would). */
function typeInColumn(n: number, typed: string) {
  const view = columnView(n);
  act(() => {
    view.focus();
    view.dispatch({ changes: { from: view.state.doc.length, insert: typed }, userEvent: "input.type" });
  });
}

describe("Columns while writing", () => {
  it("are shown side by side, one editor each, without their code", async () => {
    const { editor } = await openNote();

    expect(within(editor).getByRole("group", { name: "2 columns" })).toBeInTheDocument();
    expect(text(columnView(1))).toBe("Transformers use *attention*.");
    expect(text(columnView(2))).toBe("BERT came next.");
    expect(editor).not.toHaveTextContent("#columns");
    expect(editor).not.toHaveTextContent("#colbreak");
  });

  it("each column is formatted like the rest of the note", async () => {
    await openNote();

    expect(within(column(1)).getByText("attention").closest("strong")).toBeInTheDocument();
  });

  it("what's typed in a column goes into the note, in that column", async () => {
    const { view } = await openNote();

    typeInColumn(2, " Then GPT.");

    expect(text(view)).toBe(NOTE.replace("BERT came next.", "BERT came next. Then GPT."));
  });

  it("Undo takes back what was typed in a column, in the note and in the column", async () => {
    const { view } = await openNote();
    typeInColumn(2, " Then GPT.");

    await chooseInMenu("Edit › Undo");

    expect(text(view)).toBe(NOTE);
    expect(text(columnView(2))).toBe("BERT came next.");
  });

  it("Ctrl+Z in a column is the note's Undo too", async () => {
    const { view } = await openNote();
    typeInColumn(1, " Mostly.");

    await userEvent.keyboard("{Control>}z{/Control}");

    expect(text(view)).toBe(NOTE);
  });

  it("the note's cursor stays at the columns, so Undo doesn't jump elsewhere", async () => {
    const { view } = await openNote();

    typeInColumn(2, "!");

    expect(view.state.selection.main.head).toBe("Intro.\n".length);
  });

  it("columns that don't all have text yet are shown empty, and typing in one fills it", async () => {
    notes["Paper.typ"] = "#columns(3)[\nFirst.\n]";
    const { view } = await openNote();

    expect(text(columnView(3))).toBe("");
    typeInColumn(3, "Third.");

    expect(text(view)).toBe("#columns(3)[\nFirst.\n#colbreak()\n\n#colbreak()\nThird.\n]");
  });

  it("a new line at the end of a column stays", async () => {
    const { view } = await openNote();

    typeInColumn(2, "\n");

    expect(text(columnView(2))).toBe("BERT came next.\n");
    expect(text(view)).toBe(NOTE.replace("BERT came next.\n", "BERT came next.\n\n"));
  });

  it("the toolbar works in a column", async () => {
    await openNote();
    const view = columnView(2);

    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 0, head: 4 } });
    });

    expect(await screen.findByRole("toolbar", { name: "Format" })).toBeInTheDocument();
  });

  it("the / menu works in a column", async () => {
    await openNote();
    const view = columnView(2);
    act(() => {
      view.focus();
      view.dispatch({ changes: { from: view.state.doc.length, insert: "\n" }, selection: { anchor: view.state.doc.length + 1 } });
    });

    await userEvent.keyboard("/");

    expect(await screen.findByRole("listbox")).toHaveTextContent("Heading 1");
  });

  it("with the note's cursor in them, they show as code, to edit", async () => {
    const { editor, view } = await openNote();

    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: NOTE.indexOf("#colbreak") } });
    });

    expect(editor).toHaveTextContent("#colbreak()");
    expect(screen.queryByRole("textbox", { name: "Column 1" })).not.toBeInTheDocument();
  });
});

describe("The columns bar", () => {
  it("adds a column on the right", async () => {
    const { view } = await openNote();

    await userEvent.click(bar().getByRole("button", { name: "Add column" }));

    expect(text(view)).toBe(NOTE.replace("#columns(2)", "#columns(3)").replace("BERT came next.\n]", "BERT came next.\n#colbreak()\n\n]"));
    expect(column(3)).toBeInTheDocument();
  });

  it("removes the last column, keeping its text in the one before", async () => {
    notes["Paper.typ"] = "#columns(3)[\nA.\n#colbreak()\nB.\n#colbreak()\nC.\n]";
    const { view } = await openNote();

    await userEvent.click(bar().getByRole("button", { name: "Remove column" }));

    expect(text(view)).toBe("#columns(2)[\nA.\n#colbreak()\nB.\n\nC.\n]");
  });

  it("two columns can't become one", async () => {
    await openNote();

    expect(bar().getByRole("button", { name: "Remove column" })).toBeDisabled();
  });

  it("'Back to text' removes the columns, keeping each one's text in order", async () => {
    const { view } = await openNote();

    await userEvent.click(bar().getByRole("button", { name: "Back to text" }));

    expect(text(view)).toBe("Intro.\nTransformers use *attention*.\n\nBERT came next.\nAfter.");
    expect(screen.queryByRole("group", { name: "2 columns" })).not.toBeInTheDocument();
  });

  it("'Back to text' leaves out empty columns", async () => {
    notes["Paper.typ"] = "#columns(3)[\nA.\n#colbreak()\n\n#colbreak()\nC.\n]";
    const { view } = await openNote();

    await userEvent.click(bar().getByRole("button", { name: "Back to text" }));

    expect(text(view)).toBe("A.\n\nC.");
  });

  it("one Undo brings the columns back", async () => {
    const { view } = await openNote();
    await userEvent.click(bar().getByRole("button", { name: "Back to text" }));

    await chooseInMenu("Edit › Undo");

    expect(text(view)).toBe(NOTE);
    // At the columns, so the note doesn't jump to its start.
    expect(view.state.selection.main.head).toBe("Intro.\n".length);
  });

  it("clicking into a column puts the note's cursor at the columns", async () => {
    const { view } = await openNote();

    await userEvent.click(within(column(2)).getByText("BERT came next."));

    expect(view.state.selection.main.head).toBe("Intro.\n".length);
  });

  it("'Edit as code' shows the code", async () => {
    const { editor } = await openNote();

    await userEvent.click(bar().getByRole("button", { name: "Edit as code" }));

    expect(editor).toHaveTextContent("#columns(2)[");
  });

  it("keeps the columns' settings, like the gap between them", async () => {
    notes["Paper.typ"] = "#columns(2, gutter: 2em)[\nA.\n#colbreak()\nB.\n]";
    const { view } = await openNote();

    await userEvent.click(bar().getByRole("button", { name: "Add column" }));

    expect(text(view)).toBe("#columns(3, gutter: 2em)[\nA.\n#colbreak()\nB.\n#colbreak()\n\n]");
  });
});

describe("Arrow keys and columns", () => {
  const focusedColumn = () => document.activeElement?.getAttribute("aria-label");
  const head = (view: EditorView) => view.state.selection.main.head;
  function cursorInNote(view: EditorView, at: number) {
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: at } });
    });
  }
  function cursorInColumn(n: number, at: (doc: string) => number) {
    const view = columnView(n);
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: at(text(view)) } });
    });
  }
  const end = (doc: string) => doc.length;
  const start = () => 0;

  it("→ at the end of the text before the columns goes into the first column", async () => {
    const { view } = await openNote();
    cursorInNote(view, "Intro.".length);

    await userEvent.keyboard("{ArrowRight}");

    expect(focusedColumn()).toBe("Column 1");
    expect(head(columnView(1))).toBe(0);
  });

  it("the blank line between the columns and the paragraph after them isn't shown", async () => {
    notes["Paper.typ"] = `Intro.\n\n${COLUMNS}\n\nAfter.`;
    const { editor } = await openNote();

    // (The note's own lines, not the columns'.)
    const lines = [...editor.querySelectorAll(":scope > .cm-line")].map((line) => line.textContent);
    expect(lines).toEqual(["Intro.", "After."]);
  });

  it("→ at the end of a paragraph a blank line before the columns goes into the first column", async () => {
    notes["Paper.typ"] = `Intro.\n\n${COLUMNS}\n\nAfter.`;
    const { view } = await openNote();
    cursorInNote(view, "Intro.".length);

    await userEvent.keyboard("{ArrowRight}");

    expect(focusedColumn()).toBe("Column 1");
    expect(head(columnView(1))).toBe(0);
  });

  it("← at the start of a paragraph a blank line after the columns goes into the last column", async () => {
    notes["Paper.typ"] = `Intro.\n\n${COLUMNS}\n\nAfter.`;
    const { view } = await openNote();
    cursorInNote(view, notes["Paper.typ"].indexOf("After."));

    await userEvent.keyboard("{ArrowLeft}");

    expect(focusedColumn()).toBe("Column 2");
  });

  it("↓ on the line before the columns goes into the first column", async () => {
    const { view } = await openNote();
    cursorInNote(view, 2);

    await userEvent.keyboard("{ArrowDown}");

    expect(focusedColumn()).toBe("Column 1");
  });

  it("← and ↑ at the start of the text after the columns go into the last column, at its end", async () => {
    const { view } = await openNote();
    cursorInNote(view, NOTE.indexOf("After."));

    await userEvent.keyboard("{ArrowLeft}");

    expect(focusedColumn()).toBe("Column 2");
    expect(head(columnView(2))).toBe("BERT came next.".length);
  });

  it("→ at the end of a column goes to the start of the next", async () => {
    await openNote();
    cursorInColumn(1, end);

    await userEvent.keyboard("{ArrowRight}");

    expect(focusedColumn()).toBe("Column 2");
    expect(head(columnView(2))).toBe(0);
  });

  it("← at the start of a column goes to the end of the one before", async () => {
    await openNote();
    cursorInColumn(2, start);

    await userEvent.keyboard("{ArrowLeft}");

    expect(focusedColumn()).toBe("Column 1");
    expect(head(columnView(1))).toBe("Transformers use *attention*.".length);
  });

  it("→ at the end of the last column goes to the text after the columns", async () => {
    const { view } = await openNote();
    cursorInColumn(2, end);

    await userEvent.keyboard("{ArrowRight}");

    expect(view.hasFocus).toBe(true);
    expect(head(view)).toBe(NOTE.indexOf("After."));
  });

  it("← at the start of the first column goes back to the text before", async () => {
    const { view } = await openNote();
    cursorInColumn(1, start);

    await userEvent.keyboard("{ArrowLeft}");

    expect(view.hasFocus).toBe(true);
    expect(head(view)).toBe("Intro.".length);
  });

  it("↑ on a column's first line and ↓ on its last leave the columns", async () => {
    const { view } = await openNote();
    cursorInColumn(2, start);
    await userEvent.keyboard("{ArrowUp}");
    expect(view.hasFocus).toBe(true);
    expect(head(view)).toBe("Intro.".length);

    cursorInColumn(1, end);
    await userEvent.keyboard("{ArrowDown}");
    expect(view.hasFocus).toBe(true);
    expect(head(view)).toBe(NOTE.indexOf("After."));
  });
});

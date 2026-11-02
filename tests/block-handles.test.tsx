// Moving blocks around, like in Notion: hovering a block shows a handle (⋮⋮) in the margin;
// dragging it moves the block, with a line showing where it'll go. ⌘⇧↑ / ⌘⇧↓ (Ctrl here) move the
// block the cursor is in. Blocks in columns have handles too, and move within a column, between
// columns, and in and out of them. Each move is one change: one Undo takes it back. What counts
// as a block, and how the text is kept tidy, is specified in blocks.test.ts.

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const NOTE = "First.\n\nSecond.\n\nThird.";
const COLUMNS = "Intro.\n#columns(2)[\nTransformers.\n\nThey scale.\n#colbreak()\nBERT came next.\n]\nAfter.";

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": NOTE, "Columns.typ": COLUMNS, "Todo.md": "- one\n- two\n- three" };
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
/** The line (or block) element showing some text. */
const lineOf = (within_: HTMLElement, shown: string) => within(within_).getByText(shown).closest<HTMLElement>(".cm-line")!;
/** An editor's own handle (each editor, the note's and each column's, has one). */
const handleOf = (view: EditorView) => view.dom.querySelector<HTMLElement>(":scope > .cm-block-handle")!;

function hover(line: HTMLElement) {
  fireEvent.mouseMove(line);
}

/** Drags a handle onto a line: in its top half (before it) or bottom half (after it). */
function drag(handle: HTMLElement, onto: HTMLElement, side: "before" | "after") {
  fireEvent.mouseDown(handle, { button: 0 });
  // (Nothing has a size here, so every block's middle is at 0.)
  fireEvent.mouseMove(onto, { clientY: side === "before" ? -1 : 1 });
  fireEvent.mouseUp(onto, { clientY: side === "before" ? -1 : 1 });
}

describe("Block handles", () => {
  it("hovering a block shows its handle in the margin", async () => {
    const { editor, view } = await openNote();

    hover(lineOf(editor, "Second."));

    expect(handleOf(view)).toHaveAttribute("aria-label", "Drag to move");
    expect(handleOf(view)).toHaveClass("cm-block-handle-shown");
  });

  it("the handle stays while the mouse goes from the text to it, outside the text", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Second."));

    fireEvent.mouseLeave(view.dom);
    fireEvent.mouseEnter(handleOf(view));
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(handleOf(view)).toHaveClass("cm-block-handle-shown");
  });

  it("it goes away a moment after the mouse leaves the note", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Second."));

    // (Nothing has a size here: anywhere but 0, 0 is away from the note.)
    fireEvent.mouseMove(document.body, { clientX: 900, clientY: 900 });
    expect(handleOf(view)).toHaveClass("cm-block-handle-shown");
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(handleOf(view)).not.toHaveClass("cm-block-handle-shown");
  });

  it("leaving the handle hides it too, after a moment", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Second."));
    fireEvent.mouseLeave(view.dom);
    fireEvent.mouseEnter(handleOf(view));

    fireEvent.mouseLeave(handleOf(view));
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(handleOf(view)).not.toHaveClass("cm-block-handle-shown");
  });

  describe("from the margin", () => {
    // The text starts 100px from the left; the mouse is in the margin, level with "Second.".
    beforeEach(() => {
      // (Lines are 20px high, so the editor shows them all, however fast it measures.)
      const sized = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const height = this.classList.contains("cm-line") ? 20 : 500;
        return { left: 100, right: 600, width: 500, top: 0, bottom: height, height, x: 100, y: 0, toJSON: () => ({}) } as DOMRect;
      });
      const at = vi.spyOn(EditorView.prototype, "posAtCoords").mockImplementation(function (this: EditorView) {
        return this.state.doc.toString().indexOf("Second.");
      } as never);
      return () => {
        sized.mockRestore();
        at.mockRestore();
      };
    });

    it("the mouse in the margin beside a block shows its handle, without touching the text", async () => {
      const { view } = await openNote();

      fireEvent.mouseMove(document.body, { clientX: 70, clientY: 40 });

      expect(handleOf(view)).toHaveClass("cm-block-handle-shown");
      fireEvent.mouseDown(handleOf(view), { button: 0 });
      fireEvent.mouseUp(handleOf(view));
      const { from, to } = view.state.selection.main;
      expect(view.state.sliceDoc(from, to)).toBe("Second.");
    });

    it("dragging in the margin moves the block level with the mouse, without going into the text", async () => {
      const { editor, view } = await openNote();
      hover(lineOf(editor, "Third."));
      // What's in the text level with the mouse: "First.".
      const first = lineOf(editor, "First.");
      const original = document.elementFromPoint;
      document.elementFromPoint = () => first;

      // Every block is 0–100px high: the mouse at 10px is in "First."'s top half.
      const coords = vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({ top: 0, bottom: 100, left: 0, right: 0 });

      fireEvent.mouseDown(handleOf(view), { button: 0 });
      fireEvent.mouseMove(document.body, { clientX: 70, clientY: 10 });
      expect(view.dom.querySelector(".cm-drop-line")).toBeInTheDocument();
      fireEvent.mouseUp(document.body, { clientX: 70, clientY: 10 });
      document.elementFromPoint = original;
      coords.mockRestore();

      expect(text(view)).toBe("Third.\n\nFirst.\n\nSecond.");
    });

    it("far from the note, it isn't shown", async () => {
      const { view } = await openNote();

      fireEvent.mouseMove(document.body, { clientX: 10, clientY: 40 });
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(handleOf(view)).not.toHaveClass("cm-block-handle-shown");
    });
  });

  it("an empty line (a new, empty paragraph) has a handle too", async () => {
    notes["Paper.typ"] = "First.\n\n\n\nSecond.";
    const { editor, view } = await openNote();
    const empty = [...editor.querySelectorAll<HTMLElement>(".cm-content > .cm-line")].find((line) => line.textContent === "")!;

    hover(empty);

    expect(handleOf(view)).toHaveClass("cm-block-handle-shown");
  });

  it("the first block's handle is level with it, not with the empty properties above it", async () => {
    const { editor, view } = await openNote();
    // (Nothing has a size here: the "Add property" row is given 26px at the top, the lines 20px each below it.)
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const lines = [...view.contentDOM.querySelectorAll(":scope > .cm-line")];
      const top = this.matches(".cm-properties-widget") ? 0 : lines.includes(this) ? 30 + lines.indexOf(this) * 20 : 0;
      const height = this.matches(".cm-properties-widget") ? 26 : lines.includes(this) ? 20 : 0;
      return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });

    hover(lineOf(editor, "First."));

    expect(Number.parseFloat(handleOf(view).style.top)).toBeGreaterThanOrEqual(30 - 11);
    vi.mocked(Element.prototype.getBoundingClientRect).mockRestore();
  });

  it("dragging the handle moves the block, keeping the text tidy", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Third."));

    drag(handleOf(view), lineOf(editor, "First."), "before");

    expect(text(view)).toBe("Third.\n\nFirst.\n\nSecond.");
  });

  it("dropping in a block's bottom half puts it after", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "First."));

    drag(handleOf(view), lineOf(editor, "Second."), "after");

    expect(text(view)).toBe("Second.\n\nFirst.\n\nThird.");
  });

  it("a line shows where it'll go while dragging, and goes away after", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Third."));

    fireEvent.mouseDown(handleOf(view), { button: 0 });
    fireEvent.mouseMove(lineOf(editor, "First."), { clientY: -1 });
    expect(view.dom.querySelector(".cm-drop-line")).toBeInTheDocument();

    fireEvent.mouseUp(lineOf(editor, "First."), { clientY: -1 });
    expect(document.querySelector(".cm-drop-line")).not.toBeInTheDocument();
  });

  it("Escape stops a drag without moving anything", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Third."));

    fireEvent.mouseDown(handleOf(view), { button: 0 });
    fireEvent.mouseMove(lineOf(editor, "First."), { clientY: -1 });
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseUp(lineOf(editor, "First."), { clientY: -1 });

    expect(text(view)).toBe(NOTE);
  });

  it("one Undo takes a move back", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Third."));
    drag(handleOf(view), lineOf(editor, "First."), "before");

    await chooseInMenu("Edit › Undo");

    expect(text(view)).toBe(NOTE);
  });

  it("clicking the handle selects the block", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Second."));

    fireEvent.mouseDown(handleOf(view), { button: 0 });
    fireEvent.mouseUp(handleOf(view));

    const { from, to } = view.state.selection.main;
    expect(view.state.sliceDoc(from, to)).toBe("Second.");
  });

  it("list items move as list items", async () => {
    const { editor, view } = await openNote("Todo.md");
    hover(lineOf(editor, "three"));

    drag(handleOf(view), lineOf(editor, "one"), "before");

    expect(text(view)).toBe("- three\n- one\n- two");
  });
});

describe("Moving blocks with the keyboard", () => {
  function cursorAt(view: EditorView, at: number) {
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: at } });
    });
  }

  it("Ctrl+Shift+↑ moves the block the cursor is in up, and the cursor goes with it", async () => {
    const { view } = await openNote();
    cursorAt(view, NOTE.indexOf("hird"));

    await userEvent.keyboard("{Control>}{Shift>}{ArrowUp}{/Shift}{/Control}");

    expect(text(view)).toBe("First.\n\nThird.\n\nSecond.");
    expect(view.state.sliceDoc(view.state.selection.main.head, view.state.selection.main.head + 4)).toBe("hird");
  });

  it("Ctrl+Shift+↓ moves it down", async () => {
    const { view } = await openNote();
    cursorAt(view, 1);

    await userEvent.keyboard("{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}");

    expect(text(view)).toBe("Second.\n\nFirst.\n\nThird.");
  });

  it("at the top or bottom, nothing moves", async () => {
    const { view } = await openNote();
    cursorAt(view, 1);

    await userEvent.keyboard("{Control>}{Shift>}{ArrowUp}{/Shift}{/Control}");

    expect(text(view)).toBe(NOTE);
  });
});

describe("Blocks and columns", () => {
  const column = (n: number) => screen.getByRole("textbox", { name: `Column ${n}` });
  const columnView = (n: number) => EditorView.findFromDOM(column(n).closest<HTMLElement>(".cm-editor")!)!;

  it("blocks in a column have handles of their own", async () => {
    await openNote("Columns.typ");

    hover(lineOf(column(1), "They scale."));

    expect(handleOf(columnView(1))).toHaveClass("cm-block-handle-shown");
  });

  it("a block moves within a column", async () => {
    const { view } = await openNote("Columns.typ");
    hover(lineOf(column(1), "They scale."));

    drag(handleOf(columnView(1)), lineOf(column(1), "Transformers."), "before");

    expect(text(view)).toBe(COLUMNS.replace("Transformers.\n\nThey scale.", "They scale.\n\nTransformers."));
  });

  it("a block moves from one column to another", async () => {
    const { view } = await openNote("Columns.typ");
    hover(lineOf(column(1), "They scale."));

    drag(handleOf(columnView(1)), lineOf(column(2), "BERT came next."), "after");

    expect(text(view)).toBe("Intro.\n#columns(2)[\nTransformers.\n#colbreak()\nBERT came next.\n\nThey scale.\n]\nAfter.");
    expect(text(columnView(2))).toBe("BERT came next.\n\nThey scale.");
  });

  it("a block moves from the note into a column", async () => {
    const { editor, view } = await openNote("Columns.typ");
    hover(lineOf(editor, "After."));

    drag(handleOf(view), lineOf(column(2), "BERT came next."), "before");

    expect(text(view)).toBe("Intro.\n#columns(2)[\nTransformers.\n\nThey scale.\n#colbreak()\nAfter.\n\nBERT came next.\n]");
  });

  it("a block moves out of a column into the note", async () => {
    const { editor, view } = await openNote("Columns.typ");
    hover(lineOf(column(2), "BERT came next."));

    drag(handleOf(columnView(2)), lineOf(editor, "Intro."), "before");

    expect(text(view)).toBe("BERT came next.\n\nIntro.\n#columns(2)[\nTransformers.\n\nThey scale.\n#colbreak()\n\n]\nAfter.");
  });

  it("the columns move as one block, by the grip in their bar", async () => {
    const { editor, view } = await openNote("Columns.typ");

    drag(within(screen.getByRole("toolbar", { name: "Columns" })).getByRole("button", { name: "Drag to move" }), lineOf(editor, "Intro."), "before");

    // (Intro. and After. would run together as one paragraph: they're kept a blank line apart.)
    expect(text(view)).toBe("#columns(2)[\nTransformers.\n\nThey scale.\n#colbreak()\nBERT came next.\n]\n\nIntro.\n\nAfter.");
  });

  it("the note's own handle isn't shown over the columns (their bar has the grip)", async () => {
    const { view } = await openNote("Columns.typ");
    hover(lineOf(column(1), "Transformers."));

    expect(handleOf(view)).not.toHaveClass("cm-block-handle-shown");
  });

  it("Ctrl+Shift+↓ works in a column too", async () => {
    const { view } = await openNote("Columns.typ");
    const first = columnView(1);
    act(() => {
      first.focus();
      first.dispatch({ selection: { anchor: 1 } });
    });

    await userEvent.keyboard("{Control>}{Shift>}{ArrowDown}{/Shift}{/Control}");

    expect(text(view)).toBe(COLUMNS.replace("Transformers.\n\nThey scale.", "They scale.\n\nTransformers."));
  });
});

describe("Dropping a block beside another makes columns", () => {
  // Gives every element a width, so the mouse can be near a block's left or right edge.
  beforeEach(() => {
    const sized = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      { left: 0, right: 600, width: 600, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect,
    );
    return () => sized.mockRestore();
  });

  function dragBeside(handle: HTMLElement, onto: HTMLElement, side: "left" | "right") {
    const clientX = side === "left" ? 4 : 596;
    fireEvent.mouseDown(handle, { button: 0 });
    fireEvent.mouseMove(onto, { clientX, clientY: 0 });
    fireEvent.mouseUp(onto, { clientX, clientY: 0 });
  }

  it("dropped at a block's right edge, they become two columns side by side", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Third."));

    dragBeside(handleOf(view), lineOf(editor, "First."), "right");

    expect(text(view)).toBe("#columns(2)[\nFirst.\n#colbreak()\nThird.\n]\n\nSecond.");
  });

  it("at its left edge, the dropped block is the first column", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Third."));

    dragBeside(handleOf(view), lineOf(editor, "First."), "left");

    expect(text(view)).toBe("#columns(2)[\nThird.\n#colbreak()\nFirst.\n]\n\nSecond.");
  });

  it("a line along the edge shows where it'll go", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Third."));

    fireEvent.mouseDown(handleOf(view), { button: 0 });
    fireEvent.mouseMove(lineOf(editor, "First."), { clientX: 596, clientY: 0 });

    expect(view.dom.querySelector(".cm-drop-line")).toHaveClass("cm-drop-line-beside");
    fireEvent.keyDown(document, { key: "Escape" });
  });

  it("one Undo takes the columns back", async () => {
    const { editor, view } = await openNote();
    hover(lineOf(editor, "Third."));
    dragBeside(handleOf(view), lineOf(editor, "First."), "right");

    await chooseInMenu("Edit › Undo");

    expect(text(view)).toBe(NOTE);
  });

  it("dropped at a column's edge, it becomes a new column there", async () => {
    const { editor, view } = await openNote("Columns.typ");
    hover(lineOf(editor, "After."));

    dragBeside(handleOf(view), lineOf(screen.getByRole("textbox", { name: "Column 2" }), "BERT came next."), "right");

    expect(text(view)).toBe("Intro.\n#columns(3)[\nTransformers.\n\nThey scale.\n#colbreak()\nBERT came next.\n#colbreak()\nAfter.\n]");
  });

  it("at a column's left edge, the new column comes before it", async () => {
    const { editor, view } = await openNote("Columns.typ");
    hover(lineOf(editor, "After."));

    dragBeside(handleOf(view), lineOf(screen.getByRole("textbox", { name: "Column 1" }), "Transformers."), "left");

    expect(text(view)).toBe("Intro.\n#columns(3)[\nAfter.\n#colbreak()\nTransformers.\n\nThey scale.\n#colbreak()\nBERT came next.\n]");
  });
});

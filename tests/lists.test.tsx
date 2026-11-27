// Writing lists: Enter in a list item starts the next one, with the same marker (the next number
// in a Markdown numbered list, an unchecked box in a to-do list). Text after the cursor goes into
// the new item. Enter on an empty item ends the list, with a blank line after it (so what comes next
// is a paragraph of its own: in Markdown, a line right after an item is part of it), or, nested,
// brings the item out a level.
//
// Nested items show nested: each level a step further in, and an item's text (wrapped onto more
// lines too) lines up under where it starts, not under its marker. Tab nests an item under the one
// above it, its text in line with that item's text (three spaces under "1. "), and Shift+Tab brings
// it back out; what's nested under it goes with it. Numbered items written "1." in Typst are list
// items like "+" ones.

import { EditorView } from "@codemirror/view";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { CHECKLIST_RULE } from "../src/editor/checklists";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": "", "Todo.md": "" };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

/** Opens a note with some text and the cursor at the "|". */
async function write(name: string, withCursor: string) {
  notes[name] = withCursor.replace("|", "");
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  const editor = await screen.findByRole("textbox", { name });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: withCursor.indexOf("|") } });
  });
  return view;
}

/** The note's text, with "|" where the cursor is (without the checklist rule to-dos add). */
const shown = (view: EditorView) => {
  const text = view.state.doc.toString();
  const head = view.state.selection.main.head;
  const marked = `${text.slice(0, head)}|${text.slice(head)}`;
  return marked.startsWith(CHECKLIST_RULE) ? marked.slice(CHECKLIST_RULE.length) : marked;
};

describe("Enter in a Typst list", () => {
  it("starts the next item", async () => {
    const view = await write("Paper.typ", "- milk|");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("- milk\n- |");
  });

  it("keeps a numbered list numbered", async () => {
    const view = await write("Paper.typ", "+ first|");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("+ first\n+ |");
  });

  it("keeps a nested item nested", async () => {
    const view = await write("Paper.typ", "- fruit\n  - apples|");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("- fruit\n  - apples\n  - |");
  });

  it("a to-do starts a new, unchecked to-do", async () => {
    const view = await write("Paper.typ", "- [x] done|");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("- [x] done\n- [ ] |");
  });

  it("text after the cursor goes into the new item", async () => {
    const view = await write("Paper.typ", "- milk |and bread");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("- milk\n- |and bread");
  });

  it("on an empty item, ends the list", async () => {
    const view = await write("Paper.typ", "- milk\n- |");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("- milk\n\n|");
  });

  it("on an empty nested item, brings it out a level", async () => {
    const view = await write("Paper.typ", "- fruit\n  - |");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("- fruit\n- |");
  });

  it("an empty to-do ends the list too", async () => {
    const view = await write("Paper.typ", "- [ ] buy\n- [ ] |");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("- [ ] buy\n\n|");
  });
});

describe("Enter in a Markdown list", () => {
  it("starts the next item with the same bullet", async () => {
    const view = await write("Todo.md", "* milk|");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("* milk\n* |");
  });

  it("numbers the next item", async () => {
    const view = await write("Todo.md", "1. first\n2. second|");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("1. first\n2. second\n3. |");
  });

  it("a to-do starts a new, unchecked to-do", async () => {
    const view = await write("Todo.md", "- [X] done|");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("- [X] done\n- [ ] |");
  });

  it("on an empty item, ends the list", async () => {
    const view = await write("Todo.md", "1. first\n2. |");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("1. first\n\n|");
  });
});

describe("Enter in a Typst list numbered with 1.", () => {
  it("numbers the next item", async () => {
    const view = await write("Paper.typ", "1. first|");

    await userEvent.keyboard("{Enter}");

    expect(shown(view)).toBe("1. first\n2. |");
  });
});

/** The note's lines as shown: their text, and how far in their text starts and wraps to. */
const shownLines = (view: EditorView) =>
  [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-line")].map((line) => ({
    text: line.textContent,
    wrapsAt: line.style.paddingLeft,
    startsAt: line.style.textIndent,
  }));

describe("How lists look", () => {
  it("each level is a step further in, and wrapped text lines up under the item's text", async () => {
    const view = await write("Paper.typ", "|- one\n  - two\n    - three\n- four");

    expect(shownLines(view)).toEqual([
      { text: "- one", wrapsAt: "1.6em", startsAt: "-1.6em" },
      { text: "- two", wrapsAt: "3.2em", startsAt: "-1.6em" },
      { text: "- three", wrapsAt: "4.8em", startsAt: "-1.6em" },
      { text: "- four", wrapsAt: "1.6em", startsAt: "-1.6em" },
    ]);
  });

  it("how deep an item is depends on what it's under, not how many spaces it has", async () => {
    const view = await write("Todo.md", "|1. Ray Data:\n   - Moritz et al.\n2. Morsels:\n      - Leis et al.");

    expect(shownLines(view).map((line) => line.wrapsAt)).toEqual(["1.6em", "3.2em", "1.6em", "3.2em"]);
  });

  it("a paragraph after a list isn't indented, and the next list starts again at the left", async () => {
    const view = await write("Todo.md", "|- one\n  - two\n\nSome text.\n\n  - again");

    const lines = shownLines(view).filter((line) => line.text);
    expect(lines.map((line) => line.wrapsAt)).toEqual(["1.6em", "3.2em", "", "1.6em"]);
  });

  it("to-dos are indented like other items", async () => {
    const view = await write("Paper.typ", "|- [ ] buy\n  - [x] milk");

    expect(shownLines(view).filter((line) => line.wrapsAt).map((line) => line.wrapsAt)).toEqual(["1.6em", "3.2em"]);
  });
});

describe("Tab and Shift+Tab in a list", () => {
  it("Tab nests a numbered Markdown item under the one above, in line with its text", async () => {
    const view = await write("Todo.md", "1. first\n2. |second");

    await userEvent.keyboard("{Tab}");

    expect(shown(view)).toBe("1. first\n   2. |second");
  });

  it("Tab nests a Typst item numbered with 1. instead of padding it", async () => {
    const view = await write("Paper.typ", "1. first\n2. |second");

    await userEvent.keyboard("{Tab}");

    expect(shown(view)).toBe("1. first\n   2. |second");
  });

  it("what's nested under an item goes with it", async () => {
    const view = await write("Paper.typ", "- a\n- |b\n  - c");

    await userEvent.keyboard("{Tab}");

    expect(shown(view)).toBe("- a\n  - |b\n    - c");
  });

  it("an item can't be nested deeper than one level below the item above", async () => {
    const view = await write("Paper.typ", "- a\n  - |b");

    await userEvent.keyboard("{Tab}");

    expect(shown(view)).toBe("- a\n  - |b");
  });

  it("the first item can't be nested, and Tab stays in the note", async () => {
    const view = await write("Paper.typ", "- |a");

    await userEvent.keyboard("{Tab}");

    expect(shown(view)).toBe("- |a");
    expect(view.hasFocus).toBe(true);
  });

  it("Shift+Tab brings an item out to its parent's level, with what's under it", async () => {
    const view = await write("Todo.md", "1. Ray\n   - |Moritz\n     - Plasma");

    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");

    expect(shown(view)).toBe("1. Ray\n- |Moritz\n  - Plasma");
  });
});

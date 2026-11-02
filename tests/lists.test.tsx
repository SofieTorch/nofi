// Writing lists: Enter in a list item starts the next one, with the same marker (the next number
// in a Markdown numbered list, an unchecked box in a to-do list). Text after the cursor goes into
// the new item. Enter on an empty item ends the list, with a blank line after it (so what comes next
// is a paragraph of its own: in Markdown, a line right after an item is part of it), or, nested,
// brings the item out a level.

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

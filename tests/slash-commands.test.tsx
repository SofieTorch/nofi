// The "/" menu: typing "/" at the start of a line or after a space lists blocks to insert, like
// Notion's and Obsidian's. Which commands exist (and that they keep notes valid) is specified in
// src-tauri/tests/slash_commands.rs; these tests are about using the menu.

import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const command = (c: Partial<api.SlashCommand> & Pick<api.SlashCommand, "id" | "label" | "section" | "insert">) =>
  ({ keywords: [], description: `${c.label}.`, cursor: c.insert.length, selection: 0, block: true, ...c }) as api.SlashCommand;

const typst: api.SlashCommand[] = [
  command({ id: "heading-1", label: "Heading 1", section: "Text", insert: "= Heading", cursor: 2, selection: 7 }),
  command({ id: "bold", label: "Bold", section: "Text", insert: "*bold text*", cursor: 1, selection: 9, block: false }),
  command({ id: "display-maths", label: "Display equation", section: "Maths", keywords: ["math", "equation"], insert: "$ x $", cursor: 2, selection: 1 }),
  command({ id: "table", label: "Table", section: "Insert", keywords: ["rows"], insert: "#table(columns: 2, [A], [B])", cursor: 20, selection: 1 }),
];
const markdown: api.SlashCommand[] = [
  command({ id: "to-do", label: "To-do list", section: "Lists", insert: "- [ ] Task", cursor: 6, selection: 4 }),
];

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": "Intro.\n", "Todo.md": "" };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  vi.mocked(api.slashCommands).mockImplementation(async (format) => (format === "typst" ? typst : markdown));
});

async function openNote(name = "Paper.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  const editor = await screen.findByRole("textbox", { name });
  const view = EditorView.findFromDOM(editor)!;
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  return view;
}

const menu = () => screen.findByRole("listbox");
const offered = async () =>
  within(await menu())
    .getAllByRole("option")
    .map((option) => option.querySelector(".cm-completionLabel")?.textContent);
/** Right after the menu opens, Enter is ignored for a moment so fast typing never picks by accident. */
const menuReady = async () => {
  await menu();
  await new Promise((resolve) => setTimeout(resolve, 100));
};
const selected = (view: EditorView) => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);

describe("The / menu", () => {
  it("opens when / is typed at the start of a line, with what can be inserted", async () => {
    await openNote();

    await userEvent.keyboard("/");

    expect(await offered()).toEqual(["Heading 1", "Bold", "Display equation", "Table"]);
    expect(api.slashCommands).toHaveBeenCalledWith("typst");
  });

  it("groups the commands into sections", async () => {
    await openNote();

    await userEvent.keyboard("/");

    const list = await menu();
    for (const section of ["Text", "Maths", "Insert"]) {
      expect(within(list).getByText(section)).toBeInTheDocument();
    }
  });

  it("typing after the / narrows them down, also by other words they're known by", async () => {
    await openNote();

    await userEvent.keyboard("/tab");
    expect(await offered()).toEqual(["Table"]);

    await userEvent.keyboard("{Backspace}{Backspace}{Backspace}math");
    await vi.waitFor(async () => expect(await offered()).toEqual(["Display equation"]));
  });

  it("Enter inserts the block in place of the /…, with its placeholder selected to type over", async () => {
    const view = await openNote();

    await userEvent.keyboard("/hea");
    await menuReady();
    await userEvent.keyboard("{Enter}");

    expect(view.state.doc.toString()).toBe("Intro.\n= Heading");
    expect(selected(view)).toBe("Heading");
  });

  it("a block chosen after some text starts on its own line", async () => {
    const view = await openNote();
    await userEvent.keyboard("Some text ");

    await userEvent.keyboard("/tab");
    await menuReady();
    await userEvent.keyboard("{Enter}");

    expect(view.state.doc.toString()).toBe("Intro.\nSome text \n#table(columns: 2, [A], [B])");
    expect(selected(view)).toBe("A");
  });

  it("text styles are inserted right where the / was", async () => {
    const view = await openNote();
    await userEvent.keyboard("Some ");

    await userEvent.keyboard("/bold");
    await menuReady();
    await userEvent.keyboard("{Enter}");

    expect(view.state.doc.toString()).toBe("Intro.\nSome *bold text*");
    expect(selected(view)).toBe("bold text");
  });

  it("Escape closes the menu and keeps the / as typed", async () => {
    const view = await openNote();
    await userEvent.keyboard("/");
    await menu();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(view.state.doc.toString()).toBe("Intro.\n/");
  });

  it("a / inside a word, a path or a link doesn't open it", async () => {
    await openNote();

    await userEvent.keyboard("and/or https://typst.app");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("a / inside maths is a division, not the menu", async () => {
    await openNote();

    await userEvent.keyboard("$a /");
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("Markdown notes get Markdown's blocks", async () => {
    const view = await openNote("Todo.md");

    await userEvent.keyboard("/");
    expect(await offered()).toEqual(["To-do list"]);
    await menuReady();
    await userEvent.keyboard("{Enter}");

    expect(view.state.doc.toString()).toBe("- [ ] Task");
    expect(selected(view)).toBe("Task");
    expect(api.slashCommands).toHaveBeenCalledWith("markdown");
  });
});

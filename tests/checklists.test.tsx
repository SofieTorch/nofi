// Checklists: "- [ ] task" is a task to do, "- [x] task" one that's done. While writing, each is a
// checkbox to tick, and done tasks are dimmed. Typst has no checklists of its own, so a Typst note
// with one gets a small rule at its top that draws them on the pages (src/editor/checklistRule.typ,
// specified in src-tauri/tests/checklists.rs); the editor doesn't show it.

import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import RULE from "../src/editor/checklistRule.typ?raw";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = {
    "Paper.typ": `${RULE}Groceries:\n- [ ] Buy milk\n- [x] Bake bread`,
    "Todo.md": "Groceries:\n- [ ] Buy milk\n- [x] Bake bread",
  };
  vi.mocked(api.listFiles).mockImplementation(async () => Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

async function openNote(name = "Paper.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  const editor = await screen.findByRole("textbox", { name });
  return { editor, view: EditorView.findFromDOM(editor)! };
}

const text = (view: EditorView) => view.state.doc.toString();
const checkbox = (editor: HTMLElement, task: string) => within(editor).getByRole("checkbox", { name: task });

describe.each(["Paper.typ", "Todo.md"])("A checklist in %s", (name) => {
  it("shows each task as a checkbox, ticked when it's done", async () => {
    const { editor } = await openNote(name);

    expect(checkbox(editor, "Buy milk")).not.toBeChecked();
    expect(checkbox(editor, "Bake bread")).toBeChecked();
    expect(editor).not.toHaveTextContent("[ ]");
    expect(editor).not.toHaveTextContent("[x]");
  });

  it("clicking a checkbox ticks the task, and again unticks it", async () => {
    const { editor, view } = await openNote(name);

    await userEvent.click(checkbox(editor, "Buy milk"));
    expect(text(view)).toContain("- [x] Buy milk");

    await userEvent.click(checkbox(editor, "Buy milk"));
    expect(text(view)).toContain("- [ ] Buy milk");
  });

  it("done tasks are dimmed", async () => {
    const { editor } = await openNote(name);

    expect(within(editor).getByText("Bake bread").closest(".cm-line")).toHaveClass("cm-task-done");
    expect(within(editor).getByText("Buy milk").closest(".cm-line")).not.toHaveClass("cm-task-done");
  });

  it("nested tasks are checkboxes too", async () => {
    notes[name] = notes[name] + "\n  - [ ] Knead it";
    const { editor } = await openNote(name);

    expect(checkbox(editor, "Knead it")).not.toBeChecked();
  });

  it("with the cursor on a task's box, its code shows, to edit", async () => {
    const { editor, view } = await openNote(name);

    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: text(view).indexOf("[ ] Buy") + 1 } });
    });

    expect(editor).toHaveTextContent("- [ ] Buy milk");
  });
});

describe("The rule that draws checklists in Typst", () => {
  it("isn't shown while writing", async () => {
    const { editor } = await openNote();

    expect(editor).not.toHaveTextContent("#show list");
    expect(editor).not.toHaveTextContent("Checklists:");
    expect(editor).toHaveTextContent("Groceries:");
  });

  it("is added at the top when a Typst note gets its first task", async () => {
    notes["Paper.typ"] = "Groceries:\n";
    const { view } = await openNote();

    act(() => view.dispatch({ changes: { from: text(view).length, insert: "- [ ] Buy milk" } }));

    expect(text(view)).toBe(`${RULE}Groceries:\n- [ ] Buy milk`);
  });

  it("is added only once", async () => {
    const { view } = await openNote();

    act(() => view.dispatch({ changes: { from: text(view).length, insert: "\n- [ ] Call home" } }));

    expect(text(view).split("// Checklists:")).toHaveLength(2);
  });

  it("one Undo takes back the task and the rule together", async () => {
    notes["Paper.typ"] = "Groceries:\n";
    const { view } = await openNote();
    act(() => view.dispatch({ changes: { from: text(view).length, insert: "- [ ] Buy milk" }, userEvent: "input" }));

    act(() => void undo(view));

    expect(text(view)).toBe("Groceries:\n");
  });

  it("isn't added to Markdown notes, which have checklists already", async () => {
    notes["Todo.md"] = "Groceries:\n";
    const { view } = await openNote("Todo.md");

    act(() => view.dispatch({ changes: { from: text(view).length, insert: "- [ ] Buy milk" } }));

    expect(text(view)).toBe("Groceries:\n- [ ] Buy milk");
  });

  it("isn't added for a task written inside a code block", async () => {
    notes["Paper.typ"] = "```\n\n```";
    const { view } = await openNote();

    act(() => view.dispatch({ changes: { from: 4, insert: "- [ ] not a task" } }));

    expect(text(view)).toBe("```\n- [ ] not a task\n```");
  });
});

describe("Making a checklist", () => {
  it("the toolbar turns lines into tasks", async () => {
    notes["Paper.typ"] = "Buy milk";
    const { view } = await openNote();
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 0, head: 3 } });
    });

    await userEvent.click(await within(await screen.findByRole("toolbar", { name: "Format" })).findByRole("button", { name: "Turn into" }));
    await userEvent.click(within(await screen.findByRole("menu", { name: "Turn into" })).getByRole("menuitemradio", { name: "To-do list" }));

    expect(text(view)).toBe(`${RULE}- [ ] Buy milk`);
  });

  it("the toolbar says a task is a to-do list item", async () => {
    notes["Todo.md"] = "- [ ] Buy milk";
    const { view } = await openNote("Todo.md");
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 8, head: 12 } });
    });

    expect(await within(await screen.findByRole("toolbar", { name: "Format" })).findByRole("button", { name: "Turn into" })).toHaveTextContent(
      "To-do list",
    );
  });
});

// The code view: a Typst note shown as the file it is, like in a code editor: every bit of markup
// shown, with line numbers and Typst's syntax highlighted (from Typst's own parser), and still
// editable. Right-click the note's tab › Show Code (or View › Show Code, ⌥⌘C, or the command palette)
// switches it; Show Formatted switches back. Each note has its own switch; edits and undo carry over.

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const PAPER = '#let title = "Attention"\n// A comment\n= Results\nSome *bold* text, #emph[and] $x^2$ <intro>.';
let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": PAPER, "Other.typ": "= Other", "Todo.md": "# Todo" };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

async function openNote(name: string) {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name });
}
const editorOf = (name: string) =>
  EditorView.findFromDOM(screen.getByRole("textbox", { name }).closest<HTMLElement>(".cm-editor")!)!;

async function inTabMenu(tab: string, item: string) {
  fireEvent.contextMenu(screen.getByRole("tab", { name: tab }), { clientX: 120, clientY: 40 });
  await userEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: item }));
}
const codeView = (name = "Paper.typ") => screen.getByRole("textbox", { name }).closest(".cm-editor")!.classList.contains("cm-code-view");

describe("The code view", () => {
  it("a Typst note's tab offers Show Code: every bit of markup shows, with line numbers", async () => {
    await openNote("Paper.typ");

    await inTabMenu("Paper", "Show Code");

    await vi.waitFor(() => expect(codeView()).toBe(true));
    const editor = screen.getByRole("textbox", { name: "Paper.typ" });
    expect(editor.textContent).toContain("= Results");
    expect(editor.textContent).toContain("*bold*");
    expect(editor.textContent).toContain('#let title = "Attention"');
    const numbers = editor.closest(".cm-editor")!.querySelector(".cm-lineNumbers")!;
    expect(numbers.textContent).toContain("4");
  });

  it("Typst's syntax is highlighted", async () => {
    await openNote("Paper.typ");
    await inTabMenu("Paper", "Show Code");
    await vi.waitFor(() => expect(codeView()).toBe(true));
    const editor = screen.getByRole("textbox", { name: "Paper.typ" });
    const marked = (kind: string) => [...editor.querySelectorAll(`.cm-typst-${kind}`)].map((e) => e.textContent);

    expect(marked("keyword")).toContain("let");
    expect(marked("string")).toContain('"Attention"');
    expect(marked("comment")).toContain("// A comment");
    expect(marked("heading").join("")).toContain("Results");
    expect(marked("strong")).toContain("*bold*");
    expect(marked("function")).toContain("emph");
    expect(marked("math")).toContain("$x^2$");
    expect(marked("label")).toContain("<intro>");
  });

  it("it can be edited, and Show Formatted switches back with the edit, which ⌘Z undoes", async () => {
    await openNote("Paper.typ");
    await inTabMenu("Paper", "Show Code");
    await vi.waitFor(() => expect(codeView()).toBe(true));
    act(() => editorOf("Paper.typ").dispatch({ changes: { from: 0, insert: "Hello " } }));

    await inTabMenu("Paper", "Show Formatted");

    await vi.waitFor(() => expect(codeView()).toBe(false));
    const view = editorOf("Paper.typ");
    expect(view.state.doc.toString()).toBe(`Hello ${PAPER}`);
    act(() => view.focus());
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(view.state.doc.toString()).toBe(PAPER);
  });

  it("each note has its own switch", async () => {
    await openNote("Paper.typ");
    await inTabMenu("Paper", "Show Code");
    await vi.waitFor(() => expect(codeView()).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Other.typ" }));
    await screen.findByRole("textbox", { name: "Other.typ" });

    expect(codeView("Other.typ")).toBe(false);
  });

  it("View › Show Code (⌥⌘C) and the command palette switch it too", async () => {
    await openNote("Paper.typ");

    await chooseInMenu("View › Show Code");
    await vi.waitFor(() => expect(codeView()).toBe(true));

    await chooseInMenu("View › Command Palette…");
    await userEvent.keyboard("show formatted{Enter}");
    await vi.waitFor(() => expect(codeView()).toBe(false));
  });

  it("a Markdown note's tab doesn't offer it", async () => {
    await openNote("Todo.md");

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Todo" }), { clientX: 120, clientY: 40 });

    expect(within(await screen.findByRole("menu")).queryByRole("menuitem", { name: "Show Code" })).not.toBeInTheDocument();
  });
});

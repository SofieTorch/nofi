// Finding text, like in a browser or VS Code. ⌘F (Ctrl+F elsewhere) in a note or a PDF opens a
// find bar at its top right: the matches are highlighted, the bar says which one you're on out of
// how many, and Enter (or the arrows) goes to the next one, Shift+Enter to the one before. Esc
// closes it. In a note it can replace too (⌥⌘F opens it ready to): one match or all of them, undone
// with ⌘Z. ⌘⇧F searches the whole workspace, its notes and PDFs, in the sidebar: what's found is
// listed by file (a PDF's by page), and clicking a match opens it there, with that match found.
// (Case doesn't matter, and in a PDF neither do line breaks.) The search keeps what was searched
// last while the app is open.

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import * as pdf from "../src/workspace/pdf";
import { file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");
vi.mock("../src/workspace/pdf");

let notes: Record<string, string>;
const PAGES: Record<number, string> = {
  1: "Attention is all you need. We propose a new attention model.",
  2: "Results without any attention at all.",
  3: "References.",
};

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = {
    "Ideas.typ": "Attention matters.\n\nWe study attention in models. Attention is key.",
    "Other.typ": "Nothing to see here.",
  };
  vi.mocked(api.listFiles).mockResolvedValue([file("Ideas.typ"), file("Other.typ"), folder("Papers", [file("Papers/attention.pdf")])]);
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path] ?? "");
  vi.mocked(api.readWorkspaceFile).mockResolvedValue(new ArrayBuffer(4));
  vi.mocked(pdf.openPdf).mockResolvedValue({
    pages: 3,
    close: () => {},
    page: async (number) => ({
      width: 600,
      height: 800,
      draw: async () => {},
      text: async (container) => {
        const span = document.createElement("span");
        span.textContent = PAGES[number];
        container.replaceChildren(span);
      },
      plainText: async () => PAGES[number],
    }),
  });
  // (Every match takes a box on the page.)
  Range.prototype.getClientRects = () => [{ left: 10, top: 40, width: 60, height: 14, right: 70, bottom: 54 }] as unknown as DOMRectList;
});

/** Where the reader scrolled each page to (as the test browser can't scroll). */
function watchScrolling() {
  const scrolled: number[] = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    const page = (this as HTMLElement).dataset?.page;
    if (page) scrolled.push(Number(page));
  });
  return scrolled;
}

async function openNote(name = "Ideas.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  const editor = await screen.findByRole("textbox", { name });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: 0 } });
  });
  return view;
}

const selected = (view: EditorView) => {
  const { from, to } = view.state.selection.main;
  return { at: from, text: view.state.sliceDoc(from, to) };
};
const findBar = () => screen.findByRole("search", { name: "Find" });

describe("Finding in a note", () => {
  it("⌘F opens the find bar; typing finds the matches, and says how many", async () => {
    const view = await openNote();

    await userEvent.keyboard("{Control>}f{/Control}");
    const bar = await findBar();
    await userEvent.keyboard("attention");

    expect(within(bar).getByRole("searchbox", { name: "Find" })).toHaveFocus();
    expect(within(bar).getByText("1 of 3")).toBeInTheDocument();
    expect(selected(view)).toEqual({ at: 0, text: "Attention" });
    expect(view.contentDOM.querySelectorAll(".cm-found")).toHaveLength(3);
    expect(view.contentDOM.querySelectorAll(".cm-found-current")).toHaveLength(1);
  });

  it("starts with the selected text", async () => {
    const view = await openNote();
    act(() => view.dispatch({ selection: { anchor: 0, head: 9 } }));

    await userEvent.keyboard("{Control>}f{/Control}");

    expect(within(await findBar()).getByRole("searchbox", { name: "Find" })).toHaveValue("Attention");
    expect(within(await findBar()).getByText("1 of 3")).toBeInTheDocument();
  });

  it("Enter goes to the next match, Shift+Enter back, and they go round", async () => {
    const view = await openNote();
    await userEvent.keyboard("{Control>}f{/Control}");
    const bar = await findBar();
    await userEvent.keyboard("attention");

    await userEvent.keyboard("{Enter}");
    expect(within(bar).getByText("2 of 3")).toBeInTheDocument();
    expect(selected(view).at).toBe(notes["Ideas.typ"].indexOf("attention"));

    await userEvent.keyboard("{Enter}{Enter}");
    expect(within(bar).getByText("1 of 3")).toBeInTheDocument();

    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    expect(within(bar).getByText("3 of 3")).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "Next match" }));
    expect(within(bar).getByText("1 of 3")).toBeInTheDocument();
    await userEvent.click(within(bar).getByRole("button", { name: "Previous match" }));
    expect(within(bar).getByText("3 of 3")).toBeInTheDocument();
  });

  it("says when there's nothing", async () => {
    await openNote();
    await userEvent.keyboard("{Control>}f{/Control}");
    await userEvent.keyboard("transformers");

    expect(within(await findBar()).getByText("No results")).toBeInTheDocument();
  });

  it("Esc closes it, the match it was on still selected", async () => {
    const view = await openNote();
    await userEvent.keyboard("{Control>}f{/Control}");
    await findBar();
    await userEvent.keyboard("attention{Enter}");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("search", { name: "Find" })).not.toBeInTheDocument();
    expect(view.contentDOM.querySelectorAll(".cm-found")).toHaveLength(0);
    expect(selected(view)).toEqual({ at: notes["Ideas.typ"].indexOf("attention"), text: "attention" });
    expect(view.hasFocus).toBe(true);
  });

  it("⌥⌘F opens it ready to replace; Replace changes the match and goes to the next", async () => {
    const view = await openNote();

    await userEvent.keyboard("{Control>}{Alt>}f{/Alt}{/Control}");
    const bar = await findBar();
    await userEvent.keyboard("attention");
    await userEvent.type(within(bar).getByRole("textbox", { name: "Replace" }), "focus");
    await userEvent.click(within(bar).getByRole("button", { name: "Replace" }));

    expect(view.state.doc.toString()).toBe("focus matters.\n\nWe study attention in models. Attention is key.");
    expect(within(bar).getByText("1 of 2")).toBeInTheDocument();
    expect(selected(view).text).toBe("attention");
  });

  it("Replace all changes every match, undone in one go", async () => {
    const view = await openNote();
    await userEvent.keyboard("{Control>}f{/Control}");
    const bar = await findBar();
    await userEvent.keyboard("attention");
    await userEvent.click(within(bar).getByRole("button", { name: "Show replace" }));
    await userEvent.type(within(bar).getByRole("textbox", { name: "Replace" }), "focus");

    await userEvent.click(within(bar).getByRole("button", { name: "Replace all" }));

    expect(view.state.doc.toString()).toBe("focus matters.\n\nWe study focus in models. focus is key.");
    expect(within(bar).getByText("No results")).toBeInTheDocument();
    act(() => view.focus());
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(view.state.doc.toString()).toBe(notes["Ideas.typ"]);
  });
});

async function openPdf() {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Papers" }));
  await userEvent.click(screen.getByRole("button", { name: "attention.pdf" }));
  const toolbar = await screen.findByRole("toolbar", { name: "PDF" });
  await within(toolbar).findByText("/ 3");
  const scroller = screen.getByRole("img", { name: "Page 1" }).parentElement!.parentElement!;
  return { toolbar, scroller };
}

describe("Finding in a PDF", () => {
  it("⌘F finds the matches on every page, and goes to the first", async () => {
    const scrolled = watchScrolling();
    const { scroller } = await openPdf();

    fireEvent.keyDown(scroller, { key: "f", ctrlKey: true });
    const bar = await findBar();
    await userEvent.type(within(bar).getByRole("searchbox", { name: "Find" }), "attention");

    expect(await within(bar).findByText("1 of 3")).toBeInTheDocument();
    expect(scrolled[scrolled.length - 1]).toBe(1);
  });

  it("Enter goes to the next match, on another page if that's where it is", async () => {
    const scrolled = watchScrolling();
    const { scroller } = await openPdf();
    fireEvent.keyDown(scroller, { key: "f", ctrlKey: true });
    const bar = await findBar();
    await userEvent.type(within(bar).getByRole("searchbox", { name: "Find" }), "attention");
    await within(bar).findByText("1 of 3");

    await userEvent.keyboard("{Enter}{Enter}");

    expect(within(bar).getByText("3 of 3")).toBeInTheDocument();
    expect(scrolled[scrolled.length - 1]).toBe(2);
  });

  it("the matches are highlighted on the pages, the one you're on apart", async () => {
    const { scroller } = await openPdf();
    fireEvent.keyDown(scroller, { key: "f", ctrlKey: true });
    const bar = await findBar();
    await userEvent.type(within(bar).getByRole("searchbox", { name: "Find" }), "attention");
    await within(bar).findByText("1 of 3");

    const page1 = screen.getByRole("img", { name: "Page 1" });
    await vi.waitFor(() => expect(page1.querySelectorAll("[data-found]")).toHaveLength(2));
    expect(page1.querySelectorAll("[data-found='current']")).toHaveLength(1);
    await vi.waitFor(() => expect(screen.getByRole("img", { name: "Page 2" }).querySelectorAll("[data-found]")).toHaveLength(1));
  });

  it("Esc closes it, and the highlights go", async () => {
    const { scroller } = await openPdf();
    fireEvent.keyDown(scroller, { key: "f", ctrlKey: true });
    const bar = await findBar();
    await userEvent.type(within(bar).getByRole("searchbox", { name: "Find" }), "attention");
    await within(bar).findByText("1 of 3");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("search", { name: "Find" })).not.toBeInTheDocument();
    expect(document.querySelectorAll("[data-found]")).toHaveLength(0);
  });

  it("a PDF has nothing to replace", async () => {
    const { scroller } = await openPdf();
    fireEvent.keyDown(scroller, { key: "f", ctrlKey: true });

    expect(within(await findBar()).queryByRole("button", { name: "Show replace" })).not.toBeInTheDocument();
  });
});

describe("Searching the workspace", () => {
  async function search(query: string) {
    render(<App />);
    await screen.findByRole("button", { name: "Ideas.typ" });
    fireEvent.keyDown(window, { key: "F", ctrlKey: true, shiftKey: true });
    const field = await screen.findByRole("searchbox", { name: "Search the workspace" });
    expect(field).toHaveFocus();
    // (It keeps what was searched last.)
    await userEvent.clear(field);
    await userEvent.type(field, query);
    return screen.findByRole("region", { name: "Search results" });
  }

  it("⌘⇧F lists the notes and PDFs with matches, and each match", async () => {
    const results = await search("attention");

    const ideas = await within(results).findByRole("group", { name: "Ideas.typ" });
    expect(within(ideas).getAllByRole("button", { name: /attention/i })).toHaveLength(3);
    const paper = await within(results).findByRole("group", { name: "attention.pdf" });
    expect(within(paper).getAllByRole("button", { name: /^p\. 1/ })).toHaveLength(2);
    expect(within(paper).getAllByRole("button", { name: /^p\. 2/ })).toHaveLength(1);
    expect(within(results).queryByRole("group", { name: "Other.typ" })).not.toBeInTheDocument();
    expect(await within(results).findByText("6 results in 2 files")).toBeInTheDocument();
  });

  it("clicking a note's match opens it with that match found", async () => {
    const results = await search("attention");
    const ideas = await within(results).findByRole("group", { name: "Ideas.typ" });

    await userEvent.click(within(ideas).getAllByRole("button")[1]);

    const bar = await findBar();
    expect(within(bar).getByRole("searchbox", { name: "Find" })).toHaveValue("attention");
    expect(await within(bar).findByText("2 of 3")).toBeInTheDocument();
    const editor = screen.getByRole("textbox", { name: "Ideas.typ" });
    const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
    expect(selected(view)).toEqual({ at: notes["Ideas.typ"].indexOf("attention"), text: "attention" });
  });

  it("clicking a PDF's match opens it at that page, with that match found", async () => {
    const scrolled = watchScrolling();
    const results = await search("attention");
    const paper = await within(results).findByRole("group", { name: "attention.pdf" });

    await userEvent.click(within(paper).getByRole("button", { name: /^p\. 2/ }));

    const bar = await findBar();
    expect(within(bar).getByRole("searchbox", { name: "Find" })).toHaveValue("attention");
    expect(await within(bar).findByText("3 of 3")).toBeInTheDocument();
    await vi.waitFor(() => expect(scrolled[scrolled.length - 1]).toBe(2));
  });

  it("says when nothing is found", async () => {
    const results = await search("transformers");

    expect(await within(results).findByText("No results")).toBeInTheDocument();
  });

  it("closing the search shows the files again", async () => {
    await search("attention");

    await userEvent.click(screen.getByRole("button", { name: "Close search" }));

    expect(screen.queryByRole("searchbox", { name: "Search the workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ideas.typ" })).toBeInTheDocument();
  });
});

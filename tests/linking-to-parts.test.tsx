// Links to a part of a file: a heading or a paragraph of a note, or a page of a PDF. The part is
// written after a # in the link's address, like a website's section, and the link still shows
// only the file's name: `#link("Paper.typ#methods")[Paper]`, `[Paper](Paper.md#methods)`,
// `#link("attention.pdf#page=5")[attention]`.
//
// In a Typst note, the part is marked with a Typst label: `= Methods <methods>` for a heading,
// `… <p-3f9a>` at the end of a paragraph. The app adds the label when a link is made (a name not
// used yet in the note: `methods-2` for a second "Methods"), and the editor hides labels until the
// cursor is on their line. Markdown has no labels: a heading is found by its usual anchor (its text
// in lower case, with dashes; `-1`, `-2` for repeated names), a paragraph by an Obsidian-style
// `^p-3f9a` at its end.
//
// Links are made with [[ (type # after the file for its headings, paragraphs or pages; # right
// after choosing the file from the list works too), or with
// "Copy link" (a block handle's right-click menu, a PDF page's right-click menu) and pasting.
// Following one opens the file there, and the heading or paragraph is highlighted for a moment.

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { anchorFor, findPart, partsOf } from "../src/editor/linkParts";
import * as pdf from "../src/workspace/pdf";
import { file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");
vi.mock("../src/workspace/pdf");

const PAPER = "= Intro\n\nSome context.\n\n= Methods\n\nWe did the work.\n\nThen we checked it.";
const PAPER_MD = "# Intro\n\nSome context.\n\n# Methods\n\nWe did it.\n\n# Methods\n\nAgain.";

let notes: Record<string, string>;
let copied: string[];

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": PAPER, "Paper.md": PAPER_MD, "Ideas.typ": "", "Ideas.md": "", "Papers/Attention.typ": "" };
  vi.mocked(api.listFiles).mockImplementation(async () => [
    folder("Papers", [file("Papers/Attention.typ"), file("Papers/attention.pdf")]),
    ...Object.keys(notes)
      .filter((path) => !path.includes("/"))
      .map(file),
  ]);
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  vi.mocked(api.saveNote).mockImplementation(async (path, text) => void (notes[path] = text));
  vi.mocked(api.readWorkspaceFile).mockResolvedValue(new ArrayBuffer(4));
  vi.mocked(pdf.openPdf).mockResolvedValue({
    pages: 3,
    close: () => {},
    page: async () => ({ width: 600, height: 800, draw: async () => {}, text: async () => {} }),
  });
  copied = [];
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void copied.push(text) },
  });
  Element.prototype.scrollIntoView = vi.fn();
});

async function openNote(path = "Ideas.typ") {
  render(<App />);
  if (path.includes("/")) await userEvent.click(await screen.findByRole("button", { name: path.split("/")[0] }));
  const name = path.split("/").pop()!;
  await userEvent.click(await screen.findByRole("button", { name }));
  const editor = await screen.findByRole("textbox", { name });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  return { editor, view };
}

const text = (view: EditorView) => view.state.doc.toString();
const viewOf = (editor: HTMLElement) => EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
const offered = async () =>
  within(await screen.findByRole("listbox"))
    .getAllByRole("option")
    .map((option) => option.querySelector(".cm-completionLabel")?.textContent);
const listReady = async () => {
  await screen.findByRole("listbox");
  await new Promise((resolve) => setTimeout(resolve, 100));
};
const choose = async (label: string) => {
  const option = within(await screen.findByRole("listbox"))
    .getAllByRole("option")
    .find((o) => o.querySelector(".cm-completionLabel")?.textContent === label)!;
  await userEvent.click(option);
};

/** Clicks the link in a note (not while writing in it, so it's followed). */
async function clickLink(editor: HTMLElement, shown: string, init: MouseEventInit = {}) {
  const view = viewOf(editor);
  act(() => view.contentDOM.blur());
  const link = within(editor).getByText(shown).closest<HTMLElement>(".cm-link")!;
  fireEvent.mouseDown(link, { button: 0, ...init });
}

describe("Finding a note's parts", () => {
  it("lists its headings and paragraphs, with what they show", () => {
    const parts = partsOf(PAPER, "typst");

    expect(parts.map((part) => [part.kind, part.shown])).toEqual([
      ["heading", "Intro"],
      ["paragraph", "Some context."],
      ["heading", "Methods"],
      ["paragraph", "We did the work."],
      ["paragraph", "Then we checked it."],
    ]);
  });

  it("a long paragraph shows its first words", () => {
    const [part] = partsOf("We propose a new simple network architecture based solely on attention.", "typst");

    expect(part.shown).toBe("We propose a new simple network…");
  });

  it("a Typst heading is named after its text, with a label added to it", () => {
    const methods = partsOf(PAPER, "typst")[2];

    const { anchor, change } = anchorFor(PAPER, "typst", methods);

    expect(anchor).toBe("methods");
    expect(change).toEqual({ from: PAPER.indexOf("= Methods") + 9, insert: " <methods>" });
  });

  it("a heading that has a label already keeps it", () => {
    const note = "= Methods <how>\n\nText.";

    expect(anchorFor(note, "typst", partsOf(note, "typst")[0])).toEqual({ anchor: "how" });
  });

  it("a name used already in the note gets a number", () => {
    const note = "= Methods <methods>\n\n= Methods\n\nText.";

    expect(anchorFor(note, "typst", partsOf(note, "typst")[1]).anchor).toBe("methods-2");
  });

  it("a Typst paragraph gets a short label at its end", () => {
    const paragraph = partsOf(PAPER, "typst")[3];

    const { anchor, change } = anchorFor(PAPER, "typst", paragraph);

    expect(anchor).toMatch(/^p-[0-9a-f]{4}$/);
    expect(change).toEqual({ from: PAPER.indexOf("work.") + 5, insert: ` <${anchor}>` });
  });

  it("a Markdown heading uses its usual anchor, numbered when the name repeats, without changing the note", () => {
    const parts = partsOf(PAPER_MD, "markdown").filter((part) => part.kind === "heading");

    expect(parts.map((part) => anchorFor(PAPER_MD, "markdown", part))).toEqual([
      { anchor: "intro" },
      { anchor: "methods" },
      { anchor: "methods-1" },
    ]);
  });

  it("a Markdown paragraph gets a ^ mark at its end, like Obsidian", () => {
    const paragraph = partsOf(PAPER_MD, "markdown")[1];

    const { anchor, change } = anchorFor(PAPER_MD, "markdown", paragraph);

    expect(anchor).toMatch(/^\^p-[0-9a-f]{4}$/);
    expect(change?.insert).toBe(` ${anchor}`);
  });

  it("finds the part a link names", () => {
    const note = "= Intro\n\n= Methods <methods>\n\nWe did. <p-3f9a>";

    expect(findPart(note, "typst", "methods")).toEqual({ from: note.indexOf("= Methods"), to: note.indexOf("<methods>") + 9 });
    expect(findPart(note, "typst", "p-3f9a")?.from).toBe(note.indexOf("We did."));
    expect(findPart(note, "typst", "gone")).toBeNull();
    expect(findPart(PAPER_MD, "markdown", "methods-1")?.from).toBe(PAPER_MD.lastIndexOf("# Methods"));
    expect(findPart("Text. ^p-3f9a", "markdown", "^p-3f9a")).toEqual({ from: 0, to: 13 });
  });
});

describe("Following a link to a part", () => {
  it("opens the note at the heading, highlighted for a moment", async () => {
    notes["Paper.typ"] = PAPER.replace("= Methods", "= Methods <methods>");
    notes["Ideas.typ"] = '#link("Paper.typ#methods")[Paper]';
    const { editor } = await openNote();

    await clickLink(editor, "Paper");

    const paper = await screen.findByRole("textbox", { name: "Paper.typ" });
    const view = viewOf(paper);
    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(text(view).indexOf("= Methods")));
    expect(within(paper).getByRole("heading", { name: "Methods" }).closest(".cm-line")).toHaveClass("cm-flash");
  });

  it("goes to a labelled paragraph", async () => {
    notes["Paper.typ"] = PAPER.replace("work.", "work. <p-3f9a>");
    notes["Ideas.typ"] = '#link("Paper.typ#p-3f9a")[Paper]';
    const { editor } = await openNote();

    await clickLink(editor, "Paper");

    const view = viewOf(await screen.findByRole("textbox", { name: "Paper.typ" }));
    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(text(view).indexOf("We did")));
  });

  it("in Markdown, goes to a heading by its anchor", async () => {
    notes["Ideas.md"] = "[Paper](Paper.md#methods-1)";
    const { editor } = await openNote("Ideas.md");

    await clickLink(editor, "Paper");

    const view = viewOf(await screen.findByRole("textbox", { name: "Paper.md" }));
    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(text(view).lastIndexOf("# Methods")));
  });

  it("a link to a part of the same note goes there", async () => {
    notes["Paper.typ"] = `${PAPER.replace("= Methods", "= Methods <methods>")}\n\nSee #link("Paper.typ#methods")[Paper].`;
    const { editor, view } = await openNote("Paper.typ");

    await clickLink(editor, "Paper");

    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(text(view).indexOf("= Methods")));
  });

  it("opens a PDF at the page", async () => {
    notes["Ideas.typ"] = '#link("Papers/attention.pdf#page=3")[attention]';
    const { editor } = await openNote();

    await clickLink(editor, "attention");

    const page = await screen.findByRole("img", { name: "Page 3" });
    await vi.waitFor(() => expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts).toContain(page));
  });

  it("says so when the part isn't in the note anymore, and opens it at the top", async () => {
    notes["Ideas.typ"] = '#link("Paper.typ#gone")[Paper]';
    const { editor } = await openNote();

    await clickLink(editor, "Paper");

    expect(await screen.findByRole("textbox", { name: "Paper.typ" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't find “gone” in Paper.typ.");
  });

  it("hovering a link says where it goes", async () => {
    notes["Paper.typ"] = PAPER.replace("= Methods", "= Methods <methods>");
    notes["Ideas.typ"] = '#link("Paper.typ#methods")[Paper] and #link("Papers/attention.pdf#page=3")[attention]';
    const { editor } = await openNote();

    fireEvent.mouseOver(within(editor).getByText("Paper"));
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Paper.typ › Methods");
    fireEvent.mouseOut(within(editor).getByText("Paper"));
    fireEvent.mouseOver(within(editor).getByText("attention"));

    await vi.waitFor(() => expect(screen.getByRole("tooltip")).toHaveTextContent("Papers/attention.pdf › page 3"));
    fireEvent.mouseOut(within(editor).getByText("attention"));
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("hovering doesn't change the link itself (so it can't get in the way of a click)", async () => {
    notes["Ideas.typ"] = '#link("Paper.typ#methods")[Paper]';
    const { editor } = await openNote();

    fireEvent.mouseOver(within(editor).getByText("Paper"));
    await screen.findByRole("tooltip");

    expect(within(editor).getByText("Paper").closest("[title]")).toBeNull();
  });
});

describe("Making a link to a part with [[", () => {
  it("typing # after a note lists its headings", async () => {
    await openNote();

    await userEvent.keyboard("[[[[Paper.typ#");

    expect(await offered()).toEqual(["Intro", "Methods"]);
  });

  it("# while the list is open goes on with the highlighted file", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[Pap");
    await listReady();
    await userEvent.keyboard("#");

    expect(text(view)).toBe("[[Paper.md#]]");
    await vi.waitFor(async () => expect(await offered()).toEqual(["Intro", "Methods", "Methods"]));
  });

  it("# right after choosing a file (with Enter) goes on to its parts", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[attention.p");
    await listReady();
    await userEvent.keyboard("{Enter}");
    expect(text(view)).toBe('#link("Papers/attention.pdf")[attention]');
    await userEvent.keyboard("#");

    expect(text(view)).toBe("[[attention.pdf#");
    await vi.waitFor(async () => expect(await offered()).toEqual(["Page 1", "Page 2", "Page 3"]));
    await choose("Page 2");
    expect(text(view)).toBe('#link("Papers/attention.pdf#page=2")[attention]');
  });

  it("# anywhere else is just a #", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[attention.p");
    await listReady();
    await userEvent.keyboard("{Enter} #");

    expect(text(view)).toBe('#link("Papers/attention.pdf")[attention] #');
  });

  it("typing words finds paragraphs too", async () => {
    await openNote();

    await userEvent.keyboard("[[[[Paper.typ#checked");

    expect(await offered()).toEqual(["Then we checked it."]);
  });

  it("choosing a heading links to it, showing only the file's name, and labels the heading", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[Paper.typ#");
    await choose("Methods");

    expect(text(view)).toBe('#link("Paper.typ#methods")[Paper]');
    await vi.waitFor(() => expect(api.saveNote).toHaveBeenCalledWith("Paper.typ", PAPER.replace("= Methods", "= Methods <methods>")));
  });

  it("a heading's label is used when it has one, and the note isn't changed", async () => {
    notes["Paper.typ"] = PAPER.replace("= Methods", "= Methods <how>");
    const { view } = await openNote();

    await userEvent.keyboard("[[[[Paper.typ#");
    await choose("Methods");

    expect(text(view)).toBe('#link("Paper.typ#how")[Paper]');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.saveNote).not.toHaveBeenCalledWith("Paper.typ", expect.anything());
  });

  it("choosing a paragraph labels it", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[Paper.typ#checked");
    await choose("Then we checked it.");

    const anchor = /#(p-[0-9a-f]{4})"/.exec(text(view))?.[1];
    expect(text(view)).toBe(`#link("Paper.typ#${anchor}")[Paper]`);
    await vi.waitFor(() => expect(notes["Paper.typ"]).toBe(`${PAPER} <${anchor}>`));
  });

  it("a link to a part of the note being written labels it right there", async () => {
    const { view } = await openNote("Paper.typ");

    await userEvent.keyboard("\n\nSee [[[[Paper.typ#");
    await choose("Methods");

    expect(text(view)).toContain("= Methods <methods>");
    expect(text(view)).toContain('See #link("Paper.typ#methods")[Paper]');
  });

  it("a Markdown heading is linked by its anchor, without changing that note", async () => {
    const { view } = await openNote("Ideas.md");

    await userEvent.keyboard("[[[[Paper.md#");
    await choose("Methods");

    expect(text(view)).toBe("[Paper](Paper.md#methods)");
  });

  it("a PDF lists its pages; typing a number picks one", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[attention.pdf#");
    expect(await offered()).toEqual(["Page 1", "Page 2", "Page 3"]);
    await userEvent.keyboard("2");
    await vi.waitFor(async () => expect(await offered()).toEqual(["Page 2"]));
    await choose("Page 2");

    expect(text(view)).toBe('#link("Papers/attention.pdf#page=2")[attention]');
  });

  it("without choosing, what's typed after # stays in the link", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[Paper.typ#methods");
    act(() => view.contentDOM.blur());

    await vi.waitFor(() => expect(text(view)).toBe('#link("Paper.typ#methods")[Paper]'));
  });
});

describe("Copy link", () => {
  /** Right-clicks the block handle beside a line, and chooses Copy link. */
  async function copyLinkTo(editor: HTMLElement, shown: string) {
    const view = viewOf(editor);
    fireEvent.mouseMove(within(editor).getByText(shown).closest(".cm-line")!);
    fireEvent.contextMenu(view.dom.querySelector(":scope > .cm-block-handle")!);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy link" }));
  }

  it("a block handle's right-click menu copies a link to the heading, and labels it", async () => {
    const { editor, view } = await openNote("Paper.typ");

    await copyLinkTo(editor, "Methods");

    await vi.waitFor(() => expect(copied).toEqual(["Paper.typ#methods"]));
    expect(text(view)).toContain("= Methods <methods>");
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
  });

  it("pasting a copied link into a note writes the link, from that note's folder", async () => {
    const { editor } = await openNote("Papers/Attention.typ");
    const view = viewOf(editor);

    fireEvent.paste(view.contentDOM, { clipboardData: { files: [], types: ["text/plain"], getData: () => "Paper.typ#methods" } });

    expect(text(view)).toBe('#link("../Paper.typ#methods")[Paper]');
  });

  it("pasting the address of a file that isn't in the workspace pastes the text", async () => {
    const { view } = await openNote();

    fireEvent.paste(view.contentDOM, { clipboardData: { files: [], types: ["text/plain"], getData: () => "Nowhere.typ#methods" } });

    expect(text(view)).not.toContain("#link");
  });

  it("a PDF page's right-click menu copies a link to that page", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Papers" }));
    await userEvent.click(screen.getByRole("button", { name: "attention.pdf" }));

    fireEvent.contextMenu(await screen.findByRole("img", { name: "Page 2" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Copy link to page 2" }));

    await vi.waitFor(() => expect(copied).toEqual(["Papers/attention.pdf#page=2"]));
  });
});

describe("Copy link in the PDF reader", () => {
  it("the toolbar copies a link to the page in view", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Papers" }));
    await userEvent.click(screen.getByRole("button", { name: "attention.pdf" }));
    const toolbar = await screen.findByRole("toolbar", { name: "PDF" });
    await screen.findByRole("img", { name: "Page 1" });

    await userEvent.click(within(toolbar).getByRole("button", { name: "Copy link to this page" }));

    await vi.waitFor(() => expect(copied).toEqual(["Papers/attention.pdf#page=1"]));
  });
});

describe("Labels in the editor", () => {
  it("are hidden, so a heading shows only its text", async () => {
    notes["Paper.typ"] = PAPER.replace("= Methods", "= Methods <methods>").replace("work.", "work. <p-3f9a>");
    const { editor } = await openNote("Paper.typ");

    expect(within(editor).getByRole("heading", { name: "Methods" })).toHaveTextContent(/^Methods$/);
    expect(editor).not.toHaveTextContent("<p-3f9a>");
  });

  it("show while the cursor is at them", async () => {
    notes["Paper.typ"] = PAPER.replace("work.", "work. <p-3f9a>");
    const { editor, view } = await openNote("Paper.typ");

    act(() => view.dispatch({ selection: { anchor: text(view).indexOf("<p-3f9a>") + 8 } }));

    expect(editor).toHaveTextContent("work. <p-3f9a>");
  });

  it("Markdown's ^ marks are hidden too", async () => {
    notes["Paper.md"] = "Some text. ^p-3f9a\n\nMore.";
    const { editor } = await openNote("Paper.md");

    expect(editor).toHaveTextContent("Some text.");
    expect(editor).not.toHaveTextContent("^p-3f9a");
  });
});

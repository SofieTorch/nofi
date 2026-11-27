// Annotating a PDF, like in Zotero: marks on its pages, and notes about any part of it.
//
// Annotations are marks on the pages: highlighted text (in a colour), a note at a spot, an area
// of a page. They're kept in a file beside the PDF, `attention.annotations.json`, not in the PDF.
//
// A note about a part of the PDF is a paragraph in a note, citing that part with a footnote,
// `#footnote[#link("attention.pdf#page=3&quote=…")[attention, p. 3]]`. "Add note" (on selected
// text, at a spot, or on an area) writes the footnote in the PDF's source note (made the first
// time, beside the PDF: `attention notes.typ`, with the paper's details) and opens it beside the
// PDF, the cursor before the footnote, to write. Once there are notes about the PDF, Add note asks
// which note it goes in: its source notes first, then the notes citing it, or any note found by
// name, or a new source note. Any note can cite the PDF like this.
//
// The reader's margin shows, next to each part, the paragraph citing it (only that paragraph:
// the rest of the note is the note's own), from the source note and from other notes.

import { EditorView } from "@codemirror/view";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { findCitations } from "../src/pdf/annotations";
import { readPart, writePart } from "../src/board/board";
import * as pdf from "../src/workspace/pdf";
import { chooseInMenu, file, folder, setUpFakeBackend } from "./support/fake-backend";
import { useFakeProperties } from "./support/fake-properties";

vi.mock("../src/api");
vi.mock("../src/workspace/pdf");

const CITATION = `#footnote[#link("attention.pdf#page=3&quote=The%20dominant%20sequence")[attention, p. 3]]`;
const SOURCE = `#metadata((\nsource: attention.pdf\n)) <properties>\n\nNotes on #link("attention.pdf")[attention].\n\nRNNs are slow to train.${CITATION}\n`;
const ANNOTATIONS = "Papers/attention.annotations.json";

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  useFakeProperties();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Ideas.typ": "Nothing yet." };
  vi.mocked(api.listFiles).mockImplementation(async () => [
    folder("Papers", [file("Papers/attention.pdf"), ...Object.keys(notes).filter((p) => p.startsWith("Papers/")).map(file)]),
    ...Object.keys(notes).filter((p) => !p.includes("/")).map(file),
  ]);
  vi.mocked(api.readNote).mockImplementation(async (path) => {
    if (!(path in notes)) throw new Error("This note doesn't exist anymore.");
    return notes[path];
  });
  vi.mocked(api.saveNote).mockImplementation(async (path, text) => void (notes[path] = text));
  vi.mocked(api.createNoteAt).mockImplementation(async (path) => {
    notes[path] = "";
    return path;
  });
  vi.mocked(api.notesLinkingTo).mockImplementation(async () =>
    Object.keys(notes).filter((path) => /\.(typ|md)$/.test(path) && notes[path].includes("attention.pdf")),
  );
  vi.mocked(api.readWorkspaceFile).mockResolvedValue(new ArrayBuffer(4));
  vi.mocked(pdf.openPdf).mockResolvedValue({
    pages: 3,
    close: () => {},
    info: async () => ({ title: "Attention Is All You Need", authors: ["Vaswani", "Shazeer"], year: 2017 }),
    page: async (number) => ({
      width: 600,
      height: 800,
      draw: async () => {},
      text: async (container: HTMLElement) => {
        container.innerHTML = number === 3 ? `<span>The dominant sequence</span><br><span>transduction models are complex.</span>` : "<span>Other words.</span>";
      },
    }),
  });
  // (The test browser doesn't lay text out: each passage is somewhere on its page.)
  Range.prototype.getClientRects = () => [{ left: 10, top: 40, width: 200, height: 14, right: 210, bottom: 54 }] as unknown as DOMRectList;
  Element.prototype.scrollIntoView = vi.fn();
});

async function openPdf() {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Papers" }));
  await userEvent.click(screen.getByRole("button", { name: "attention.pdf" }));
  const page = await screen.findByRole("img", { name: "Page 3" });
  await vi.waitFor(() => expect(page.querySelector(".textLayer")!.textContent).toContain("The dominant"));
  return page;
}

/** Selects text on a page, as the mouse does, and lets go. */
async function select(page: HTMLElement, text: string) {
  const layer = page.querySelector(".textLayer")!;
  const span = [...layer.querySelectorAll("span")].find((s) => s.textContent!.includes(text))!;
  const node = span.firstChild!;
  const at = node.textContent!.indexOf(text);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + text.length);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  fireEvent.mouseUp(span);
}

const bar = () => screen.findByRole("toolbar", { name: "Selected text" });

/**
 * Adds a note on the text selected: it's highlighted, then its highlight's bar has Add note (the
 * bar for selected text copies it as a footnote, link or quote instead).
 */
async function addNoteOnSelection() {
  await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in yellow" }));
  const page = screen.getByRole("img", { name: "Page 3" });
  await vi.waitFor(() => expect(page.querySelector("[data-highlight]")).not.toBeNull());
  // (The highlight is at 10–210 across, 40–54 down.)
  fireEvent.mouseUp(page, { clientX: 50, clientY: 45 });
  fireEvent.click(page, { clientX: 50, clientY: 45 });
  await userEvent.click(within(await screen.findByRole("toolbar", { name: "Annotation" })).getByRole("button", { name: "Add note" }));
}
// (It comes once the notes are read and the pages laid out: a while, when the computer is busy.)
const margin = () => screen.findByRole("complementary", { name: "Notes on this PDF" }, { timeout: 4000 });
const saved = () => JSON.parse(notes[ANNOTATIONS]).annotations;

/** Chooses the note a new note goes in, when asked. */
async function into(name: string) {
  const asked = await screen.findByRole("dialog", { name: "Add the note to" });
  await userEvent.click(within(asked).getByRole("option", { name }));
}

/** The source note, open beside the PDF; where its cursor is, shown as "|". */
async function sourceNoteWithCursor() {
  const editor = await screen.findByRole("textbox", { name: "attention notes.typ" });
  const view = EditorView.findFromDOM(editor)!;
  await vi.waitFor(() => expect(view.hasFocus).toBe(true));
  const head = view.state.selection.main.head;
  const text = view.state.doc.toString();
  return `${text.slice(0, head)}|${text.slice(head)}`;
}

describe("Highlighting text", () => {
  it("selecting text offers highlighting it in a colour, or copying it to cite it", async () => {
    await select(await openPdf(), "The dominant sequence");

    const actions = await bar();

    for (const colour of ["yellow", "green", "blue", "pink", "purple"]) {
      expect(within(actions).getByRole("button", { name: `Highlight in ${colour}` })).toBeInTheDocument();
    }
    expect(within(actions).getByRole("button", { name: "Copy as" })).toBeInTheDocument();
    expect(within(actions).queryByRole("button", { name: "Add note" })).not.toBeInTheDocument();
  });

  it("its buttons stay on one line, even near the page's edge", async () => {
    await select(await openPdf(), "The dominant sequence");

    expect(await bar()).toHaveClass("whitespace-nowrap");
  });

  it("a highlight is kept in the annotations file beside the PDF; no note is written", async () => {
    await select(await openPdf(), "The dominant sequence");

    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in green" }));

    await vi.waitFor(() => expect(notes[ANNOTATIONS]).toBeDefined());
    expect(JSON.parse(notes[ANNOTATIONS]).pdf).toBe("attention.pdf");
    expect(saved()).toEqual([expect.objectContaining({ type: "highlight", page: 3, quote: "The dominant sequence", colour: "green" })]);
    expect(Object.keys(notes).filter((path) => path.endsWith(".typ"))).toEqual(["Ideas.typ"]);
  });

  it("highlights show on the page, in their colour", async () => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "a1", type: "highlight", page: 3, quote: "complex.", colour: "blue" }] });
    const page = await openPdf();

    await vi.waitFor(() => expect(page.querySelector("[data-highlight]")).toHaveAttribute("data-colour", "blue"));
  });

  it("what else is in the file is kept as it was", async () => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", from: "another app", annotations: [{ id: "a1", type: "highlight", page: 3, quote: "complex.", colour: "blue", tags: ["x"] }] });
    await select(await openPdf(), "The dominant sequence");

    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in yellow" }));

    await vi.waitFor(() => expect(saved()).toHaveLength(2));
    expect(JSON.parse(notes[ANNOTATIONS]).from).toBe("another app");
    expect(saved()[0].tags).toEqual(["x"]);
  });
});

describe("Changing or removing an annotation", () => {
  beforeEach(() => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "a1", type: "highlight", page: 3, quote: "complex.", colour: "yellow" }] });
  });

  async function menuOnHighlight() {
    const page = await openPdf();
    await vi.waitFor(() => expect(page.querySelector("[data-highlight]")).not.toBeNull());
    // (The highlight is at 10–210 across, 40–54 down.)
    fireEvent.contextMenu(page, { clientX: 50, clientY: 45 });
    return screen.findByRole("menu", { name: "Annotation" });
  }

  async function clickHighlight() {
    const page = await openPdf();
    await vi.waitFor(() => expect(page.querySelector("[data-highlight]")).not.toBeNull());
    fireEvent.mouseUp(page, { clientX: 50, clientY: 45 });
    fireEvent.click(page, { clientX: 50, clientY: 45 });
    return screen.findByRole("toolbar", { name: "Annotation" });
  }

  it("clicking a highlight offers its colours, adding a note, and removing it", async () => {
    const actions = await clickHighlight();

    expect(within(actions).getByRole("button", { name: "Yellow" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(actions).getByRole("button", { name: "Remove highlight" }));

    await vi.waitFor(() => expect(saved()).toEqual([]));
    await vi.waitFor(() => expect(screen.getByRole("img", { name: "Page 3" }).querySelector("[data-highlight]")).toBeNull());
  });

  it("its colour can be changed there too", async () => {
    await userEvent.click(within(await clickHighlight()).getByRole("button", { name: "Green" }));

    await vi.waitFor(() => expect(saved()[0].colour).toBe("green"));
  });

  it("selecting highlighted text offers removing the highlight", async () => {
    const page = await openPdf();
    await select(page, "complex.");

    await userEvent.click(within(await bar()).getByRole("button", { name: "Remove highlight" }));

    await vi.waitFor(() => expect(saved()).toEqual([]));
  });

  it("highlighting it again changes its colour, rather than adding another", async () => {
    await select(await openPdf(), "complex.");

    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in pink" }));

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ id: "a1", quote: "complex.", colour: "pink" })]));
  });

  it("highlighting text that overlaps a highlight joins them into one (highlights never overlap)", async () => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "a1", type: "highlight", page: 3, quote: "The dominant", colour: "yellow" }] });
    await select(await openPdf(), "dominant sequence");

    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in green" }));

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ type: "highlight", page: 3, quote: "The dominant sequence", colour: "green" })]));
  });

  it("text that isn't highlighted isn't offered that", async () => {
    await select(await openPdf(), "The dominant sequence");

    expect(within(await bar()).queryByRole("button", { name: "Remove highlight" })).not.toBeInTheDocument();
  });

  it("right-clicking a highlight can change its colour", async () => {
    await userEvent.click(within(await menuOnHighlight()).getByRole("menuitem", { name: "Pink" }));

    await vi.waitFor(() => expect(saved()[0].colour).toBe("pink"));
  });

  it("or remove it", async () => {
    await userEvent.click(within(await menuOnHighlight()).getByRole("menuitem", { name: "Remove" }));

    await vi.waitFor(() => expect(saved()).toEqual([]));
  });

  it("or add a note about it", async () => {
    await userEvent.click(within(await menuOnHighlight()).getByRole("menuitem", { name: "Add note" }));

    expect(await sourceNoteWithCursor()).toMatch(/\n\n\|#footnote\[#link\("attention\.pdf#page=3&quote=complex\."\)\[attention, p\. 3\]\]\n$/);
    expect(saved()).toHaveLength(1);
  });
});

describe("Undoing changes to highlights (⌘Z, while reading the PDF)", () => {
  beforeEach(() => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "a1", type: "highlight", page: 3, quote: "complex.", colour: "yellow" }] });
  });

  /** Where the focus is after clicking the pages: Undo is the reader's then. */
  const reading = (page: HTMLElement) => page.closest<HTMLElement>("[data-pdf-scroller]")!.focus();

  it("takes back a highlight just made", async () => {
    const page = await openPdf();
    reading(page);
    await select(page, "The dominant sequence");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in green" }));
    await vi.waitFor(() => expect(saved()).toHaveLength(2));

    await chooseInMenu("Edit › Undo");

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ id: "a1" })]));
    await vi.waitFor(() => expect(page.querySelectorAll("[data-highlight]")).toHaveLength(1));
  });

  it("the keys do it too, and Redo makes it again", async () => {
    const page = await openPdf();
    reading(page);
    await select(page, "The dominant sequence");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in green" }));
    await vi.waitFor(() => expect(saved()).toHaveLength(2));

    await userEvent.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(saved()).toHaveLength(1));
    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ id: "a1" }), expect.objectContaining({ quote: "The dominant sequence", colour: "green" })]));
  });

  it("takes back removing a highlight: it's back as it was", async () => {
    const page = await openPdf();
    reading(page);
    await select(page, "complex.");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Remove highlight" }));
    await vi.waitFor(() => expect(saved()).toEqual([]));

    await chooseInMenu("Edit › Undo");

    await vi.waitFor(() => expect(saved()).toEqual([{ id: "a1", type: "highlight", page: 3, quote: "complex.", colour: "yellow" }]));
  });

  it("takes back changing a highlight's colour", async () => {
    const page = await openPdf();
    reading(page);
    await select(page, "complex.");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in pink" }));
    await vi.waitFor(() => expect(saved()[0].colour).toBe("pink"));

    await chooseInMenu("Edit › Undo");

    await vi.waitFor(() => expect(saved()[0].colour).toBe("yellow"));
  });

  it("takes back joining highlights: the ones joined are back", async () => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "a1", type: "highlight", page: 3, quote: "The dominant", colour: "yellow" }] });
    const page = await openPdf();
    reading(page);
    await select(page, "dominant sequence");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in green" }));
    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ quote: "The dominant sequence" })]));

    await chooseInMenu("Edit › Undo");

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ id: "a1", quote: "The dominant", colour: "yellow" })]));
  });

  it("takes back removing one from its bar, or its menu", async () => {
    const page = await openPdf();
    await vi.waitFor(() => expect(page.querySelector("[data-highlight]")).not.toBeNull());
    reading(page);
    fireEvent.contextMenu(page, { clientX: 50, clientY: 45 });
    await userEvent.click(within(await screen.findByRole("menu", { name: "Annotation" })).getByRole("menuitem", { name: "Remove" }));
    await vi.waitFor(() => expect(saved()).toEqual([]));
    reading(page);

    await chooseInMenu("Edit › Undo");

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ id: "a1" })]));
  });
});

describe("A passage the PDF writes in pieces", () => {
  // (PDFs often write a reference's number, or a sign like ×, as a piece of its own, with no space
  // before it: its words are still found, wherever the pieces break.)
  beforeEach(() => {
    const opened = vi.mocked(pdf.openPdf).getMockImplementation();
    vi.mocked(pdf.openPdf).mockImplementation(async (bytes) => {
      const document = (await opened?.(bytes)) ?? (await vi.mocked(pdf.openPdf).mock.results[0].value);
      return {
        ...document,
        page: async (number: number) => ({
          ...(await document.page(number)),
          text: async (container: HTMLElement) => {
            container.innerHTML =
              number === 3
                ? `<span>The dominant sequence</span><br><span>systems such as Spark [</span><span>44</span><span>] and</span><br><span>Flink [6] by up to 12</span><span>×</span><span>.</span>`
                : "<span>Other words.</span>";
          },
        }),
      };
    });
  });

  it("a note citing it underlines it", async () => {
    const quote = encodeURIComponent("systems such as Spark [44] and\nFlink [6] by up to 12×");
    notes["Ideas.typ"] = `Fast.#footnote[#link("Papers/attention.pdf#page=3&quote=${quote}")[attention, p. 3]]\n`;
    const page = await openPdf();

    await vi.waitFor(() => expect(page.querySelector("[data-cited]")).not.toBeNull());
  });

  it("a piece much taller than the words on its line (a sign in another font) doesn't move its underline", async () => {
    // (The words' boxes, and the ×'s, taller and reaching into the line below.)
    Range.prototype.getClientRects = () =>
      [
        { left: 10, top: 40, width: 150, height: 14, right: 160, bottom: 54 },
        { left: 160, top: 36, width: 8, height: 30, right: 168, bottom: 66 },
      ] as unknown as DOMRectList;
    const quote = encodeURIComponent("Flink [6] by up to 12×");
    notes["Ideas.typ"] = `Fast.#footnote[#link("Papers/attention.pdf#page=3&quote=${quote}")[attention, p. 3]]\n`;
    const page = await openPdf();

    await vi.waitFor(() => expect(page.querySelector("[data-cited]")).not.toBeNull());
    const line = page.querySelector<HTMLElement>("[data-cited]")!.style;
    expect([line.left, line.width, line.top, line.height]).toEqual(["10px", "158px", "40px", "14px"]);
  });

  it("and it can be highlighted", async () => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "a1", type: "highlight", page: 3, quote: "Spark [44] and Flink [6] by up to 12×", colour: "yellow" }] });
    const page = await openPdf();

    await vi.waitFor(() => expect(page.querySelector("[data-highlight]")).not.toBeNull());
  });
});

describe("The same words twice on a page", () => {
  // A passage keeps which time its words are on the page (not the first? `nth`): what's marked,
  // cited or linked is the one selected, not the first one found.
  // (pdf.js often has a space and the next words as pieces of their own, as on the second line.)
  const TWICE = "<span>attention here</span><br><span>more </span><span>attention</span>";
  beforeEach(() => {
    // (Each piece of text somewhere of its own: the first at 10 across, then 310, then 610.)
    Range.prototype.getClientRects = function (this: Range) {
      const node = this.startContainer;
      const span = (node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element))!;
      const line = [...span.parentElement!.querySelectorAll("span")].indexOf(span as HTMLSpanElement);
      const left = 10 + 300 * Math.max(0, line);
      return [{ left, top: 40, width: 100, height: 14, right: left + 100, bottom: 54 }] as unknown as DOMRectList;
    };
    vi.mocked(pdf.openPdf).mockResolvedValue({
      pages: 3,
      close: () => {},
      info: async () => ({ title: "Attention Is All You Need" }),
      page: async (number) => ({
        width: 600,
        height: 800,
        draw: async () => {},
        text: async (container: HTMLElement) => {
          container.innerHTML = number === 3 ? TWICE : "<span>Other words.</span>";
        },
      }),
    });
  });
  async function pageWithTwice() {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Papers" }));
    await userEvent.click(screen.getByRole("button", { name: "attention.pdf" }));
    const page = await screen.findByRole("img", { name: "Page 3" });
    await vi.waitFor(() => expect(page.querySelector(".textLayer")!.textContent).toContain("more attention"));
    return page;
  }
  /** Selects the words in the piece of text they're in (the how-manyth piece). */
  function selectIn(page: HTMLElement, words: string, line: number) {
    const span = page.querySelectorAll(".textLayer span")[line];
    const node = span.firstChild!;
    const at = node.textContent!.indexOf(words);
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + words.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(span);
  }

  it("is written in a passage's address only when it's not the first", () => {
    expect(writePart({ page: 3, quote: "attention", nth: 2 })).toBe("#page=3&quote=attention&nth=2");
    expect(writePart({ page: 3, quote: "attention", nth: 1 })).toBe("#page=3&quote=attention");
    expect(readPart("#page=3&quote=attention&nth=2")).toEqual({ page: 3, quote: "attention", nth: 2 });
  });

  it("highlighting the second keeps which one it is, and that one is highlighted", async () => {
    const page = await pageWithTwice();
    selectIn(page, "attention", 2);

    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in yellow" }));

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ quote: "attention", nth: 2 })]));
    await vi.waitFor(() => expect(page.querySelector<HTMLElement>("[data-highlight]")?.style.left).toBe("610px"));
  });

  it("found by where the selection starts, however the browser says it (as Safari does: at the end of the text before)", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    const page = await pageWithTwice();
    const [, before, words] = page.querySelectorAll(".textLayer span");
    const range = document.createRange();
    range.setStart(before.firstChild!, "more ".length);
    range.setEnd(words.firstChild!, "attention".length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(words);
    await userEvent.click(within(await bar()).getByRole("button", { name: "Copy as" }));

    await userEvent.click(within(await screen.findByRole("menu", { name: "Copy as" })).getByRole("menuitem", { name: "Link" }));

    await vi.waitFor(() => expect(copied).toEqual(["Papers/attention.pdf#page=3&quote=attention&nth=2"]));
  });

  it("or at the edge of a piece of text, rather than in it", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    const page = await pageWithTwice();
    const words = page.querySelectorAll(".textLayer span")[2];
    const range = document.createRange();
    range.setStart(words, 0);
    range.setEnd(words.firstChild!, "attention".length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.mouseUp(words);
    await userEvent.click(within(await bar()).getByRole("button", { name: "Copy as" }));

    await userEvent.click(within(await screen.findByRole("menu", { name: "Copy as" })).getByRole("menuitem", { name: "Link" }));

    await vi.waitFor(() => expect(copied).toEqual(["Papers/attention.pdf#page=3&quote=attention&nth=2"]));
  });

  it("the first keeps no number, as passages always have", async () => {
    const page = await pageWithTwice();
    selectIn(page, "attention", 0);

    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in yellow" }));

    await vi.waitFor(() => expect(saved()).toHaveLength(1));
    expect(saved()[0].nth).toBeUndefined();
  });

  it("copying the second to cite it cites that one", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    const page = await pageWithTwice();
    selectIn(page, "attention", 2);
    await userEvent.click(within(await bar()).getByRole("button", { name: "Copy as" }));

    await userEvent.click(within(await screen.findByRole("menu", { name: "Copy as" })).getByRole("menuitem", { name: "Link" }));

    await vi.waitFor(() => expect(copied).toEqual(["Papers/attention.pdf#page=3&quote=attention&nth=2"]));
  });

  it("linking the second to a note links that one", async () => {
    const page = await pageWithTwice();
    selectIn(page, "attention", 2);
    await userEvent.click(within(await bar()).getByRole("button", { name: "Link" }));
    const dialog = await screen.findByRole("dialog", { name: "Link to a note or paper" });
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Find a note" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Find a note" }), "ideas");

    await userEvent.click(within(dialog).getByRole("option", { name: "Ideas.typ" }));

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ type: "link", quote: "attention", nth: 2 })]));
    await vi.waitFor(() => expect(page.querySelector<HTMLElement>("[data-note-link]")?.style.left).toBe("610px"));
  });

  it("a note citing the second is next to that one, which is underlined", async () => {
    notes["Ideas.typ"] = `About it: #link("Papers/attention.pdf#page=3&quote=attention&nth=2")[attention].`;
    const page = await pageWithTwice();

    await vi.waitFor(() => expect(page.querySelector<HTMLElement>("[data-cited]")?.style.left).toBe("610px"));
  });
});

describe("Copying selected text to cite it", () => {
  // Copy as: a footnote, a link or a quote citing the passage, to paste in any note. Nothing is
  // written or highlighted; pasted in a note, it's written for that note (its folder, its format).
  let copied: string[];
  const PASSAGE = "Papers/attention.pdf#page=3&quote=The%20dominant%20sequence";
  beforeEach(() => {
    copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    notes["Reading.md"] = "";
  });

  async function copyAs(kind: string) {
    await select(await openPdf(), "The dominant sequence");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Copy as" }));
    await userEvent.click(within(await screen.findByRole("menu", { name: "Copy as" })).getByRole("menuitem", { name: kind }));
    await vi.waitFor(() => expect(copied).toHaveLength(1));
  }

  /** Pastes what was copied into a note (opened from the files). */
  async function pasteInto(name: string) {
    if (name.startsWith("Papers/")) await userEvent.click(screen.getByRole("button", { name: name.split("/").pop() }));
    else await userEvent.click(screen.getByRole("button", { name }));
    const editor = await screen.findByRole("textbox", { name: name.split("/").pop() });
    const view = EditorView.findFromDOM(editor)!;
    fireEvent.paste(view.contentDOM, { clipboardData: { files: [], types: ["text/plain"], getData: () => copied[0] } });
    return view.state.doc.toString();
  }

  it("as a footnote: the footnote citing the passage; nothing is written or highlighted", async () => {
    await copyAs("Footnote");

    expect(copied).toEqual([`#footnote[#link("${PASSAGE}")[attention, p. 3]]`]);
    expect(await screen.findByRole("status")).toHaveTextContent("Copied as a footnote");
    expect(notes[ANNOTATIONS]).toBeUndefined();
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });

  it("copies straight away, in the click (the app's webview only lets a click write to the clipboard then)", async () => {
    await select(await openPdf(), "The dominant sequence");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Copy as" }));
    const footnote = within(await screen.findByRole("menu", { name: "Copy as" })).getByRole("menuitem", { name: "Footnote" });

    fireEvent.click(footnote);

    // (Not after waiting for anything: by then, it wouldn't be allowed.)
    expect(copied).toEqual([`#footnote[#link("${PASSAGE}")[attention, p. 3]]`]);
  });

  it("as a link: only its address, to link selected text with the style menu's Link", async () => {
    await copyAs("Link");

    expect(copied).toEqual([PASSAGE]);
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
  });

  it("the link pasted into a note's text is a link to the passage, from that note's folder", async () => {
    notes["Papers/attention notes.typ"] = "";
    await copyAs("Link");

    expect(await pasteInto("Papers/attention notes.typ")).toBe(`#link("attention.pdf#page=3&quote=The%20dominant%20sequence")[attention]`);
  });

  it("as a quote: the words, quoted, with a footnote citing them", async () => {
    await copyAs("Quote");

    expect(copied).toEqual([`#quote[The dominant sequence]#footnote[#link("${PASSAGE}")[attention, p. 3]]`]);
  });

  it("pasted into a note in a folder, it's written from there", async () => {
    notes["Papers/attention notes.typ"] = "";
    await copyAs("Footnote");

    expect(await pasteInto("Papers/attention notes.typ")).toBe(`#footnote[#link("attention.pdf#page=3&quote=The%20dominant%20sequence")[attention, p. 3]]`);
  });

  it("pasted into a Markdown note, it's Markdown", async () => {
    await copyAs("Quote");

    expect(await pasteInto("Reading.md")).toBe(`“The dominant sequence” ([attention, p. 3](${PASSAGE}))`);
  });
});

describe("Adding a note", () => {
  it("on a highlight: the source note gets a footnote citing it, ready to write before", async () => {
    await select(await openPdf(), "The dominant sequence");

    await addNoteOnSelection();

    expect(await sourceNoteWithCursor()).toMatch(/\n\n\|#footnote\[#link\("attention\.pdf#page=3&quote=The%20dominant%20sequence"\)\[attention, p\. 3\]\]\n$/);
    expect(saved()).toEqual([expect.objectContaining({ type: "highlight", page: 3, quote: "The dominant sequence", colour: "yellow" })]);
    expect(screen.getAllByRole("region", { name: "Pane" })).toHaveLength(2);
  });

  it("the first time, the source note is made beside the PDF, with the paper's details", async () => {
    await select(await openPdf(), "The dominant sequence");

    await addNoteOnSelection();

    await vi.waitFor(() => expect(notes["Papers/attention notes.typ"]).toContain("#footnote["));
    const note = notes["Papers/attention notes.typ"];
    expect(note).toContain("source: attention.pdf");
    expect(note).toContain("title: Attention Is All You Need");
    expect(note).toContain("authors: [Vaswani, Shazeer]");
    expect(note).toContain("year: 2017");
    // (Its source property links it to the PDF; then only the citation, not the passage itself.)
    expect(note).toMatch(/<properties>\n\n#footnote\[#link\("attention\.pdf#page=3&quote=The%20dominant%20sequence"\)\[attention, p\. 3\]\]\n$/);
  });

  it("once there are notes about the PDF, it asks which one: its source notes first, then those citing it", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    notes["Papers/attention reading.typ"] = `#metadata((\nsource: attention.pdf\n)) <properties>\n\nMy reading.\n`;
    notes["Ideas.typ"] = `Compare: #link("Papers/attention.pdf#page=3&quote=transduction%20models")[attention].`;
    await select(await openPdf(), "complex.");

    await addNoteOnSelection();

    const asked = await screen.findByRole("dialog", { name: "Add the note to" });
    expect(within(asked).getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual([
      "attention notes.typ",
      "attention reading.typ",
      "Ideas.typ",
      "New note",
    ]);
    expect(within(asked).getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("the note chosen gets the footnote, and opens beside the PDF", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    notes["Papers/attention reading.typ"] = `#metadata((\nsource: attention.pdf\n)) <properties>\n\nMy reading.\n`;
    await select(await openPdf(), "complex.");
    await addNoteOnSelection();

    await into("attention reading.typ");

    const editor = await screen.findByRole("textbox", { name: "attention reading.typ" });
    await vi.waitFor(() => expect(EditorView.findFromDOM(editor)!.state.doc.toString()).toContain("\n\n#footnote[#link(\"attention.pdf#page=3&quote=complex.\")"));
    expect(notes["Papers/attention notes.typ"]).toBe(SOURCE);
    expect(saved()).toEqual([expect.objectContaining({ type: "highlight", quote: "complex." })]);
  });

  it("Enter chooses the first, the PDF's source note", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await select(await openPdf(), "complex.");
    await addNoteOnSelection();
    await screen.findByRole("dialog", { name: "Add the note to" });

    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(notes["Papers/attention notes.typ"]).toContain("quote=complex."));
    expect(notes["Papers/attention notes.typ"].startsWith(SOURCE)).toBe(true);
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });

  it("any other note can be found by name", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await select(await openPdf(), "complex.");
    await addNoteOnSelection();

    await userEvent.type(within(await screen.findByRole("dialog", { name: "Add the note to" })).getByRole("textbox", { name: "Find a note" }), "ide");
    await into("Ideas.typ");

    const editor = await screen.findByRole("textbox", { name: "Ideas.typ" });
    // (Its address is from that note's folder.)
    await vi.waitFor(() => expect(EditorView.findFromDOM(editor)!.state.doc.toString()).toContain('#footnote[#link("Papers/attention.pdf#page=3&quote=complex.")[attention, p. 3]]'));
  });

  it("or a new source note made for it", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await select(await openPdf(), "complex.");
    await addNoteOnSelection();

    await into("New note");

    await vi.waitFor(() => expect(notes["Papers/attention notes 2.typ"]).toContain("quote=complex."));
    expect(notes["Papers/attention notes 2.typ"]).toContain("source: attention.pdf");
  });

  it("Escape adds no note (the highlight stays)", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await select(await openPdf(), "complex.");
    await addNoteOnSelection();
    await screen.findByRole("dialog", { name: "Add the note to" });

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Add the note to" })).not.toBeInTheDocument();
    expect(saved()).toHaveLength(1);
    expect(notes["Papers/attention notes.typ"]).toBe(SOURCE);
  });

  it("at a spot on a page: a note mark stays there", async () => {
    const page = await openPdf();

    await userEvent.click(screen.getByRole("button", { name: "Add a note on the page" }));
    fireEvent.pointerDown(page, { clientX: 120, clientY: 300, button: 0 });

    expect(await sourceNoteWithCursor()).toMatch(/\n\n\|#footnote\[#link\("attention\.pdf#page=3&point=120,300"\)\[attention, p\. 3\]\]\n$/);
    expect(saved()).toEqual([expect.objectContaining({ type: "note", page: 3, x: 120, y: 300, colour: "yellow" })]);
    // (The reader is drawn again beside the note.)
    expect(await within(await screen.findByRole("img", { name: "Page 3" })).findByRole("button", { name: "Note on page 3" })).toBeInTheDocument();
  });

  it("the reader keeps its place when the note opens beside it", async () => {
    await select(await openPdf(), "The dominant sequence");
    const scroller = screen.getByRole("img", { name: "Page 3" }).parentElement!.parentElement!;
    scroller.scrollTop = 1234;
    fireEvent.scroll(scroller);

    await addNoteOnSelection();
    await sourceNoteWithCursor();

    const page = await screen.findByRole("img", { name: "Page 3" });
    await vi.waitFor(() => expect(page.parentElement!.parentElement!.scrollTop).toBe(1234));
  });

  it("on an area of a page, chosen with Select an area", async () => {
    const page = await openPdf();
    await userEvent.click(screen.getByRole("button", { name: "Select an area" }));
    fireEvent.pointerDown(page, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 250 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 250 });

    await userEvent.click(within(await screen.findByRole("toolbar", { name: "Selected area" })).getByRole("button", { name: "Add note" }));

    expect(await sourceNoteWithCursor()).toMatch(/\|#footnote\[#link\("attention\.pdf#page=3&area=100,100,200,150"\)\[attention, p\. 3\]\]\n$/);
    expect(saved()).toEqual([expect.objectContaining({ type: "area", page: 3, x: 100, y: 100, width: 200, height: 150 })]);
  });

  it("an area can also just be kept, outlined on the page", async () => {
    const page = await openPdf();
    await userEvent.click(screen.getByRole("button", { name: "Select an area" }));
    fireEvent.pointerDown(page, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 300, clientY: 250 });
    fireEvent.pointerUp(window, { clientX: 300, clientY: 250 });

    await userEvent.click(within(await screen.findByRole("toolbar", { name: "Selected area" })).getByRole("button", { name: "Keep area" }));

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ type: "area", page: 3, x: 100, y: 100, width: 200, height: 150 })]));
    await vi.waitFor(() => expect(page.querySelector("[data-area]")).not.toBeNull());
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });

  it("special characters in a passage are kept in the citation's address", async () => {
    const page = await openPdf();
    page.querySelector(".textLayer")!.innerHTML = "<span>costs $5 * 2</span>";

    await select(page, "costs $5 * 2");
    await addNoteOnSelection();

    await vi.waitFor(() => expect(notes["Papers/attention notes.typ"]).toContain("quote=costs%20%245%20*%202"));
  });

  it("a note's mark goes when no note cites it anymore (its footnote was deleted)", async () => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "n1", type: "note", page: 3, x: 120, y: 300, colour: "yellow" }] });
    notes["Papers/attention notes.typ"] = SOURCE;
    const page = await openPdf();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(within(page).queryByRole("button", { name: "Note on page 3" })).not.toBeInTheDocument();
  });

  it("clicking a note's mark opens the note citing it", async () => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "n1", type: "note", page: 3, x: 120, y: 300, colour: "yellow" }] });
    notes["Papers/attention notes.typ"] = `${SOURCE}\nA thought.#footnote[#link("attention.pdf#page=3&point=120,300")[attention, p. 3]]\n`;
    const page = await openPdf();

    await userEvent.click(await within(page).findByRole("button", { name: "Note on page 3" }));

    expect(await sourceNoteWithCursor()).toContain("\n|A thought.#footnote[");
  });
});

// A note's mark on a page (a note at a spot): hovering it shows the note citing it; dragging it
// moves it, and the links citing it in notes follow.
describe("A note's mark", () => {
  const A_THOUGHT = `${SOURCE}\nA thought about the model.#footnote[#link("attention.pdf#page=3&point=120,300")[attention, p. 3]]\n`;
  const withAMark = () => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "n1", type: "note", page: 3, x: 120, y: 300, colour: "yellow" }] });
    notes["Papers/attention notes.typ"] = A_THOUGHT;
  };
  const mark = async (page: HTMLElement) => within(page).findByRole("button", { name: "Note on page 3" });
  /** Drags something by (dx, dy) pixels, as the mouse does. */
  function dragBy(element: HTMLElement, dx: number, dy: number) {
    fireEvent.pointerDown(element, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 100 + dx / 2, clientY: 100 + dy / 2, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
    fireEvent.pointerUp(window, { clientX: 100 + dx, clientY: 100 + dy, pointerId: 1 });
  }
  /** How many pixels a point of the page is drawn as (from where the mark is drawn). */
  const scaleOf = (button: HTMLElement) => Number.parseFloat(button.style.left) / 120;

  it("hovering it shows a preview of the note citing it: the paragraph, and which note", async () => {
    withAMark();
    const page = await openPdf();

    await userEvent.hover(await mark(page));

    const preview = await screen.findByRole("tooltip");
    expect(preview).toHaveTextContent("A thought about the model.");
    expect(preview).toHaveTextContent("attention notes");
  });

  it("the preview goes when the mouse leaves", async () => {
    withAMark();
    const page = await openPdf();
    await userEvent.hover(await mark(page));
    await screen.findByRole("tooltip");

    await userEvent.unhover(await mark(page));

    await vi.waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("dragging it moves it on the page, and its new place is saved", async () => {
    withAMark();
    const button = await mark(await openPdf());
    const scale = scaleOf(button);

    dragBy(button, 40, -20);

    const x = Math.round(120 + 40 / scale);
    const y = Math.round(300 - 20 / scale);
    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ id: "n1", type: "note", page: 3, x, y })]));
    expect(Number.parseFloat(button.style.left)).toBeCloseTo(x * scale, 0);
  });

  it("the notes citing it are changed to cite its new place", async () => {
    withAMark();
    notes["Ideas.typ"] = `See #link("Papers/attention.pdf#page=3&point=120,300")[this spot].`;
    const button = await mark(await openPdf());
    const scale = scaleOf(button);

    dragBy(button, 40, -20);

    const point = `point=${Math.round(120 + 40 / scale)},${Math.round(300 - 20 / scale)}`;
    await vi.waitFor(() => expect(notes["Papers/attention notes.typ"]).toContain(`attention.pdf#page=3&${point}`));
    expect(notes["Papers/attention notes.typ"]).not.toContain("point=120,300");
    expect(notes["Ideas.typ"]).toContain(`Papers/attention.pdf#page=3&${point}`);
  });

  it("other links to the PDF are left as they were", async () => {
    withAMark();
    notes["Ideas.typ"] = `#link("Papers/attention.pdf#page=3&point=10,10")[another spot] and #link("Papers/attention.pdf#page=2&point=120,300")[page 2].`;
    const button = await mark(await openPdf());

    dragBy(button, 40, -20);

    await vi.waitFor(() => expect(notes["Papers/attention notes.typ"]).not.toContain("point=120,300"));
    expect(notes["Ideas.typ"]).toContain("page=3&point=10,10");
    expect(notes["Ideas.typ"]).toContain("page=2&point=120,300");
  });

  it("a note open in the editor is changed there, keeping what's typed", async () => {
    withAMark();
    const page = await openPdf();
    await userEvent.click(await mark(page));
    const editor = await screen.findByRole("textbox", { name: "attention notes.typ" });
    const view = EditorView.findFromDOM(editor)!;
    view.dispatch({ changes: { from: view.state.doc.length, insert: "Typed, not saved." } });
    const button = await mark(await screen.findByRole("img", { name: "Page 3" }));

    dragBy(button, 40, 0);

    await vi.waitFor(() => expect(view.state.doc.toString()).not.toContain("point=120,300"));
    expect(view.state.doc.toString()).toContain("Typed, not saved.");
  });

  it("a little wobble while clicking doesn't move it: the click opens its note", async () => {
    withAMark();
    const button = await mark(await openPdf());

    dragBy(button, 2, 1);
    await userEvent.click(button);

    expect(await sourceNoteWithCursor()).toContain("|A thought about the model.");
    expect(saved()[0]).toMatchObject({ x: 120, y: 300 });
  });
});

describe("The margin", () => {
  it("shows the paragraph citing a part next to it, without the footnote", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await openPdf();

    const card = await within(await margin()).findByRole("button", { name: /slow to train/ });

    expect(card).toHaveTextContent(/^RNNs are slow to train\.$/);
    expect(card).toHaveAttribute("data-page", "3");
  });

  it("a bullet in a list shows only itself, with the bullet it's in above, in full, as a hint", async () => {
    notes["Ideas.typ"] = [
      `- What's the difference?`,
      `  - Task: an operator over a batch#footnote[#link("Papers/attention.pdf#page=3&quote=transduction%20models")[attention, p. 3]]`,
      `  - Placement: which worker runs it#footnote[#link("Papers/attention.pdf#page=3&quote=complex.")[attention, p. 3]]`,
    ].join("\n");
    await openPdf();

    const task = await within(await margin()).findByRole("button", { name: /Task: an operator/ });
    const placement = within(await margin()).getByRole("button", { name: /Placement: which worker/ });

    expect(task).not.toHaveTextContent("Placement");
    expect(placement).not.toHaveTextContent("Task");
    const hint = within(task).getByText("What's the difference?");
    expect(hint).not.toHaveClass("truncate");
    expect(hint.className).not.toMatch(/line-clamp/);
  });

  it("only that paragraph: the rest of the note is the note's own", async () => {
    notes["Papers/attention notes.typ"] = `${SOURCE}\nMy own thoughts.\n\n\`\`\`rust\nfn main() {}\n\`\`\`\n`;
    await openPdf();

    const card = await within(await margin()).findByRole("button", { name: /slow to train/ });

    expect(card).not.toHaveTextContent("My own thoughts");
    expect(card).not.toHaveTextContent("fn main");
  });

  it("a passage a note cites is underlined, not highlighted (only highlights are)", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    const page = await openPdf();

    await vi.waitFor(() => expect(page.querySelectorAll("[data-cited]").length).toBeGreaterThan(0));
    expect(page.querySelector("[data-highlight]")).toBeNull();
  });

  it("a highlighted passage a note cites is both highlighted and underlined", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "a1", type: "highlight", page: 3, quote: "The dominant sequence", colour: "blue" }] });
    const page = await openPdf();

    await vi.waitFor(() => expect(page.querySelector("[data-cited]")).not.toBeNull());
    expect(page.querySelector("[data-highlight]")).toHaveAttribute("data-colour", "blue");
  });

  it("the pieces of a line of text are highlighted as one (no darker overlaps)", async () => {
    // (A PDF's text can come in overlapping pieces, like an italic word's.)
    Range.prototype.getClientRects = () =>
      [
        { left: 10, top: 40, width: 60, height: 14, right: 70, bottom: 54 },
        { left: 65, top: 41, width: 80, height: 14, right: 145, bottom: 55 },
        { left: 140, top: 40, width: 70, height: 14, right: 210, bottom: 54 },
        { left: 10, top: 60, width: 120, height: 14, right: 130, bottom: 74 },
      ] as unknown as DOMRectList;
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "a1", type: "highlight", page: 3, quote: "complex.", colour: "yellow" }] });
    const page = await openPdf();

    await vi.waitFor(() => expect(page.querySelectorAll("[data-highlight]")).toHaveLength(2));
    const [line] = page.querySelectorAll<HTMLElement>("[data-highlight]");
    expect(line.style.left).toBe("10px");
    expect(line.style.width).toBe("200px");
  });

  it("a note about a spot or an area sits level with it", async () => {
    notes["Papers/attention notes.typ"] = `${SOURCE}\nAbout the figure.#footnote[#link("attention.pdf#page=2&area=50,420,300,200")[attention, p. 2]]\n\nHere.#footnote[#link("attention.pdf#page=1&point=10,250")[attention, p. 1]]\n`;
    await openPdf();
    const side = await margin();

    expect(await within(side).findByRole("button", { name: /About the figure/ })).toHaveAttribute("data-mark", "420");
    expect(within(side).getByRole("button", { name: /Here/ })).toHaveAttribute("data-mark", "250");
  });

  describe("hovering a note in it", () => {
    // What it's about lights up on the page, in a colour of its own (not one highlights can have).
    const lit = (page: HTMLElement) => [...page.querySelectorAll<HTMLElement>("[data-pointed]")];

    it("lights up the passage it cites, and goes dark when the mouse leaves", async () => {
      notes["Papers/attention notes.typ"] = SOURCE;
      const page = await openPdf();
      const card = await within(await margin()).findByRole("button", { name: /slow to train/ });

      fireEvent.mouseEnter(card);

      await vi.waitFor(() => expect(lit(page)).toHaveLength(1));
      // (The passage is at 10–210 across, 40–54 down.)
      expect(lit(page)[0].style.left).toBe("10px");
      expect(lit(page)[0].style.top).toBe("40px");
      expect(lit(page)[0].className).toMatch(/orange/);
      expect(lit(page)[0].className).not.toMatch(/yellow|green|sky|pink|violet/);
      // (Lit up, without an outline.)
      expect(lit(page)[0].className).not.toMatch(/\bring-/);

      fireEvent.mouseLeave(card);
      await vi.waitFor(() => expect(lit(page)).toHaveLength(0));
    });

    it("the other way round: hovering the passage lights up the notes citing it, and the passage", async () => {
      notes["Papers/attention notes.typ"] = SOURCE;
      notes["Ideas.typ"] = `Elsewhere: #link("Papers/attention.pdf#page=3&quote=transduction%20models")[attention].`;
      const page = await openPdf();
      const card = await within(await margin()).findByRole("button", { name: /slow to train/ });
      const other = within(await margin()).getByRole("button", { name: /Elsewhere/ });

      // (Both passages are at 10–210 across, 40–54 down, in the test browser.)
      fireEvent.mouseMove(page, { clientX: 50, clientY: 45 });

      await vi.waitFor(() => expect(card).toHaveAttribute("data-pointed", "true"));
      expect(other).toHaveAttribute("data-pointed", "true");
      expect(lit(page).length).toBeGreaterThan(0);

      fireEvent.mouseMove(page, { clientX: 400, clientY: 300 });
      await vi.waitFor(() => expect(card).not.toHaveAttribute("data-pointed"));
      expect(lit(page)).toHaveLength(0);
    });

    it("an area or a spot it's about lights up too", async () => {
      notes["Papers/attention notes.typ"] = `${SOURCE}\nAbout the figure.#footnote[#link("attention.pdf#page=3&area=50,420,300,200")[attention, p. 3]]\n`;
      const page = await openPdf();
      const card = await within(await margin()).findByRole("button", { name: /About the figure/ });

      fireEvent.mouseEnter(card);

      await vi.waitFor(() => expect(lit(page)).toHaveLength(1));
      const scale = Number.parseFloat(lit(page)[0].style.left) / 50;
      expect(Number.parseFloat(lit(page)[0].style.width)).toBeCloseTo(300 * scale);
    });
  });

  it("a note sits level with its page even before the page is drawn", async () => {
    // (Pages far down are only drawn when scrolled to; here, none is.)
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    const offsetTop = vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "img" && this.dataset.page ? (Number(this.dataset.page) - 1) * 1000 : 0;
    });
    try {
      notes["Papers/attention notes.typ"] = SOURCE;
      render(<App />);
      await userEvent.click(await screen.findByRole("button", { name: "Papers" }));
      await userEvent.click(screen.getByRole("button", { name: "attention.pdf" }));

      const card = await within(await margin()).findByRole("button", { name: /slow to train/ });

      await vi.waitFor(() => expect(card.style.top).toBe("2000px"));
    } finally {
      offsetTop.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("a note's name isn't on its card, to keep it short: it shows on hovering the card", async () => {
    const long = "Ray Data A dynamic and scalable system for heterogeneous data processing notes";
    notes[`${long}.typ`] = `Traditional systems? #link("Papers/attention.pdf#page=3&quote=transduction%20models")[attention].`;
    await openPdf();
    const side = await margin();

    const card = await within(side).findByRole("button", { name: /Traditional systems/ });

    expect(card).not.toHaveTextContent(long);
    expect(card).toHaveAttribute("title", long);
  });

  it("the notes keep a little room from the reader's edge", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await openPdf();

    const side = await margin();

    expect(Number.parseFloat(side.style.right)).toBeGreaterThanOrEqual(12);
  });

  it("shows other notes citing the PDF too, with their name, and they can be hidden", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    notes["Ideas.typ"] = `Compare with RNNs: #link("Papers/attention.pdf#page=3&quote=transduction%20models")[attention].`;
    await openPdf();
    const side = await margin();

    const mention = await within(side).findByRole("button", { name: /Compare with RNNs/ });
    expect(mention).toHaveTextContent("Compare with RNNs: attention.");
    expect(mention).toHaveAttribute("title", "Ideas");

    await userEvent.click(screen.getByRole("button", { name: "Show mentions from other notes" }));
    expect(within(side).queryByRole("button", { name: /Compare with RNNs/ })).not.toBeInTheDocument();
  });

  it("clicking one opens its note beside the PDF, the cursor at that paragraph", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await openPdf();

    await userEvent.click(await within(await margin()).findByRole("button", { name: /slow to train/ }));

    expect(await sourceNoteWithCursor()).toContain("\n\n|RNNs are slow to train.");
  });

  it("a new note shows straight away (with the passage, until something's written)", async () => {
    await select(await openPdf(), "The dominant sequence");

    await addNoteOnSelection();

    expect(await within(await margin()).findByRole("button", { name: /dominant sequence/ })).toBeInTheDocument();
  });

  it("there's no margin while no note cites the PDF", async () => {
    await openPdf();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByRole("complementary", { name: "Notes on this PDF" })).not.toBeInTheDocument();
  });
});

// A switch on the PDF's toolbar hides the margin (and shows it again); the marks on the pages stay.
// It's remembered while the app is open, for every PDF.
describe("Hiding the margin", () => {
  const marginSwitch = () => screen.getByRole("button", { name: "Show notes in the margin" });

  it("the toolbar's switch hides the notes in the margin, and shows them again", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await openPdf();
    await within(await margin()).findByRole("button", { name: /slow to train/ });
    expect(marginSwitch()).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(marginSwitch());
    expect(screen.queryByRole("complementary", { name: "Notes on this PDF" })).not.toBeInTheDocument();
    expect(marginSwitch()).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(marginSwitch());
    expect(await within(await margin()).findByRole("button", { name: /slow to train/ })).toBeInTheDocument();
  });

  describe("while it's hidden, hovering a passage a note cites", () => {
    // (As when the reader is beside a note, with no room for the margin: what the notes say is still a hover away.)
    async function withMarginHidden() {
      notes["Papers/attention notes.typ"] = SOURCE;
      const page = await openPdf();
      await within(await margin()).findByRole("button", { name: /slow to train/ });
      await userEvent.click(marginSwitch());
      await vi.waitFor(() => expect(page.querySelector("[data-cited]")).not.toBeNull());
      return page;
    }
    /** Shows the margin again (it's remembered for the PDFs opened next). */
    const showMarginAgain = () => userEvent.click(marginSwitch());

    it("shows the paragraph citing it, and which note it's in", async () => {
      const page = await withMarginHidden();

      // (The passage is at 10–210 across, 40–54 down.)
      fireEvent.mouseMove(page, { clientX: 50, clientY: 45 });

      const preview = await screen.findByRole("tooltip");
      expect(preview).toHaveTextContent("RNNs are slow to train.");
      expect(preview).toHaveTextContent("attention notes");
      await showMarginAgain();
    });

    it("shows as soon as a link's does, even while the mouse keeps moving over the passage", async () => {
      const page = await withMarginHidden();

      // (Moving across the passage for 400ms: it comes in its time from when the mouse got there.)
      for (const x of [20, 60, 100, 140, 180]) {
        fireEvent.mouseMove(page, { clientX: x, clientY: 45 });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(screen.getByRole("tooltip")).toHaveTextContent("RNNs are slow to train.");
      await showMarginAgain();
    });

    it("over a link of the PDF's in it (like a reference's number), the link's own preview shows instead", async () => {
      const opened = vi.mocked(pdf.openPdf).getMockImplementation()!;
      vi.mocked(pdf.openPdf).mockImplementation(async (bytes) => {
        const document = await opened(bytes);
        const link = { x: 30, y: 40, width: 20, height: 14, page: 1, top: 100 };
        return { ...document, page: async (number: number) => ({ ...(await document.page(number)), links: async () => (number === 3 ? [link] : []) }) };
      });
      const page = await withMarginHidden();
      const reference = await within(page).findByRole("link");

      fireEvent.mouseMove(reference, { clientX: 40, clientY: 45 });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

      // (Off the link, still on the passage: the notes, again.)
      fireEvent.mouseMove(page, { clientX: 150, clientY: 45 });
      expect(await screen.findByRole("tooltip")).toHaveTextContent("RNNs are slow to train.");
      await showMarginAgain();
    });

    it("goes soon after the mouse leaves the passage, even while it keeps moving", async () => {
      const page = await withMarginHidden();
      fireEvent.mouseMove(page, { clientX: 50, clientY: 45 });
      await screen.findByRole("tooltip");

      // (Moving about elsewhere on the page for 400ms: it goes in its time from when the mouse left.)
      for (const y of [200, 240, 280, 320, 360]) {
        fireEvent.mouseMove(page, { clientX: 400, clientY: y });
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      await showMarginAgain();
    });

    it("shows the note as it shows it, opened at the citing bullet (marked), to scroll for the rest", async () => {
      notes["Ideas.typ"] = `Before it.\n\n- What's the difference?\n  - Task: an operator over a batch#footnote[#link("Papers/attention.pdf#page=3&quote=The%20dominant%20sequence")[attention, p. 3]]\n  - Placement: which worker runs it\n\nAfter it.`;
      const page = await withMarginHidden();
      fireEvent.mouseMove(page, { clientX: 50, clientY: 45 });

      const preview = await screen.findByRole("tooltip");
      const shown = await within(preview).findByRole("textbox", { name: "Shown from Ideas.typ" });
      // (The whole note, to scroll through.)
      expect(shown).toHaveTextContent("Before it.");
      expect(shown).toHaveTextContent("After it.");
      const marked = [...shown.querySelectorAll(".cm-cited-line")].map((line) => line.textContent);
      expect(marked).toHaveLength(1);
      expect(marked[0]).toContain("Task: an operator over a batch");
      await showMarginAgain();
    });

    it("is scrolled to the citing bullet, far down a long note", async () => {
      const before = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} before it.`).join("\n\n");
      notes["Ideas.typ"] = `${before}\n\n- Task: an operator over a batch#footnote[#link("Papers/attention.pdf#page=3&quote=The%20dominant%20sequence")[attention, p. 3]]`;
      const page = await withMarginHidden();
      // (A box with room to scroll in: the test browser doesn't lay things out.)
      const height = vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(256);
      fireEvent.mouseMove(page, { clientX: 50, clientY: 45 });

      const preview = await screen.findByRole("tooltip");
      const shown = await within(preview).findByRole("textbox", { name: "Shown from Ideas.typ" });
      const box = shown.closest<HTMLElement>(".overflow-y-auto")!;

      await vi.waitFor(() => expect(box.scrollTop).toBeGreaterThan(100));
      height.mockRestore();
      await showMarginAgain();
    });

    it("doesn't show the note's margin (its footnotes and comments): only the note", async () => {
      const page = await withMarginHidden();
      fireEvent.mouseMove(page, { clientX: 50, clientY: 45 });

      const preview = await screen.findByRole("tooltip");
      const shown = await within(preview).findByRole("textbox", { name: "Shown from attention notes.typ" });
      // (Its footnote's number stays in the text; the footnote itself isn't shown beside it.)
      await vi.waitFor(() => expect(shown.querySelector(".cm-sidenote")).not.toBeNull());
      const footnote = shown.querySelector<HTMLElement>(".cm-sidenote")!;
      expect(getComputedStyle(footnote).display).toBe("none");
      await showMarginAgain();
    });

    it("shows the paragraph as the note does: formatted, a list as a list", async () => {
      notes["Ideas.typ"] = `- What's the difference?\n  - Task: an operator over a batch#footnote[#link("Papers/attention.pdf#page=3&quote=The%20dominant%20sequence")[attention, p. 3]]\n  - Placement: which worker runs it`;
      const page = await withMarginHidden();
      fireEvent.mouseMove(page, { clientX: 50, clientY: 45 });

      const preview = await screen.findByRole("tooltip");
      const shown = await within(preview).findByRole("textbox", { name: "Shown from Ideas.typ" });
      expect(shown.querySelectorAll(".cm-list-line")).toHaveLength(3);
      expect(shown).toHaveTextContent("Placement: which worker runs it");
      await showMarginAgain();
    });

    it("clicking the paragraph there opens its note beside the PDF", async () => {
      const page = await withMarginHidden();
      fireEvent.mouseMove(page, { clientX: 50, clientY: 45 });

      await userEvent.click(within(await screen.findByRole("tooltip")).getByRole("button", { name: /slow to train/ }));

      expect(await screen.findByRole("textbox", { name: "attention notes.typ" })).toBeInTheDocument();
      await showMarginAgain();
    });

    it("goes when the mouse moves off the passage", async () => {
      const page = await withMarginHidden();
      fireEvent.mouseMove(page, { clientX: 50, clientY: 45 });
      await screen.findByRole("tooltip");

      fireEvent.mouseMove(page, { clientX: 400, clientY: 300 });

      await vi.waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
      await showMarginAgain();
    });

    it("with the margin shown, there's no pop-up: the margin has it", async () => {
      notes["Papers/attention notes.typ"] = SOURCE;
      const page = await openPdf();
      await within(await margin()).findByRole("button", { name: /slow to train/ });

      fireEvent.mouseMove(page, { clientX: 50, clientY: 45 });
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    });
  });

  it("while it's hidden, the switch for other notes' mentions goes too", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    notes["Ideas.typ"] = `Compare with RNNs: #link("Papers/attention.pdf#page=3&quote=transduction%20models")[attention].`;
    await openPdf();
    await within(await margin()).findByRole("button", { name: /Compare with RNNs/ });

    await userEvent.click(marginSwitch());

    expect(screen.queryByRole("button", { name: "Show mentions from other notes" })).not.toBeInTheDocument();
    await userEvent.click(marginSwitch()); // (Shown again, for the tests after: it's remembered.)
  });

  it("the cited passages stay underlined on the pages", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await openPdf();
    await within(await margin()).findByRole("button", { name: /slow to train/ });
    await vi.waitFor(() => expect(document.querySelectorAll("[data-cited]").length).toBeGreaterThan(0));
    const underlined = document.querySelectorAll("[data-cited]").length;

    await userEvent.click(marginSwitch());

    expect(document.querySelectorAll("[data-cited]").length).toBe(underlined);
    await userEvent.click(marginSwitch()); // (Shown again, for the tests after: it's remembered.)
  });

  it("a PDF opened later has it hidden too", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await openPdf();
    await within(await margin()).findByRole("button", { name: /slow to train/ });
    await userEvent.click(marginSwitch());
    cleanup();

    await openPdf();
    await screen.findByRole("toolbar", { name: "PDF" });

    await vi.waitFor(() => expect(marginSwitch()).toHaveAttribute("aria-pressed", "false"));
    expect(screen.queryByRole("complementary", { name: "Notes on this PDF" })).not.toBeInTheDocument();
    await userEvent.click(marginSwitch()); // (Shown again, for the tests after: it's remembered.)
  });

  it("isn't there when no note cites the PDF", async () => {
    await openPdf();
    await screen.findByRole("toolbar", { name: "PDF" });

    expect(screen.queryByRole("button", { name: "Show notes in the margin" })).not.toBeInTheDocument();
  });
});

describe("The paper's note, from the toolbar", () => {
  // (Its source note: the note whose source property names the PDF.)
  const open = async () => {
    await openPdf();
    await userEvent.click(within(await screen.findByRole("toolbar", { name: "PDF" })).getByRole("button", { name: "Open the paper's note" }));
  };

  it("opens the PDF's source note beside it", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;

    await open();

    expect(await screen.findByRole("textbox", { name: "attention notes.typ" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "PDF" })).toBeInTheDocument();
  });

  it("with none yet, makes it beside the PDF, with the paper's details, and opens it", async () => {
    await open();

    expect(await screen.findByRole("textbox", { name: "attention notes.typ" })).toBeInTheDocument();
    const note = notes["Papers/attention notes.typ"];
    expect(note).toContain("source: attention.pdf");
    expect(note).toContain("title: Attention Is All You Need");
    expect(note).toContain("year: 2017");
    expect(note).not.toContain("#footnote");
  });

  it("a note that only cites the PDF isn't its note: one is still made", async () => {
    notes["Ideas.typ"] = `Compare: #link("Papers/attention.pdf#page=3&quote=transduction%20models")[attention].`;

    await open();

    expect(await screen.findByRole("textbox", { name: "attention notes.typ" })).toBeInTheDocument();
  });

  it("with several, asks which one", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    notes["Papers/attention reading.typ"] = `#metadata((\nsource: attention.pdf\n)) <properties>\n\nMy reading.\n`;
    await open();

    const menu = await screen.findByRole("menu", { name: "The paper's notes" });
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["attention notes", "attention reading"]);
    await userEvent.click(within(menu).getByRole("menuitem", { name: "attention reading" }));

    expect(await screen.findByRole("textbox", { name: "attention reading.typ" })).toBeInTheDocument();
  });
});

describe("Finding the notes citing a PDF", () => {
  it("a link to a part of the PDF is a citation; what it says is the paragraph it's in", () => {
    const found = findCitations("Papers/attention.pdf", [
      { path: "Papers/attention notes.typ", text: `${SOURCE}\n= Later\n\nUnrelated.`, source: true },
    ]);

    expect(found).toEqual([
      expect.objectContaining({ note: "Papers/attention notes.typ", source: true, page: 3, quote: "The dominant sequence", text: "RNNs are slow to train." }),
    ]);
  });

  describe("in a list", () => {
    // Each bullet cites its own part: what it says is that bullet (not the whole list, which
    // would show once for each of them), with the bullet it's in, as a hint of what it's about.
    const cite = (quote: string) => `#footnote[#link("attention.pdf#page=3&quote=${encodeURIComponent(quote)}")[attention, p. 3]]`;
    const LIST = [
      `- What's the difference?${cite("The dominant sequence")}`,
      `  - Task: an operator over a batch${cite("transduction models")}`,
      `    continued on its next line.`,
      `  - Placement: which worker runs it${cite("complex.")}`,
      `    - Even deeper.`,
    ].join("\n");
    // (In the PDF's folder: the citations' addresses are from there.)
    const found = () => findCitations("Papers/attention.pdf", [{ path: "Papers/Ideas.typ", text: LIST, source: false }]);

    it("a bullet's citation says what that bullet says (its lines, not the bullets in it), and the bullet it's in", () => {
      expect(found()).toEqual([
        expect.objectContaining({ quote: "The dominant sequence", text: "What's the difference?" }),
        expect.objectContaining({ quote: "transduction models", text: "Task: an operator over a batch continued on its next line.", context: "What's the difference?" }),
        expect.objectContaining({ quote: "complex.", text: "Placement: which worker runs it", context: "What's the difference?" }),
      ]);
      expect(found()[0].context).toBeUndefined();
    });

    it("it's kept as written, and opens the note at that bullet", () => {
      const task = found()[1];

      expect(task.written).toBe(`  - Task: an operator over a batch${cite("transduction models")}\n    continued on its next line.`);
      expect(task.at).toBe(`before=${encodeURIComponent(`  - Task: an operator over a batch${cite("transduction models")}`)}`);
    });
  });

  it("spots and areas are cited too", () => {
    const found = findCitations("Papers/attention.pdf", [
      { path: "Ideas.typ", text: '#link("Papers/attention.pdf#page=2&point=5,6")[here] and #link("Papers/attention.pdf#page=4&area=1,2,3,4")[there]', source: false },
    ]);

    expect(found).toEqual([
      expect.objectContaining({ page: 2, point: { x: 5, y: 6 } }),
      expect.objectContaining({ page: 4, area: { x: 1, y: 2, width: 3, height: 4 } }),
    ]);
  });

  it("links to a whole page aren't citations of a part", () => {
    expect(findCitations("Papers/attention.pdf", [{ path: "Ideas.typ", text: '#link("Papers/attention.pdf#page=2")[p. 2]', source: false }])).toEqual([]);
  });

  it("works in Markdown notes too", () => {
    const found = findCitations("Papers/attention.pdf", [
      { path: "Ideas.md", text: "See [this](Papers/attention.pdf#page=1&quote=Other%20words) about it.", source: false },
    ]);

    expect(found).toEqual([expect.objectContaining({ page: 1, quote: "Other words", text: "See this about it." })]);
  });
});

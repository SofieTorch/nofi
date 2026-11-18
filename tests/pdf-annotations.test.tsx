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
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { findCitations } from "../src/pdf/annotations";
import * as pdf from "../src/workspace/pdf";
import { file, folder, setUpFakeBackend } from "./support/fake-backend";
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
const margin = () => screen.findByRole("complementary", { name: "Notes on this PDF" });
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
  it("selecting text offers highlighting it in a colour, or adding a note", async () => {
    await select(await openPdf(), "The dominant sequence");

    const actions = await bar();

    for (const colour of ["yellow", "green", "blue", "pink", "purple"]) {
      expect(within(actions).getByRole("button", { name: `Highlight in ${colour}` })).toBeInTheDocument();
    }
    expect(within(actions).getByRole("button", { name: "Add note" })).toBeInTheDocument();
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

describe("Adding a note", () => {
  it("on selected text: the text is highlighted, and the source note gets a footnote citing it, ready to write before", async () => {
    await select(await openPdf(), "The dominant sequence");

    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));

    expect(await sourceNoteWithCursor()).toMatch(/\n\n\|#footnote\[#link\("attention\.pdf#page=3&quote=The%20dominant%20sequence"\)\[attention, p\. 3\]\]\n$/);
    expect(saved()).toEqual([expect.objectContaining({ type: "highlight", page: 3, quote: "The dominant sequence", colour: "yellow" })]);
    expect(screen.getAllByRole("region", { name: "Pane" })).toHaveLength(2);
  });

  it("the first time, the source note is made beside the PDF, with the paper's details", async () => {
    await select(await openPdf(), "The dominant sequence");

    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));

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

    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));

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
    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));

    await into("attention reading.typ");

    const editor = await screen.findByRole("textbox", { name: "attention reading.typ" });
    await vi.waitFor(() => expect(EditorView.findFromDOM(editor)!.state.doc.toString()).toContain("\n\n#footnote[#link(\"attention.pdf#page=3&quote=complex.\")"));
    expect(notes["Papers/attention notes.typ"]).toBe(SOURCE);
    expect(saved()).toEqual([expect.objectContaining({ type: "highlight", quote: "complex." })]);
  });

  it("Enter chooses the first, the PDF's source note", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await select(await openPdf(), "complex.");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));
    await screen.findByRole("dialog", { name: "Add the note to" });

    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(notes["Papers/attention notes.typ"]).toContain("quote=complex."));
    expect(notes["Papers/attention notes.typ"].startsWith(SOURCE)).toBe(true);
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });

  it("any other note can be found by name", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await select(await openPdf(), "complex.");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));

    await userEvent.type(within(await screen.findByRole("dialog", { name: "Add the note to" })).getByRole("textbox", { name: "Find a note" }), "ide");
    await into("Ideas.typ");

    const editor = await screen.findByRole("textbox", { name: "Ideas.typ" });
    // (Its address is from that note's folder.)
    await vi.waitFor(() => expect(EditorView.findFromDOM(editor)!.state.doc.toString()).toContain('#footnote[#link("Papers/attention.pdf#page=3&quote=complex.")[attention, p. 3]]'));
  });

  it("or a new source note made for it", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await select(await openPdf(), "complex.");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));

    await into("New note");

    await vi.waitFor(() => expect(notes["Papers/attention notes 2.typ"]).toContain("quote=complex."));
    expect(notes["Papers/attention notes 2.typ"]).toContain("source: attention.pdf");
  });

  it("Escape adds nothing, not even the highlight", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await select(await openPdf(), "complex.");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));
    await screen.findByRole("dialog", { name: "Add the note to" });

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Add the note to" })).not.toBeInTheDocument();
    expect(notes[ANNOTATIONS]).toBeUndefined();
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

    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));
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
    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));

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

describe("The margin", () => {
  it("shows the paragraph citing a part next to it, without the footnote", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await openPdf();

    const card = await within(await margin()).findByRole("button", { name: /slow to train/ });

    expect(card).toHaveTextContent(/^RNNs are slow to train\.$/);
    expect(card).toHaveAttribute("data-page", "3");
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

  it("shows other notes citing the PDF too, with their name, and they can be hidden", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    notes["Ideas.typ"] = `Compare with RNNs: #link("Papers/attention.pdf#page=3&quote=transduction%20models")[attention].`;
    await openPdf();
    const side = await margin();

    const mention = await within(side).findByRole("button", { name: /Ideas/ });
    expect(mention).toHaveTextContent("Compare with RNNs: attention.");

    await userEvent.click(screen.getByRole("button", { name: "Show mentions from other notes" }));
    expect(within(side).queryByRole("button", { name: /Ideas/ })).not.toBeInTheDocument();
  });

  it("clicking one opens its note beside the PDF, the cursor at that paragraph", async () => {
    notes["Papers/attention notes.typ"] = SOURCE;
    await openPdf();

    await userEvent.click(await within(await margin()).findByRole("button", { name: /slow to train/ }));

    expect(await sourceNoteWithCursor()).toContain("\n\n|RNNs are slow to train.");
  });

  it("a new note shows straight away (with the passage, until something's written)", async () => {
    await select(await openPdf(), "The dominant sequence");

    await userEvent.click(within(await bar()).getByRole("button", { name: "Add note" }));

    expect(await within(await margin()).findByRole("button", { name: /dominant sequence/ })).toBeInTheDocument();
  });

  it("there's no margin while no note cites the PDF", async () => {
    await openPdf();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByRole("complementary", { name: "Notes on this PDF" })).not.toBeInTheDocument();
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

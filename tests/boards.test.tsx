// Boards (whiteboards), like Muse: an endless surface with text, cards, and arrows between them. A
// board is a file of its own (`Name.canvas`, JSON Canvas), opened in a tab like a note. Text written
// on the board is plain text, right on the board (it can be shown as a card instead). A file is
// shown live on a card: a note (or one of its headings or paragraphs, or text from it), a PDF page,
// a passage or an area of a PDF. Many files can share a board.
//
// - Double-click empty space to write; double-click text to edit it. Right-click empty space to add
//   a card there instead, or text to show it as a card (or as plain text again).
// - A click selects; drag to move; drag the corner to resize; × (or ⌫) takes it off the board.
// - Drag the dot at the right to another card or text to draw an arrow; click an arrow and press ⌫
//   to remove it.
// - Double-clicking a file card opens the file there (beside the board); with ⌘ (Ctrl here), in a
//   new pane.
// - Drag notes and PDFs from the explorer onto the board; or, from another pane, text selected in
//   a note, text selected in a PDF, or an area of a PDF page (the PDF reader's "Select an area").
// - Scroll to move around; ⌘-scroll (or pinch) to zoom.
// Creating boards, and their links in the graph, is specified in src-tauri/tests/boards.rs.

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { addArrow, type Board, CARD_TYPE, parseBoard, readPart, removeCard, writeBoard, writePart } from "../src/board/board";
import * as pdf from "../src/workspace/pdf";
import { chooseInMenu, file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");
vi.mock("../src/workspace/pdf");

const PAPER = "= Intro\n\nSome context.\n\n= Methods <methods>\n\nWe did the work.";

let files: Record<string, string>;
const drawn: number[] = [];

const board = (nodes: unknown[], edges: unknown[] = []) => JSON.stringify({ nodes, edges });
const noteCard = { id: "n1", type: "file", file: "Paper.typ", subpath: "#methods", x: 0, y: 0, width: 300, height: 200 };
const textCard = { id: "t1", type: "text", text: "An idea.", x: 400, y: 0, width: 200, height: 100 };
const pdfCard = { id: "p1", type: "file", file: "Papers/attention.pdf", subpath: "#page=2", x: 0, y: 300, width: 300, height: 400 };

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  files = { "Ideas.canvas": board([noteCard, textCard, pdfCard]), "Empty.canvas": "", "Paper.typ": PAPER };
  vi.mocked(api.listFiles).mockImplementation(async () => [
    folder("Papers", [file("Papers/attention.pdf")]),
    ...Object.keys(files).map(file),
  ]);
  vi.mocked(api.readNote).mockImplementation(async (path) => {
    if (!(path in files)) throw "This note doesn't exist anymore.";
    return files[path];
  });
  vi.mocked(api.saveNote).mockImplementation(async (path, text) => void (files[path] = text));
  vi.mocked(api.readWorkspaceFile).mockResolvedValue(new ArrayBuffer(4));
  drawn.length = 0;
  vi.mocked(pdf.openPdf).mockResolvedValue({
    pages: 3,
    close: () => {},
    page: async (number) => ({ width: 600, height: 800, draw: async () => void drawn.push(number), text: async () => {} }),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

const explorer = () => within(screen.getByLabelText("File explorer", { selector: "aside" }));
const explorerLoaded = async () => within(await screen.findByLabelText("File explorer", { selector: "aside" }));
const panes = () => screen.getAllByRole("region", { name: "Pane" });
const surface = () => screen.findByRole("group", { name: "Board" });
const card = (name: string) => screen.findByRole("article", { name });
/** The board's file, as saved last. */
const saved = (path = "Ideas.canvas"): Board => parseBoard(files[path]);
const savedSoon = (check: (board: Board) => void, path = "Ideas.canvas") =>
  vi.waitFor(() => check(saved(path)), { timeout: 3000 });

async function openBoard(name = "Ideas.canvas") {
  render(<App />);
  await userEvent.click(await (await explorerLoaded()).findByText(name));
  return surface();
}

/** Presses on an element, moves by some pixels, and lets go (on another element, maybe). */
function drag(element: Element, by: { x: number; y: number }, onto: Element = element, init: PointerEventInit = {}) {
  fireEvent.pointerDown(element, { button: 0, clientX: 10, clientY: 10, ...init });
  fireEvent.pointerMove(window, { clientX: 10 + by.x, clientY: 10 + by.y });
  fireEvent.pointerUp(onto, { clientX: 10 + by.x, clientY: 10 + by.y });
}
const click = (element: Element, init: PointerEventInit = {}) => drag(element, { x: 0, y: 0 }, element, init);
/** Double-clicks a card (two clicks, then the double-click). */
function openCard(element: Element, init: MouseEventInit = {}) {
  click(element, init);
  click(element, init);
  fireEvent.doubleClick(element, init);
}

describe("A board's file", () => {
  it("is JSON Canvas: cards (nodes) and arrows (edges); an empty file is an empty board", () => {
    expect(parseBoard("")).toEqual({ nodes: [], edges: [] });
    expect(parseBoard(board([textCard])).nodes).toEqual([textCard]);
    expect(writeBoard(parseBoard(board([textCard])))).toBe(`${JSON.stringify({ nodes: [textCard], edges: [] }, null, "\t")}\n`);
  });

  it("keeps what other apps add to it", () => {
    const text = JSON.stringify({ nodes: [{ ...textCard, color: "4" }], edges: [], theirs: true });

    expect(JSON.parse(writeBoard(parseBoard(text)))).toEqual(JSON.parse(text));
  });

  it("a card's part says which page, passage or area of a PDF it shows, or which part of a note", () => {
    expect(readPart("#methods")).toEqual({ anchor: "methods" });
    expect(readPart("#page=3")).toEqual({ page: 3 });
    expect(readPart("#page=3&quote=All%20you%20need")).toEqual({ page: 3, quote: "All you need" });
    expect(readPart("#page=4&area=10,20,300,150")).toEqual({ page: 4, area: { x: 10, y: 20, width: 300, height: 150 } });
    expect(readPart("#quote=We%20did")).toEqual({ quote: "We did" });
    expect(writePart({ page: 3, quote: "All you need" })).toBe("#page=3&quote=All%20you%20need");
  });

  it("an arrow joins the sides of two cards that face each other; a card's arrows go with it", () => {
    const withArrow = addArrow(parseBoard(board([noteCard, textCard])), "n1", "t1");

    expect(withArrow.edges).toEqual([expect.objectContaining({ fromNode: "n1", toNode: "t1", fromSide: "right", toSide: "left" })]);
    expect(addArrow(withArrow, "n1", "t1").edges).toHaveLength(1);
    expect(removeCard(withArrow, "t1").edges).toEqual([]);
  });
});

describe("Opening a board", () => {
  it("File › New Board makes an empty board and opens it", async () => {
    files["Untitled.canvas"] = "";
    render(<App />);
    await (await explorerLoaded()).findByText("Paper.typ");

    await chooseInMenu("File › New Board");

    const empty = await surface();
    expect(api.createBoard).toHaveBeenCalled();
    expect(empty).toHaveTextContent(/double-click to write/i);
    expect(screen.getByRole("tab", { name: "Untitled" })).not.toHaveAttribute("aria-description", "Preview");
  });

  it("boards are in the explorer, and open in a tab", async () => {
    await openBoard();

    expect(screen.getByRole("tab", { name: "Ideas" })).toBeInTheDocument();
  });

  it("shows its cards: text, and files shown live (a note's part, a PDF page)", async () => {
    await openBoard();

    expect(await card("Text")).toHaveTextContent("An idea.");
    const note = await card("Paper.typ › Methods");
    await vi.waitFor(() => expect(note).toHaveTextContent("We did the work."));
    expect(note).not.toHaveTextContent("Some context.");
    expect(await card("attention.pdf › page 2")).toBeInTheDocument();
    await vi.waitFor(() => expect(drawn).toContain(2));
  });

  it("a passage of a PDF is shown as plain text, with its lines", async () => {
    files["Ideas.canvas"] = board([{ ...pdfCard, subpath: "#page=3&quote=1.%20Choose%20a%20prime%20p.%0A2.%20Publish%20p." }]);
    await openBoard();

    const passage = await card("attention.pdf › passage on page 3");

    expect(passage.querySelector("blockquote")).toBeNull();
    expect(within(passage).getByText(/1\. Choose a prime p\.\s+2\. Publish p\./)).toHaveStyle({ whiteSpace: "pre-line" });
  });

  it("a card for a passage of a PDF shows the passage, and an area shows that part of the page", async () => {
    files["Ideas.canvas"] = board([
      { ...pdfCard, id: "q", subpath: "#page=3&quote=All%20you%20need" },
      { ...pdfCard, id: "a", subpath: "#page=1&area=0,0,300,200", x: 400 },
    ]);
    await openBoard();

    expect(await card("attention.pdf › passage on page 3")).toHaveTextContent("All you need");
    expect(await card("attention.pdf › area of page 1")).toBeInTheDocument();
    await vi.waitFor(() => expect(drawn).toContain(1));
  });

  it("a card for text from a note shows that text", async () => {
    files["Ideas.canvas"] = board([{ ...noteCard, subpath: "#quote=the%20work" }]);
    await openBoard();

    expect(await card("Paper.typ › “the work”")).toHaveTextContent("the work");
  });

  it("a card for a file that isn't there anymore says so", async () => {
    files["Ideas.canvas"] = board([{ ...noteCard, file: "Gone.typ", subpath: undefined }]);
    await openBoard();

    expect(await card("Gone.typ")).toHaveTextContent("Gone.typ isn't in the workspace anymore.");
  });

  it("explains when the board's file can't be read", async () => {
    files["Ideas.canvas"] = "{ broken";
    render(<App />);
    await userEvent.click(await (await explorerLoaded()).findByText("Ideas.canvas"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open the board");
  });
});

describe("Text and cards", () => {
  it("double-clicking empty space writes text there", async () => {
    const space = await openBoard("Empty.canvas");

    fireEvent.doubleClick(space, { clientX: 120, clientY: 80 });
    const editor = await within(await card("Text")).findByRole("textbox");
    await vi.waitFor(() => expect(editor).toHaveFocus());
    await userEvent.keyboard("A thought");

    await savedSoon((b) => expect(b.nodes).toEqual([expect.objectContaining({ type: "text", text: "A thought", x: 120, y: 80 })]), "Empty.canvas");
  });

  it("text is plain text on the board, not in a card", async () => {
    await openBoard();

    expect(await card("Text")).toHaveAttribute("data-look", "text");
    expect(await card("Paper.typ › Methods")).toHaveAttribute("data-look", "card");
  });

  it("right-clicking text can show it as a card, and back", async () => {
    await openBoard();

    fireEvent.contextMenu(await card("Text"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Show as card" }));

    expect(await card("Text card")).toHaveAttribute("data-look", "card");
    await savedSoon((b) => expect(b.nodes.find((n) => n.id === "t1")).toMatchObject({ card: true }));
    fireEvent.contextMenu(await card("Text card"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Show as plain text" }));
    await savedSoon((b) => expect(b.nodes.find((n) => n.id === "t1")).not.toHaveProperty("card"));
  });

  it("right-clicking empty space adds a card there, to write in", async () => {
    const space = await openBoard("Empty.canvas");

    fireEvent.contextMenu(space, { clientX: 50, clientY: 60 });
    await userEvent.click(await screen.findByRole("menuitem", { name: "Add a card here" }));
    await within(await card("Text card")).findByRole("textbox");
    await userEvent.keyboard("Boxed");

    await savedSoon((b) => expect(b.nodes).toEqual([expect.objectContaining({ text: "Boxed", card: true, x: 50, y: 60 })]), "Empty.canvas");
  });

  it("text left empty goes away", async () => {
    const space = await openBoard("Empty.canvas");
    fireEvent.doubleClick(space, { clientX: 120, clientY: 80 });
    await card("Text");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("article", { name: "Text" })).not.toBeInTheDocument();
  });

  it("dragging a card moves it", async () => {
    await openBoard();

    drag(await card("Text"), { x: 100, y: 50 });

    await savedSoon((b) => expect(b.nodes.find((n) => n.id === "t1")).toMatchObject({ x: 500, y: 50 }));
  });

  it("dragging a card's corner resizes it", async () => {
    await openBoard();
    const note = await card("Paper.typ › Methods");

    drag(within(note).getByRole("button", { name: "Resize" }), { x: 40, y: 30 });

    await savedSoon((b) => expect(b.nodes.find((n) => n.id === "n1")).toMatchObject({ width: 340, height: 230 }));
  });

  it("plain text only gets wider or narrower: its height follows its text", async () => {
    await openBoard();
    const text = await card("Text");

    drag(within(text).getByRole("button", { name: "Resize" }), { x: 40, y: 30 });

    await savedSoon((b) => expect(b.nodes.find((n) => n.id === "t1")).toMatchObject({ width: 240, height: 100 }));
  });

  it("× takes a card off the board, with its arrows", async () => {
    files["Ideas.canvas"] = board([noteCard, textCard], [{ id: "e", fromNode: "n1", toNode: "t1" }]);
    await openBoard();

    await userEvent.click(within(await card("Text")).getByRole("button", { name: "Remove from board" }));

    await savedSoon((b) => {
      expect(b.nodes.map((n) => n.id)).toEqual(["n1"]);
      expect(b.edges).toEqual([]);
    });
    expect(files["Paper.typ"]).toBe(PAPER);
  });

  it("⌫ takes the card just moved off the board", async () => {
    await openBoard();
    drag(await card("Text"), { x: 5, y: 5 });

    fireEvent.keyDown(await surface(), { key: "Backspace" });

    await savedSoon((b) => expect(b.nodes.map((n) => n.id)).toEqual(["n1", "p1"]));
  });
});

describe("Arrows", () => {
  it("dragging a card's dot to another card draws an arrow", async () => {
    await openBoard();
    const note = await card("Paper.typ › Methods");

    drag(within(note).getByRole("button", { name: "Draw an arrow" }), { x: 300, y: 0 }, await card("Text"));

    await savedSoon((b) => expect(b.edges).toEqual([expect.objectContaining({ fromNode: "n1", toNode: "t1" })]));
    expect(screen.getAllByRole("img", { name: /^Arrow from/ })).toHaveLength(1);
  });

  it("an arrow can be clicked and removed with ⌫", async () => {
    files["Ideas.canvas"] = board([noteCard, textCard], [{ id: "e", fromNode: "n1", toNode: "t1" }]);
    const space = await openBoard();

    fireEvent.pointerDown(await screen.findByRole("img", { name: "Arrow from Paper.typ › Methods to Text" }), { button: 0 });
    fireEvent.keyDown(space, { key: "Backspace" });

    await savedSoon((b) => expect(b.edges).toEqual([]));
  });
});

describe("Opening what's on a card", () => {
  it("double-clicking a file card opens it beside the board, at its part", async () => {
    await openBoard();

    openCard(await card("Paper.typ › Methods"));

    const editor = await screen.findByRole("textbox", { name: "Paper.typ" });
    expect(panes()).toHaveLength(2);
    const view = EditorView.findFromDOM(editor)!;
    await vi.waitFor(() => expect(view.state.selection.main.head).toBe(PAPER.indexOf("= Methods")));
  });

  it("the next one opens in that same pane beside the board", async () => {
    await openBoard();
    openCard(await card("Paper.typ › Methods"));
    await screen.findByRole("textbox", { name: "Paper.typ" });

    openCard(await card("attention.pdf › page 2"));

    expect(await screen.findByRole("toolbar", { name: "PDF" })).toBeInTheDocument();
    expect(panes()).toHaveLength(2);
  });

  it("with ⌘, in a new pane", async () => {
    await openBoard();
    openCard(await card("Paper.typ › Methods"));
    await screen.findByRole("textbox", { name: "Paper.typ" });

    openCard(await card("attention.pdf › page 2"), { ctrlKey: true });

    expect(await screen.findByRole("toolbar", { name: "PDF" })).toBeInTheDocument();
    expect(panes()).toHaveLength(3);
  });

  it("text from a note opens the note with that text selected", async () => {
    files["Ideas.canvas"] = board([{ ...noteCard, subpath: "#quote=the%20work" }]);
    await openBoard();

    openCard(await card("Paper.typ › “the work”"));

    const view = EditorView.findFromDOM(await screen.findByRole("textbox", { name: "Paper.typ" }))!;
    await vi.waitFor(() => expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("the work"));
  });

  it("a click only selects a card", async () => {
    await openBoard();
    const note = await card("Paper.typ › Methods");

    click(note);

    expect(note).toHaveAttribute("data-selected", "true");
    expect(panes()).toHaveLength(1);
  });

  it("double-clicking text edits it, and opens nothing", async () => {
    await openBoard();

    openCard(await card("Text"));

    expect(await within(await card("Text")).findByRole("textbox")).toBeInTheDocument();
    expect(panes()).toHaveLength(1);
  });
});

describe("Putting things on a board", () => {
  /** Drops something on the board at a spot, as dragged from another pane. */
  function dropOn(space: HTMLElement, data: Record<string, string>, at = { clientX: 500, clientY: 400 }) {
    const dataTransfer = { types: Object.keys(data), getData: (type: string) => data[type] ?? "", dropEffect: "copy" };
    fireEvent.dragOver(space, { dataTransfer, ...at });
    fireEvent.drop(space, { dataTransfer, ...at });
  }

  it("a note dragged from the explorer becomes a card where it's dropped", async () => {
    const space = await openBoard("Empty.canvas");

    fireEvent.dragStart(explorer().getByText("Paper.typ"));
    dropOn(space, { "text/plain": "Paper.typ" });

    await savedSoon((b) => expect(b.nodes).toEqual([expect.objectContaining({ type: "file", file: "Paper.typ", x: 500, y: 400 })]), "Empty.canvas");
    expect(panes()).toHaveLength(1);
  });

  it("a PDF from the explorer too, showing its first page", async () => {
    const space = await openBoard("Empty.canvas");
    await userEvent.click(explorer().getByText("Papers"));

    fireEvent.dragStart(explorer().getByText("attention.pdf"));
    dropOn(space, { "text/plain": "Papers/attention.pdf" });

    await savedSoon((b) => expect(b.nodes).toEqual([expect.objectContaining({ file: "Papers/attention.pdf", subpath: "#page=1" })]), "Empty.canvas");
  });

  it("what's dragged from a note or a PDF (a passage, an area) becomes a card for it", async () => {
    const space = await openBoard("Empty.canvas");

    dropOn(space, { [CARD_TYPE]: JSON.stringify({ file: "Papers/attention.pdf", subpath: "#page=4&area=10,20,300,150" }) });

    await savedSoon(
      (b) => expect(b.nodes).toEqual([expect.objectContaining({ file: "Papers/attention.pdf", subpath: "#page=4&area=10,20,300,150", width: 300, height: 150 })]),
      "Empty.canvas",
    );
  });

  it("plain text dropped on it becomes a text card", async () => {
    const space = await openBoard("Empty.canvas");

    dropOn(space, { "text/plain": "Some words" });

    await savedSoon((b) => expect(b.nodes).toEqual([expect.objectContaining({ type: "text", text: "Some words" })]), "Empty.canvas");
  });
});

describe("Dragging from a note or a PDF", () => {
  /** Starts dragging an element, and returns what the drag carries. */
  function startDrag(element: Element) {
    const data: Record<string, string> = {};
    fireEvent.dragStart(element, { dataTransfer: { setData: (type: string, value: string) => (data[type] = value), effectAllowed: "" } });
    return data;
  }

  it("text selected in a note carries the note and the text", async () => {
    render(<App />);
    await userEvent.click(await (await explorerLoaded()).findByText("Paper.typ"));
    const view = EditorView.findFromDOM(await screen.findByRole("textbox", { name: "Paper.typ" }))!;
    const at = PAPER.indexOf("the work");
    act(() => view.dispatch({ selection: { anchor: at, head: at + "the work".length } }));

    const data = startDrag(view.contentDOM);

    expect(JSON.parse(data[CARD_TYPE])).toEqual({ file: "Paper.typ", subpath: "#quote=the%20work" });
  });

  it("text selected in a PDF carries its page and the text", async () => {
    render(<App />);
    await userEvent.click(await (await explorerLoaded()).findByText("Papers"));
    await userEvent.click(explorer().getByText("attention.pdf"));
    const page = await screen.findByRole("img", { name: "Page 2" });
    const words = document.createElement("span");
    words.textContent = "Attention is all you need";
    page.querySelector(".textLayer")!.append(words);
    window.getSelection()!.selectAllChildren(words);

    const data = startDrag(words);

    expect(JSON.parse(data[CARD_TYPE])).toEqual({ file: "Papers/attention.pdf", subpath: "#page=2&quote=Attention%20is%20all%20you%20need" });
  });

  it("the passage keeps its lines (a list stays a list)", async () => {
    render(<App />);
    await userEvent.click(await (await explorerLoaded()).findByText("Papers"));
    await userEvent.click(explorer().getByText("attention.pdf"));
    const page = await screen.findByRole("img", { name: "Page 2" });
    const words = document.createElement("span");
    words.textContent = "1. Choose a   prime\n\n2. Publish it";
    page.querySelector(".textLayer")!.append(words);
    window.getSelection()!.selectAllChildren(words);

    const data = startDrag(words);

    expect(JSON.parse(data[CARD_TYPE]).subpath).toBe("#page=2&quote=1.%20Choose%20a%20prime%0A2.%20Publish%20it");
  });

  it("an area of a PDF page is chosen with “Select an area”, and dragged", async () => {
    render(<App />);
    await userEvent.click(await (await explorerLoaded()).findByText("Papers"));
    await userEvent.click(explorer().getByText("attention.pdf"));
    const toolbar = await screen.findByRole("toolbar", { name: "PDF" });
    const page = await screen.findByRole("img", { name: "Page 1" });
    await within(toolbar).findByText("/ 3");
    vi.spyOn(page, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 600, height: 800 } as DOMRect);

    await userEvent.click(within(toolbar).getByRole("button", { name: "Select an area" }));
    fireEvent.pointerDown(page, { button: 0, clientX: 60, clientY: 80 });
    fireEvent.pointerMove(window, { clientX: 360, clientY: 230 });
    fireEvent.pointerUp(window, { clientX: 360, clientY: 230 });
    const area = await screen.findByRole("button", { name: "Selected area: drag it to a board" });

    const data = startDrag(area);

    // (The page is shown at its size at 100% here.)
    expect(JSON.parse(data[CARD_TYPE])).toEqual({ file: "Papers/attention.pdf", subpath: "#page=1&area=60,80,300,150" });
  });
});

describe("Moving around", () => {
  it("⌘-scroll zooms in and out", async () => {
    const space = await openBoard();

    fireEvent.wheel(space, { deltaY: -100, ctrlKey: true, clientX: 0, clientY: 0 });

    expect(within(space).getByRole("button", { name: "Zoom to fit" })).toHaveTextContent(/^1\d\d%$/);
  });

  it("scrolling moves around the board", async () => {
    const space = await openBoard();
    const layer = space.querySelector<HTMLElement>(".board-layer")!;

    fireEvent.wheel(space, { deltaX: 30, deltaY: 40 });

    expect(layer.style.transform).toBe("translate(-30px, -40px) scale(1)");
  });
});

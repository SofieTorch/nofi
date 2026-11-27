import { EditorView } from "@codemirror/view";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const researchNotes: api.Workspace = { name: "Research Notes", path: "/Users/me/Research Notes" };

let notes: Record<string, string>;

/** An A4 page, as the backend draws it. */
const a4 = (label = "page"): api.PagePicture => ({
  svg: `<svg xmlns="http://www.w3.org/2000/svg"><title>${label}</title></svg>`,
  width: 595,
  height: 842,
});

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue(researchNotes);
  notes = { "Paper.typ": "= Attention\nA study.", "Todo.md": "# Todo" };
  vi.mocked(api.listFiles).mockResolvedValue([file("Paper.typ"), file("Todo.md")]);
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  vi.mocked(api.renderPages).mockResolvedValue([a4()]);
});

async function openNote(name: string) {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name });
}

/** Right-clicks a tab, and returns its menu. */
async function tabMenu(name: string) {
  fireEvent.contextMenu(screen.getByRole("tab", { name }), { clientX: 120, clientY: 40 });
  return screen.findByRole("menu", { name });
}
/** Shows (or hides) the pages from the note's tab's right-click menu. */
async function togglePagesFromTab(name = "Paper") {
  const menu = await tabMenu(name);
  await userEvent.click(within(menu).getByRole("menuitem", { name: /^(Show|Hide) Pages$/ }));
}
const pageView = () => screen.queryByRole("region", { name: "Pages" });
const findPages = () => within(screen.getByRole("region", { name: "Pages" })).findAllByRole("img");

describe("The page view", () => {
  it("is hidden at first: the note is only shown in the editor", async () => {
    await openNote("Paper.typ");

    expect(pageView()).not.toBeInTheDocument();
  });

  it("right-clicking a Typst note's tab offers Show Pages: the note is shown as pages next to the editor", async () => {
    const editor = await openNote("Paper.typ");

    await userEvent.click(within(await tabMenu("Paper")).getByRole("menuitem", { name: "Show Pages" }));

    expect(await findPages()).toHaveLength(1);
    expect(api.renderPages).toHaveBeenCalledWith("= Attention\nA study.", expect.any(String));
    expect(editor).toBeInTheDocument();
  });

  it("while they're shown, the tab's menu offers Hide Pages", async () => {
    await openNote("Paper.typ");
    await togglePagesFromTab();
    await findPages();

    await userEvent.click(within(await tabMenu("Paper")).getByRole("menuitem", { name: "Hide Pages" }));

    expect(pageView()).not.toBeInTheDocument();
  });

  it("a Markdown note's tab doesn't offer pages", async () => {
    await openNote("Todo.md");

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Todo" }), { clientX: 120, clientY: 40 });

    expect(within(await screen.findByRole("menu")).queryByRole("menuitem", { name: "Show Pages" })).not.toBeInTheDocument();
  });

  it("the command palette shows and hides them too", async () => {
    await openNote("Paper.typ");

    await chooseInMenu("View › Command Palette…");
    await userEvent.keyboard("Show Pages{Enter}");

    expect(await findPages()).toHaveLength(1);
  });

  it("View › Show Pages shows and hides them too", async () => {
    await openNote("Paper.typ");

    await chooseInMenu("View › Show Pages");
    expect(await findPages()).toHaveLength(1);

    await chooseInMenu("View › Show Pages");
    expect(pageView()).not.toBeInTheDocument();
  });

  it("shows every page of the note, in order", async () => {
    vi.mocked(api.renderPages).mockResolvedValue([a4(), a4(), a4()]);
    await openNote("Paper.typ");

    await togglePagesFromTab();

    const pages = await findPages();
    expect(pages.map((page) => page.getAttribute("alt"))).toEqual(["Page 1", "Page 2", "Page 3"]);
  });

  it("is remembered for the workspace", async () => {
    await openNote("Paper.typ");

    await togglePagesFromTab();

    expect(api.saveShowPages).toHaveBeenCalledWith(true);
  });

  it("is shown straight away when it was left on last time", async () => {
    vi.mocked(api.getShowPages).mockResolvedValue(true);

    await openNote("Paper.typ");

    expect(await findPages()).toHaveLength(1);
  });

  it("stays empty until a note is open", async () => {
    vi.mocked(api.getShowPages).mockResolvedValue(true);
    render(<App />);
    await screen.findByRole("heading", { name: "Research Notes", hidden: true });

    expect(pageView()).not.toBeInTheDocument();
    expect(api.renderPages).not.toHaveBeenCalled();
  });

  it("updates the pages as you type", async () => {
    vi.mocked(api.getShowPages).mockResolvedValue(true);
    const editor = await openNote("Paper.typ");
    await findPages();

    await userEvent.click(editor);
    await userEvent.keyboard("New ");

    await vi.waitFor(() =>
      expect(api.renderPages).toHaveBeenLastCalledWith(expect.stringContaining("New "), expect.any(String)),
    );
  });

  it("clicking on a page puts the cursor at that spot in the text", async () => {
    vi.mocked(api.getShowPages).mockResolvedValue(true);
    vi.mocked(api.pagePosition).mockResolvedValue(14);
    const editor = await openNote("Paper.typ");
    const [page] = await findPages();
    // The page is drawn at 595 × 842 pixels here, so pixels and points are the same.
    page.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 595, height: 842, right: 595, bottom: 842 }) as DOMRect;

    fireEvent.click(page, { clientX: 100, clientY: 80 });

    expect(api.pagePosition).toHaveBeenCalledWith(0, expect.closeTo(100), expect.closeTo(80));
    await vi.waitFor(() => expect(EditorView.findFromDOM(editor)!.state.selection.main.head).toBe(14));
    expect(editor).toHaveFocus();
  });

  it("when the note has a mistake, keeps the last pages and says what's wrong", async () => {
    vi.mocked(api.getShowPages).mockResolvedValue(true);
    const editor = await openNote("Paper.typ");
    await findPages();
    vi.mocked(api.renderPages).mockRejectedValue("Line 1: Unknown variable: alpah.");

    await userEvent.click(editor);
    await userEvent.keyboard("$alpah$");

    const pages = screen.getByRole("region", { name: "Pages" });
    expect(await within(pages).findByRole("alert")).toHaveTextContent(
      "Line 1: Unknown variable: alpah.",
    );
    expect(within(pages).getAllByRole("img")).toHaveLength(1);
  });

  it("Markdown notes have no pages", async () => {
    vi.mocked(api.getShowPages).mockResolvedValue(true);

    await openNote("Todo.md");

    expect(pageView()).toHaveTextContent("Pages are only for Typst notes.");
    expect(api.renderPages).not.toHaveBeenCalled();
  });
});

// Exporting a Typst note as a PDF: the same pages as the page view, saved where you choose.
describe("Exporting a PDF", () => {
  const exported = "/Users/me/Exports/Paper.pdf";

  it("File › Export as PDF… asks where to save it, starting beside the note with its name", async () => {
    await openNote("Paper.typ");

    await chooseInMenu("File › Export as PDF…");

    await vi.waitFor(() => expect(api.pickPdfDestination).toHaveBeenCalledWith("/Users/me/Research Notes/Paper.pdf"));
  });

  it("saves the note's pages there as a PDF, and says so", async () => {
    vi.mocked(api.pickPdfDestination).mockResolvedValue(exported);
    await openNote("Paper.typ");

    await chooseInMenu("File › Export as PDF…");

    await vi.waitFor(() => expect(api.exportPdf).toHaveBeenCalledWith("= Attention\nA study.", "Paper.typ", exported));
    expect(await screen.findByRole("status")).toHaveTextContent("Exported “Paper.pdf”.");
  });

  it("a note in a folder starts in that folder", async () => {
    notes["Papers/Attention.typ"] = "= Attention";
    vi.mocked(api.listFiles).mockResolvedValue([folder("Papers", [file("Papers/Attention.typ")])]);
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Papers" }));
    await userEvent.click(await screen.findByRole("button", { name: "Attention.typ" }));
    await screen.findByRole("textbox", { name: "Attention.typ" });

    await chooseInMenu("File › Export as PDF…");

    await vi.waitFor(() =>
      expect(api.pickPdfDestination).toHaveBeenCalledWith("/Users/me/Research Notes/Papers/Attention.pdf"),
    );
  });

  it("exports what's typed, even before it's saved", async () => {
    vi.mocked(api.pickPdfDestination).mockResolvedValue(exported);
    vi.mocked(api.saveNote).mockImplementation(async (path, text) => {
      notes[path] = text;
    });
    const editor = await openNote("Paper.typ");
    await userEvent.click(editor);
    await userEvent.keyboard("New ");

    await chooseInMenu("File › Export as PDF…");

    await vi.waitFor(() => expect(api.exportPdf).toHaveBeenCalledWith(expect.stringContaining("New "), "Paper.typ", exported));
  });

  it("cancelling the Save dialog exports nothing", async () => {
    await openNote("Paper.typ");

    await chooseInMenu("File › Export as PDF…");

    await vi.waitFor(() => expect(api.pickPdfDestination).toHaveBeenCalled());
    expect(api.exportPdf).not.toHaveBeenCalled();
  });

  it("a note with a mistake isn't exported: the mistake is explained", async () => {
    vi.mocked(api.pickPdfDestination).mockResolvedValue(exported);
    vi.mocked(api.exportPdf).mockRejectedValue("Line 2: Unknown variable: unknown.");
    await openNote("Paper.typ");

    await chooseInMenu("File › Export as PDF…");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't export “Paper.typ”: Line 2: Unknown variable: unknown.",
    );
  });

  it("Markdown notes can't be exported: it says so", async () => {
    await openNote("Todo.md");

    await chooseInMenu("File › Export as PDF…");

    expect(await screen.findByRole("alert")).toHaveTextContent("Only Typst notes can be exported as PDFs.");
    expect(api.pickPdfDestination).not.toHaveBeenCalled();
  });

  it("with no note open, it says to open one", async () => {
    render(<App />);
    await screen.findByRole("button", { name: "Paper.typ" });

    await chooseInMenu("File › Export as PDF…");

    expect(await screen.findByRole("alert")).toHaveTextContent("Open a Typst note to export it as a PDF.");
  });

  it("the page view's Export as PDF button does the same", async () => {
    vi.mocked(api.pickPdfDestination).mockResolvedValue(exported);
    await openNote("Paper.typ");
    await togglePagesFromTab();

    await userEvent.click(await screen.findByRole("button", { name: "Export as PDF" }));

    await vi.waitFor(() => expect(api.exportPdf).toHaveBeenCalledWith("= Attention\nA study.", "Paper.typ", exported));
  });

  it("is in the command palette too", async () => {
    vi.mocked(api.pickPdfDestination).mockResolvedValue(exported);
    await openNote("Paper.typ");

    await chooseInMenu("View › Command Palette…");
    await userEvent.keyboard("Export as PDF{Enter}");

    await vi.waitFor(() => expect(api.exportPdf).toHaveBeenCalledWith("= Attention\nA study.", "Paper.typ", exported));
  });
});

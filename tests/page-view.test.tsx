import { EditorView } from "@codemirror/view";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

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

const showPagesButton = () => screen.getByRole("button", { name: "Show pages" });
const pageView = () => screen.queryByRole("region", { name: "Pages" });
const findPages = () => within(screen.getByRole("region", { name: "Pages" })).findAllByRole("img");

describe("The page view", () => {
  it("is hidden at first: the note is only shown in the editor", async () => {
    await openNote("Paper.typ");

    expect(pageView()).not.toBeInTheDocument();
    expect(showPagesButton()).toHaveAttribute("aria-pressed", "false");
  });

  it("the top bar's 'Show pages' button shows the note as pages next to the editor", async () => {
    const editor = await openNote("Paper.typ");

    await userEvent.click(showPagesButton());

    expect(await findPages()).toHaveLength(1);
    expect(api.renderPages).toHaveBeenCalledWith("= Attention\nA study.", expect.any(String));
    expect(editor).toBeInTheDocument();
    expect(showPagesButton()).toHaveAttribute("aria-pressed", "true");
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

    await userEvent.click(showPagesButton());

    const pages = await findPages();
    expect(pages.map((page) => page.getAttribute("alt"))).toEqual(["Page 1", "Page 2", "Page 3"]);
  });

  it("is remembered for the workspace", async () => {
    await openNote("Paper.typ");

    await userEvent.click(showPagesButton());

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
    await screen.findByRole("heading", { name: "Research Notes" });

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

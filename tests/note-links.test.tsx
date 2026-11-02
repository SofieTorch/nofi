// Links between notes, like Obsidian's: typing [[ opens a list of the workspace's notes right at
// the cursor; choosing one writes a link to it, showing its name (in Typst `#link("Ideas.md")[Ideas]`,
// in Markdown `[Ideas](Ideas.md)`), with the path relative to the note it's in. No need to choose:
// [[ is a shortcut, so leaving what's typed after it (clicking elsewhere, moving away, leaving the
// note) makes the link too, to the note with that name, or to a new one. Clicking a link opens its
// note, creating it if needed.
// (The link's text and address can be changed with the toolbar's link editor, as any link.)

import { undo } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");
vi.mock("../src/workspace/pdf");

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": "", "Ideas.md": "", "Reading list.typ": "", "Papers/Attention.typ": "", "Papers/attention.pdf": "" };
  const listing = () => [
    folder(
      "Papers",
      Object.keys(notes)
        .filter((path) => path.startsWith("Papers/"))
        .map(file),
    ),
    ...Object.keys(notes)
      .filter((path) => !path.includes("/"))
      .map(file),
  ];
  vi.mocked(api.listFiles).mockImplementation(async () => listing());
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  vi.mocked(api.createNoteAt).mockImplementation(async (path) => {
    notes[path] = "";
    return path;
  });
});

async function openNote(path = "Paper.typ") {
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
// (In userEvent.keyboard, "[[" types one "[": "[[[[" types "[[".)
const offered = async () =>
  within(await screen.findByRole("listbox"))
    .getAllByRole("option")
    .map((option) => option.querySelector(".cm-completionLabel")?.textContent);
/** Right after the list opens, Enter is ignored for a moment so fast typing never picks by accident. */
const listReady = async () => {
  await screen.findByRole("listbox");
  await new Promise((resolve) => setTimeout(resolve, 100));
};

describe("Typing [[", () => {
  it("lists the workspace's files right at the cursor, notes first", async () => {
    await openNote();

    await userEvent.keyboard("[[[[");

    expect(await offered()).toEqual(["Attention.typ", "Ideas.md", "Paper.typ", "Reading list.typ", "attention.pdf"]);
  });

  it("typing after it narrows the list", async () => {
    await openNote();

    await userEvent.keyboard("[[[[rdl");

    expect(await offered()).toEqual(["Reading list.typ", "New note “rdl”"]);
  });

  it("choosing a note writes a link to it, showing its name", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[idea");
    await listReady();
    await userEvent.keyboard("{Enter}");

    expect(text(view)).toBe('#link("Ideas.md")[Ideas]');
  });

  it("the cursor goes after the link, to keep writing", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[idea");
    await listReady();
    await userEvent.keyboard("{Enter}");

    expect(view.state.selection.main.head).toBe(text(view).length);
  });

  it("the link shows the file's name with spaces for its underscores", async () => {
    notes["reading_list_2024.typ"] = "";
    const { view } = await openNote();

    await userEvent.keyboard("[[[[reading_list");
    await listReady();
    await userEvent.keyboard("{Enter}");

    expect(text(view)).toBe('#link("reading_list_2024.typ")[reading list 2024]');
  });

  it("in Markdown too", async () => {
    notes["reading_list.md"] = "";
    const { view } = await openNote("Ideas.md");

    await userEvent.keyboard("[[[[reading_list");
    await listReady();
    await userEvent.keyboard("{Enter}");

    expect(text(view)).toBe("[reading list](reading_list.md)");
  });

  it("from a note in a folder, the link's path starts from that folder", async () => {
    const { view } = await openNote("Papers/Attention.typ");

    await userEvent.keyboard("[[[[idea");
    await listReady();
    await userEvent.keyboard("{Enter}");

    expect(text(view)).toBe('#link("../Ideas.md")[Ideas]');
  });

  it("in Markdown, it's a Markdown link, with spaces written as %20", async () => {
    const { view } = await openNote("Ideas.md");

    await userEvent.keyboard("[[[[reading");
    await listReady();
    await userEvent.keyboard("{Enter}");

    expect(text(view)).toBe("[Reading list](Reading%20list.typ)");
  });

  it("a name no note has makes a link to a new note, in the format of this one", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[Methods");
    await listReady();
    await userEvent.click(screen.getByRole("option", { name: /New note/ }));

    expect(text(view)).toBe('#link("Methods.typ")[Methods]');
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });

  it("every file is listed, like PDFs, after the notes", async () => {
    await openNote();

    await userEvent.keyboard("[[[[att");

    expect((await offered()).slice(0, 2)).toEqual(["Attention.typ", "attention.pdf"]);
  });

  it("choosing a PDF links to it", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[attention.p");
    await listReady();
    await userEvent.keyboard("{Enter}");

    expect(text(view)).toBe('#link("Papers/attention.pdf")[attention]');
  });

  it("Escape keeps what was typed as it is", async () => {
    const { view } = await openNote("Ideas.md");

    await userEvent.keyboard("[[[[idea");
    await listReady();
    await userEvent.keyboard("{Escape}");

    expect(text(view)).toBe("[[idea");
  });
});

describe("Leaving [[ without choosing", () => {
  it("clicking elsewhere makes a link to a new note with the name typed", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[this is a test");
    act(() => view.dispatch({ selection: { anchor: 0 } }));

    await vi.waitFor(() => expect(text(view)).toBe('#link("this is a test.typ")[this is a test]'));
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });

  it("a name a note has links to that note", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[reading list");
    act(() => view.dispatch({ selection: { anchor: 0 } }));

    await vi.waitFor(() => expect(text(view)).toBe('#link("Reading list.typ")[Reading list]'));
  });

  it("leaving the note does it too", async () => {
    const { view } = await openNote("Ideas.md");

    await userEvent.keyboard("[[[[Methods");
    act(() => view.contentDOM.blur());

    await vi.waitFor(() => expect(text(view)).toBe("[Methods](Methods.md)"));
  });

  it("text after it on the line stays where it was", async () => {
    notes["Paper.typ"] = "Before  after.";
    const { view } = await openNote();
    act(() => view.dispatch({ selection: { anchor: "Before ".length } }));

    await userEvent.keyboard("[[[[Methods");
    act(() => view.dispatch({ selection: { anchor: text(view).length } }));

    await vi.waitFor(() => expect(text(view)).toBe('Before #link("Methods.typ")[Methods] after.'));
  });

  it("while the cursor is still in the name, nothing changes yet", async () => {
    const { view } = await openNote();

    await userEvent.keyboard("[[[[Meth");
    await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(text(view)).toBe("[[Meth]]");
  });

  it("with no name typed, the brackets stay as they are", async () => {
    const { view } = await openNote("Ideas.md");

    await userEvent.keyboard("[[[[");
    act(() => view.dispatch({ selection: { anchor: 0 } }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(text(view)).toBe("[[");
  });

  it("one Undo gives back what was typed", async () => {
    const { view } = await openNote();
    await userEvent.keyboard("[[[[Methods");
    act(() => view.dispatch({ selection: { anchor: 0 } }));
    await vi.waitFor(() => expect(text(view)).toContain("#link"));

    act(() => undo(view));

    expect(text(view)).toBe("[[Methods]]");
  });
});

describe("Clicking a link to a note", () => {
  function clickLink(editor: HTMLElement, shown: string) {
    fireEvent.mouseDown(within(editor).getByText(shown), { button: 0 });
  }

  it("opens the note", async () => {
    notes["Paper.typ"] = 'See #link("Ideas.md")[my ideas] here.';
    const { editor } = await openNote();

    clickLink(editor, "my ideas");

    expect(await screen.findByRole("textbox", { name: "Ideas.md" })).toBeInTheDocument();
  });

  it("finds it from the folder of the note the link is in", async () => {
    notes["Papers/Attention.typ"] = 'Back to #link("../Paper.typ")[the paper].';
    const { editor } = await openNote("Papers/Attention.typ");

    clickLink(editor, "the paper");

    expect(await screen.findByRole("textbox", { name: "Paper.typ" })).toBeInTheDocument();
  });

  it("works in Markdown, with %20 for spaces", async () => {
    notes["Ideas.md"] = "Read [the list](Reading%20list.typ).";
    const { editor } = await openNote("Ideas.md");

    clickLink(editor, "the list");

    expect(await screen.findByRole("textbox", { name: "Reading list.typ" })).toBeInTheDocument();
  });

  it("a note that doesn't exist yet is created, then opened", async () => {
    notes["Paper.typ"] = 'See #link("Methods.typ")[Methods] soon.';
    const { editor } = await openNote();

    clickLink(editor, "Methods");

    expect(await screen.findByRole("textbox", { name: "Methods.typ" })).toBeInTheDocument();
    expect(api.createNoteAt).toHaveBeenCalledWith("Methods.typ");
    expect(await screen.findByRole("button", { name: "Methods.typ" })).toBeInTheDocument();
  });

  it("while editing the link (the cursor in it), a click just moves the cursor", async () => {
    notes["Paper.typ"] = 'See #link("Ideas.md")[my ideas] here.';
    const { editor, view } = await openNote();
    act(() => view.dispatch({ selection: { anchor: text(view).indexOf("my ideas") + 2 } }));

    clickLink(editor, "my ideas");

    expect(screen.queryByRole("textbox", { name: "Ideas.md" })).not.toBeInTheDocument();
  });

  it("with the cursor right after the link (as when it was just made), a click follows it", async () => {
    notes["Paper.typ"] = 'See #link("Ideas.md")[my ideas] here.';
    const { editor, view } = await openNote();
    act(() => view.dispatch({ selection: { anchor: text(view).indexOf(" here") } }));

    clickLink(editor, "my ideas");

    expect(await screen.findByRole("textbox", { name: "Ideas.md" })).toBeInTheDocument();
  });

  it("a link to a website opens in the browser", async () => {
    notes["Paper.typ"] = 'See #link("https://typst.app")[Typst].';
    const { editor } = await openNote();

    clickLink(editor, "Typst");

    await vi.waitFor(() => expect(api.openUrl).toHaveBeenCalledWith("https://typst.app"));
    expect(api.createNoteAt).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Paper.typ" })).toBeInTheDocument();
  });

  it("a link to a PDF opens it in the PDF reader", async () => {
    notes["Paper.typ"] = 'See #link("Papers/attention.pdf")[the paper].';
    const { editor } = await openNote();

    clickLink(editor, "the paper");

    expect(await screen.findByRole("tab", { name: "attention.pdf" })).toBeInTheDocument();
  });

  it("a link to another kind of file opens it in its own app", async () => {
    notes["Paper.typ"] = 'See #link("data.csv")[the data].';
    const { editor } = await openNote();

    clickLink(editor, "the data");

    await vi.waitFor(() => expect(api.openFile).toHaveBeenCalledWith("data.csv"));
  });

  it("a link to a label in the note moves the cursor there", async () => {
    notes["Paper.typ"] = 'See #link(<methods>)[the methods].\n\n= Methods <methods>\n\nHow.';
    const { editor, view } = await openNote();

    clickLink(editor, "the methods");

    expect(view.state.selection.main.head).toBe(text(view).indexOf("<methods>\n"));
  });

  it("⌘-click opens the note in a new pane beside, keeping this one", async () => {
    notes["Paper.typ"] = 'See #link("Ideas.md")[my ideas] here.';
    const { editor } = await openNote();

    fireEvent.mouseDown(within(editor).getByText("my ideas"), { button: 0, metaKey: true });

    expect(await screen.findByRole("textbox", { name: "Ideas.md" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Paper.typ" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Pane" })).toHaveLength(2);
  });
});

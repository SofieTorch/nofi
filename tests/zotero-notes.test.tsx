// Notes on a Zotero paper, like on a PDF in the workspace (see pdf-annotations.test.tsx).
//
// Its highlights and note marks are kept in the workspace's hidden `.marginalia` folder
// (`.marginalia/zotero/<paper id>.annotations.json`): each workspace has its own. Notes cite the
// paper with `zotero:<paper id>#page=3&quote=…` links, named by its authors and year.
//
// The first note added on a paper makes its source note, at the top of the workspace. Its name is
// asked first, ready filled in (`<title> notes`); a name with folders (`Papers/gpt3`) puts it in
// them, made if they're missing.

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { findCitations } from "../src/pdf/annotations";
import { resolvePath } from "../src/editor/noteLinks";
import * as pdf from "../src/workspace/pdf";
import { file, setUpFakeBackend } from "./support/fake-backend";
import { useFakeProperties } from "./support/fake-properties";

vi.mock("../src/api");
vi.mock("../src/workspace/pdf");

const zotero: api.ZoteroLibrary = {
  libraries: [
    {
      id: "user",
      name: "My Library",
      collections: [],
      items: [{ id: "GPT30001", title: "Language Models are Few-Shot Learners", authors: ["Brown", "Mann", "Ryder"], year: 2020, kind: "journalArticle", pdf: true }],
    },
  ],
};

const ANNOTATIONS = ".marginalia/zotero/GPT30001.annotations.json";
const NOTE = "Language Models are Few-Shot Learners notes.typ";

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  useFakeProperties();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  vi.mocked(api.zoteroLibrary).mockResolvedValue(zotero);
  notes = { "Ideas.typ": "Nothing yet." };
  vi.mocked(api.listFiles).mockImplementation(async () => Object.keys(notes).filter((p) => !p.startsWith(".")).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => {
    if (!(path in notes)) throw new Error("This note doesn't exist anymore.");
    return notes[path];
  });
  vi.mocked(api.saveNote).mockImplementation(async (path, text) => void (notes[path] = text));
  vi.mocked(api.createNoteAt).mockImplementation(async (path) => {
    notes[path] = "";
    return path;
  });
  vi.mocked(api.notesLinkingTo).mockImplementation(async (target) =>
    Object.keys(notes).filter((path) => /\.(typ|md)$/.test(path) && notes[path].includes(target)),
  );
  vi.mocked(pdf.openPdf).mockResolvedValue({
    pages: 3,
    close: () => {},
    // (What the PDF itself says: Zotero's details are better.)
    info: async () => ({ title: "arXiv:2005.14165v4" }),
    page: async (number) => ({
      width: 600,
      height: 800,
      draw: async () => {},
      text: async (container: HTMLElement) => {
        container.innerHTML = number === 3 ? `<span>Few-shot learning works</span>` : "<span>Other words.</span>";
      },
    }),
  });
  Range.prototype.getClientRects = () => [{ left: 10, top: 40, width: 200, height: 14, right: 210, bottom: 54 }] as unknown as DOMRectList;
  Element.prototype.scrollIntoView = vi.fn();
});

async function openPaper() {
  render(<App />);
  const library = within(await screen.findByRole("region", { name: "Library" }));
  await userEvent.click(await library.findByRole("button", { name: /^Language Models are Few-Shot Learners/ }));
  const page = await screen.findByRole("img", { name: "Page 3" });
  await vi.waitFor(() => expect(page.querySelector(".textLayer")!.textContent).toContain("Few-shot"));
  return page;
}

/** Selects text on a page, as the mouse does, and lets go. */
async function select(page: HTMLElement, text: string) {
  const span = [...page.querySelectorAll(".textLayer span")].find((s) => s.textContent!.includes(text))!;
  const node = span.firstChild!;
  const at = node.textContent!.indexOf(text);
  const range = document.createRange();
  range.setStart(node, at);
  range.setEnd(node, at + text.length);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  span.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
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
const nameDialog = () => screen.findByRole("dialog", { name: "Name the paper's note" });

async function addNoteOn(text: string) {
  await select(await openPaper(), text);
  await addNoteOnSelection();
}

describe("Highlighting a Zotero paper", () => {
  it("is kept in the workspace's hidden folder, not beside the PDF in Zotero", async () => {
    await select(await openPaper(), "Few-shot learning");

    await userEvent.click(within(await bar()).getByRole("button", { name: "Highlight in yellow" }));

    await vi.waitFor(() => expect(notes[ANNOTATIONS]).toBeDefined());
    expect(JSON.parse(notes[ANNOTATIONS]).annotations).toEqual([
      expect.objectContaining({ type: "highlight", page: 3, quote: "Few-shot learning", colour: "yellow" }),
    ]);
  });

  it("shows on the page when the paper opens again", async () => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "GPT30001", annotations: [{ id: "a1", type: "highlight", page: 3, quote: "Few-shot", colour: "green" }] });

    const page = await openPaper();

    await vi.waitFor(() => expect(page.querySelector(".bg-green-300\\/45")).not.toBeNull());
  });

  it("the toolbar has the same tools as for a PDF in the workspace", async () => {
    await openPaper();

    const toolbar = await screen.findByRole("toolbar", { name: "PDF" });
    expect(within(toolbar).getByRole("button", { name: "Add a note on the page" })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: "Select an area" })).toBeInTheDocument();
  });
});

describe("The first note on a Zotero paper", () => {
  it("asks for its name, ready filled in with the paper's title", async () => {
    await addNoteOn("Few-shot learning");

    expect(within(await nameDialog()).getByRole("textbox", { name: "Name" })).toHaveValue("Language Models are Few-Shot Learners notes");
  });

  it("is made at the top of the workspace, with Zotero's details, citing the passage", async () => {
    await addNoteOn("Few-shot learning");
    await userEvent.click(within(await nameDialog()).getByRole("button", { name: "Create" }));

    await vi.waitFor(() => expect(notes[NOTE]).toContain("#footnote["));
    const note = notes[NOTE];
    expect(note).toContain("source: zotero:GPT30001");
    expect(note).toContain("title: Language Models are Few-Shot Learners");
    expect(note).toContain("authors: [Brown, Mann, Ryder]");
    expect(note).toContain("year: 2020");
    expect(note).toContain(`#footnote[#link("zotero:GPT30001#page=3&quote=Few-shot%20learning")[Brown et al., 2020, p. 3]]`);
    expect(JSON.parse(notes[ANNOTATIONS]).annotations).toHaveLength(1);
  });

  it("opens beside the paper, to write", async () => {
    await addNoteOn("Few-shot learning");
    await userEvent.click(within(await nameDialog()).getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("textbox", { name: NOTE })).toBeInTheDocument();
  });

  it("a name with folders puts it in them", async () => {
    await addNoteOn("Few-shot learning");
    const name = within(await nameDialog()).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Papers/LLMs/gpt3{Enter}");

    await vi.waitFor(() => expect(api.createNoteAt).toHaveBeenCalledWith("Papers/LLMs/gpt3.typ"));
    await vi.waitFor(() => expect(notes["Papers/LLMs/gpt3.typ"]).toContain(`#link("zotero:GPT30001#page=3`));
  });

  it("a name that's a note already isn't written into straight away: it offers to use that note", async () => {
    notes["gpt3.typ"] = "My own note.";
    await addNoteOn("Few-shot learning");
    const dialog = await nameDialog();
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "gpt3{Enter}");

    expect(await within(dialog).findByText("There's already a note called “gpt3”.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Use it as the paper's note" })).toBeInTheDocument();
    expect(notes["gpt3.typ"]).toBe("My own note.");
  });

  it("using it makes it the paper's note, its text kept, and the note on the passage goes in it", async () => {
    notes["gpt3.typ"] = "My own note.";
    await addNoteOn("Few-shot learning");
    const dialog = await nameDialog();
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "gpt3{Enter}");

    await userEvent.click(await within(dialog).findByRole("button", { name: "Use it as the paper's note" }));

    await vi.waitFor(() => expect(notes["gpt3.typ"]).toContain("#footnote["));
    const note = notes["gpt3.typ"];
    expect(note).toContain("source: zotero:GPT30001");
    expect(note).toContain("title: Language Models are Few-Shot Learners");
    expect(note).toContain("My own note.");
    expect(await screen.findByRole("textbox", { name: "gpt3.typ" })).toBeInTheDocument();
  });

  it("typing something else goes back to making a new note", async () => {
    notes["gpt3.typ"] = "My own note.";
    await addNoteOn("Few-shot learning");
    const dialog = await nameDialog();
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "gpt3{Enter}");
    await within(dialog).findByRole("button", { name: "Use it as the paper's note" });

    await userEvent.type(name, " new");

    expect(within(dialog).queryByRole("button", { name: "Use it as the paper's note" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("an empty name or one going up a folder is refused", async () => {
    await addNoteOn("Few-shot learning");
    const dialog = await nameDialog();
    const name = within(dialog).getByRole("textbox", { name: "Name" });

    await userEvent.clear(name);
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();

    await userEvent.type(name, "../outside");
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("Cancel adds no note (the highlight stays)", async () => {
    await addNoteOn("Few-shot learning");

    await userEvent.click(within(await nameDialog()).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Name the paper's note" })).not.toBeInTheDocument();
    expect(JSON.parse(notes[ANNOTATIONS]).annotations).toHaveLength(1);
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });
});

describe("A Zotero paper's note, from the toolbar", () => {
  it("with none yet, asks for its name, then makes it with Zotero's details and opens it", async () => {
    await openPaper();
    await userEvent.click(within(await screen.findByRole("toolbar", { name: "PDF" })).getByRole("button", { name: "Open the paper's note" }));

    await userEvent.click(within(await nameDialog()).getByRole("button", { name: "Create" }));

    expect(await screen.findByRole("textbox", { name: NOTE })).toBeInTheDocument();
    expect(notes[NOTE]).toContain("source: zotero:GPT30001");
    expect(notes[NOTE]).not.toContain("#footnote");
    expect(notes[ANNOTATIONS]).toBeUndefined();
  });
});

describe("Using a note that's there as a Zotero paper's note", () => {
  // (Like a note that was the paper's note until its properties were taken out.)
  async function useNote(name: string) {
    await openPaper();
    await userEvent.click(within(await screen.findByRole("toolbar", { name: "PDF" })).getByRole("button", { name: "Open the paper's note" }));
    const dialog = await nameDialog();
    const field = within(dialog).getByRole("textbox", { name: "Name" });
    await userEvent.clear(field);
    await userEvent.type(field, `${name}{Enter}`);
    await userEvent.click(await within(dialog).findByRole("button", { name: "Use it as the paper's note" }));
  }

  it("from the toolbar, it's made the paper's note and opens, nothing else written in it", async () => {
    notes["masters/thesis/gpt3.typ"] = "What I wrote.";

    await useNote("masters/thesis/gpt3");

    expect(await screen.findByRole("textbox", { name: "gpt3.typ" })).toBeInTheDocument();
    const note = notes["masters/thesis/gpt3.typ"];
    expect(note).toMatch(/^#metadata\(\(\n/);
    expect(note).toContain("source: zotero:GPT30001");
    expect(note).toContain("authors: [Brown, Mann, Ryder]");
    expect(note).toContain("year: 2020");
    expect(note).toMatch(/<properties>\n\nWhat I wrote\.$/);
    expect(note).not.toContain("#footnote");
  });

  it("properties it has are kept: only what's missing is added", async () => {
    notes["gpt3.typ"] = "#metadata((\ntitle: My own title\nyear: 2021\n)) <properties>\n\nWhat I wrote.";

    await useNote("gpt3");

    await vi.waitFor(() => expect(notes["gpt3.typ"]).toContain("source: zotero:GPT30001"));
    const note = notes["gpt3.typ"];
    expect(note).toContain("title: My own title");
    expect(note).toContain("year: 2021");
    expect(note).not.toContain("Language Models are Few-Shot Learners");
    expect(note).toContain("authors: [Brown, Mann, Ryder]");
    expect(note).toContain("What I wrote.");
  });

  it("afterwards it's the note the toolbar's button opens", async () => {
    notes["gpt3.typ"] = "What I wrote.";
    await useNote("gpt3");
    await screen.findByRole("textbox", { name: "gpt3.typ" });
    vi.mocked(api.createNoteAt).mockClear();

    await userEvent.click(within(screen.getAllByRole("toolbar", { name: "PDF" })[0]).getByRole("button", { name: "Open the paper's note" }));

    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Name the paper's note" })).not.toBeInTheDocument());
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });
});

describe("Copying a Zotero paper's passage to cite it", () => {
  it("is cited by its authors and year, copied straight away in the click", async () => {
    const copied: string[] = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } });
    await select(await openPaper(), "Few-shot learning");
    await userEvent.click(within(await bar()).getByRole("button", { name: "Copy as" }));
    const footnote = within(await screen.findByRole("menu", { name: "Copy as" })).getByRole("menuitem", { name: "Footnote" });

    fireEvent.click(footnote);

    expect(copied).toEqual([`#footnote[#link("zotero:GPT30001#page=3&quote=Few-shot%20learning")[Brown et al., 2020, p. 3]]`]);
  });
});

describe("Notes citing a Zotero paper", () => {
  const SOURCE = `#metadata((\nsource: zotero:GPT30001\n)) <properties>\n\nScaling helps.#footnote[#link("zotero:GPT30001#page=3&quote=Few-shot")[Brown et al., 2020, p. 3]]\n`;

  it("show in the paper's margin", async () => {
    notes["gpt3.typ"] = SOURCE;

    await openPaper();

    const margin = await screen.findByRole("complementary", { name: "Notes on this PDF" });
    expect(await within(margin).findByText("Scaling helps.")).toBeInTheDocument();
  });

  it("a later note asks which note it goes in, the paper's source note first", async () => {
    notes["gpt3.typ"] = SOURCE;
    await addNoteOn("Few-shot learning");

    const asked = await screen.findByRole("dialog", { name: "Add the note to" });
    expect(within(asked).getAllByRole("option")[0]).toHaveAccessibleName(expect.stringContaining("gpt3"));
  });

  it("clicking a link to the paper opens it, named by its title, at the passage cited", async () => {
    notes["gpt3.typ"] = SOURCE;
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "gpt3.typ" }));
    const editor = await screen.findByRole("textbox", { name: "gpt3.typ" });

    fireEvent.mouseDown(await within(editor).findByText("Brown et al., 2020, p. 3"), { button: 0 });

    expect(await screen.findByRole("tab", { name: "Language Models are Few-Shot Learners" })).toBeInTheDocument();
    expect(api.readZoteroPdf).toHaveBeenCalledWith("GPT30001");
  });

  it("a link to the paper is a link to its PDF, whatever note it's in", () => {
    expect(resolvePath("Deep/Down/note.typ", "zotero:GPT30001#page=3&quote=Few", false)).toBe("zotero:GPT30001");
    expect(resolvePath("note.md", "zotero:groups/77/UNIPAPER", true)).toBe("zotero:groups/77/UNIPAPER");
  });

  it("its citations are found like a PDF's", () => {
    const found = findCitations("zotero:GPT30001", [{ path: "Deep/gpt3.typ", text: SOURCE, source: true }]);

    expect(found).toEqual([expect.objectContaining({ page: 3, quote: "Few-shot", text: "Scaling helps." })]);
  });
});

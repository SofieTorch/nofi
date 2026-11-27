// Links in a PDF, like links in a note: a PDF is one more note. Words on its pages can link to a
// note ("batch inference" → the note explaining it), or to another PDF: one in the workspace, or a
// paper in Zotero (a reference → the paper it cites), found by its title, authors or year, or by
// selecting the whole reference. Select them, Link to note, and choose the note
// (found by name, the words typed in to start with) or make a new one, named after the words: at
// the workspace's top, or in the folders written before it with / ("Concepts/batch inference").
//
// The link is the PDF's own, like a note's links are its own: it's kept in the PDF's annotations
// file beside it (`{"type": "link", "page", "quote", "to"}`, the note's path from the PDF's folder);
// the note isn't changed. On the page the words show as a link: clicking it opens the note beside
// the PDF, hovering it shows the start of the note, and right-clicking it can remove it.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { fileScore } from "../src/pdf/NotePicker";
import * as pdf from "../src/workspace/pdf";
import { file, folder, setUpFakeBackend } from "./support/fake-backend";
import { useFakeProperties } from "./support/fake-properties";

vi.mock("../src/api");
vi.mock("../src/workspace/pdf");

const ANNOTATIONS = "Papers/attention.annotations.json";
const REFERENCE = "[12] A. Vaswani, N. Shazeer, et al. Attention is all you need. In NeurIPS, 2017.";
const paper = (id: string, title: string, authors: string[], year: number, pdf = true) => ({ id, title, authors, year, kind: "journalArticle", pdf });
const ZOTERO: api.ZoteroLibrary = {
  libraries: [
    {
      id: "user",
      name: "My Library",
      collections: [],
      items: [
        paper("VASW2017", "Attention Is All You Need", ["Vaswani", "Shazeer"], 2017),
        paper("BAHD2014", "Neural Machine Translation by Jointly Learning to Align and Translate", ["Bahdanau"], 2014),
        paper("NOPDF001", "Attention Without a PDF", ["Nobody"], 2017, false),
      ],
    },
  ],
};

let notes: Record<string, string>;

beforeEach(() => {
  cleanup();
  setUpFakeBackend();
  useFakeProperties();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Ideas.typ": "Batch inference means running a *model* offline." };
  vi.mocked(api.listFiles).mockImplementation(async () => [
    folder("Papers", [file("Papers/attention.pdf"), file("Papers/bert.pdf"), ...Object.keys(notes).filter((p) => p.startsWith("Papers/") && !p.endsWith(".json")).map(file)]),
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
  vi.mocked(api.notesLinkingTo).mockResolvedValue([]);
  vi.mocked(api.zoteroLibrary).mockResolvedValue(ZOTERO);
  vi.mocked(api.readWorkspaceFile).mockResolvedValue(new ArrayBuffer(4));
  vi.mocked(pdf.openPdf).mockResolvedValue({
    pages: 3,
    close: () => {},
    info: async () => ({ title: "Attention Is All You Need" }),
    page: async (number) => ({
      width: 600,
      height: 800,
      draw: async () => {},
      text: async (container: HTMLElement) => {
        container.innerHTML =
          number === 3
            ? `<span>The dominant sequence</span><br><span>transduction models are complex.</span>`
            : number === 2
              ? `<span>${REFERENCE}</span>`
              : "<span>Other words.</span>";
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
const saved = () => JSON.parse(notes[ANNOTATIONS]).annotations;

/** Selects words and asks to link them: the dialog to choose the note. */
async function linkWords(words: string) {
  await select(await openPdf(), words);
  await userEvent.click(within(await bar()).getByRole("button", { name: "Link" }));
  return screen.findByRole("dialog", { name: "Link to a note or paper" });
}

describe("Linking words in a PDF to a note", () => {
  it("selecting text offers linking it to a note", async () => {
    await select(await openPdf(), "dominant sequence");

    expect(within(await bar()).getByRole("button", { name: "Link" })).toBeInTheDocument();
  });

  it("asks which note, the selected words typed in to find it, and offers a new note named after them", async () => {
    const asked = await linkWords("dominant sequence");

    expect(within(asked).getByRole("textbox", { name: "Find a note" })).toHaveValue("dominant sequence");
    expect(within(asked).getByRole("option", { name: "New note “dominant sequence”" })).toBeInTheDocument();
  });

  it("choosing a note keeps the link in the annotations file beside the PDF, the note's path written from the PDF's folder", async () => {
    const asked = await linkWords("dominant sequence");
    await userEvent.clear(within(asked).getByRole("textbox", { name: "Find a note" }));
    await userEvent.type(within(asked).getByRole("textbox", { name: "Find a note" }), "ideas");

    await userEvent.click(within(asked).getByRole("option", { name: "Ideas.typ" }));

    await vi.waitFor(() =>
      expect(saved()).toEqual([expect.objectContaining({ type: "link", page: 3, quote: "dominant sequence", to: "../Ideas.typ" })]),
    );
  });

  it("the note isn't changed, and doesn't open: you keep reading", async () => {
    const asked = await linkWords("dominant sequence");
    await userEvent.clear(within(asked).getByRole("textbox", { name: "Find a note" }));
    await userEvent.type(within(asked).getByRole("textbox", { name: "Find a note" }), "ideas");

    await userEvent.click(within(asked).getByRole("option", { name: "Ideas.typ" }));

    await vi.waitFor(() => expect(notes[ANNOTATIONS]).toBeDefined());
    expect(notes["Ideas.typ"]).toBe("Batch inference means running a *model* offline.");
    expect(screen.queryByRole("textbox", { name: "Ideas.typ" })).not.toBeInTheDocument();
  });

  it("a new note, named after the words, is made at the workspace's top and opens beside the PDF, to write", async () => {
    const asked = await linkWords("dominant sequence");

    await userEvent.click(within(asked).getByRole("option", { name: "New note “dominant sequence”" }));

    expect(await screen.findByRole("textbox", { name: "dominant sequence.typ" })).toBeInTheDocument();
    expect(api.createNoteAt).toHaveBeenCalledWith("dominant sequence.typ");
    expect(saved()).toEqual([expect.objectContaining({ type: "link", quote: "dominant sequence", to: "../dominant sequence.typ" })]);
    expect(screen.getByRole("toolbar", { name: "PDF" })).toBeInTheDocument();
  });

  it("folders written before the name with / are where the new note goes (made if they aren't there)", async () => {
    const asked = await linkWords("dominant sequence");
    const field = within(asked).getByRole("textbox", { name: "Find a note" });
    await userEvent.clear(field);
    await userEvent.type(field, "Concepts/Models/Batch inference");

    await userEvent.click(within(asked).getByRole("option", { name: "New note “Concepts/Models/Batch inference”" }));

    expect(await screen.findByRole("textbox", { name: "Batch inference.typ" })).toBeInTheDocument();
    expect(api.createNoteAt).toHaveBeenCalledWith("Concepts/Models/Batch inference.typ");
    expect(saved()).toEqual([expect.objectContaining({ to: "../Concepts/Models/Batch inference.typ" })]);
  });

  it("says which folder a new note goes in", async () => {
    const asked = await linkWords("dominant sequence");
    const field = within(asked).getByRole("textbox", { name: "Find a note" });
    expect(within(asked).getByRole("option", { name: "New note “dominant sequence”" })).toHaveTextContent("at the top");

    await userEvent.clear(field);
    await userEvent.type(field, "Concepts/Batch inference");

    expect(within(asked).getByRole("option", { name: "New note “Concepts/Batch inference”" })).toHaveTextContent("in Concepts");
  });

  it("a name can't lead out of the workspace: a / at the start, and . or .. folders, are left out", async () => {
    const asked = await linkWords("dominant sequence");
    const field = within(asked).getByRole("textbox", { name: "Find a note" });
    await userEvent.clear(field);
    await userEvent.type(field, "/../Concepts//./Batch inference/");

    await userEvent.click(within(asked).getByRole("option", { name: "New note “Concepts/Batch inference”" }));

    await vi.waitFor(() => expect(api.createNoteAt).toHaveBeenCalledWith("Concepts/Batch inference.typ"));
  });

  it("a note named like the words comes first, so Enter links to it", async () => {
    notes["Dominant sequence.typ"] = "Already explained.";
    await linkWords("dominant sequence");

    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ to: "../Dominant sequence.typ" })]));
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });

  it("Escape links nothing", async () => {
    await linkWords("dominant sequence");

    await userEvent.keyboard("{Escape}");

    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Link to a note or paper" })).not.toBeInTheDocument());
    expect(notes[ANNOTATIONS]).toBeUndefined();
  });
});

describe("A link on a page", () => {
  const linked = (to = "../Ideas.typ") => {
    notes[ANNOTATIONS] = JSON.stringify({ pdf: "attention.pdf", annotations: [{ id: "l1", type: "link", page: 3, quote: "dominant sequence", to }] });
  };

  it("shows the words as a link to the note", async () => {
    linked();
    const page = await openPdf();

    expect(await within(page).findByRole("link", { name: "Ideas" })).toBeInTheDocument();
  });

  it("clicking it opens the note beside the PDF", async () => {
    linked();
    const page = await openPdf();

    await userEvent.click(await within(page).findByRole("link", { name: "Ideas" }));

    expect(await screen.findByRole("textbox", { name: "Ideas.typ" })).toBeInTheDocument();
    expect(screen.getByRole("toolbar", { name: "PDF" })).toBeInTheDocument();
  });

  it("hovering it shows the start of the note, without its properties", async () => {
    notes["Ideas.typ"] = "#metadata((\nyear: 2017\n)) <properties>\n\nBatch inference means running a *model* offline.";
    linked();
    const page = await openPdf();

    await userEvent.hover(await within(page).findByRole("link", { name: "Ideas" }));

    const preview = await screen.findByRole("tooltip");
    expect(preview).toHaveTextContent("Ideas");
    expect(preview).toHaveTextContent("Batch inference means running a model offline.");
    expect(preview).not.toHaveTextContent("2017");
  });

  it("the preview is the note as the editor shows it: formatted, not to be edited there", async () => {
    notes["Ideas.typ"] = "#metadata((\nyear: 2017\n)) <properties>\n\n= Batch inference\n\nRunning a *trained* model offline.";
    linked();
    const page = await openPdf();

    await userEvent.hover(await within(page).findByRole("link", { name: "Ideas" }));

    const preview = await screen.findByRole("tooltip");
    const note = await within(preview).findByRole("textbox", { name: "Shown from Ideas.typ" });
    expect(note).toHaveAttribute("contenteditable", "false");
    expect(within(note).getByRole("heading", { name: "Batch inference" })).toBeInTheDocument();
    expect(preview).not.toHaveTextContent("2017");
  });

  it("an empty note's preview is small: it only says so", async () => {
    notes["Ideas.typ"] = "#metadata((\nyear: 2017\n)) <properties>\n";
    linked();
    const page = await openPdf();

    await userEvent.hover(await within(page).findByRole("link", { name: "Ideas" }));

    const preview = await screen.findByRole("tooltip");
    expect(preview).toHaveTextContent("An empty note.");
    expect(preview).toHaveClass("w-64");
    expect(preview).not.toHaveClass("w-[26rem]");
  });

  it("the preview doesn't show the note's margin (its footnotes and comments)", async () => {
    notes["Ideas.typ"] = "Batch inference.#footnote[A side note.]";
    linked();
    const page = await openPdf();

    await userEvent.hover(await within(page).findByRole("link", { name: "Ideas" }));

    const preview = await screen.findByRole("tooltip");
    await vi.waitFor(() => expect(preview.querySelector(".cm-sidenote")).not.toBeNull());
    const footnote = preview.querySelector<HTMLElement>(".cm-sidenote")!;
    expect(getComputedStyle(footnote).display).toBe("none");
  });

  it("a long note can be scrolled in it: it stays while the mouse is over it", async () => {
    linked();
    const page = await openPdf();
    const link = await within(page).findByRole("link", { name: "Ideas" });
    await userEvent.hover(link);
    const preview = await screen.findByRole("tooltip");

    expect(preview.querySelector(".overflow-y-auto")).not.toBeNull();
    await userEvent.unhover(link);
    await userEvent.hover(preview);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    await userEvent.unhover(preview);
    await vi.waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("the preview goes when the mouse leaves", async () => {
    linked();
    const page = await openPdf();
    const link = await within(page).findByRole("link", { name: "Ideas" });
    await userEvent.hover(link);
    await screen.findByRole("tooltip");

    await userEvent.unhover(link);

    await vi.waitFor(() => expect(screen.queryByRole("tooltip")).not.toBeInTheDocument());
  });

  it("a link to a note that's gone says so when hovered", async () => {
    linked("../Gone.typ");
    const page = await openPdf();

    await userEvent.hover(await within(page).findByRole("link", { name: "Gone" }));

    expect(await screen.findByRole("tooltip")).toHaveTextContent("Not created yet");
  });

  it("renaming the note while the PDF is open: the link follows it", async () => {
    vi.mocked(api.renameNote).mockImplementation(async (path, name) => {
      const to = `${name}.typ`;
      notes[to] = notes[path];
      delete notes[path];
      return to;
    });
    linked();
    const page = await openPdf();
    await within(page).findByRole("link", { name: "Ideas" });

    fireEvent.contextMenu(screen.getByRole("button", { name: "Ideas.typ" }), { clientX: 40, clientY: 80 });
    await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Rename" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Note name" }));
    await userEvent.keyboard("Big ideas{Enter}");

    expect(await within(page).findByRole("link", { name: "Big ideas" })).toBeInTheDocument();
    expect(saved()).toEqual([expect.objectContaining({ to: "../Big ideas.typ" })]);
  });

  it("right-clicking it can remove the link", async () => {
    linked();
    const page = await openPdf();
    fireEvent.contextMenu(await within(page).findByRole("link", { name: "Ideas" }));

    await userEvent.click(within(await screen.findByRole("menu", { name: "Link" })).getByRole("menuitem", { name: "Remove link" }));

    await vi.waitFor(() => expect(saved()).toEqual([]));
    await vi.waitFor(() => expect(within(page).queryByRole("link", { name: "Ideas" })).not.toBeInTheDocument());
  });
});

describe("Linking words to another PDF", () => {
  const asked = () => screen.findByRole("dialog", { name: "Link to a note or paper" });
  async function find(dialog: HTMLElement, typed: string) {
    const field = within(dialog).getByRole("textbox", { name: "Find a note" });
    await userEvent.clear(field);
    await userEvent.type(field, typed);
  }

  it("the workspace's PDFs are offered too", async () => {
    const dialog = await linkWords("dominant sequence");

    await find(dialog, "bert");

    expect(await within(dialog).findByRole("option", { name: "bert.pdf" })).toBeInTheDocument();
  });

  it("so are Zotero papers with a PDF, found by their title, authors or year", async () => {
    const dialog = await linkWords("dominant sequence");

    await find(dialog, "vaswani 2017");

    expect(await within(dialog).findByRole("option", { name: "Attention Is All You Need" })).toHaveTextContent("Vaswani, Shazeer 2017");
    await find(dialog, "attention");
    await within(dialog).findByRole("option", { name: "Attention Is All You Need" });
    expect(within(dialog).queryByRole("option", { name: "Attention Without a PDF" })).not.toBeInTheDocument();
  });

  it("selecting a whole reference finds the paper it cites, first, so Enter links to it", async () => {
    await openPdf();
    const page = await screen.findByRole("img", { name: "Page 2" });
    await vi.waitFor(() => expect(page.querySelector(".textLayer")!.textContent).toContain("Vaswani"));
    await select(page, REFERENCE);
    await userEvent.click(within(await bar()).getByRole("button", { name: "Link" }));
    const dialog = await asked();
    await within(dialog).findByRole("option", { name: "Attention Is All You Need" });

    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() =>
      expect(saved()).toEqual([expect.objectContaining({ type: "link", page: 2, to: "zotero:VASW2017", title: "Attention Is All You Need" })]),
    );
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });

  it("a link to a PDF in the workspace is kept from the PDF's folder", async () => {
    const dialog = await linkWords("dominant sequence");
    await find(dialog, "bert");

    await userEvent.click(await within(dialog).findByRole("option", { name: "bert.pdf" }));

    await vi.waitFor(() => expect(saved()).toEqual([expect.objectContaining({ to: "bert.pdf" })]));
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });
});

describe("A link to another PDF on a page", () => {
  const linked = (to: string, title?: string) => {
    notes[ANNOTATIONS] = JSON.stringify({
      pdf: "attention.pdf",
      annotations: [{ id: "l1", type: "link", page: 3, quote: "dominant sequence", to, ...(title && { title }) }],
    });
  };

  it("is named after the paper", async () => {
    linked("zotero:VASW2017", "Attention Is All You Need");
    const page = await openPdf();

    expect(await within(page).findByRole("link", { name: "Attention Is All You Need" })).toBeInTheDocument();
  });

  it("clicking it opens the paper beside, in the reader, without making a note", async () => {
    linked("zotero:VASW2017", "Attention Is All You Need");
    const page = await openPdf();

    await userEvent.click(await within(page).findByRole("link", { name: "Attention Is All You Need" }));

    await vi.waitFor(() => expect(api.readZoteroPdf).toHaveBeenCalledWith("VASW2017"));
    expect(screen.getAllByRole("toolbar", { name: "PDF" })).toHaveLength(2);
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });

  it("a PDF in the workspace opens the same way", async () => {
    linked("bert.pdf");
    const page = await openPdf();

    await userEvent.click(await within(page).findByRole("link", { name: "bert" }));

    await vi.waitFor(() => expect(api.readWorkspaceFile).toHaveBeenCalledWith("Papers/bert.pdf"));
    expect(api.createNoteAt).not.toHaveBeenCalled();
  });

  it("hovering it shows the paper's title, authors and year", async () => {
    linked("zotero:VASW2017", "Attention Is All You Need");
    const page = await openPdf();

    await userEvent.hover(await within(page).findByRole("link", { name: "Attention Is All You Need" }));

    const preview = await screen.findByRole("tooltip");
    expect(preview).toHaveTextContent("Attention Is All You Need");
    await vi.waitFor(() => expect(preview).toHaveTextContent("Vaswani, Shazeer · 2017"));
  });
});

describe("Finding a paper by a reference to it", () => {
  const gpt3 = { path: "zotero:GPT30001", label: "Language Models are Few-Shot Learners", title: "Language Models are Few-Shot Learners", words: "Language Models are Few-Shot Learners Brown Mann 2020" };

  it("a reference with most of the paper's title in it finds it", () => {
    expect(fileScore(gpt3, "[3] T. Brown and B. Mann, “Language models are few-shot learners,” NeurIPS, 2020.")).not.toBeNull();
  });

  it("even with a hyphenated word joined (as when it was broken over two lines)", () => {
    expect(fileScore(gpt3, "[3] T. Brown and B. Mann, “Language models are fewshot learners,” NeurIPS, 2020.")).not.toBeNull();
  });

  it("the PDF's joined letters (ligatures like ﬁ and ﬃ) are the letters", () => {
    const paper = { path: "zotero:FT", label: "Efficient Fine-Tuning of Language Models", title: "Efficient Fine-Tuning of Language Models", words: "Efficient Fine-Tuning Kwon 2023" };

    expect(fileScore(paper, "[21] W. Kwon et al. Eﬃcient ﬁne-tuning of language models. In SOSP, 2023.")).not.toBeNull();
  });

  it("accents don't matter", () => {
    const paper = { path: "zotero:FR", label: "Réseaux de neurones profonds", title: "Réseaux de neurones profonds", words: "Réseaux de neurones profonds Lécun 1998" };

    expect(fileScore(paper, "[4] Y. LeCun. Reseaux de neurones profonds. 1998.")).not.toBeNull();
  });

  it("a title only mostly in the reference (Zotero's has a subtitle) is found with its first author and year", () => {
    const longer = { ...gpt3, label: "Language Models are Few-Shot Learners: An Extended Study", title: "Language Models are Few-Shot Learners: An Extended Study", authors: ["Brown", "Mann"], year: 2020 };

    expect(fileScore(longer, "[3] T. Brown and B. Mann, “Language models are few-shot learners,” NeurIPS, 2020.")).not.toBeNull();
    // (Not with another year: it may be another paper.)
    expect(fileScore(longer, "[3] T. Brown and B. Mann, “Language models are few-shot learners,” NeurIPS, 2021.")).toBeNull();
  });

  it("a reference to another paper doesn't", () => {
    expect(fileScore(gpt3, "[2] J. Devlin, “BERT: Pre-training of deep bidirectional transformers,” NAACL, 2019.")).toBeNull();
  });

  it("nor does one sharing many of the paper's title words, but not in its title's order", () => {
    const tfData = {
      path: "zotero:TFDATA",
      label: "tf.data: A Machine Learning Data Processing Framework",
      title: "tf.data: A Machine Learning Data Processing Framework",
      words: "tf.data: A Machine Learning Data Processing Framework Murray Šimša Klimovic Indyk 2021",
      authors: ["Murray", "Šimša", "Klimovic", "Indyk"],
      year: 2021,
    };
    const cachew =
      "[13] Dan Graur, Damien Aymon, Dan Kluser, Tanguy Albrici, Chandramohan A Thekkath, and Ana Klimovic. Cachew: Machine learning input data processing as a service. In 2022 USENIX Annual Technical Conference, 2022.";

    expect(fileScore(tfData, cachew)).toBeNull();
    expect(fileScore({ ...tfData, path: "zotero:CACHEW", label: "Cachew: Machine Learning Input Data Processing as a Service", title: "Cachew: Machine Learning Input Data Processing as a Service", words: "Cachew Graur Klimovic 2022", authors: ["Graur"], year: 2022 }, cachew)).not.toBeNull();
  });
});

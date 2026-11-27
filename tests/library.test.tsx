// The sidebar's sections, like VS Code's: Files (the workspace) and Library (the user's Zotero
// library), each folded away by clicking its header. The library lists Zotero's libraries (the
// user's own, then groups), their collections and papers; a paper's PDF opens in the reader.

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend, zoteroChangedOnDisk } from "./support/fake-backend";

vi.mock("../src/api");

const researchNotes: api.Workspace = { name: "Research Notes", path: "/Users/me/Research Notes" };

const paper = (id: string, title: string, authors: string[] = [], year: number | null = null, pdf = true): api.ZoteroItem => ({
  id,
  title,
  authors,
  year,
  kind: "journalArticle",
  pdf,
});

const zotero: api.ZoteroLibrary = {
  libraries: [
    {
      id: "user",
      name: "My Library",
      collections: [
        { key: "THESIS01", name: "Thesis", parent: null, items: ["ATTN2017"] },
        { key: "LITREV01", name: "Literature review", parent: "THESIS01", items: ["BERT2018"] },
      ],
      items: [
        paper("ATTN2017", "Attention Is All You Need", ["Vaswani", "Shazeer", "Parmar"], 2017),
        paper("BERT2018", "BERT: Pre-training of Deep Bidirectional Transformers", ["Devlin"], 2018),
        paper("BOOK0001", "Designing Data-Intensive Applications", ["Kleppmann"], 2017, false),
        paper("GPT30001", "Language Models are Few-Shot Learners", ["Brown", "Mann", "Ryder"], 2020),
      ],
    },
    { id: "groups/77", name: "Uni projects", collections: [], items: [paper("groups/77/UNIPAPER", "Kubernetes Scheduling", ["Burns"], 2016)] },
  ],
};

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue(researchNotes);
  vi.mocked(api.listFiles).mockResolvedValue([file("Ideas.typ")]);
  vi.mocked(api.zoteroLibrary).mockResolvedValue(zotero);
});

async function renderOpenWorkspace() {
  render(<App />);
  await screen.findByRole("heading", { name: "Research Notes", hidden: true });
}

const section = (name: "Files" | "Library") => screen.queryByRole("region", { name });
const library = () => within(screen.getByRole("region", { name: "Library" }));
/** The search field, opened from the Library header's Search button if it isn't open yet. */
async function searchBox() {
  if (!library().queryByRole("searchbox", { name: "Search the library" })) {
    await userEvent.click(screen.getByRole("button", { name: "Search the library" }));
  }
  return library().getByRole("searchbox", { name: "Search the library" });
}

describe("The sidebar's sections", () => {
  it("has Files (named after the workspace) and Library, both open at first", async () => {
    await renderOpenWorkspace();

    expect(screen.getByRole("button", { name: "Research Notes" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute("aria-expanded", "true");
    expect(await within(section("Files")!).findByRole("button", { name: "Ideas.typ" })).toBeInTheDocument();
    expect(section("Library")).toBeInTheDocument();
  });

  it("clicking a section's header folds it away, and clicking again opens it", async () => {
    await renderOpenWorkspace();
    await screen.findByRole("button", { name: "Ideas.typ" });

    await userEvent.click(screen.getByRole("button", { name: "Research Notes" }));
    expect(screen.getByRole("button", { name: "Research Notes" })).toHaveAttribute("aria-expanded", "false");
    expect(section("Files")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ideas.typ" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Research Notes" }));
    expect(await screen.findByRole("button", { name: "Ideas.typ" })).toBeInTheDocument();
  });

  it("which sections are folded is remembered for the workspace", async () => {
    await renderOpenWorkspace();

    await userEvent.click(screen.getByRole("button", { name: "Library" }));

    expect(api.saveExplorerLayout).toHaveBeenCalledWith({
      side: "left",
      mode: "pinned",
      collapsed: { files: false, library: true },
    });
  });

  it("a section folded last time is folded when the workspace opens", async () => {
    vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "left", mode: "pinned", collapsed: { files: false, library: true } });

    await renderOpenWorkspace();

    expect(await screen.findByRole("button", { name: "Library" })).toHaveAttribute("aria-expanded", "false");
    expect(section("Library")).not.toBeInTheDocument();
  });

  it("the library isn't read while its section is folded", async () => {
    vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "left", mode: "pinned", collapsed: { files: false, library: true } });
    await renderOpenWorkspace();
    await screen.findByRole("button", { name: "Ideas.typ" });

    expect(api.zoteroLibrary).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Library" }));
    await vi.waitFor(() => expect(api.zoteroLibrary).toHaveBeenCalled());
  });

  it("Pin is on the sidebar's top row (beside the window's buttons); New note is on the Files header", async () => {
    await renderOpenWorkspace();

    const top = within(screen.getByRole("toolbar", { name: "Sidebar" }));
    expect(top.getByRole("button", { name: /pin file explorer/i })).toBeInTheDocument();
    expect(top.queryByRole("button", { name: "New note" })).not.toBeInTheDocument();
    const header = within(screen.getByRole("button", { name: "Research Notes" }).closest("h1")!.parentElement!);
    expect(header.getByRole("button", { name: "New note" })).toBeInTheDocument();
  });
});

describe("The Library", () => {
  it("shows the user's own library open, with its collections and then the papers in none", async () => {
    await renderOpenWorkspace();

    const mine = await library().findByRole("button", { name: "My Library" });
    expect(mine).toHaveAttribute("aria-expanded", "true");
    expect(library().getByRole("button", { name: "Thesis" })).toHaveAttribute("aria-expanded", "false");
    expect(library().getByRole("button", { name: /^Language Models are Few-Shot Learners/ })).toBeInTheDocument();
    expect(library().getByText("Designing Data-Intensive Applications")).toBeInTheDocument();
  });

  it("a paper in a collection is only shown inside it, not among the library's own papers", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });

    // (Thesis is folded: Attention, in it, isn't shown anywhere; nor BERT, in a collection inside it.)
    expect(library().queryByRole("button", { name: /^Attention Is All You Need/ })).not.toBeInTheDocument();
    expect(library().queryByRole("button", { name: /^BERT/ })).not.toBeInTheDocument();

    await userEvent.click(library().getByRole("button", { name: "Thesis" }));
    expect(library().getAllByRole("button", { name: /^Attention Is All You Need/ })).toHaveLength(1);
  });

  it("group libraries come after it, folded", async () => {
    await renderOpenWorkspace();

    const group = await library().findByRole("button", { name: "Uni projects" });
    expect(group).toHaveAttribute("aria-expanded", "false");
    expect(library().queryByRole("button", { name: /^Kubernetes Scheduling/ })).not.toBeInTheDocument();

    await userEvent.click(group);
    expect(library().getByRole("button", { name: /^Kubernetes Scheduling/ })).toBeInTheDocument();
  });

  it("opening a collection shows the collections inside it and its papers", async () => {
    await renderOpenWorkspace();
    const thesis = await library().findByRole("button", { name: "Thesis" });
    const inThesis = () => within(thesis.closest("li")!);

    await userEvent.click(thesis);
    expect(inThesis().getByRole("button", { name: "Literature review" })).toBeInTheDocument();
    expect(inThesis().getByRole("button", { name: /^Attention Is All You Need/ })).toBeInTheDocument();
    expect(inThesis().queryByRole("button", { name: /^BERT/ })).not.toBeInTheDocument();

    await userEvent.click(inThesis().getByRole("button", { name: "Literature review" }));
    expect(inThesis().getByRole("button", { name: /^BERT/ })).toBeInTheDocument();
  });

  it("a paper's row shows only its title: its year isn't on the right", async () => {
    await renderOpenWorkspace();

    const gpt3 = await library().findByRole("button", { name: /^Language Models are Few-Shot Learners/ });

    expect(gpt3).toHaveTextContent(/^Language Models are Few-Shot Learners$/);
  });

  it("a paper shows its authors and year", async () => {
    await renderOpenWorkspace();

    const gpt3 = await library().findByRole("button", { name: /^Language Models are Few-Shot Learners/ });

    expect(gpt3).toHaveAccessibleName("Language Models are Few-Shot Learners, Brown et al., 2020");
    expect(gpt3).toHaveAttribute("title", "Language Models are Few-Shot Learners\nBrown, Mann, Ryder · 2020");
  });

  it("clicking a paper opens its PDF in the reader, named by its title", async () => {
    await renderOpenWorkspace();

    await userEvent.click(await library().findByRole("button", { name: /^Language Models are Few-Shot Learners/ }));

    expect(await screen.findByRole("tab", { name: "Language Models are Few-Shot Learners" })).toBeInTheDocument();
    await vi.waitFor(() => expect(api.readZoteroPdf).toHaveBeenCalledWith("GPT30001"));
  });

  it("a group's paper opens too", async () => {
    await renderOpenWorkspace();
    await userEvent.click(await library().findByRole("button", { name: "Uni projects" }));

    await userEvent.click(library().getByRole("button", { name: /^Kubernetes Scheduling/ }));

    await vi.waitFor(() => expect(api.readZoteroPdf).toHaveBeenCalledWith("groups/77/UNIPAPER"));
  });

  it("a paper without a PDF is listed, but can't be opened", async () => {
    await renderOpenWorkspace();

    const book = await library().findByText("Designing Data-Intensive Applications");

    expect(book.closest("button")).toBeNull();
    expect(book.closest("[aria-description]")).toHaveAttribute("aria-description", "No PDF in Zotero");
  });

  it("search is a button on the Library's header, between Refresh and the gear; its field is hidden at first", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });

    const header = screen.getByRole("button", { name: "Library" }).parentElement!;
    const buttons = within(header).getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(buttons.slice(-3)).toEqual(["Refresh the library", "Search the library", "Library settings"]);
    expect(library().queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("the Search button shows the field, ready to type in; Escape clears it and hides it again", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });

    await userEvent.click(screen.getByRole("button", { name: "Search the library" }));
    expect(library().getByRole("searchbox", { name: "Search the library" })).toHaveFocus();
    await userEvent.keyboard("kub");
    expect(library().queryByRole("button", { name: "My Library" })).not.toBeInTheDocument();

    await userEvent.keyboard("{Escape}");
    expect(library().queryByRole("searchbox")).not.toBeInTheDocument();
    expect(library().getByRole("button", { name: "My Library" })).toBeInTheDocument();
  });

  it("clicking the Search button again hides the field and clears the search", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });
    await userEvent.type(await searchBox(), "kub");

    await userEvent.click(screen.getByRole("button", { name: "Search the library" }));

    expect(library().queryByRole("searchbox")).not.toBeInTheDocument();
    expect(library().getByRole("button", { name: "My Library" })).toBeInTheDocument();
  });

  it("searching lists the papers whose title, authors or year match, across libraries", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });

    await userEvent.type(await searchBox(), "kub");
    expect(library().getByRole("button", { name: /^Kubernetes Scheduling/ })).toBeInTheDocument();
    expect(library().queryByRole("button", { name: "My Library" })).not.toBeInTheDocument();
    expect(library().queryByRole("button", { name: /^Attention/ })).not.toBeInTheDocument();

    await userEvent.clear(await searchBox());
    await userEvent.type(await searchBox(), "devlin");
    expect(library().getByRole("button", { name: /^BERT/ })).toBeInTheDocument();

    await userEvent.clear(await searchBox());
    await userEvent.type(await searchBox(), "2017");
    expect(library().getByRole("button", { name: /^Attention/ })).toBeInTheDocument();
    expect(library().getByText("Designing Data-Intensive Applications")).toBeInTheDocument();
  });

  it("searching for something that isn't there says so", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });

    await userEvent.type(await searchBox(), "quantum");

    expect(library().getByText("No papers match.")).toBeInTheDocument();
  });

  it("a paper added in Zotero shows up by itself, keeping what's open as it was", async () => {
    await renderOpenWorkspace();
    await userEvent.click(await library().findByRole("button", { name: "Thesis" }));
    vi.mocked(api.zoteroLibrary).mockResolvedValue({
      libraries: [
        {
          ...zotero.libraries[0],
          collections: [{ key: "THESIS01", name: "Thesis", parent: null, items: ["ATTN2017", "NEWPAPER"] }],
          items: [...zotero.libraries[0].items, paper("NEWPAPER", "A New Paper")],
        },
      ],
    });

    await zoteroChangedOnDisk();

    const thesis = within(library().getByRole("button", { name: "Thesis" }).closest("li")!);
    expect(await thesis.findByRole("button", { name: /^A New Paper/ })).toBeInTheDocument();
    expect(library().getByRole("button", { name: "Thesis" })).toHaveAttribute("aria-expanded", "true");
  });

  it("a search stays as it was when the library changes", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });
    await userEvent.type(await searchBox(), "new");
    vi.mocked(api.zoteroLibrary).mockResolvedValue({
      libraries: [{ id: "user", name: "My Library", collections: [], items: [paper("NEWPAPER", "A New Paper")] }],
    });

    await zoteroChangedOnDisk();

    expect(await library().findByRole("button", { name: /^A New Paper/ })).toBeInTheDocument();
    expect(library().getByRole("searchbox", { name: "Search the library" })).toHaveValue("new");
  });

  it("Refresh reads the library again, for changes made in Zotero", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });
    vi.mocked(api.zoteroLibrary).mockResolvedValue({
      libraries: [{ id: "user", name: "My Library", collections: [], items: [paper("NEWPAPER", "A New Paper")] }],
    });

    await userEvent.click(screen.getByRole("button", { name: "Refresh the library" }));

    expect(await library().findByRole("button", { name: /^A New Paper/ })).toBeInTheDocument();
  });

  it("without Zotero on the computer, it says so", async () => {
    vi.mocked(api.zoteroLibrary).mockResolvedValue(null);

    await renderOpenWorkspace();

    expect(await library().findByText("Zotero isn't on this computer.")).toBeInTheDocument();
  });

  it("a library that can't be read explains why", async () => {
    vi.mocked(api.zoteroLibrary).mockRejectedValue("Couldn't read the Zotero library: disk I/O error");

    await renderOpenWorkspace();

    expect(await library().findByRole("alert")).toHaveTextContent("Couldn't read the Zotero library: disk I/O error");
  });
});

describe("A Zotero paper in the reader", () => {
  it("a PDF Zotero hasn't downloaded explains what to do", async () => {
    vi.mocked(api.readZoteroPdf).mockRejectedValue("The PDF isn't on this computer yet: open it once in Zotero to download it.");
    await renderOpenWorkspace();

    await userEvent.click(await library().findByRole("button", { name: /^Language Models are Few-Shot Learners/ }));

    expect(await screen.findByText(/open it once in Zotero to download it/)).toBeInTheDocument();
  });
});

// Hiding libraries and collections, per workspace: from a library's or collection's right-click
// menu, or the Library's settings (the gear on its header), which list everything with a box to
// show it. Hidden means hidden in the Library, search included.
describe("Hiding in the Library", () => {
  const rightClick = async (name: string) => {
    const row = await library().findByRole("button", { name });
    fireEvent.contextMenu(row, { clientX: 40, clientY: 200 });
    return screen.findByRole("menu");
  };
  const searchFor = async (text: string) => {
    const box = await searchBox();
    await userEvent.clear(box);
    await userEvent.type(box, text);
  };
  const openSettings = async () => {
    await userEvent.click(screen.getByRole("button", { name: "Library settings" }));
    return within(await screen.findByRole("dialog", { name: "Library settings" }));
  };

  it("right-clicking a collection offers to hide it: then it's gone, and the collections in it", async () => {
    await renderOpenWorkspace();

    const menu = await rightClick("Thesis");
    await userEvent.click(within(menu).getByRole("menuitem", { name: "Hide “Thesis”" }));

    expect(library().queryByRole("button", { name: "Thesis" })).not.toBeInTheDocument();
    expect(library().queryByRole("button", { name: "Literature review" })).not.toBeInTheDocument();
    expect(api.saveHiddenInLibrary).toHaveBeenCalledWith(["user/collections/THESIS01"]);
  });

  it("papers only in hidden collections are left out of the library's papers, and of search", async () => {
    await renderOpenWorkspace();
    await userEvent.click(await library().findByRole("button", { name: "Thesis" }));

    await userEvent.click(within(await rightClick("Literature review")).getByRole("menuitem", { name: "Hide “Literature review”" }));

    // BERT is only in Literature review; Attention is in Thesis (shown); the book is in no collection.
    expect(library().queryByRole("button", { name: /^BERT/ })).not.toBeInTheDocument();
    expect(library().getByRole("button", { name: /^Attention Is All You Need/ })).toBeInTheDocument();
    expect(library().getByText("Designing Data-Intensive Applications")).toBeInTheDocument();
    await searchFor("devlin");
    expect(library().getByText("No papers match.")).toBeInTheDocument();
  });

  it("right-clicking a library hides all of it, search included", async () => {
    await renderOpenWorkspace();

    await userEvent.click(within(await rightClick("Uni projects")).getByRole("menuitem", { name: "Hide “Uni projects”" }));

    expect(library().queryByRole("button", { name: "Uni projects" })).not.toBeInTheDocument();
    await searchFor("kubernetes");
    expect(library().getByText("No papers match.")).toBeInTheDocument();
    expect(api.saveHiddenInLibrary).toHaveBeenCalledWith(["groups/77"]);
  });

  it("what was hidden in the workspace is hidden when it opens", async () => {
    vi.mocked(api.getHiddenInLibrary).mockResolvedValue(["groups/77", "user/collections/LITREV01"]);

    await renderOpenWorkspace();

    await library().findByRole("button", { name: "Thesis" });
    expect(library().queryByRole("button", { name: "Uni projects" })).not.toBeInTheDocument();
    await userEvent.click(library().getByRole("button", { name: "Thesis" }));
    expect(library().queryByRole("button", { name: "Literature review" })).not.toBeInTheDocument();
  });

  it("the gear lists every library and collection, with a box to show each", async () => {
    vi.mocked(api.getHiddenInLibrary).mockResolvedValue(["groups/77"]);
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });

    const settings = await openSettings();

    const boxes = settings.getAllByRole("checkbox");
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual(["My Library", "Thesis", "Literature review", "Uni projects"]);
    expect(settings.getByRole("checkbox", { name: "Thesis" })).toBeChecked();
    expect(settings.getByRole("checkbox", { name: "Uni projects" })).not.toBeChecked();
  });

  it("unticking a box hides it, and ticking it shows it again", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });
    const settings = await openSettings();

    await userEvent.click(settings.getByRole("checkbox", { name: "Thesis" }));
    expect(library().queryByRole("button", { name: "Thesis" })).not.toBeInTheDocument();
    expect(api.saveHiddenInLibrary).toHaveBeenLastCalledWith(["user/collections/THESIS01"]);

    await userEvent.click(settings.getByRole("checkbox", { name: "Thesis" }));
    expect(library().getByRole("button", { name: "Thesis" })).toBeInTheDocument();
    expect(api.saveHiddenInLibrary).toHaveBeenLastCalledWith([]);
  });

  it("in a hidden library or collection, what's inside it can't be ticked on its own", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });
    const settings = await openSettings();

    await userEvent.click(settings.getByRole("checkbox", { name: "Thesis" }));

    expect(settings.getByRole("checkbox", { name: "Literature review" })).toBeDisabled();
    await userEvent.click(settings.getByRole("checkbox", { name: "My Library" }));
    expect(settings.getByRole("checkbox", { name: "Thesis" })).toBeDisabled();
  });

  it("the settings close with Done, or Escape", async () => {
    await renderOpenWorkspace();
    await library().findByRole("button", { name: "My Library" });

    await userEvent.click((await openSettings()).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog", { name: "Library settings" })).not.toBeInTheDocument();

    await openSettings();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Library settings" })).not.toBeInTheDocument();
  });

  it("the gear opens the Library section if it's folded", async () => {
    vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "left", mode: "pinned", collapsed: { files: false, library: true } });
    await renderOpenWorkspace();

    await userEvent.click(await screen.findByRole("button", { name: "Library settings" }));

    expect(await screen.findByRole("dialog", { name: "Library settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Library" })).toHaveAttribute("aria-expanded", "true");
  });

  it("the right-click menu opens the settings too", async () => {
    await renderOpenWorkspace();

    await userEvent.click(within(await rightClick("My Library")).getByRole("menuitem", { name: "Library settings…" }));

    expect(await screen.findByRole("dialog", { name: "Library settings" })).toBeInTheDocument();
  });
});

describe("Which libraries and collections are open", () => {
  it("is remembered for the workspace", async () => {
    await renderOpenWorkspace();
    const thesis = await library().findByRole("button", { name: "Thesis" });

    await userEvent.click(thesis);

    expect(api.saveOpenInLibrary).toHaveBeenLastCalledWith(["user", "user/collections/THESIS01"]);
    await userEvent.click(library().getByRole("button", { name: "My Library" }));
    expect(api.saveOpenInLibrary).toHaveBeenLastCalledWith(["user/collections/THESIS01"]);
  });

  it("opens as it was left", async () => {
    vi.mocked(api.getOpenInLibrary).mockResolvedValue(["user", "user/collections/THESIS01", "user/collections/LITREV01", "groups/77"]);
    await renderOpenWorkspace();

    const thesis = await library().findByRole("button", { name: "Thesis" });
    await vi.waitFor(() => expect(thesis).toHaveAttribute("aria-expanded", "true"));
    expect(library().getByRole("button", { name: "Literature review" })).toHaveAttribute("aria-expanded", "true");
    expect(library().getByRole("button", { name: "Uni projects" })).toHaveAttribute("aria-expanded", "true");
  });

  it("with nothing remembered, the user's own library is open and the rest folded", async () => {
    await renderOpenWorkspace();

    expect(await library().findByRole("button", { name: "My Library" })).toHaveAttribute("aria-expanded", "true");
    expect(library().getByRole("button", { name: "Thesis" })).toHaveAttribute("aria-expanded", "false");
    expect(library().getByRole("button", { name: "Uni projects" })).toHaveAttribute("aria-expanded", "false");
  });
});

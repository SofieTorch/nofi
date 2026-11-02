// A note's properties, shown as a table at the top of the editor (like Obsidian). Any name, any
// value; editing the table rewrites the block in the note, and the rest of the note stays as is.

import { EditorView } from "@codemirror/view";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { findPropertiesBlock } from "../src/editor/properties";
import { file, setUpFakeBackend } from "./support/fake-backend";
import { useFakeProperties } from "./support/fake-properties";

vi.mock("../src/api");

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  useFakeProperties();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = {
    "Paper.md": "---\nyear: 2017\nread: false\n---\nNotes on the paper.",
    "Paper.typ": "#metadata((\nyear: 2017\n)) <properties>\nNotes on the paper.",
    "Plain.md": "Just notes.",
  };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

async function openNote(name: string) {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name });
}

const properties = () => screen.findByRole("group", { name: "Properties" });
/** The note's text as it is in the editor (and will be saved). */
const textIn = (editor: HTMLElement) => EditorView.findFromDOM(editor)!.state.doc.toString();

describe("Finding a note's properties block", () => {
  it("in Markdown, it's the --- block at the very top", () => {
    const note = "---\nyear: 2017\n---\n# Notes";
    expect(findPropertiesBlock(note, "markdown")).toEqual({ from: 0, to: 18 });
    expect(findPropertiesBlock("# Notes\n---\na: 1\n---", "markdown")).toBeNull();
    expect(findPropertiesBlock("---\nyear: 2017\n# never closed", "markdown")).toBeNull();
  });

  it("in Typst, it's the #metadata(…) <properties> at the very top", () => {
    const block = '#metadata((title: "A (draft)", tags: ("a", ")"))) <properties>';
    expect(findPropertiesBlock(`${block}\n= Notes`, "typst")).toEqual({ from: 0, to: block.length });
    expect(findPropertiesBlock("#metadata((a: 1)) <other>", "typst")).toBeNull();
    expect(findPropertiesBlock("= Notes\n#metadata((a: 1)) <properties>", "typst")).toBeNull();
  });
});

describe("Seeing a note's properties", () => {
  it("shows them as a table at the top of the note, instead of the raw block", async () => {
    const editor = await openNote("Paper.md");

    const table = await properties();

    expect(await within(table).findByRole("spinbutton", { name: "year" })).toHaveValue(2017);
    expect(within(table).getByRole("checkbox", { name: "read" })).not.toBeChecked();
    expect(editor).toHaveTextContent("Notes on the paper.");
    expect(editor).not.toHaveTextContent("---");
  });

  it("reads Typst notes' #metadata block", async () => {
    await openNote("Paper.typ");

    const table = await properties();

    expect(await within(table).findByRole("spinbutton", { name: "year" })).toHaveValue(2017);
    expect(api.parseProperties).toHaveBeenCalledWith("typst", "#metadata((\nyear: 2017\n)) <properties>");
  });

  it("shows each kind of value with a fitting field", async () => {
    notes["Paper.md"] =
      "---\ntitle: Attention\nyear: 2017\nread: true\npublished: 2017-06-12\nauthors: [Vaswani, Shazeer]\n---\n";
    await openNote("Paper.md");
    const table = await properties();

    expect(await within(table).findByRole("combobox", { name: "title" })).toHaveValue("Attention");
    expect(within(table).getByRole("spinbutton", { name: "year" })).toHaveValue(2017);
    expect(within(table).getByRole("checkbox", { name: "read" })).toBeChecked();
    expect(within(table).getByLabelText("published")).toHaveValue("2017-06-12");
    expect(within(table).getByRole("combobox", { name: "authors" })).toHaveValue("Vaswani, Shazeer");
  });

  it("values the table can't edit are shown as written", async () => {
    notes["Paper.md"] = "---\nvenue: {nested}\n---\n";
    await openNote("Paper.md");

    const table = await properties();

    expect(await within(table).findByText("{nested}")).toBeInTheDocument();
    expect(within(table).queryByRole("combobox", { name: "venue" })).not.toBeInTheDocument();
  });

  it("explains when the properties can't be read", async () => {
    vi.mocked(api.parseProperties).mockRejectedValue("The properties have a mistake: line 2.");
    await openNote("Paper.md");

    const table = await properties();

    expect(await within(table).findByRole("alert")).toHaveTextContent(
      "The properties have a mistake: line 2.",
    );
  });

  it("'Edit as text' shows the block itself in the editor, to edit by hand", async () => {
    const editor = await openNote("Paper.md");
    const table = await properties();

    await userEvent.click(within(table).getByRole("button", { name: "Edit properties as text" }));

    expect(editor).toHaveTextContent("year: 2017");
    expect(screen.queryByRole("group", { name: "Properties" })).not.toBeInTheDocument();
  });
});

describe("Editing properties", () => {
  it("changing a value rewrites the block in the note and saves it", async () => {
    const editor = await openNote("Paper.md");
    const year = await within(await properties()).findByRole("spinbutton", { name: "year" });

    await userEvent.clear(year);
    await userEvent.type(year, "2018{Enter}");

    await vi.waitFor(() =>
      expect(api.writeProperties).toHaveBeenLastCalledWith("markdown", [
        { key: "year", value: { type: "number", value: 2018 }, raw: null },
        { key: "read", value: { type: "boolean", value: false }, raw: "read: false" },
      ]),
    );
    await vi.waitFor(() =>
      expect(textIn(editor)).toBe("---\nyear: 2018\nread: false\n---\nNotes on the paper."),
    );
    // (Saved after the usual pause; a busy computer can take longer.)
    await vi.waitFor(
      () => expect(api.saveNote).toHaveBeenCalledWith("Paper.md", expect.stringContaining("year: 2018")),
      { timeout: 3000 },
    );
  });

  it("ticking a yes/no value saves it straight away", async () => {
    const editor = await openNote("Paper.md");
    const read = await within(await properties()).findByRole("checkbox", { name: "read" });

    await userEvent.click(read);

    await vi.waitFor(() => expect(textIn(editor)).toContain("read: true"));
  });

  it("lists are typed with commas between the items", async () => {
    notes["Paper.md"] = "---\ntags: [ml]\n---\n";
    const editor = await openNote("Paper.md");
    const tags = await within(await properties()).findByRole("combobox", { name: "tags" });

    await userEvent.clear(tags);
    await userEvent.type(tags, "ml, attention ,{Enter}");

    await vi.waitFor(() => expect(textIn(editor)).toContain("tags: [ml, attention]"));
  });

  it("renaming a property keeps its value", async () => {
    const editor = await openNote("Paper.md");
    const name = await within(await properties()).findByRole("combobox", { name: "Name of year" });

    await userEvent.clear(name);
    await userEvent.type(name, "published{Enter}");

    await vi.waitFor(() => expect(textIn(editor)).toContain("published: 2017"));
  });

  it("a property can change type, e.g. from text to a list", async () => {
    notes["Paper.md"] = "---\nauthors: Vaswani, Shazeer\n---\n";
    const editor = await openNote("Paper.md");
    const type = await within(await properties()).findByRole("combobox", { name: "Type of authors" });

    await userEvent.selectOptions(type, "List");

    await vi.waitFor(() => expect(textIn(editor)).toContain("authors: [Vaswani, Shazeer]"));
  });

  it("removing a property takes it out of the block", async () => {
    const editor = await openNote("Paper.md");
    const table = await properties();

    await userEvent.click(await within(table).findByRole("button", { name: "Remove year" }));

    await vi.waitFor(() => expect(textIn(editor)).toBe("---\nread: false\n---\nNotes on the paper."));
  });

  it("removing the last property removes the whole block", async () => {
    notes["Paper.md"] = "---\nyear: 2017\n---\nNotes on the paper.";
    const editor = await openNote("Paper.md");
    const table = await properties();

    await userEvent.click(await within(table).findByRole("button", { name: "Remove year" }));

    await vi.waitFor(() => expect(textIn(editor)).toBe("Notes on the paper."));
  });

  it("adding a property adds a new row to name", async () => {
    const editor = await openNote("Paper.md");
    const table = await properties();

    await userEvent.click(await within(table).findByRole("button", { name: "Add property" }));

    await vi.waitFor(() => expect(textIn(editor)).toContain("property: \n---"));
    await vi.waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Name of property" })).toHaveFocus(),
    );
  });

  it("the first property of a note creates the block at its top", async () => {
    const editor = await openNote("Plain.md");

    await userEvent.click(await screen.findByRole("button", { name: "Add property" }));

    await vi.waitFor(() => expect(textIn(editor)).toBe("---\nproperty: \n---\nJust notes."));
  });

  it("Typst notes get a #metadata block", async () => {
    notes["Plain.typ"] = "Just notes.";
    vi.mocked(api.listFiles).mockResolvedValue([file("Plain.typ")]);
    const editor = await openNote("Plain.typ");

    await userEvent.click(await screen.findByRole("button", { name: "Add property" }));

    await vi.waitFor(() =>
      expect(textIn(editor)).toBe("#metadata((\nproperty: \n)) <properties>\nJust notes."),
    );
  });
});

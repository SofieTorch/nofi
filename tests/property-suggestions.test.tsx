// Suggestions in the properties table: names and values the workspace's other notes use (see
// src-tauri/tests/property_suggestions.rs for what's suggested). These tests are about using them.

import { EditorView } from "@codemirror/view";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";
import { useFakeProperties } from "./support/fake-properties";

vi.mock("../src/api");

const known: api.KnownProperty[] = [
  { key: "year", kind: "number", notes: 12, values: [] },
  { key: "authors", kind: "list", notes: 9, values: ["Vaswani", "Hinton", "LeCun"] },
  { key: "status", kind: "text", notes: 7, values: ["done", "reading", "to read"] },
  { key: "tags", kind: "list", notes: 5, values: ["ml", "attention", "vision"] },
];

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  useFakeProperties();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = {
    "Paper.md": "---\nyear: 2017\nstatus: \ntags: [ml]\n---\nNotes.",
    "Plain.md": "Notes.",
  };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  vi.mocked(api.suggestProperties).mockResolvedValue(known);
});

async function openNote(name = "Paper.md") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name });
}

const textIn = (editor: HTMLElement) => EditorView.findFromDOM(editor)!.state.doc.toString();
const suggestions = () => screen.findByRole("listbox");
const shown = async () =>
  within(await suggestions())
    .getAllByRole("option")
    .map((option) => option.textContent);

/** Adds a property and waits until its name is ready to type. */
async function addProperty() {
  await userEvent.click(await screen.findByRole("button", { name: "Add property" }));
  await vi.waitFor(() => expect(screen.getByRole("combobox", { name: "Name of property" })).toHaveFocus());
}

describe("Suggested property names", () => {
  it("a new property's name suggests the names other notes use, except ones this note has", async () => {
    await openNote();

    await addProperty();

    expect(await shown()).toEqual(["authors"]);
  });

  it("a note without properties gets every name suggested", async () => {
    await openNote("Plain.md");

    await addProperty();

    expect(await shown()).toEqual(["year", "authors", "status", "tags"]);
  });

  it("typing narrows the suggestions down", async () => {
    await openNote("Plain.md");
    await addProperty();

    await userEvent.keyboard("ta");

    expect(await shown()).toEqual(["status", "tags"]);
  });

  it("choosing a name uses it, with the type that property usually has", async () => {
    const editor = await openNote("Plain.md");
    await addProperty();

    await userEvent.keyboard("aut{Enter}");

    await vi.waitFor(() => expect(textIn(editor)).toBe("---\nauthors: []\n---\nNotes."));
  });

  it("names can be chosen with the arrow keys or a click", async () => {
    const editor = await openNote("Plain.md");
    await addProperty();

    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    await vi.waitFor(() => expect(textIn(editor)).toContain("authors: []"));

    await addProperty();
    await userEvent.click(within(await suggestions()).getByRole("option", { name: "status" }));
    await vi.waitFor(() => expect(textIn(editor)).toContain("status: "));
  });

  it("a name that isn't suggested can still be typed", async () => {
    const editor = await openNote("Plain.md");
    await addProperty();

    await userEvent.keyboard("venue");
    await vi.waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(textIn(editor)).toBe("---\nvenue: \n---\nNotes."));
  });

  it("Escape closes the suggestions and keeps what was typed", async () => {
    await openNote("Plain.md");
    await addProperty();
    await suggestions();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Name of property" })).toHaveValue("property");
  });
});

describe("Suggested values", () => {
  it("a text value suggests values that property has in other notes", async () => {
    const editor = await openNote();
    const status = await screen.findByRole("combobox", { name: "status" });

    await userEvent.click(status);
    expect(await shown()).toEqual(["done", "reading", "to read"]);

    await userEvent.keyboard("rea{Enter}");
    await vi.waitFor(() => expect(textIn(editor)).toContain("status: reading"));
  });

  it("a list suggests items for the one being typed, leaving out ones already in it", async () => {
    const editor = await openNote();
    const tags = await screen.findByRole("combobox", { name: "tags" });

    await userEvent.click(tags);
    await userEvent.keyboard("{End}, ");
    expect(await shown()).toEqual(["attention", "vision"]);

    await userEvent.keyboard("vi{Enter}");
    expect(tags).toHaveValue("ml, vision, ");
    await userEvent.keyboard("{Enter}");

    await vi.waitFor(() => expect(textIn(editor)).toContain("tags: [ml, vision]"));
  });

  it("closed suggestions open again with Ctrl+Space or ⌘I (Ctrl+I on Windows and Linux)", async () => {
    await openNote();
    const status = await screen.findByRole("combobox", { name: "status" });
    await userEvent.click(status);
    await suggestions();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await userEvent.keyboard("{Control>} {/Control}");
    expect(await shown()).toEqual(["done", "reading", "to read"]);

    await userEvent.keyboard("{Escape}");
    await userEvent.keyboard("{Control>}i{/Control}");
    expect(await shown()).toEqual(["done", "reading", "to read"]);
    expect(status).toHaveValue("");
  });

  it("Edit › Show Suggestions opens them too", async () => {
    await openNote();
    const status = await screen.findByRole("combobox", { name: "status" });
    await userEvent.click(status);
    await userEvent.keyboard("{Escape}");

    await chooseInMenu("Edit › Show Suggestions");

    expect(await shown()).toEqual(["done", "reading", "to read"]);
  });

  it("properties nobody has used yet suggest nothing", async () => {
    vi.mocked(api.suggestProperties).mockResolvedValue([]);
    await openNote();
    const status = await screen.findByRole("combobox", { name: "status" });

    await userEvent.click(status);
    await userEvent.keyboard("x");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
});

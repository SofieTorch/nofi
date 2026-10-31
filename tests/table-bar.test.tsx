// The table bar: with the cursor in a table, a bar above it adds and removes rows and columns,
// turns the header row on and off, and sets a caption. What each change writes is specified in
// src-tauri/tests/table_editing.rs; these tests are about the bar.

import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const TABLE = "#table(\n  columns: 2,\n  [Model], [Year],\n  [BERT], [2018],\n)";
const BIGGER = "#table(\n  columns: 2,\n  [Model], [Year],\n  [], [],\n  [BERT], [2018],\n)";
const info: api.TableInfo = { columns: 2, rows: 2, header: false, caption: null, row: 0, column: 0 };

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": `Intro.\n${TABLE}\nAfter.`, "Todo.md": "Plain" };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  vi.mocked(api.tableInfo).mockResolvedValue(info);
  vi.mocked(api.editTable).mockResolvedValue({ block: BIGGER, cursor: TABLE.indexOf("[BERT]") + 1 });
});

async function openNote(name = "Paper.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  const editor = await screen.findByRole("textbox", { name });
  return EditorView.findFromDOM(editor)!;
}

function putCursor(view: EditorView, at: number) {
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: at } });
  });
}

const inTable = (view: EditorView, part: string) => view.state.doc.toString().indexOf(part, "Intro.\n".length);
const bar = () => screen.findByRole("toolbar", { name: "Table" });
/** A button in the bar, once the table has been read (the bar shows its buttons after that). */
const barButton = async (name: string) => within(await bar()).findByRole("button", { name });

describe("The table bar", () => {
  it("shows up with the cursor in a table, with what can be changed", async () => {
    const view = await openNote();

    putCursor(view, inTable(view, "Model"));

    const buttons = (await within(await bar()).findAllByRole("button")).map((b) => b.getAttribute("aria-label"));
    expect(buttons).toEqual(["Add row below", "Add column right", "Delete row", "Delete column", "Header row", "Caption"]);
    expect(api.tableInfo).toHaveBeenCalledWith(TABLE, TABLE.indexOf("Model"));
  });

  it("isn't there with the cursor outside tables", async () => {
    const view = await openNote();

    putCursor(view, 2);

    expect(screen.queryByRole("toolbar", { name: "Table" })).not.toBeInTheDocument();
  });

  it("a change rewrites the table in the note and puts the cursor in the cell it's about", async () => {
    const view = await openNote();
    putCursor(view, inTable(view, "Model"));

    await userEvent.click(await barButton("Add row below"));

    expect(api.editTable).toHaveBeenCalledWith(TABLE, TABLE.indexOf("Model"), { action: "addRowBelow" });
    expect(view.state.doc.toString()).toBe(`Intro.\n${BIGGER}\nAfter.`);
    expect(view.state.selection.main.head).toBe("Intro.\n".length + TABLE.indexOf("[BERT]") + 1);
  });

  it("shows whether the table has a header row, and turns it on or off", async () => {
    vi.mocked(api.tableInfo).mockResolvedValue({ ...info, header: true });
    const view = await openNote();
    putCursor(view, inTable(view, "Model"));

    const header = await barButton("Header row");
    await vi.waitFor(() => expect(header).toHaveAttribute("aria-pressed", "true"));
    await userEvent.click(header);

    expect(api.editTable).toHaveBeenCalledWith(TABLE, expect.any(Number), { action: "toggleHeader" });
  });

  it("the last row or column can't be deleted", async () => {
    vi.mocked(api.tableInfo).mockResolvedValue({ ...info, rows: 1, columns: 1 });
    const view = await openNote();
    putCursor(view, inTable(view, "Model"));

    await vi.waitFor(async () => expect(await barButton("Delete row")).toBeDisabled());
    expect(await barButton("Delete column")).toBeDisabled();
  });

  it("asks for a caption, and sets it", async () => {
    const view = await openNote();
    putCursor(view, inTable(view, "Model"));

    await userEvent.click(await barButton("Caption"));
    await userEvent.type(await screen.findByRole("textbox", { name: "Caption" }), "Models compared{Enter}");

    expect(api.editTable).toHaveBeenCalledWith(TABLE, expect.any(Number), { action: "setCaption", value: "Models compared" });
  });

  it("an existing caption can be removed", async () => {
    vi.mocked(api.tableInfo).mockResolvedValue({ ...info, caption: "Old" });
    const view = await openNote();
    putCursor(view, inTable(view, "Model"));

    await userEvent.click(await barButton("Caption"));
    expect(await screen.findByRole("textbox", { name: "Caption" })).toHaveValue("Old");
    await userEvent.click(screen.getByRole("button", { name: "Remove caption" }));

    expect(api.editTable).toHaveBeenCalledWith(TABLE, expect.any(Number), { action: "setCaption", value: null });
  });

  it("a table written in a way it can't change says so", async () => {
    vi.mocked(api.tableInfo).mockRejectedValue("This table can only be changed as code.");
    const view = await openNote();

    putCursor(view, inTable(view, "Model"));

    await vi.waitFor(async () => expect(await bar()).toHaveTextContent("This table can only be changed as code."));
    expect(within(await bar()).queryByRole("button")).not.toBeInTheDocument();
  });

  it("Markdown notes don't get it", async () => {
    notes["Todo.md"] = TABLE;
    const view = await openNote("Todo.md");

    putCursor(view, TABLE.indexOf("Model"));
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(screen.queryByRole("toolbar", { name: "Table" })).not.toBeInTheDocument();
  });
});

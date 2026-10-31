// The table editor: while writing, a table is shown as Typst draws it; clicking it opens a grid of
// cells to type in, with a bar to add and remove rows and columns, the header row and the caption.
// Leaving the table turns it back into a picture. What each change writes (and how it
// stays valid) is specified in src-tauri/tests/table_editing.rs.

import { EditorView } from "@codemirror/view";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const TABLE = "#table(\n  columns: 2,\n  table.header[*Model*][*Year*],\n  [BERT], [2018],\n)";
const cell = (text: string, start: number, editable = true): api.TableCell => ({ text, start, editable });
const cells: api.TableCells = {
  columns: 2,
  header: [cell("*Model*", 37), cell("*Year*", 46)],
  rows: [[cell("BERT", 57), cell("2018", 65)]],
  caption: null,
};
const EDITED = TABLE.replace("2018", "2019");

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": `Intro.\n${TABLE}\nAfter.` };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  vi.mocked(api.readTable).mockResolvedValue(cells);
  vi.mocked(api.editTable).mockResolvedValue({ block: EDITED, cursor: 66 });
});

async function openNote() {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Paper.typ" }));
  return screen.findByRole("textbox", { name: "Paper.typ" });
}

const grid = () => screen.findByRole("grid");

/** Clicks the table's picture, which opens the editor. */
async function openTableEditor(editor: HTMLElement) {
  await userEvent.click(await within(editor).findByRole("img", { name: "Table" }));
  return grid();
}
const cellField = async (name: string) => within(await grid()).findByRole("textbox", { name });
const textIn = (editor: HTMLElement) => EditorView.findFromDOM(editor)!.state.doc.toString();
const editorBar = async () => within(await screen.findByRole("group", { name: "Table editor" })).getByRole("toolbar");

describe("The table editor", () => {
  it("while writing, a table is shown as Typst draws it", async () => {
    const editor = await openNote();

    expect(await within(editor).findByRole("img", { name: "Table" })).toBeInTheDocument();
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("clicking it opens the editor, ready to type in the first cell", async () => {
    const editor = await openNote();

    await openTableEditor(editor);

    await vi.waitFor(async () => expect(await cellField("Row 1, column 1")).toHaveFocus());
  });

  it("clicking elsewhere in the note turns it back into a picture", async () => {
    const editor = await openNote();
    await openTableEditor(editor);
    await vi.waitFor(async () => expect(await cellField("Row 1, column 1")).toHaveFocus());

    await userEvent.click(within(editor).getByText("Intro."));

    await vi.waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
    expect(await within(editor).findByRole("img", { name: "Table" })).toBeInTheDocument();
  });

  it("Escape also turns it back into a picture", async () => {
    const editor = await openNote();
    await openTableEditor(editor);
    await vi.waitFor(async () => expect(await cellField("Row 1, column 1")).toHaveFocus());

    await userEvent.keyboard("{Escape}");

    await vi.waitFor(() => expect(screen.queryByRole("grid")).not.toBeInTheDocument());
  });

  it("shows a table as a grid of cells, header and all", async () => {
    const editor = await openNote();
    await openTableEditor(editor);

    expect(await cellField("Header 1")).toHaveValue("*Model*");
    expect(await cellField("Row 1, column 2")).toHaveValue("2018");
    expect(api.readTable).toHaveBeenCalledWith(TABLE);
  });

  it("typing in a cell and pressing Enter writes it into the table", async () => {
    const editor = await openNote();
    await openTableEditor(editor);
    const year = await cellField("Row 1, column 2");

    await userEvent.clear(year);
    await userEvent.type(year, "2019{Enter}");

    expect(api.editTable).toHaveBeenCalledWith(TABLE, 65, {
      action: "setCell",
      value: { row: 0, column: 1, text: "2019" },
    });
    await vi.waitFor(() => expect(textIn(editor)).toBe(`Intro.\n${EDITED}\nAfter.`));
  });

  it("Tab saves the cell and moves to the next one", async () => {
    await openTableEditor(await openNote());
    const model = await cellField("Row 1, column 1");

    await userEvent.click(model);
    await userEvent.keyboard("{End}X{Tab}");

    expect(api.editTable).toHaveBeenCalledWith(TABLE, 57, {
      action: "setCell",
      value: { row: 0, column: 0, text: "BERTX" },
    });
    await vi.waitFor(async () => expect(await cellField("Row 1, column 2")).toHaveFocus());
  });

  it("Escape puts the cell back as it was", async () => {
    await openTableEditor(await openNote());
    const year = await cellField("Row 1, column 2");

    await userEvent.type(year, "99{Escape}");

    expect(year).toHaveValue("2018");
    expect(api.editTable).not.toHaveBeenCalled();
  });

  it("its bar adds a row where the cell being edited is", async () => {
    await openTableEditor(await openNote());
    await userEvent.click(await cellField("Row 1, column 2"));

    await userEvent.click(within(await editorBar()).getByRole("button", { name: "Add row below" }));

    expect(api.editTable).toHaveBeenCalledWith(TABLE, 65, { action: "addRowBelow" });
  });

  it("its bar shows and switches the header row", async () => {
    await openTableEditor(await openNote());

    const header = within(await editorBar()).getByRole("button", { name: "Header row" });
    expect(header).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(header);

    expect(api.editTable).toHaveBeenCalledWith(TABLE, expect.any(Number), { action: "toggleHeader" });
  });

  it("a caption is shown under the table and can be changed", async () => {
    vi.mocked(api.readTable).mockResolvedValue({ ...cells, caption: "Models" });
    await openTableEditor(await openNote());
    const caption = await screen.findByRole("textbox", { name: "Caption" });
    expect(caption).toHaveValue("Models");

    await userEvent.clear(caption);
    await userEvent.type(caption, "Models compared{Enter}");

    expect(api.editTable).toHaveBeenCalledWith(TABLE, expect.any(Number), {
      action: "setCaption",
      value: "Models compared",
    });
  });

  it("'Edit as code' shows the table's code", async () => {
    const editor = await openNote();
    await openTableEditor(editor);

    await userEvent.click(within(await editorBar()).getByRole("button", { name: "Edit as code" }));

    expect(editor).toHaveTextContent("columns: 2");
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });

  it("cells written as code can't be typed in", async () => {
    vi.mocked(api.readTable).mockResolvedValue({ ...cells, rows: [[cell("BERT", 57), cell('"2018"', 65, false)]] });
    await openTableEditor(await openNote());

    expect(await cellField("Row 1, column 2")).toHaveAttribute("readonly");
  });

  it("a table it can't edit opens as code when clicked", async () => {
    vi.mocked(api.readTable).mockRejectedValue("This table can only be changed as code.");
    const editor = await openNote();

    await userEvent.click(await within(editor).findByRole("img", { name: "Table" }));

    await vi.waitFor(() => expect(editor).toHaveTextContent("columns: 2"));
    expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  });
});

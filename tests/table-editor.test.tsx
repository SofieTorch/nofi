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
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const TABLE = "#table(\n  columns: 2,\n  table.header[*Model*][*Year*],\n  [BERT], [2018],\n)";
const cell = (text: string, start: number, editable = true): api.TableCell => ({ text, start, editable });
const cells: api.TableCells = {
  columns: 2,
  header: [cell("*Model*", 37), cell("*Year*", 46)],
  rows: [[cell("BERT", 57), cell("2018", 65)]],
  caption: null,
  style: {
    lines: "all",
    striped: false,
    shadedHeader: false,
    align: ["left", "left"],
    spacing: "normal",
    widths: "auto",
  },
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

describe("Undo in the table editor", () => {
  const ADDED = "#table(\n  columns: 2,\n  table.header[*Model*][*Year*],\n  [BERT], [2018],\n  [], [],\n)";

  beforeEach(() => {
    vi.mocked(api.editTable).mockResolvedValue({ block: ADDED, cursor: 70 });
  });

  async function addRow(editor: HTMLElement) {
    await openTableEditor(editor);
    await userEvent.click(await cellField("Row 1, column 2"));
    await userEvent.click(within(await editorBar()).getByRole("button", { name: "Add row below" }));
    await vi.waitFor(() => expect(textIn(editor)).toBe(`Intro.\n${ADDED}\nAfter.`));
  }

  it("Edit › Undo takes back adding a row", async () => {
    const editor = await openNote();
    await addRow(editor);

    await chooseInMenu("Edit › Undo");

    await vi.waitFor(() => expect(textIn(editor)).toBe(`Intro.\n${TABLE}\nAfter.`));
  });

  it("Ctrl+Z in a cell takes back adding a row, and the editor stays open", async () => {
    const editor = await openNote();
    await addRow(editor);

    await userEvent.keyboard("{Control>}z{/Control}");

    await vi.waitFor(() => expect(textIn(editor)).toBe(`Intro.\n${TABLE}\nAfter.`));
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });

  it("Undo leaves the note's cursor at the table, so the note doesn't jump to its start", async () => {
    const editor = await openNote();
    await addRow(editor);

    await userEvent.keyboard("{Control>}z{/Control}");

    await vi.waitFor(() => expect(textIn(editor)).toBe(`Intro.\n${TABLE}\nAfter.`));
    expect(EditorView.findFromDOM(editor)!.state.selection.main.head).toBe("Intro.\n".length);
  });

  it("Ctrl+Shift+Z puts the row back", async () => {
    const editor = await openNote();
    await addRow(editor);
    await userEvent.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(textIn(editor)).toBe(`Intro.\n${TABLE}\nAfter.`));

    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");

    await vi.waitFor(() => expect(textIn(editor)).toBe(`Intro.\n${ADDED}\nAfter.`));
  });

  it("Ctrl+Z while typing in a cell still undoes the typing first", async () => {
    await openTableEditor(await openNote());
    const year = await cellField("Row 1, column 2");

    await userEvent.type(year, "9");
    await userEvent.keyboard("{Control>}z{/Control}");

    expect(api.editTable).not.toHaveBeenCalled();
  });
});

describe("Styling a table", () => {
  async function openStyleMenu() {
    await openTableEditor(await openNote());
    await userEvent.click(within(await editorBar()).getByRole("button", { name: "Table style" }));
    return screen.findByRole("dialog", { name: "Table style" });
  }
  const withStyle = (style: Partial<api.TableStyle>) =>
    vi.mocked(api.readTable).mockResolvedValue({ ...cells, style: { ...cells.style, ...style } });

  it("the style menu shows the table's lines, and choosing others sets them", async () => {
    const menu = await openStyleMenu();

    expect(within(menu).getByRole("button", { name: "All lines" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(menu).getByRole("button", { name: "Academic" }));

    expect(api.editTable).toHaveBeenCalledWith(TABLE, expect.any(Number), { action: "setLines", value: "academic" });
  });

  it("offers every kind of lines", async () => {
    const menu = await openStyleMenu();

    for (const name of ["All lines", "Between rows", "Academic", "No lines"]) {
      expect(within(menu).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("striped rows and a shaded header switch on and off", async () => {
    withStyle({ striped: true });
    const menu = await openStyleMenu();

    const striped = within(menu).getByRole("button", { name: "Striped rows" });
    expect(striped).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(striped);
    expect(api.editTable).toHaveBeenCalledWith(TABLE, expect.any(Number), { action: "setStriped", value: false });

    await userEvent.click(within(menu).getByRole("button", { name: "Shaded header" }));
    // (The table has changed by now.)
    expect(api.editTable).toHaveBeenLastCalledWith(expect.any(String), expect.any(Number), {
      action: "setShadedHeader",
      value: true,
    });
  });

  it("a shaded header needs a header row", async () => {
    vi.mocked(api.readTable).mockResolvedValue({ ...cells, header: null });
    const menu = await openStyleMenu();

    expect(within(menu).getByRole("button", { name: "Shaded header" })).toBeDisabled();
  });

  it("sets the room inside cells", async () => {
    const menu = await openStyleMenu();

    expect(within(menu).getByRole("button", { name: "Normal" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(menu).getByRole("button", { name: "Compact" }));

    expect(api.editTable).toHaveBeenCalledWith(TABLE, expect.any(Number), { action: "setSpacing", value: "compact" });
  });

  it("makes the columns equal, or fit their content", async () => {
    const menu = await openStyleMenu();

    expect(within(menu).getByRole("button", { name: "Fit content" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(menu).getByRole("button", { name: "Equal widths" }));

    expect(api.editTable).toHaveBeenCalledWith(TABLE, expect.any(Number), { action: "setWidths", value: "equal" });
  });

  it("a setting written as code shows as custom, with no choice picked", async () => {
    withStyle({ lines: null });
    const menu = await openStyleMenu();

    expect(within(menu).getByRole("button", { name: "All lines" })).toHaveAttribute("aria-pressed", "false");
    expect(within(menu).getByText(/custom/i)).toBeInTheDocument();
  });

  it("Escape closes the style menu, and the table editor stays open", async () => {
    await openStyleMenu();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Table style" })).not.toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });
});

describe("Aligning a column", () => {
  it("the bar aligns the column being edited", async () => {
    await openTableEditor(await openNote());
    await userEvent.click(await cellField("Row 1, column 2"));

    await userEvent.click(within(await editorBar()).getByRole("button", { name: "Align right" }));

    expect(api.editTable).toHaveBeenCalledWith(TABLE, 65, { action: "setAlign", value: { column: 1, align: "right" } });
  });

  it("shows the column's alignment, in the bar and in its cells", async () => {
    vi.mocked(api.readTable).mockResolvedValue({ ...cells, style: { ...cells.style, align: ["left", "center"] } });
    await openTableEditor(await openNote());
    await userEvent.click(await cellField("Row 1, column 2"));

    expect(within(await editorBar()).getByRole("button", { name: "Align center" })).toHaveAttribute("aria-pressed", "true");
    expect(await cellField("Row 1, column 2")).toHaveStyle({ textAlign: "center" });
  });
});

// Tables, figures and grids drawn in the writing view, like maths: written as their own block,
// they're shown as Typst draws them, and as code while the cursor is in them.

import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { findDrawnBlocks } from "../src/editor/drawnBlocks";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const TABLE = "#table(\n  columns: 2,\n  [Model], [Year],\n  [Transformer], [2017],\n)";

/** The blocks found in the text, as the text they cover. */
const found = (text: string) => findDrawnBlocks(text).map((block) => text.slice(block.from, block.to));

describe("Finding the blocks to draw", () => {
  it("finds a table written as its own block, over several lines", () => {
    expect(found(`Intro.\n${TABLE}\nAfter.`)).toEqual([TABLE]);
  });

  it("finds figures and grids too, and says which kind each is", () => {
    const text = "#figure(table(columns: 1, [A]), caption: [Results])\n#grid(columns: 2, [L], [R])";

    expect(findDrawnBlocks(text).map((block) => block.kind)).toEqual(["figure", "grid"]);
  });

  it("finds lines too, so they're shown as lines", () => {
    expect(findDrawnBlocks("Above\n#line(length: 100%)\nBelow").map((block) => block.kind)).toEqual(["line"]);
  });

  it("isn't confused by brackets inside text or quotes", () => {
    const tricky = '#table(columns: 1, [a) note (b], [")"], [nested #text(red)[x]])';

    expect(found(tricky)).toEqual([tricky]);
  });

  it("only draws blocks that stand on their own lines", () => {
    expect(found(`Text before ${TABLE}`)).toEqual([]);
    expect(found(`${TABLE} and text after`)).toEqual([]);
  });

  it("doesn't draw a table that isn't finished yet", () => {
    expect(found("#table(\n  columns: 2,\n  [Model]")).toEqual([]);
  });

  it("a table inside a figure is drawn as part of the figure", () => {
    const figure = "#figure(\n  table(columns: 1, [A]),\n  caption: [Results],\n)";

    expect(found(figure)).toEqual([figure]);
  });
});

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": `Intro.\n${TABLE}\nAfter.`, "Todo.md": TABLE };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

async function openNote(name = "Paper.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name });
}

describe("Drawn blocks in the editor", () => {
  it("a table is shown as Typst draws it", async () => {
    const editor = await openNote();

    expect(await within(editor).findByRole("img", { name: "Table" })).toBeInTheDocument();
    expect(api.renderBlock).toHaveBeenCalledWith(TABLE);
    expect(editor).not.toHaveTextContent("columns: 2");
  });

  it("clicking it shows its code, to edit", async () => {
    const editor = await openNote();
    const table = await within(editor).findByRole("img", { name: "Table" });

    await userEvent.click(table);

    expect(within(editor).queryByRole("img", { name: "Table" })).not.toBeInTheDocument();
    expect(editor).toHaveTextContent("columns: 2");
  });

  it("moving the cursor into it shows its code too, and leaving draws it again", async () => {
    const editor = await openNote();
    await within(editor).findByRole("img", { name: "Table" });
    const view = EditorView.findFromDOM(editor)!;

    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: "Intro.\n#tab".length } });
    });
    expect(editor).toHaveTextContent("columns: 2");

    act(() => view.dispatch({ selection: { anchor: 0 } }));
    expect(await within(editor).findByRole("img", { name: "Table" })).toBeInTheDocument();
  });

  it("if Typst can't draw it, its code stays visible, so its mistake can be seen and fixed", async () => {
    vi.mocked(api.renderBlock).mockRejectedValue("Unknown variable: bleu.");
    const editor = await openNote();

    await vi.waitFor(() => expect(api.renderBlock).toHaveBeenCalled());

    await vi.waitFor(() => expect(editor).toHaveTextContent("columns: 2"));
    expect(within(editor).queryByRole("img", { name: "Table" })).not.toBeInTheDocument();
  });

  it("a line is shown as Typst draws it, and as code when clicked", async () => {
    notes["Paper.typ"] = "Above\n#line(length: 100%)\nBelow";
    const editor = await openNote();

    const line = await within(editor).findByRole("img", { name: "Line" });
    expect(api.renderBlock).toHaveBeenCalledWith("#line(length: 100%)");

    await userEvent.click(line);
    expect(editor).toHaveTextContent("#line(length: 100%)");
  });

  it("Markdown notes don't draw Typst blocks", async () => {
    const editor = await openNote("Todo.md");
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(api.renderBlock).not.toHaveBeenCalled();
    expect(editor).toHaveTextContent("columns: 2");
  });
});

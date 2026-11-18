// Footnotes and comments in the writing view's margins, like a book's sidenotes: a footnote
// becomes a number in the text with its note on the right; a comment (// …) a small mark with its
// text on the left. Clicking one shows its code, to edit.

import { EditorView } from "@codemirror/view";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = {
    "Paper.typ":
      "Every decision is a tradeoff#footnote[Of course this isn't always true.].\nMature engineers weigh both sides#footnote[Mostly.]. // check this claim\nThe end.",
  };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

async function openNote() {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Paper.typ" }));
  return screen.findByRole("textbox", { name: "Paper.typ" });
}

describe("Footnotes in the margin", () => {
  it("a footnote is a number in the text, numbered in order", async () => {
    const editor = await openNote();

    const references = within(editor).getAllByRole("doc-noteref");
    expect(references.map((reference) => reference.firstChild?.textContent)).toEqual(["1", "2"]);
    expect(editor).toHaveTextContent("Every decision is a tradeoff1");
    expect(editor).not.toHaveTextContent("#footnote");
  });

  it("its text is in the right margin, with its number", async () => {
    const editor = await openNote();

    const footnote = within(editor).getByRole("note", { name: "Footnote 1" });

    expect(footnote).toHaveTextContent("1. Of course this isn't always true.");
    expect(within(footnote).getByText("1.").tagName).toBe("STRONG");
    expect(footnote).toHaveClass("cm-margin-right");
  });

  it("clicking it shows the footnote's code, to edit", async () => {
    const editor = await openNote();

    await userEvent.click(within(editor).getByRole("note", { name: "Footnote 1" }));

    expect(editor).toHaveTextContent("#footnote[Of course this isn't always true.]");
    const view = EditorView.findFromDOM(editor)!;
    expect(view.state.sliceDoc(view.state.selection.main.head, view.state.selection.main.head + 9)).toBe("Of course");
  });
});

describe("Links in footnotes", () => {
  it("a footnote's link can be clicked, to follow it", async () => {
    notes = { "Paper.typ": 'A claim#footnote[See #link("Other.typ")[the other note].].', "Other.typ": "Other text." };
    vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
    const editor = await openNote();

    await userEvent.click(within(within(editor).getByRole("note", { name: "Footnote 1" })).getByText("the other note"));

    expect(await screen.findByRole("textbox", { name: "Other.typ" })).toHaveTextContent("Other text.");
  });
});

describe("Comments in the margin", () => {
  it("a comment's text is in the left margin, not in the text", async () => {
    const editor = await openNote();

    const comment = within(editor).getByRole("note", { name: "Comment" });

    expect(comment).toHaveTextContent("check this claim");
    expect(comment).toHaveClass("cm-margin-left");
    // In the text, a message icon marks where the comment is.
    expect(comment.closest(".cm-comment-ref")?.querySelector("svg")).toBeInTheDocument();
    expect(editor).not.toHaveTextContent("//");
  });

  it("clicking it shows the comment, to edit", async () => {
    const editor = await openNote();

    await userEvent.click(within(editor).getByRole("note", { name: "Comment" }));

    expect(editor).toHaveTextContent("// check this claim");
  });
});

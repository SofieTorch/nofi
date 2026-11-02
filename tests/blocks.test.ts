// Blocks: the pieces of a note that can be moved around, like Notion's. A heading, a paragraph,
// a list item (with what's nested under it), a code block, a table, an equation, columns… Moving
// one keeps the note's text tidy: paragraphs stay a blank line apart, list items stay together.

import { describe, expect, it } from "vitest";
import { findBlocks, moveBlock } from "../src/editor/blocks";
import { CHECKLIST_RULE } from "../src/editor/checklists";

const blockTexts = (text: string, format: "typst" | "markdown" = "typst") =>
  findBlocks(text, format).map((block) => text.slice(block.from, block.to));
const kinds = (text: string, format: "typst" | "markdown" = "typst") => findBlocks(text, format).map((b) => b.kind);

/** Moves the block whose text starts with `what` before or after the one starting with `where`. */
function move(text: string, what: string, side: "before" | "after", where: string, format: "typst" | "markdown" = "typst") {
  const blocks = findBlocks(text, format);
  const block = blocks.find((b) => text.slice(b.from).startsWith(what))!;
  const target = blocks.find((b) => text.slice(b.from).startsWith(where))!;
  return moveBlock(text, format, block, { block: target, side }).text;
}

describe("Finding a Typst note's blocks", () => {
  const NOTE = [
    "= Title",
    "First paragraph",
    "still the first.",
    "",
    "- item one",
    "  - nested",
    "- item two",
    "",
    "```py",
    "code",
    "",
    "```",
    "",
    "#table(",
    "  columns: 2,",
    "",
    "  [a], [b],",
    ")",
    "$ x =",
    "  y $",
    "#columns(2)[",
    "A",
    "",
    "#colbreak()",
    "B",
    "]",
    "Last.",
  ].join("\n");

  it("each heading, paragraph, list item, code block, table, equation and columns is one", () => {
    expect(blockTexts(NOTE)).toEqual([
      "= Title",
      "First paragraph\nstill the first.",
      "- item one\n  - nested",
      "- item two",
      "```py\ncode\n\n```",
      "#table(\n  columns: 2,\n\n  [a], [b],\n)",
      "$ x =\n  y $",
      "#columns(2)[\nA\n\n#colbreak()\nB\n]",
      "Last.",
    ]);
  });

  it("knows what kind each is", () => {
    expect(kinds(NOTE)).toEqual(["heading", "paragraph", "list", "list", "code", "other", "other", "columns", "paragraph"]);
  });

  it("a style written across lines stays in its paragraph", () => {
    expect(blockTexts("Some #highlight[marked\n\ntext] here.\n\nNext.")).toEqual(["Some #highlight[marked\n\ntext] here.", "Next."]);
  });

  it("a code block with line numbers (the #[ … ] around it) is one block", () => {
    const wrapped = "#[\n#show raw.line: it => [#box(width: 2em, text(fill: luma(150), str(it.number)))#it.body]\n```py\ny = 2\n```\n]";

    expect(blockTexts(`Text.\n${wrapped}\nLast.`)).toEqual(["Text.", wrapped, "Last."]);
    expect(kinds(`Text.\n${wrapped}\nLast.`)).toEqual(["paragraph", "code", "paragraph"]);
  });

  it("a table or a line right after text is a block of its own", () => {
    expect(blockTexts("Text.\n#table(columns: 1, [a])\nMore.\n#line(length: 100%)\nEnd.")).toEqual([
      "Text.",
      "#table(columns: 1, [a])",
      "More.",
      "#line(length: 100%)",
      "End.",
    ]);
  });

  it("the checklist rule isn't a block", () => {
    expect(blockTexts(`${CHECKLIST_RULE}- [ ] Buy milk`)).toEqual(["- [ ] Buy milk"]);
  });

  it("the properties at the top aren't a block", () => {
    expect(blockTexts('#metadata((status: "draft")) <properties>\nText.')).toEqual(["Text."]);
  });
});

describe("Finding a Markdown note's blocks", () => {
  it("headings, paragraphs, list items, quotes, tables and code blocks", () => {
    const note = "# Title\nText\nmore text.\n\n- one\n- two\n\n> quoted\n> still\n\n| a | b |\n| - | - |\n\n```\ncode\n```";

    expect(blockTexts(note, "markdown")).toEqual([
      "# Title",
      "Text\nmore text.",
      "- one",
      "- two",
      "> quoted\n> still",
      "| a | b |\n| - | - |",
      "```\ncode\n```",
    ]);
  });

  it("the properties at the top aren't a block", () => {
    expect(blockTexts("---\nstatus: draft\n---\nText.", "markdown")).toEqual(["Text."]);
  });
});

describe("Moving a block", () => {
  const PARAGRAPHS = "A para.\n\nB para.\n\nC para.";

  it("after another: paragraphs stay a blank line apart", () => {
    expect(move(PARAGRAPHS, "A", "after", "C")).toBe("B para.\n\nC para.\n\nA para.");
  });

  it("before another", () => {
    expect(move(PARAGRAPHS, "C", "before", "A")).toBe("C para.\n\nA para.\n\nB para.");
  });

  it("into the middle", () => {
    expect(move(PARAGRAPHS, "A", "after", "B")).toBe("B para.\n\nA para.\n\nC para.");
  });

  it("list items stay a list, without blank lines", () => {
    expect(move("- one\n- two\n- three", "- three", "before", "- one")).toBe("- three\n- one\n- two");
  });

  it("a list item takes what's nested under it along", () => {
    expect(move("- a\n  - a1\n- b", "- a", "after", "- b")).toBe("- b\n- a\n  - a1");
  });

  it("a paragraph next to a list gets a blank line", () => {
    expect(move("Intro.\n\n- one\n- two", "- two", "before", "Intro.")).toBe("- two\n\nIntro.\n\n- one");
  });

  it("a code block moves whole", () => {
    expect(move("Text.\n\n```\na\n\nb\n```", "```", "before", "Text.")).toBe("```\na\n\nb\n```\n\nText.");
  });

  it("taking one out from between two paragraphs keeps them apart", () => {
    expect(move("A.\n= H\nB.", "= H", "after", "B.")).toBe("A.\n\nB.\n\n= H");
  });

  it("dropping it where it already is changes nothing", () => {
    expect(move(PARAGRAPHS, "A", "before", "B")).toBe(PARAGRAPHS);
    expect(move(PARAGRAPHS, "B", "after", "A")).toBe(PARAGRAPHS);
  });

  it("works the same in Markdown", () => {
    expect(move("# H\n\nText.", "Text.", "before", "# H", "markdown")).toBe("Text.\n\n# H");
  });

  it("says where the moved block starts now", () => {
    const blocks = findBlocks(PARAGRAPHS, "typst");

    expect(moveBlock(PARAGRAPHS, "typst", blocks[0], { block: blocks[2], side: "after" }).cursor).toBe("B para.\n\nC para.\n\n".length);
  });
});

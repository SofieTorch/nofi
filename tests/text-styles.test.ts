// Adding and removing styles on selected text (the format toolbar, ⌘B, ⌘I). The examples are in
// tests/fixtures/style-toggles.json, shared with the Rust tests, which check each Typst result is
// valid Typst.

import { describe, expect, it } from "vitest";
import type { Format } from "../src/editor/formatting";
import {
  availableStyles,
  type BlockType,
  blockTypeAt,
  indent,
  turnInto,
  type Option,
  optionsAt,
  setOption,
  type Style,
  stylesAt,
  toggleStyle,
} from "../src/editor/styles";
import examples from "./fixtures/style-toggles.json";

/** Text and selection from text with « and » around the selected part. */
function parse(marked: string) {
  const from = marked.indexOf("«");
  const to = marked.indexOf("»") - 1;
  return { text: marked.replace("«", "").replace("»", ""), from, to };
}

type Example = {
  before: string;
  style?: string;
  option?: string;
  value?: string | null;
  turnInto?: string;
  indent?: string;
};

/** The text after the example's change, with « and » around what's selected then. */
function changed(format: Format, example: Example) {
  const { text, from, to } = parse(example.before);
  const selection = { from, to };
  const edit = example.option
    ? setOption(text, format, selection, example.option as Option, example.value ?? null)
    : example.turnInto
      ? turnInto(text, format, selection, example.turnInto as BlockType)
      : example.indent
        ? indent(text, format, selection, example.indent as "in" | "out")
        : toggleStyle(text, format, selection, example.style as Style);
  if (!edit) return null;
  let result = text;
  for (const change of [...edit.changes].sort((a, b) => b.from - a.from)) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to);
  }
  const { from: start, to: end } = edit.selection;
  return `${result.slice(0, start)}«${result.slice(start, end)}»${result.slice(end)}`;
}

for (const format of ["typst", "markdown"] as const) {
  describe(`Styling selected text in ${format === "typst" ? "Typst" : "Markdown"} notes`, () => {
    for (const example of examples[format]) {
      it(example.name, () => {
        expect(changed(format, example as Example)).toBe(example.after);
      });
    }
  });
}

describe("Which styles a selection has", () => {
  const at = (format: Format, marked: string) => {
    const { text, from, to } = parse(marked);
    return stylesAt(text, format, { from, to });
  };

  it("finds the styles around the selected text", () => {
    expect(at("typst", "A #highlight[*«key»*] idea.")).toEqual(["highlight", "bold"]);
    expect(at("typst", "Read «more» papers.")).toEqual([]);
  });

  it("counts #strong and #emph as bold and italic", () => {
    expect(at("typst", "sn#strong[«ake»] #emph[x]")).toEqual(["bold"]);
  });

  it("finds styles that span several lines, nested", () => {
    expect(at("typst", "#highlight[very *important\n«idea»*]")).toEqual(["highlight", "bold"]);
  });

  it("a selection only partly inside a style doesn't have it", () => {
    expect(at("typst", "Read *mo«re* pa»pers.")).toEqual([]);
  });
});

describe("A selection's settings", () => {
  const at = (marked: string) => {
    const { text, from, to } = parse(marked);
    return optionsAt(text, "typst", { from, to });
  };

  it("finds the size, font and indent too", () => {
    expect(at('#pad(left: 4em)[#text(font: "Arial", size: 2em)[«x»]]')).toEqual({ size: "2em", font: "Arial", indent: "4em" });
  });

  it("finds the colour, highlight colour, link and alignment around the selection", () => {
    expect(at('#align(center)[#link("https://typst.app")[#text(fill: red)[#highlight(fill: aqua)[«x»]]]]')).toEqual({
      align: "center",
      link: "https://typst.app",
      colour: "red",
      highlight: "aqua",
    });
  });

  it("reads a colour among other settings, even with commas in quotes", () => {
    expect(at('#text(font: "A, B", fill: rgb("#e03e3e"), size: 2em)[«x»]')).toEqual({
      colour: 'rgb("#e03e3e")',
      size: "2em",
      font: "A, B",
    });
  });

  it("a plain highlight has the default colour, and plain text has no settings", () => {
    expect(at("#highlight[«x»]")).toEqual({ highlight: "default" });
    expect(at("«x»")).toEqual({});
  });
});

describe("What kind of block the selection is in", () => {
  const at = (format: Format, marked: string) => {
    const { text, from, to } = parse(marked);
    return blockTypeAt(text, format, { from, to });
  };

  it("finds headings, lists, quotes and callouts, and plain text otherwise", () => {
    expect(at("typst", "== «Title»")).toBe("heading-2");
    expect(at("typst", "  - «item»")).toBe("bulleted-list");
    expect(at("typst", "+ «item»")).toBe("numbered-list");
    expect(at("typst", "#quote(block: true)[«x»]")).toBe("quote");
    expect(at("typst", "#block(fill: luma(240))[«x»]")).toBe("callout");
    expect(at("typst", "Just «text»")).toBe("text");
    expect(at("markdown", "> «wise»")).toBe("quote");
    expect(at("markdown", "1. «item»")).toBe("numbered-list");
  });
});

describe("Which styles can be applied", () => {
  it("Typst notes offer everything Typst can do with text", () => {
    expect(availableStyles("typst")).toEqual([
      "bold",
      "italic",
      "highlight",
      "strikethrough",
      "underline",
      "smallcaps",
      "superscript",
      "subscript",
      "overline",
      "uppercase",
      "lowercase",
      "footnote",
      "code",
      "maths",
      "justify",
    ]);
  });

  it("Markdown notes offer what Markdown has", () => {
    expect(availableStyles("markdown")).toEqual(["bold", "italic", "strikethrough", "highlight", "code"]);
  });

  it("code and maths can't be applied across lines", () => {
    expect(toggleStyle("one\ntwo", "typst", { from: 0, to: 7 }, "code")).toBeNull();
    expect(toggleStyle("one\ntwo", "typst", { from: 0, to: 7 }, "maths")).toBeNull();
  });
});

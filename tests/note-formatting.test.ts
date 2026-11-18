// How the editor shows a note as you type: what's formatted, and which markers (like the stars
// around *bold*) are hidden. Markers only show up where the cursor is, so you can edit them.

import { describe, expect, it } from "vitest";
import {
  drawnMaths,
  findFormatting,
  hiddenMarkers,
  type Format,
} from "../src/editor/formatting";

/** Each formatted piece of the note, e.g. "bold: *more*". */
function formatted(text: string, format: Format = "typst") {
  return findFormatting(text, format).map(
    (span) => `${span.kind}${span.level ? ` ${span.level}` : ""}: ${text.slice(span.from, span.to)}`,
  );
}

/** What you see with the cursor at `|` (hidden markers left out). */
function shown(textWithCursor: string, format: Format = "typst") {
  const cursor = textWithCursor.indexOf("|");
  const text = textWithCursor.replace("|", "");
  const hidden = hiddenMarkers(findFormatting(text, format), [{ from: cursor, to: cursor }], text);
  let result = "";
  for (let i = 0; i < text.length; i++) {
    if (!hidden.some((m) => i >= m.from && i < m.to)) result += text[i];
  }
  return result;
}

describe("Typst notes", () => {
  describe("what's formatted", () => {
    it("'=' at the start of a line makes a heading; more '=' make a smaller one", () => {
      expect(formatted("= Ideas\n== Reading\n=== Later")).toEqual([
        "heading 1: = Ideas",
        "heading 2: == Reading",
        "heading 3: === Later",
      ]);
    });

    it("'=' in the middle of a line isn't a heading", () => {
      expect(formatted("a = b")).toEqual([]);
    });

    it("*stars* make text bold and _underscores_ make it italic", () => {
      expect(formatted("Read *more* papers _slowly_")).toEqual([
        "bold: *more*",
        "italic: _slowly_",
      ]);
    });

    it("bold and italic can be combined", () => {
      expect(formatted("*very _important_*")).toEqual([
        "bold: *very _important_*",
        "italic: _important_",
      ]);
    });

    it("a single star or underscore on its own changes nothing", () => {
      expect(formatted("2 * 3 and snake_case")).toEqual([]);
    });

    it("a backslash keeps a star as a plain star", () => {
      expect(formatted("\\*not bold\\*")).toEqual(["escape: \\*", "escape: \\*"]);
    });

    it("code like #metadata(…) isn't text: underscores in it don't start italics", () => {
      const text = '#metadata((\nsource: "Rust_08_Ownership.pdf"\n)) <properties>\nNotes on #link("Rust_08_Ownership.pdf")[Rust 08 Ownership].';
      expect(formatted(text)).toEqual(['link: #link("Rust_08_Ownership.pdf")[Rust 08 Ownership]']);
    });

    it("an underscore before a link doesn't pair with one in its address", () => {
      expect(formatted('my_var: #link("a_b.pdf")[a b]')).toEqual(['link: #link("a_b.pdf")[a b]']);
    });

    it("something not closed yet is just text, and the rest of the note keeps its formatting", () => {
      expect(formatted("a $x and *b*\n\n#highlight[c *d* `e\n\n/* f\n\n_g_")).toEqual(["bold: *b*", "bold: *d*", "italic: _g_"]);
    });

    it("a lone star inside a style doesn't undo the style", () => {
      expect(formatted("#highlight[2 * 3]")).toEqual(["highlight: #highlight[2 * 3]"]);
    });

    it("text in the brackets of other code is formatted", () => {
      expect(formatted("#figure(caption: [a *b*])[c _d_]")).toEqual(["bold: *b*", "italic: _d_"]);
    });

    it("so does a function's name", () => {
      expect(formatted("#my_fn and _this_")).toEqual(["italic: _this_"]);
    });

    it("`backticks` show code, and nothing inside them is formatted", () => {
      expect(formatted("run `a *b* c` now")).toEqual(["code: `a *b* c`"]);
    });

    it("$dollars$ mark maths, and nothing inside them is formatted", () => {
      expect(formatted("so $a * b * c$ holds")).toEqual(["math: $a * b * c$"]);
    });

    it("'-' and '+' at the start of a line make list items", () => {
      expect(formatted("- milk\n  - oat\n+ first")).toEqual([
        "list-item: - ",
        "list-item: - ",
        "list-item: + ",
      ]);
    });

    it("'//' starts a comment that runs to the end of the line", () => {
      expect(formatted("text // *note to self*")).toEqual(["comment: // *note to self*"]);
    });

    it("Typst's style functions are formatted too: #highlight, #strike, #underline, #smallcaps", () => {
      expect(
        formatted("#highlight[key] #strike[old] #underline[note] #smallcaps[Name]"),
      ).toEqual([
        "highlight: #highlight[key]",
        "strikethrough: #strike[old]",
        "underline: #underline[note]",
        "smallcaps: #smallcaps[Name]",
      ]);
    });

    it("more of Typst's text functions are formatted: super, sub, overline, upper, lower, link", () => {
      expect(
        formatted('10#super[th] H#sub[2]O #overline[x] #upper[loud] #lower[QUIET] #link("https://typst.app")[Typst]'),
      ).toEqual([
        "superscript: #super[th]",
        "subscript: #sub[2]",
        "overline: #overline[x]",
        "uppercase: #upper[loud]",
        "lowercase: #lower[QUIET]",
        'link: #link("https://typst.app")[Typst]',
      ]);
    });

    it("#text(…)[…] with settings like a colour, and their settings are kept with the span", () => {
      const text = '#text(fill: rgb("#e03e3e"))[red] #highlight(fill: rgb("#fbe4e4"))[pink]';
      const spans = findFormatting(text, "typst");
      expect(spans.map((s) => [s.kind, s.args])).toEqual([
        ["text", 'fill: rgb("#e03e3e")'],
        ["highlight", 'fill: rgb("#fbe4e4")'],
      ]);
    });

    it("alignment and justified paragraphs are formatted too", () => {
      expect(formatted("#align(center)[Title]\n#par(justify: true)[Long text]")).toEqual([
        "align: #align(center)[Title]",
        "justify: #par(justify: true)[Long text]",
      ]);
    });

    it("block quotes, callouts and indents are formatted, with their settings", () => {
      const text =
        "#quote(block: true)[Wise words]\n#block(fill: luma(240), inset: 10pt, radius: 4pt, width: 100%)[Note]\n#pad(left: 2em)[Indented]";
      expect(findFormatting(text, "typst").map((s) => [s.kind, s.args])).toEqual([
        ["quote", "block: true"],
        ["callout", "fill: luma(240), inset: 10pt, radius: 4pt, width: 100%"],
        ["indent", "left: 2em"],
      ]);
    });

    it("an inline quote is a quotation, not a block quote; a block without a background isn't a callout", () => {
      expect(formatted("#quote[inline] #block(width: 50%)[box]")).toEqual(["quotation: #quote[inline]"]);
    });

    it("footnotes are formatted", () => {
      expect(formatted("A claim#footnote[see the paper].")).toEqual(["footnote: #footnote[see the paper]"]);
    });

    it("#strong[…] is bold and #emph[…] is italic, like * and _", () => {
      expect(formatted("#strong[a] #emph[b]")).toEqual(["bold: #strong[a]", "italic: #emph[b]"]);
    });

    it("style functions can have settings and other styles inside", () => {
      expect(formatted("#highlight(fill: aqua)[very *key* idea]")).toEqual([
        "highlight: #highlight(fill: aqua)[very *key* idea]",
        "bold: *key*",
      ]);
    });

    it("brackets inside a style function's text don't end it early", () => {
      expect(formatted("#highlight[a [b] c]")).toEqual(["highlight: #highlight[a [b] c]"]);
    });

    it("a style function that's never closed isn't formatted", () => {
      expect(formatted("#highlight[never closed\nstill open")).toEqual([]);
    });
  });

  describe("styles over several lines", () => {
    it("a style function can span lines, even blank ones", () => {
      expect(formatted("#highlight[first line\nsecond line\n\nnext paragraph] after")).toEqual([
        "highlight: #highlight[first line\nsecond line\n\nnext paragraph]",
      ]);
    });

    it("*bold* and _italic_ can continue onto the next line of a paragraph", () => {
      expect(formatted("Some *bold\ntext* and _italic\ntext_.")).toEqual([
        "bold: *bold\ntext*",
        "italic: _italic\ntext_",
      ]);
    });

    it("but not past a blank line, like in Typst", () => {
      expect(formatted("*not\n\nbold* here")).toEqual([]);
    });

    it("styles can be nested over several lines", () => {
      expect(formatted("#highlight[very *important\nidea* and\n#strike[old #underline[new]]]")).toEqual([
        "highlight: #highlight[very *important\nidea* and\n#strike[old #underline[new]]]",
        "bold: *important\nidea*",
        "strikethrough: #strike[old #underline[new]]",
        "underline: #underline[new]",
      ]);
    });

    it("a heading at the very start of a style's text is a heading, like in Typst", () => {
      expect(formatted("#align(center)[= Title]")).toEqual(["align: #align(center)[= Title]", "heading 1: = Title"]);
      expect(formatted("*= not a heading*")).toEqual(["bold: *= not a heading*"]);
    });

    it("headings and lists still work inside a style that spans lines", () => {
      expect(formatted("#highlight[\n= Title\n- item\n]")).toEqual([
        "highlight: #highlight[\n= Title\n- item\n]",
        "heading 1: = Title",
        "list-item: - ",
      ]);
    });

    it("maths and code can go on over several lines, like in Typst; comments end with their line", () => {
      expect(formatted("$a\nb$ `c\nd` // e\nf")).toEqual(["math: $a\nb$", "code: `c\nd`", "comment: // e"]);
    });

    it("hides a multi-line style's syntax unless the cursor is somewhere in it", () => {
      expect(shown("|Then #highlight[first\nsecond] after")).toBe("Then first\nsecond after");
      expect(shown("Then #highlight[first\nsec|ond] after")).toBe("Then #highlight[first\nsecond] after");
    });

    it("Markdown's styles can continue onto the next line too", () => {
      expect(formatted("**bold\ntext** and ~~old\ntext~~", "markdown")).toEqual([
        "bold: **bold\ntext**",
        "strikethrough: ~~old\ntext~~",
      ]);
    });

    it("'//' inside a link isn't a comment", () => {
      expect(formatted("see https://typst.app")).toEqual([]);
    });
  });

  describe("which markers are hidden", () => {
    it("hides the stars and underscores when the cursor is elsewhere", () => {
      expect(shown("|Read *more* papers _slowly_")).toBe("Read more papers slowly");
    });

    it("shows them around the word the cursor is in, so you can edit them", () => {
      expect(shown("Read *mo|re* papers _slowly_")).toBe("Read *more* papers slowly");
    });

    it("shows them when the cursor is right next to them", () => {
      expect(shown("Read *more*| papers")).toBe("Read *more* papers");
    });

    it("hides a heading's '=' unless the cursor is on that line", () => {
      expect(shown("= Ideas\n|text")).toBe("Ideas\ntext");
      expect(shown("= Ide|as\ntext")).toBe("= Ideas\ntext");
    });

    it("hides a style function's syntax unless the cursor is in it", () => {
      expect(shown("|Read #highlight[this] now")).toBe("Read this now");
      expect(shown("Read #highlight[th|is] now")).toBe("Read #highlight[this] now");
      expect(shown("|Note: #highlight(fill: aqua)[key]")).toBe("Note: key");
    });

    it("hides an inline quote's syntax unless the cursor is in it (it's shown in quotation marks)", () => {
      expect(shown("|See #quote[the passage] p. 3")).toBe("See the passage p. 3");
      expect(shown("See #quote[the pas|sage] p. 3")).toBe("See #quote[the passage] p. 3");
    });

    it("hides a backslash before a character unless the cursor is next to it", () => {
      expect(shown("|costs \\$5 \\* 2")).toBe("costs $5 * 2");
      expect(shown("costs \\|$5")).toBe("costs \\$5");
    });

    it("hides code's backticks when the cursor is elsewhere", () => {
      expect(shown("|run `ls` now")).toBe("run ls now");
    });

    it("never hides maths, comments or list markers", () => {
      expect(shown("|$x$ // note\n- item")).toBe("$x$ // note\n- item");
    });

    it("every cursor shows the markers it's in, when there are several", () => {
      const text = "*a* *b* *c*";
      const hidden = hiddenMarkers(
        findFormatting(text, "typst"),
        [
          { from: 1, to: 1 },
          { from: 9, to: 9 },
        ],
        text,
      );
      expect(hidden.map((m) => text.slice(m.from, m.to))).toEqual(["*", "*"]);
    });
  });
});

describe("Code blocks", () => {
  for (const format of ["typst", "markdown"] as const) {
    it(`\`\`\` fences make a code block in ${format} notes, and nothing inside is formatted`, () => {
      const text = "Before\n```python\nx = 2 * 3 * 4  # *not bold*\n```\nAfter *bold*";

      expect(formatted(text, format)).toEqual([
        "codeblock: ```python\nx = 2 * 3 * 4  # *not bold*\n```",
        // One star is bold in Typst, italic in Markdown.
        format === "typst" ? "bold: *bold*" : "italic: *bold*",
      ]);
    });
  }

  it("keeps the code block's language", () => {
    expect(findFormatting("```rust\nfn main() {}\n```", "typst")[0].args).toBe("rust");
  });

  it("a code block without a language has none", () => {
    expect(findFormatting("```\nplain\n```", "typst")[0].args).toBe("");
  });

  it("fences that are never closed don't make a code block", () => {
    expect(formatted("```\nstill *typing*")).toEqual(["bold: *typing*"]);
  });

  it("its fences are never hidden by the formatting (the code block shows them its own way)", () => {
    expect(shown("|```\ncode\n```")).toBe("```\ncode\n```");
  });
});

describe("Maths in Typst notes", () => {
  /** The maths drawn as formulas with the cursor at `|`; the rest is shown as Typst source. */
  function drawn(textWithCursor: string) {
    const cursor = textWithCursor.indexOf("|");
    const text = textWithCursor.replace("|", "");
    const spans = findFormatting(text, "typst");
    return drawnMaths(spans, [{ from: cursor, to: cursor }]).map((m) => text.slice(m.from, m.to));
  }

  it("maths is drawn when the cursor is elsewhere", () => {
    expect(drawn("|So $x^2$ and $y$ hold.")).toEqual(["$x^2$", "$y$"]);
  });

  it("the maths the cursor is in, or right next to, shows its source so you can edit it", () => {
    expect(drawn("So $x|^2$ and $y$ hold.")).toEqual(["$y$"]);
    expect(drawn("So $x^2$| and $y$ hold.")).toEqual(["$y$"]);
  });

  it("maths with spaces inside the dollars is a display equation", () => {
    const spans = findFormatting("$ x^2 $ and $x^2$", "typst");
    expect(spans.map((s) => s.display)).toEqual([true, false]);
  });
});

describe("Markdown notes", () => {
  it("'#' at the start of a line makes a heading", () => {
    expect(formatted("# Ideas\n## Reading", "markdown")).toEqual([
      "heading 1: # Ideas",
      "heading 2: ## Reading",
    ]);
  });

  it("**double stars** make text bold and *single stars* or _underscores_ make it italic", () => {
    expect(formatted("**bold** *italic* _also_", "markdown")).toEqual([
      "bold: **bold**",
      "italic: *italic*",
      "italic: _also_",
    ]);
  });

  it("'-', '*', '+' and '1.' at the start of a line make list items", () => {
    expect(formatted("- a\n* b\n+ c\n1. d", "markdown")).toEqual([
      "list-item: - ",
      "list-item: * ",
      "list-item: + ",
      "list-item: 1. ",
    ]);
  });

  it("hides the markers the same way as in Typst", () => {
    expect(shown("|# Ideas\n**more**", "markdown")).toBe("# Ideas\nmore");
    expect(shown("# Ideas\n|**more**", "markdown")).toBe("Ideas\n**more**");
  });

  it("~~double tildes~~ cross text out", () => {
    expect(formatted("~~old~~ new", "markdown")).toEqual(["strikethrough: ~~old~~"]);
  });

  it("==double equals== highlight text, like in Obsidian", () => {
    expect(formatted("A ==key== idea", "markdown")).toEqual(["highlight: ==key=="]);
  });

  it("[text](address) is a link, its address kept with it", () => {
    const spans = findFormatting("See [Typst](https://typst.app) now", "markdown");
    expect(spans.map((s) => [s.kind, s.args])).toEqual([["link", "https://typst.app"]]);
  });

  it("hides a link's brackets and address unless the cursor is in it", () => {
    expect(shown("|See [Typst](https://typst.app) now", "markdown")).toBe("See Typst now");
  });

  it("a line of three dashes (after a blank line) is a divider", () => {
    expect(formatted("Above\n\n---\n\nBelow", "markdown")).toEqual(["divider: ---"]);
  });

  it("dashes right under text make that text a heading in Markdown, not a divider", () => {
    expect(formatted("Title\n---", "markdown")).not.toContain("divider: ---");
  });

  it("has no '//' comments", () => {
    expect(formatted("a // b", "markdown")).toEqual([]);
  });
});

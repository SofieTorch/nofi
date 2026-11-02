// Breaking a paragraph inside styled text, like Notion or Word do: Enter closes every style open
// at the cursor before the break and opens it again after, so each paragraph is whole on its own
// and looks as before. Joining the paragraphs again (⌫ at the start of the second) merges the
// styles that match, giving back the text as it was.
// In the cases below, "|" is the cursor.

import { describe, expect, it } from "vitest";
import { type Format } from "../src/editor/formatting";
import { joinAt, splitAt } from "../src/editor/styleBreaks";

/** The note after Enter at the "|", with "|" where the cursor ends up ("line" for a plain line break). */
function enter(note: string, format: Format = "typst") {
  const pos = note.indexOf("|");
  const text = note.replace("|", "");
  const split = splitAt(text, format, pos);
  if (split === "line") return "line";
  const after = text.slice(0, split.from) + split.insert + text.slice(split.to);
  return after.slice(0, split.cursor) + "|" + after.slice(split.cursor);
}

/** The note after ⌫ at the "|" (the start of a paragraph), or null if the styles don't merge. */
function backspace(note: string, format: Format = "typst") {
  const pos = note.indexOf("|");
  const text = note.replace("|", "");
  const join = joinAt(text, format, pos);
  if (!join) return null;
  const after = text.slice(0, join.from) + text.slice(join.to);
  return after.slice(0, join.from) + "|" + after.slice(join.from);
}

describe("Enter inside styled text", () => {
  it("outside any style, it's a plain paragraph break", () => {
    expect(enter("Hello |world")).toBe("Hello \n\n|world");
  });

  it("splits bold into two bold parts", () => {
    expect(enter("*Hello wo|rld*")).toBe("*Hello wo*\n\n*|rld*");
  });

  it("splits a style function, like highlight", () => {
    expect(enter("#highlight[Hello wo|rld]")).toBe("#highlight[Hello wo]\n\n#highlight[|rld]");
  });

  it("splits any function with text in brackets, keeping its settings", () => {
    expect(enter('#footnote[See th|is]')).toBe("#footnote[See th]\n\n#footnote[|is]");
    expect(enter("#text(fill: red, size: 14pt)[Big te|xt]")).toBe(
      "#text(fill: red, size: 14pt)[Big te]\n\n#text(fill: red, size: 14pt)[|xt]",
    );
    expect(enter("#my-style[a|b]")).toBe("#my-style[a]\n\n#my-style[|b]");
    expect(enter("#[a|b]")).toBe("#[a]\n\n#[|b]");
  });

  it("splits nested styles, every one of them", () => {
    expect(enter("#text(fill: red)[#highlight[*Hel|lo*] there]")).toBe(
      "#text(fill: red)[#highlight[*Hel*]]\n\n#text(fill: red)[#highlight[*|lo*] there]",
    );
  });

  it("keeps the text around the styles where it was", () => {
    expect(enter("Some *bold te|xt* here.")).toBe("Some *bold te*\n\n*|xt* here.");
  });

  it("at the end of styled text, leaves no empty style behind", () => {
    expect(enter("*Hello|* there")).toBe("*Hello*\n\n| there");
    expect(enter("#highlight[*Hello|*]")).toBe("#highlight[*Hello*]\n\n|");
  });

  it("at the start of styled text, leaves no empty style behind", () => {
    expect(enter("Say *|hello*")).toBe("Say \n\n*|hello*");
  });

  it("inside a function's settings, it's a plain line break", () => {
    expect(enter("#text(fill: red,| size: 2pt)[a]")).toBe("line");
  });

  it("in a function's first text when it has more, it's a plain line break", () => {
    expect(enter("*#grid[a|][b]*")).toBe("line");
  });

  it("splits Markdown styles too", () => {
    expect(enter("**Hello wo|rld**", "markdown")).toBe("**Hello wo**\n\n**|rld**");
    expect(enter("[a li|nk](https://x.org)", "markdown")).toBe("[a li](https://x.org)\n\n[|nk](https://x.org)");
  });

  it("a # in code isn't a function", () => {
    expect(enter("`#highlight[` a|b")).toBe("`#highlight[` a\n\n|b");
  });
});

describe("⌫ at the start of a paragraph after a split", () => {
  it("merges the styles back, giving the text as it was", () => {
    expect(backspace("*Hello wo*\n\n|*rld*")).toBe("*Hello wo|rld*");
    expect(backspace("#highlight[Hello wo]\n\n|#highlight[rld]")).toBe("#highlight[Hello wo|rld]");
  });

  it("merges nested styles, as deep as they match", () => {
    expect(backspace("#text(fill: red)[#highlight[*Hel*]]\n\n|#text(fill: red)[#highlight[*lo*] there]")).toBe(
      "#text(fill: red)[#highlight[*Hel|lo*] there]",
    );
    expect(backspace("#highlight[*Hel*]\n\n|#highlight[lo]")).toBe("#highlight[*Hel*|lo]");
  });

  it("doesn't merge styles with different settings", () => {
    expect(backspace("#text(fill: red)[a]\n\n|#text(fill: blue)[b]")).toBeNull();
  });

  it("does nothing special when the paragraphs don't end and start with the same style", () => {
    expect(backspace("*a*\n\n|b")).toBeNull();
    expect(backspace("a\n\n|*b*")).toBeNull();
  });

  it("works in Markdown too", () => {
    expect(backspace("**Hello wo**\n\n|**rld**", "markdown")).toBe("**Hello wo|rld**");
  });

  it("splitting and joining again gives back the same text", () => {
    const note = "Intro #text(fill: red)[#highlight[*Hel|lo*] there] end.";
    const split = enter(note) as string;

    expect(backspace(split.replace("|", "").replace("\n\n", "\n\n|"))).toBe(note);
  });
});

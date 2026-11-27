// Finding words in a PDF's text. pdf.js gives a page's text in pieces that often split words (at a
// ligature like "fi", or where a line ends), so the pieces are joined as they are, with a space only
// where a line ends; and a word broken over two lines, or by a hyphen, is still found. Curly and
// straight quotes, and the kinds of dashes, are found as each other. The text laid over a page reads
// the same, so each match there is highlighted where it is. The text is read in a way that works in
// the app's webview (Safari's), which can't go through a stream with `for await`.

import { describe, expect, it } from "vitest";
import { matchesIn } from "../src/ui/FindBar";
import { joinTextItems, layerFindText, readTextItems } from "../src/workspace/pdfText";

// What pdf.js gave for a justified Typst paragraph.
const ITEMS = [
  { str: "Ray Data: A Dynamic System defines the exact sched", hasEOL: false },
  { str: "", hasEOL: true },
  { str: "uling and backpressure model. Morsel", hasEOL: false },
  { str: " ", hasEOL: false },
  { str: "Driven Parallelism, “quoted” text, and", hasEOL: false },
  { str: " ", hasEOL: false },
  { str: "fi", hasEOL: false },
  { str: "nal ligatures.", hasEOL: false },
];

const found = (text: string, query: string) => matchesIn(text, query, true).map((m) => text.slice(m.from, m.to));

describe("A PDF page's text", () => {
  it("its pieces are joined as they are, with a space where a line ends", () => {
    expect(joinTextItems(ITEMS)).toBe(
      "Ray Data: A Dynamic System defines the exact sched uling and backpressure model. Morsel Driven Parallelism, “quoted” text, and final ligatures.",
    );
  });

  it("a word split at a ligature is found", () => {
    expect(found(joinTextItems(ITEMS), "final")).toEqual(["final"]);
  });

  it("a word broken over two lines is found", () => {
    expect(found(joinTextItems(ITEMS), "scheduling")).toEqual(["sched uling"]);
    expect(found("atten-\ntion and atten- tion", "attention")).toEqual(["atten-\ntion", "atten- tion"]);
  });

  it("a hyphen is found as a hyphen or a space, and dashes as each other", () => {
    expect(found(joinTextItems(ITEMS), "Morsel-Driven")).toEqual(["Morsel Driven"]);
    expect(found("Morsel–Driven", "morsel-driven")).toEqual(["Morsel–Driven"]);
  });

  it("curly and straight quotes are found as each other", () => {
    expect(found(joinTextItems(ITEMS), '"quoted"')).toEqual(["“quoted”"]);
  });

  it("words still have to be whole: one word isn't found inside two", () => {
    expect(found("a cat at home", "cat")).toEqual(["cat"]);
    expect(found(joinTextItems(ITEMS), "Data")).toEqual(["Data"]);
  });

  it("the text laid over the page reads the same, line ends and all", () => {
    const layer = document.createElement("div");
    for (const item of ITEMS) {
      const span = document.createElement("span");
      span.textContent = item.str;
      layer.append(span);
      if (item.hasEOL) layer.append(document.createElement("br"));
    }

    const { text, chars } = layerFindText(layer);

    expect(text).toBe(joinTextItems(ITEMS));
    expect(chars).toHaveLength(text.length);
    const at = text.indexOf("final");
    expect(chars[at].node.data).toBe("fi");
    expect(chars[at + 2].node.data).toBe("nal ligatures.");
  });
});

describe("In a note", () => {
  it("text is found as it's written (ignoring case), so replacing changes only that", () => {
    expect(matchesIn("final fi nal", "final").length).toBe(1);
  });
});

describe("Reading a page's text from pdf.js", () => {
  it("works where a stream can't be gone through with for await (as in Safari)", async () => {
    const chunks = [{ items: ITEMS.slice(0, 3) }, { items: ITEMS.slice(3) }];
    const stream = new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });
    Object.defineProperty(stream, Symbol.asyncIterator, { value: undefined });

    expect(joinTextItems(await readTextItems(stream))).toBe(joinTextItems(ITEMS));
  });
});

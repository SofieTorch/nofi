// Finding words in a PDF's text. pdf.js gives a page's text in pieces that often split words (at a
// ligature like "fi", or where a line ends), so the pieces are joined as they are, with a space only
// where a line ends; and a word broken over two lines, or by a hyphen, is still found. Curly and
// straight quotes, and the kinds of dashes, are found as each other. The text laid over a page reads
// the same, so each match there is highlighted where it is. The text is read in a way that works in
// the app's webview (Safari's), which can't go through a stream with `for await`.
//
// The text laid over a page is in the PDF's own fonts, where it has them: in the stand-in fonts
// pdf.js would pick (serif, sans-serif), letters are wider or narrower than on the page, so
// highlights and selections drifted off the words they're on. And a justified line's extra width
// is in its spaces, as on the page, rather than stretching every letter (which pushed the words
// further off the further along the line they were).

import { describe, expect, it } from "vitest";
import { matchesIn } from "../src/ui/FindBar";
import { entryAt, figureName, figureRegion, inPdfFonts, isFigureLink, spaceSpread, joinTextItems, layerFindText, readTextContent, readTextItems } from "../src/workspace/pdfText";

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

describe("The text laid over a page", () => {
  const stream = (chunks: object[]) =>
    new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });

  it("is read whole from pdf.js: its pieces, their styles and its language", async () => {
    const content = await readTextContent(
      stream([
        { items: [{ str: "a", fontName: "g_d0_f1" }], styles: { g_d0_f1: { fontFamily: "serif" } }, lang: "en" },
        { items: [{ str: "b", fontName: "g_d0_f2" }], styles: { g_d0_f2: { fontFamily: "sans-serif" } } },
      ]),
    );

    expect(content.items.map((item) => (item as { str: string }).str)).toEqual(["a", "b"]);
    expect(Object.keys(content.styles)).toEqual(["g_d0_f1", "g_d0_f2"]);
    expect(content.lang).toBe("en");
  });

  it("uses the PDF's own fonts, falling back to pdf.js's stand-ins for what they don't have", () => {
    const content = {
      items: [],
      styles: { g_d0_f1: { fontFamily: "serif", ascent: 0.9 }, g_d0_f2: { fontFamily: "sans-serif" } },
      lang: null,
    };

    expect(inPdfFonts(content).styles).toEqual({
      g_d0_f1: { fontFamily: '"g_d0_f1", serif', ascent: 0.9 },
      g_d0_f2: { fontFamily: '"g_d0_f2", sans-serif' },
    });
  });

  it("a font name that couldn't be one is left to the stand-ins", () => {
    const content = { items: [], styles: { 'a"b': { fontFamily: "serif" } }, lang: null };

    expect(inPdfFonts(content).styles).toEqual({ 'a"b': { fontFamily: "serif" } });
  });
});

describe("A justified line laid over a page", () => {
  it("is as wide as on the page by its spaces, not by stretching its letters", () => {
    // 200px wide as laid out, 206px on the page, with 4 spaces: each is 1.5px wider.
    expect(spaceSpread({ text: "resources spanning batch inference and", width: 200, stretch: 1.03, fontSize: 12 })).toBeCloseTo(1.5);
  });

  it("narrower on the page, its spaces are narrower", () => {
    expect(spaceSpread({ text: "a b c", width: 100, stretch: 0.98, fontSize: 12 })).toBeCloseTo(-1);
  });

  it("a line without spaces is stretched as before", () => {
    expect(spaceSpread({ text: "Transformers", width: 100, stretch: 1.03, fontSize: 12 })).toBeNull();
  });

  it("nor a line its spaces can't make right (more than half a letter's height each): it's not justification", () => {
    expect(spaceSpread({ text: "a b", width: 100, stretch: 1.2, fontSize: 12 })).toBeNull();
  });

  it("nor one already as wide as on the page", () => {
    expect(spaceSpread({ text: "a b", width: 100, stretch: 1, fontSize: 12 })).toBeNull();
  });
});

describe("The text where a link goes (a reference, in a bibliography)", () => {
  // pdf.js's pieces of text: where each starts (its transform's last two: across, and up from the
  // page's bottom) and how tall it is. The page is 600 × 800.
  const piece = (str: string, x: number, down: number, height = 10) => ({ str, transform: [height, 0, 0, height, x, 800 - down], width: str.length * 5, height });
  const BIBLIOGRAPHY = [
    piece("[11] Someone. Another paper.", 50, 380),
    piece("[12] A. Vaswani, N. Shazeer, et al. Atten-", 50, 412),
    piece("tion is all you need. In NeurIPS, 2017.", 62, 424),
    piece("[13] J. Devlin et al. BERT. In NAACL, 2019.", 50, 436),
    // (The other column, level with it.)
    piece("[40] Someone else. Far away.", 320, 412),
  ];

  it("reads the reference starting where the link goes, up to the next one, a word broken over two lines joined", () => {
    expect(entryAt(BIBLIOGRAPHY, { width: 600, height: 800 }, 400, 50)).toBe(
      "[12] A. Vaswani, N. Shazeer, et al. Attention is all you need. In NeurIPS, 2017.",
    );
  });

  it("in a bibliography in two columns, only the link's column", () => {
    expect(entryAt(BIBLIOGRAPHY, { width: 600, height: 800 }, 400, 320)).toBe("[40] Someone else. Far away.");
  });

  it("stops at a gap, where the bibliography ends", () => {
    const items = [piece("Smith, J. A paper. 2020.", 50, 412), piece("Appendix A", 50, 480)];

    expect(entryAt(items, { width: 600, height: 800 }, 400, 50)).toBe("Smith, J. A paper. 2020.");
  });

  it("the bibliography's heading, just above its first reference, is left out", () => {
    const items = [piece("References", 50, 405, 12), piece("[1] A. Vaswani. Attention is all you need. 2017.", 50, 424), piece("[2] Other.", 50, 436)];

    expect(entryAt(items, { width: 600, height: 800 }, 395, 50)).toBe("[1] A. Vaswani. Attention is all you need. 2017.");
  });

  it("a place in the middle of a line reads that line from its column's start", () => {
    const items = [piece("Transformers", 50, 412), piece("[1] changed the field.", 120, 412)];

    expect(entryAt(items, { width: 600, height: 800 }, 400, 120)).toBe("Transformers [1] changed the field.");
  });

  it("is empty when there's no text there", () => {
    expect(entryAt(BIBLIOGRAPHY, { width: 600, height: 800 }, 700, 50)).toBe("");
  });
});

describe("A figure a link goes to", () => {
  const piece = (str: string, x: number, down: number, height = 10) => ({ str, transform: [height, 0, 0, height, x, 800 - down], width: str.length * 5, height });
  const PAGE = { width: 600, height: 800 };
  /** The other column's text, level with the figure (a page in two columns). */
  const otherColumn = (x: number) => [100, 140, 180, 220, 260, 300].map((down) => piece("The other column goes on and on here.", x, down));
  const bottom = (r: { y: number; height: number }) => r.y + r.height;
  const right = (r: { x: number; width: number }) => r.x + r.width;

  it("in a column: from where the link goes down to the end of its caption, the column's width", () => {
    const items = [
      piece("Text before the figure in the left column.", 50, 90),
      piece("GPU load decode", 80, 150, 8),
      piece("inference encode", 80, 170, 8),
      piece("Figure 1: Batch inference with a long", 50, 220),
      piece("caption on two lines.", 50, 232),
      piece("Body text after the figure resumes here.", 50, 260),
      ...otherColumn(310),
    ];

    const region = figureRegion(items, PAGE, 100, 50);

    expect(region.y).toBeGreaterThan(90);
    expect(region.y).toBeLessThanOrEqual(100);
    expect(bottom(region)).toBeGreaterThan(232);
    expect(bottom(region)).toBeLessThan(250);
    expect(region.x).toBeLessThanOrEqual(50);
    expect(right(region)).toBeGreaterThanOrEqual(290);
    expect(right(region)).toBeLessThanOrEqual(310);
  });

  it("a paragraph between where the link goes and the figure is left out (the figure starts below it)", () => {
    const wide = "Body text of a paragraph that is justified wide."; // (240 points: the column's width)
    const items = [
      piece(wide, 50, 110),
      piece(wide, 50, 122),
      piece("its short last line.", 50, 134),
      piece("Spark Flink Ray", 100, 160),
      piece("1× 2× 12×", 100, 172),
      piece("Table 1: Throughput compared.", 80, 190),
      ...otherColumn(310),
    ];

    const region = figureRegion(items, PAGE, 100, 50);

    expect(region.y).toBeGreaterThan(134);
    expect(region.y).toBeLessThan(150);
    expect(bottom(region)).toBeGreaterThan(190);
  });

  it("named by the link (\"Figure 2\"), its own caption is found anywhere on the page, even above where the link goes", () => {
    const items = [
      piece("Figure 2: A figure placed at the top.", 220, 200),
      piece("Body text in the left column, wide enough.", 50, 260),
      piece("Table 1: Another one, below.", 50, 600),
      ...otherColumn(310),
    ];

    const region = figureRegion(items, PAGE, 560, 50, "Figure 2");

    expect(region.y).toBeLessThan(200);
    expect(bottom(region)).toBeGreaterThan(200);
    expect(bottom(region)).toBeLessThan(220);
  });

  it("across both columns, when its caption is", () => {
    const items = [piece("Left text.", 50, 90), piece("Right text that ends the line.", 400, 90), piece("Figure 2: A figure across both columns.", 200, 420)];

    const region = figureRegion(items, PAGE, 100, 50);

    expect(region.x).toBeLessThanOrEqual(50);
    expect(right(region)).toBeGreaterThanOrEqual(550);
    expect(bottom(region)).toBeGreaterThan(420);
  });

  it("in the right column", () => {
    const items = [...otherColumn(50), piece("Figure 4: On the right.", 310, 240), piece("Right column body text ends here, far.", 310, 300)];

    const region = figureRegion(items, PAGE, 120, 320);

    expect(region.x).toBeGreaterThanOrEqual(290);
    expect(right(region)).toBeGreaterThanOrEqual(500);
    expect(bottom(region)).toBeGreaterThan(240);
    expect(bottom(region)).toBeLessThan(290);
  });

  it("a sentence starting with the figure's name isn't its caption", () => {
    const items = [piece("Left text that fills a whole line, wide.", 50, 90), piece("Figure 3 shows the results of the", 50, 220), piece("Figure 3. Results.", 50, 280), ...otherColumn(310)];

    expect(bottom(figureRegion(items, PAGE, 100, 50))).toBeGreaterThan(280);
  });

  it("without a caption, a third of the page from where the link goes", () => {
    const items = [piece("Some text on the left, wide enough here.", 50, 90), ...otherColumn(310)];

    const region = figureRegion(items, PAGE, 100, 50);

    expect(region.y).toBeLessThanOrEqual(100);
    expect(region.height).toBeGreaterThan(240);
    expect(region.height).toBeLessThan(300);
  });

  it("going to the caption itself (the figure is above it): what's above it is shown too", () => {
    const items = [piece("Text before the figure in the left column.", 50, 60), piece("Figure 1: Batch inference.", 50, 320), ...otherColumn(310)];

    const region = figureRegion(items, PAGE, 310, 50);

    expect(region.y).toBeLessThan(200);
    expect(bottom(region)).toBeGreaterThan(320);
  });
});

describe("Which links go to a figure", () => {
  it("those the PDF names after a figure or table (as LaTeX does)", () => {
    expect(isFigureLink("figure.caption.3", "1a")).toBe(true);
    expect(isFigureLink("table.2", "2")).toBe(true);
    expect(isFigureLink("subfigure.1.1", "1b")).toBe(true);
    expect(isFigureLink("cite.zaharia2010", "[44]")).toBe(false);
    expect(isFigureLink("section.3", "Section 3")).toBe(false);
  });

  it("the figure their words name, to find its caption", () => {
    expect(figureName("Figure 1a")).toBe("Figure 1");
    expect(figureName("Fig. 2")).toBe("Figure 2");
    expect(figureName("Table IV")).toBe("Table IV");
    expect(figureName("1a")).toBeUndefined();
  });

  it("otherwise, those whose words name one", () => {
    expect(isFigureLink(undefined, "Figure 1a")).toBe(true);
    expect(isFigureLink(undefined, "Fig. 2")).toBe(true);
    expect(isFigureLink(undefined, "Table 3")).toBe(true);
    expect(isFigureLink(undefined, "[22]")).toBe(false);
    expect(isFigureLink(undefined, "Section 3")).toBe(false);
  });
});

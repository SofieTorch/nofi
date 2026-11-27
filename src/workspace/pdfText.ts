// A PDF page's text, for finding words in it (see tests/pdf-text.test.ts). pdf.js gives it in pieces
// that often split words (at a ligature, or where a line ends): they're joined as they are, with a
// space where a line ends, and runs of spaces made one. The text laid over a page (one piece per
// span, a <br> where a line ends) reads the same, so a match found in one is in the other.

/** The page's text from pdf.js's pieces. */
export function joinTextItems(items: { str?: string; hasEOL?: boolean }[]): string {
  let text = "";
  const add = (char: string) => {
    if (/\s/.test(char)) {
      if (text && !text.endsWith(" ")) text += " ";
    } else text += char;
  };
  for (const item of items) {
    for (const char of item.str ?? "") add(char);
    if (item.hasEOL) add(" ");
  }
  return text;
}

/** The text laid over a page, as joinTextItems reads it, and where each of its characters is. */
export function layerFindText(layer: HTMLElement) {
  const chars: { node: Text; offset: number }[] = [];
  let text = "";
  let last: { node: Text; offset: number } | null = null;
  const space = () => {
    // (A space that isn't in the text, as at a line's end: where the character before it is.)
    if (text && !text.endsWith(" ") && last) {
      text += " ";
      chars.push(last);
    }
  };
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).tagName === "BR") space();
      continue;
    }
    const piece = node as Text;
    for (let offset = 0; offset < piece.data.length; offset++) {
      const at = { node: piece, offset };
      if (/\s/.test(piece.data[offset])) {
        if (text && !text.endsWith(" ")) {
          text += " ";
          chars.push(at);
        }
      } else {
        text += piece.data[offset];
        chars.push(at);
      }
      last = at;
    }
  }
  return { text, chars };
}

/**
 * The pieces of a page's text, from pdf.js's stream of them (`page.streamTextContent()`). Read by
 * hand: pdf.js's own getTextContent goes through it with `for await`, which Safari's webview (the
 * app's, on a Mac) can't do, so it would fail there.
 */
export async function readTextItems(stream: ReadableStream<{ items: unknown[] }>) {
  const reader = stream.getReader();
  const items: { str?: string; hasEOL?: boolean }[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return items;
    items.push(...(value.items as { str?: string; hasEOL?: boolean }[]));
  }
}

/** A page's text as pdf.js gives it: its pieces, the styles of their fonts (by name), its language. */
export type TextContent = { items: unknown[]; styles: Record<string, { fontFamily: string } & Record<string, unknown>>; lang: string | null };

/** A page's text, read whole from pdf.js's stream of it (by hand, as `readTextItems`). */
export async function readTextContent(stream: ReadableStream<Partial<TextContent>>): Promise<TextContent> {
  const reader = stream.getReader();
  const content: TextContent = { items: [], styles: {}, lang: null };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return content;
    content.items.push(...(value.items ?? []));
    Object.assign(content.styles, value.styles);
    content.lang ??= value.lang ?? null;
  }
}

/**
 * The text in the PDF's own fonts (pdf.js loads them by their names, to draw the pages), with the
 * stand-ins pdf.js picked after them, for letters they don't have. Laid out in them, the text's
 * letters are as wide as on the page, so what's highlighted or selected is right on the words.
 */
export function inPdfFonts(content: TextContent): TextContent {
  const styles = Object.fromEntries(
    Object.entries(content.styles).map(([name, style]) => [
      name,
      // (Only a plain name can be one of its fonts' names.)
      /^[\w-]+$/.test(name) ? { ...style, fontFamily: `"${name}", ${style.fontFamily}` } : style,
    ]),
  );
  return { ...content, styles };
}

/**
 * How much wider (or narrower, below 0) each space of a line laid over a page should be, in pixels
 * as it's laid out, for it to be as wide as on the page: `width` is how wide it's laid out, and
 * `stretch` how much wider it is on the page (pdf.js would stretch its letters that much). A
 * justified line is wider by its spaces, so its letters keep their width and stay on the words.
 * Null when the line has no spaces, or the spaces would have to be more than half a letter's height
 * wider or narrower each (it's not justification then): pdf.js's stretching is kept for it.
 */
export function spaceSpread({ text, width, stretch, fontSize }: { text: string; width: number; stretch: number; fontSize: number }) {
  const spaces = text.split(" ").length - 1;
  if (!spaces || !width || Math.abs(stretch - 1) < 1e-3) return null;
  const each = ((stretch - 1) * width) / spaces;
  return Math.abs(each) > fontSize / 2 ? null : each;
}

/** A piece of a page's text as pdf.js gives it: where it starts (its transform's last two: across, and up from the page's bottom), and how tall it is. */
type PlacedItem = { str?: string; transform?: number[]; width?: number; height?: number };

/**
 * The text where a link in a PDF goes (its page, how far down it and across, in points from its
 * top left): for a citation, its reference in the bibliography. It starts at the first line below
 * that point (past a heading just above the first reference) and goes on to where the next
 * reference starts ("[13]", "13."), a gap, or a few lines. In two columns, only the point's column. A word broken over two lines with a hyphen is joined.
 */
export function entryAt(items: unknown[], page: { width: number; height: number }, top: number, left?: number): string {
  const half = page.width / 2;
  // (The point's column: the left half, or the right one, of a page in two columns.)
  const inColumn = (x: number) => left === undefined || (left < half - 10 ? x < half : x >= half - 15);
  const pieces = (items as PlacedItem[])
    .filter((item) => item.str?.trim() && item.transform)
    .map((item) => {
      const size = item.height || Math.abs(item.transform![3]) || 10;
      return { str: item.str!, x: item.transform![4], baseline: page.height - item.transform![5], size, width: item.width ?? 0 };
    })
    .filter((piece) => inColumn(piece.x))
    .sort((a, b) => a.baseline - b.baseline || a.x - b.x);
  // Lines: pieces level with each other.
  const lines: { baseline: number; size: number; pieces: typeof pieces }[] = [];
  for (const piece of pieces) {
    const line = lines.find((l) => Math.abs(l.baseline - piece.baseline) < Math.min(l.size, piece.size) / 2);
    if (line) line.pieces.push(piece);
    else lines.push({ baseline: piece.baseline, size: piece.size, pieces: [piece] });
  }
  const lineText = (line: (typeof lines)[number]) => {
    let text = "";
    let end = -Infinity;
    for (const piece of [...line.pieces].sort((a, b) => a.x - b.x)) {
      if (text && piece.x - end > piece.size * 0.15 && !text.endsWith(" ") && !piece.str.startsWith(" ")) text += " ";
      text += piece.str;
      end = piece.x + piece.width;
    }
    return text.replace(/\s+/g, " ").trim();
  };
  const startsAnother = /^(\[\d+\]|\d+\.\s)/;
  let first = lines.findIndex((line) => line.baseline > top + 1);
  if (first < 0) return "";
  // (A heading just above the first reference, like "References": the reference is what's wanted.)
  const next = lines[first + 1];
  if (next && !startsAnother.test(lineText(lines[first])) && startsAnother.test(lineText(next)) && lineText(lines[first]).length < 40) first++;
  const kept: string[] = [];
  for (let i = first; i < lines.length && kept.length < 8; i++) {
    const text = lineText(lines[i]);
    if (i > first) {
      const gap = lines[i].baseline - lines[i - 1].baseline;
      if (startsAnother.test(text) || gap > lines[i].size * 2.2) break;
    }
    kept.push(text);
  }
  return kept.reduce((all, line) => (!all ? line : /[a-z]-$/.test(all) && /^[a-z]/.test(line) ? all.slice(0, -1) + line : `${all} ${line}`), "");
}

/** A part of a page, in points from its top left. */
export type Region = { x: number; y: number; width: number; height: number };

/**
 * Whether a link goes to a figure (or a table): the PDF names where it goes after one, as LaTeX
 * does ("figure.caption.3", "table.2"), or, without such a name, its words name one ("Figure 1a").
 */
export function isFigureLink(name: string | undefined, words: string) {
  if (name && /^(sub)?(figure|table)\b/i.test(name)) return true;
  if (name && /^(cite|section|subsection|subsubsection|chapter|appendix|equation|page|item|Hfootnote|footnote|algorithm|theorem|lemma)\b/i.test(name)) return false;
  return /^(fig(ure)?s?\.?|tables?|tab\.)\s*[0-9IVX]/i.test(words.trim());
}

/** The figure (or table) a link's words name, as its caption starts ("Figure 1a" is "Figure 1"), if they do. */
export function figureName(words: string): string | undefined {
  const named = /^(fig(?:ure)?s?\.?|tables?|tab\.)\s*([0-9]+|[IVX]+)/i.exec(words.trim());
  if (!named) return undefined;
  return `${/^fig/i.test(named[1]) ? "Figure" : "Table"} ${named[2]}`;
}

/** A caption's first words: "Figure 1:", "Fig. 2.", "Table 3:", "TABLE IV" (not a sentence like "Figure 3 shows…"). */
const CAPTION = /^(fig(ure)?\.?|tab(le)?\.?)\s*([0-9]+[a-z]?|[IVX]+)\s*[:.|—–-]|^TABLE\s+([IVX]+|[0-9]+)\b/i;

/**
 * The part of a page a figure is in, for a link going to it (how far down and across the page, in
 * points): from there down to the end of the figure's caption, as wide as its column (or the page,
 * when its caption goes across both columns). Without a caption, a third of the page from there.
 * (Going to the caption itself, the figure being above it: from a while above it.)
 */
export function figureRegion(items: unknown[], page: { width: number; height: number }, top: number, left?: number, name?: string): Region {
  const pieces = (items as PlacedItem[])
    .filter((item) => item.str?.trim() && item.transform)
    .map((item) => {
      const size = item.height || Math.abs(item.transform![3]) || 10;
      const baseline = page.height - item.transform![5];
      return { str: item.str!, left: item.transform![4], right: item.transform![4] + (item.width ?? 0), top: baseline - size * 0.8, bottom: baseline + size * 0.25, size, baseline };
    });
  if (!pieces.length) return { x: 0, y: top, width: page.width, height: Math.min(page.height - top, page.height / 3) };
  const textLeft = Math.min(...pieces.map((p) => p.left));
  const textRight = Math.max(...pieces.map((p) => p.right));
  // (The page's middle, between its columns, if it has two.)
  const middle = page.width / 2;
  // Lines: pieces level with each other and close together (the other column's, level with them, apart).
  const lines: { left: number; right: number; top: number; bottom: number; size: number; baseline: number; text: string }[] = [];
  for (const piece of [...pieces].sort((a, b) => a.baseline - b.baseline || a.left - b.left)) {
    const line = lines.find((l) => Math.abs(l.baseline - piece.baseline) < Math.min(l.size, piece.size) / 2 && piece.left - l.right < piece.size * 1.5);
    if (line) {
      line.text += (piece.left - line.right > piece.size * 0.15 ? " " : "") + piece.str;
      line.right = Math.max(line.right, piece.right);
      line.top = Math.min(line.top, piece.top);
      line.bottom = Math.max(line.bottom, piece.bottom);
    } else lines.push({ ...piece, text: piece.str });
  }
  const spans = (l: { left: number; right: number }) => l.left < middle - 20 && l.right > middle + 20;
  const onLeft = (l: { left: number; right: number }) => !spans(l) && l.right <= middle + 20;
  // (The link's column: a caption in the other one isn't its figure's.)
  const inColumn = (l: (typeof lines)[number]) =>
    left === undefined || spans(l) || (left < middle ? onLeft(l) : !onLeft(l));
  // (Its own caption, when the link names it, wherever it is on the page: a figure can be placed
  // elsewhere, at the page's top, than where the link goes; otherwise the first one below.)
  const caption =
    (name && lines.find((l) => CAPTION.test(l.text.trim()) && figureName(l.text) === name)) ||
    lines.find((l) => l.baseline > top - 2 && l.top < top + page.height * 0.75 && inColumn(l) && CAPTION.test(l.text.trim()));
  const across = (l: { left: number; right: number }) =>
    spans(l) ? { x: textLeft - 4, right: textRight + 4 } : onLeft(l) ? { x: textLeft - 4, right: middle } : { x: middle, right: textRight + 4 };
  if (!caption) {
    const column = left === undefined ? { x: textLeft - 4, right: textRight + 4 } : across({ left, right: left + 1 });
    return { x: column.x, y: top, width: column.right - column.x, height: Math.min(page.height - top, page.height / 3) };
  }
  // The caption's end: its lines follow each other closely, below it and across the same width.
  let end = caption;
  for (const line of lines) {
    if (line.baseline <= end.baseline) continue;
    const overlaps = line.left < caption.right + 5 && line.right > caption.left - 5;
    if (!overlaps) continue;
    if (line.top - end.bottom > end.size * 0.6 || CAPTION.test(line.text.trim())) break;
    end = line;
  }
  const column = across({ left: caption.left, right: Math.max(caption.right, end.right) });
  // (Going to the caption itself: the figure is above it.)
  // (A caption above where the link goes, or right there: the figure is above it.)
  const from = caption.top - top < caption.size * 2.5 ? Math.max(0, caption.top - page.height * 0.35) : top - 2;
  // The figure starts below the body text above it (where a link goes can be above a paragraph
  // before it): body text is a line as wide as the column, or a paragraph's last line, after one.
  const width = column.right - column.x - 8;
  const columnLines = lines.filter((l) => l.left >= column.x - 2 && l.right <= column.right + 2).sort((a, b) => a.baseline - b.baseline);
  const wide = (l: (typeof lines)[number]) => l.right - l.left >= width * 0.8;
  // (Not above the page's text: its margin is empty.)
  let start = Math.max(from, Math.min(...lines.map((l) => l.top)) - 4);
  columnLines.forEach((line, i) => {
    const before = columnLines[i - 1];
    const body = wide(line) || (!!before && wide(before) && line.top - before.bottom <= line.size * 0.6);
    if (body && line.baseline > from - 4 && line.bottom <= caption.top + 1) start = Math.max(start, line.bottom + 2);
  });
  return { x: column.x, y: start, width: column.right - column.x, height: end.bottom + 4 - start };
}

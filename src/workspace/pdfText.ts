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

// Breaking a paragraph inside styled text: Enter closes every style open at the cursor before the
// break and opens it again after (`*Hel|lo*` → `*Hel*`, blank line, `*lo*`), so each paragraph is
// whole on its own. Any Typst function with text in brackets counts, with its settings, like
// `#text(fill: red)[…]` or `#footnote[…]`. Joining the paragraphs again merges the styles that
// match on both sides, giving back the text as it was.

import { matchingClose } from "./drawnBlocks";
import { findFormatting, type Format, type Range } from "./formatting";

/** A style around some text: `open` and `close` are its syntax, like `#highlight[` and `]`. */
type Wrapper = { from: number; contentFrom: number; contentTo: number; to: number };

/** Places where Enter can't break a paragraph (a function's settings, or one of several texts). */
type Found = { wrappers: Wrapper[]; locked: Range[] };

const NOT_STYLES = new Set(["code", "codeblock", "math", "comment", "heading", "list-item", "task", "divider"]);
/** `#name` (or `#a.b`), then maybe `(settings)`, then `[text]` (maybe more than one). */
const CALL = /#(?:[A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)?/g;

function findWrappers(text: string, format: Format): Found {
  const spans = findFormatting(text, format);
  const verbatim = spans.filter((span) => ["code", "codeblock", "math", "comment"].includes(span.kind));
  const inVerbatim = (pos: number) => verbatim.some((span) => span.from <= pos && pos < span.to);
  const wrappers: Wrapper[] = [];
  const locked: Range[] = [];

  // Marker styles, like *bold* or Markdown's [links](…); functions are found below.
  for (const span of spans) {
    if (NOT_STYLES.has(span.kind) || span.markers.length !== 2) continue;
    if (text[span.from] === "#") continue;
    wrappers.push({ from: span.from, contentFrom: span.markers[0].to, contentTo: span.markers[1].from, to: span.to });
  }

  if (format === "typst") {
    for (const match of text.matchAll(CALL)) {
      const at = match.index;
      if (inVerbatim(at) || text[at - 1] === "\\") continue;
      let i = at + match[0].length;
      if (text[i] === "(" && match[0].length > 1) {
        const close = matchingClose(text, i);
        if (close === -1) continue;
        locked.push({ from: i + 1, to: close });
        i = close + 1;
      }
      const bodies: Range[] = [];
      while (text[i] === "[") {
        const close = matchingClose(text, i);
        if (close === -1) break;
        bodies.push({ from: i + 1, to: close });
        i = close + 1;
      }
      if (!bodies.length) continue;
      const last = bodies[bodies.length - 1];
      locked.push(...bodies.slice(0, -1));
      wrappers.push({ from: at, contentFrom: last.from, contentTo: last.to, to: last.to + 1 });
    }
  }
  return { wrappers, locked };
}

/** What Enter at `pos` does: a change and where the cursor goes, or "line" for a plain line break. */
export function splitAt(text: string, format: Format, pos: number): { from: number; to: number; insert: string; cursor: number } | "line" {
  const { wrappers, locked } = findWrappers(text, format);
  if (locked.some((range) => range.from <= pos && pos <= range.to)) return "line";
  // The styles around the cursor, the outermost first.
  const around = wrappers
    .filter((w) => w.contentFrom <= pos && pos <= w.contentTo)
    .sort((a, b) => a.from - b.from);
  if (!around.length) return { from: pos, to: pos, insert: "\n\n", cursor: pos + 2 };

  const open = (w: Wrapper) => text.slice(w.from, w.contentFrom);
  const close = (w: Wrapper) => text.slice(w.contentTo, w.to);
  // From the innermost style out: each side keeps a style only if it has text in it.
  let left = "";
  let right = "";
  let cursor = 0;
  for (let i = around.length - 1; i >= 0; i--) {
    const w = around[i];
    const inner = around[i + 1];
    const before = text.slice(w.contentFrom, inner ? inner.from : pos) + left;
    const after = right + text.slice(inner ? inner.to : pos, w.contentTo);
    left = before.trim() === "" ? "" : open(w) + before + close(w);
    if (after.trim() === "") {
      right = "";
      cursor = 0;
    } else {
      right = open(w) + after + close(w);
      cursor += open(w).length;
    }
  }
  const outer = around[0];
  return { from: outer.from, to: outer.to, insert: `${left}\n\n${right}`, cursor: outer.from + left.length + 2 + cursor };
}

/**
 * What ⌫ at `pos`, the start of a paragraph, does when the paragraph above ends with the same
 * styles this one starts with: the text to delete (the styles' ends and starts, and the break
 * between), so the styles merge. Null if they don't match.
 */
export function joinAt(text: string, format: Format, pos: number): Range | null {
  const gap = /\n[ \t]*\n$/.exec(text.slice(0, pos));
  if (!gap) return null;
  const end = pos - gap[0].length;
  if (end === 0 || text[end - 1] === "\n") return null;
  const { wrappers } = findWrappers(text, format);
  const same = (a: Wrapper, b: Wrapper) =>
    text.slice(a.from, a.contentFrom) === text.slice(b.from, b.contentFrom) &&
    text.slice(a.contentTo, a.to) === text.slice(b.contentTo, b.to);

  let leftEnd = end;
  let rightStart = pos;
  let merged: [Wrapper, Wrapper] | null = null;
  for (;;) {
    // The widest style ending here, and the widest starting there.
    const left = wrappers.filter((w) => w.to === leftEnd).sort((a, b) => a.from - b.from)[0];
    const right = wrappers.filter((w) => w.from === rightStart).sort((a, b) => b.to - a.to)[0];
    if (!left || !right || !same(left, right)) break;
    merged = [left, right];
    leftEnd = left.contentTo;
    rightStart = right.contentFrom;
  }
  return merged ? { from: merged[0].contentTo, to: merged[1].contentFrom } : null;
}

// The parts of a note a link can point to: its headings and paragraphs (and list items). A link
// names one after a # in its address (`Paper.typ#methods`). In Typst, the part carries a label
// (`= Methods <methods>`, `… <p-3f9a>` at a paragraph's end), added when the first link to it is
// made. In Markdown, a heading is found by its usual anchor (its text in lower case, with dashes;
// `-1`, `-2` for repeated names, like GitHub), a paragraph by an Obsidian-style `^p-3f9a` at its end.

import { findBlocks } from "./blocks";
import type { Format, Range } from "./formatting";

export type PartKind = "heading" | "paragraph" | "list";
export type Part = Range & { kind: PartKind; shown: string };

/** A Typst label, like `<methods>`. */
const LABEL = /<([\p{L}\p{N}_:.-]+)>/gu;
/** A label at the end of a line, with the space before it. */
const TRAILING_LABEL = /\s+<([\p{L}\p{N}_:.-]+)>\s*$/u;
/** An Obsidian-style block mark at the end of a line: ` ^p-3f9a`. */
const TRAILING_MARK = /\s+\^([\w-]+)\s*$/;

const lineEndAt = (text: string, pos: number) => (text.indexOf("\n", pos) + 1 || text.length + 1) - 1;
const trimmedEnd = (text: string, from: number, to: number) => from + text.slice(from, to).trimEnd().length;

/** What a part shows, without its markers or label: a heading's text, a paragraph's first words. */
function shownOf(text: string, format: Format, block: Range & { kind: string }) {
  const typst = format === "typst";
  if (block.kind === "heading") {
    const line = text.slice(block.from, lineEndAt(text, block.from));
    return plain(line.replace(typst ? /^=+\s+/ : /^#{1,6}\s+/, "").replace(typst ? TRAILING_LABEL : /\s+#+\s*$/, ""));
  }
  const words = plain(text.slice(block.from, block.to).replace(typst ? TRAILING_LABEL : TRAILING_MARK, ""))
    .replace(/^([-+*]|\d+\.)\s+(\[[ xX]\]\s+)?/, "")
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 6 ? `${words.slice(0, 6).join(" ")}…` : words.join(" ");
}

/** Text without most of its style markers. */
const plain = (text: string) => text.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();

/** The headings, paragraphs and list items of a note, in order. */
export function partsOf(text: string, format: Format): Part[] {
  return findBlocks(text, format)
    .filter((block): block is Range & { kind: PartKind } => block.kind === "heading" || block.kind === "paragraph" || block.kind === "list")
    .map((block) => ({ from: block.from, to: block.to, kind: block.kind, shown: shownOf(text, format, block) }));
}

/** A heading's anchor in Markdown, from its text, like GitHub's. */
const markdownSlug = (shown: string) =>
  shown
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

/** A label made from a heading's text: lower case, words joined by dashes. */
const labelSlug = (shown: string) =>
  shown
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "heading";

/** Each Markdown heading's anchor, numbered when the name repeats. */
function markdownAnchors(text: string) {
  const seen = new Map<string, number>();
  return partsOf(text, "markdown")
    .filter((part) => part.kind === "heading")
    .map((part) => {
      const slug = markdownSlug(part.shown);
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      return { part, anchor: count ? `${slug}-${count}` : slug };
    });
}

/** The labels a Typst note uses already. */
const labelsIn = (text: string) => new Set([...text.matchAll(LABEL)].map((m) => m[1]));

function shortId(used: (id: string) => boolean) {
  for (;;) {
    const id = `p-${Math.floor(Math.random() * 0x10000)
      .toString(16)
      .padStart(4, "0")}`;
    if (!used(id)) return id;
  }
}

/**
 * The anchor a link to a part uses, and what to add to the note for it (a label, or a ^ mark)
 * when it has none yet.
 */
export function anchorFor(text: string, format: Format, part: Range & { kind: PartKind }): { anchor: string; change?: { from: number; insert: string } } {
  // Where a mark goes: a heading's or list item's line, or a paragraph's end.
  const end = part.kind === "paragraph" ? part.to : lineEndAt(text, part.from);
  const at = trimmedEnd(text, part.from, end);
  const last = text.slice(text.lastIndexOf("\n", end - 1) + 1, end);

  if (format === "markdown") {
    if (part.kind === "heading") {
      const found = markdownAnchors(text).find((a) => a.part.from === part.from);
      return { anchor: found?.anchor ?? markdownSlug(shownOf(text, format, part)) };
    }
    const mark = TRAILING_MARK.exec(last);
    if (mark) return { anchor: `^${mark[1]}` };
    const id = shortId((id) => text.includes(`^${id}`));
    return { anchor: `^${id}`, change: { from: at, insert: ` ^${id}` } };
  }

  const label = TRAILING_LABEL.exec(last);
  if (label) return { anchor: label[1] };
  const used = labelsIn(text);
  let anchor: string;
  if (part.kind === "heading") {
    const base = labelSlug(shownOf(text, format, part));
    anchor = base;
    for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`;
  } else {
    anchor = shortId((id) => used.has(id));
  }
  return { anchor, change: { from: at, insert: ` <${anchor}>` } };
}

/** The part of a note an anchor names (a link's address after the #), if it's there. */
export function findPart(text: string, format: Format, anchor: string): Range | null {
  const blocks = findBlocks(text, format);
  const blockAt = (pos: number) => {
    const block = blocks.find((b) => b.from <= pos && pos <= b.to);
    return block ? { from: block.from, to: block.to } : null;
  };
  if (format === "markdown") {
    if (anchor.startsWith("^")) {
      const id = anchor.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = new RegExp(`\\s\\^${id}[ \\t]*$`, "m").exec(text);
      return found ? blockAt(found.index) : null;
    }
    const heading = markdownAnchors(text).find((a) => a.anchor === anchor.toLowerCase());
    return heading ? { from: heading.part.from, to: heading.part.to } : null;
  }
  for (const m of text.matchAll(LABEL)) {
    // Where the label is put, not a link to it (those come after a "(").
    if (m[1] === anchor && !/\(\s*$/.test(text.slice(0, m.index))) return blockAt(m.index);
  }
  return null;
}

/** The labels (or ^ marks) at the end of parts' lines, with the space before them: hidden in the editor. */
export function partMarks(text: string, format: Format): Range[] {
  const marks: Range[] = [];
  const pattern = format === "typst" ? TRAILING_LABEL : TRAILING_MARK;
  for (const part of partsOf(text, format)) {
    let at = part.from;
    while (at <= part.to) {
      const end = lineEndAt(text, at);
      const found = pattern.exec(text.slice(at, end));
      if (found) marks.push({ from: at + found.index, to: at + found.index + found[0].trimEnd().length });
      at = end + 1;
    }
  }
  return marks;
}

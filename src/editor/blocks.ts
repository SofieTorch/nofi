// Blocks: the pieces of a note that can be moved around, like Notion's. A heading, a paragraph,
// a list item (with what's nested under it), a code block, a table or other #function(…) block,
// an equation, columns, a Markdown quote or table. Each covers whole lines. Moving one keeps the
// text tidy: paragraphs stay a blank line apart (or they'd run together), list items don't.

import RULE from "./checklistRule.typ?raw";
import { matchingClose } from "./drawnBlocks";
import { findFormatting, type Format, type Range } from "./formatting";
import { findPropertiesBlock } from "./properties";

export type BlockKind = "paragraph" | "heading" | "list" | "code" | "columns" | "other";
export type Block = Range & { kind: BlockKind };
/** Where a block is dropped: before or after another. */
export type Drop = { block: Block; side: "before" | "after" };

/** Typst functions that make a block of their own when they start a line. */
const BLOCK_CALL =
  /^#(\[|(?:table|figure|grid|columns|line|image|block|quote|align|pad|pagebreak|colbreak|outline|set|show|let|import|include|metadata|v|bibliography|place|box|stack|rect|circle|ellipse|par|heading|list|enum|terms|raw|context|lorem)\b)/;

type Line = Range & { text: string };

const isBlank = (line: Line) => line.text.trim() === "";
const indentOf = (line: Line) => /^\s*/.exec(line.text)![0].length;

export function findBlocks(text: string, format: Format): Block[] {
  const typst = format === "typst";
  const lines: Line[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    lines.push({ from: at, to: at + line.length, text: line });
    at += line.length + 1;
  }

  // What the note carries that isn't for moving: its properties, and the checklist rule.
  const skipped: Range[] = [];
  const properties = findPropertiesBlock(text, format);
  if (properties) skipped.push(properties);
  const rule = typst ? text.indexOf(RULE) : -1;
  if (rule >= 0) skipped.push({ from: rule, to: rule + RULE.length });
  const isSkipped = (line: Line) => skipped.some((r) => line.from >= r.from && line.from < Math.max(r.to, r.from + 1));

  const heading = typst ? /^=+ / : /^#{1,6} /;
  const list = typst ? /^(\s*)([-+]|\/) / : /^(\s*)([-*+]|\d+\.) /;
  const fence = /^\s*```/;
  const startsAnother = (line: Line) =>
    heading.test(line.text) ||
    list.test(line.text) ||
    fence.test(line.text) ||
    (typst ? BLOCK_CALL.test(line.text) || /^\$/.test(line.text) : /^>/.test(line.text) || /^\|/.test(line.text));
  const lineIndexAt = (pos: number) => {
    let index = lines.findIndex((line) => line.to >= pos);
    if (index < 0) index = lines.length - 1;
    return index;
  };

  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line) || isSkipped(line)) {
      i++;
      continue;
    }
    let end = i;
    let kind: BlockKind;
    const listItem = list.exec(line.text);
    if (heading.test(line.text)) {
      kind = "heading";
    } else if (listItem) {
      kind = "list";
      // What's nested under it (indented more) goes with it.
      const indent = listItem[1].length;
      while (end + 1 < lines.length && !isBlank(lines[end + 1]) && indentOf(lines[end + 1]) > indent) end++;
    } else if (fence.test(line.text)) {
      kind = "code";
      const close = lines.findIndex((l, n) => n > i && fence.test(l.text));
      end = close < 0 ? lines.length - 1 : close;
    } else if (typst && BLOCK_CALL.test(line.text)) {
      kind = line.text.startsWith("#columns(") ? "columns" : "other";
      // A #[ … ] holding a code block (with its line numbers): the code block.
      const isWrapper = line.text.startsWith("#[");
      // To where its brackets close, including any [content] right after, like #columns(2)[…].
      let open = line.text.search(/[([]/);
      let close = -1;
      while (open >= 0) {
        close = matchingClose(text, line.from + open);
        if (close < 0) break;
        const next = text[close + 1];
        open = next === "[" || next === "(" ? close + 1 - line.from : -1;
      }
      if (close >= 0) end = Math.max(end, lineIndexAt(close));
      if (isWrapper && text.slice(line.from, lines[end].to).includes("```")) kind = "code";
    } else if (!typst && (/^>/.test(line.text) || /^\|/.test(line.text))) {
      kind = "other";
      const mark = line.text[0];
      while (end + 1 < lines.length && lines[end + 1].text.startsWith(mark)) end++;
    } else {
      kind = typst && /^\$/.test(line.text) ? "other" : "paragraph";
      while (end + 1 < lines.length && !isBlank(lines[end + 1]) && !startsAnother(lines[end + 1]) && !isSkipped(lines[end + 1])) {
        end++;
      }
    }
    blocks.push({ from: line.from, to: lines[end].to, kind });
    i = end + 1;
  }

  // Styles and maths written across blocks (even across blank lines) join them into one.
  for (const span of findFormatting(text, format)) {
    const first = blocks.findIndex((b) => b.from <= span.from && span.from <= b.to);
    const last = blocks.findIndex((b) => b.from <= span.to - 1 && span.to - 1 <= b.to);
    if (first >= 0 && last > first) {
      blocks.splice(first, last - first + 1, { from: blocks[first].from, to: blocks[last].to, kind: blocks[first].kind });
    }
  }
  return blocks;
}

/** Paragraphs need a blank line around them, or they'd run into what's next to them. */
const needsBlank = (a: Block, b: Block) => a.kind === "paragraph" || b.kind === "paragraph";

const lineStartAt = (text: string, pos: number) => text.lastIndexOf("\n", pos - 1) + 1;
const lineEndAt = (text: string, pos: number) => (text.indexOf("\n", pos) + 1 || text.length + 1) - 1;
const blankBetween = (text: string, from: number, to: number) => text.slice(from, to).trim() === "";

/**
 * What to take out of a text to remove a block: its lines, and a blank line it leaves doubled.
 * Taken from between two paragraphs (with no blank lines around), it leaves one, so they don't
 * run together.
 */
export function removalOf(text: string, block: Block, blocks: Block[] = []): Range & { insert: string } {
  let { from, to } = block;
  const previous = [...blocks].reverse().find((b) => b.to < block.from);
  const next = blocks.find((b) => b.from > block.to);
  if (previous && next && previous.to === block.from - 1 && next.from === block.to + 1 && needsBlank(previous, next)) {
    return { from, to: to + 1, insert: "\n" };
  }
  if (to < text.length) {
    to += 1;
    const nextEnd = lineEndAt(text, to);
    const nextBlank = to < text.length && blankBetween(text, to, nextEnd);
    const prevBlank = from === 0 || blankBetween(text, lineStartAt(text, from - 1), from - 1);
    if (nextBlank && prevBlank) to = Math.min(text.length, nextEnd + 1);
  } else if (from > 0) {
    from -= 1;
    const prevStart = lineStartAt(text, from);
    if (prevStart > 0 && blankBetween(text, prevStart, from)) from = prevStart - 1;
  }
  return { from, to, insert: "" };
}

/**
 * What to put into a text to drop a block there: where, the text (the block's, with the line
 * breaks it needs around it), and where in that the block itself starts.
 */
export function insertionOf(
  text: string,
  blocks: Block[],
  moved: Block,
  movedText: string,
  drop: Drop,
  /** The block being moved, when it's in this same text (it doesn't count as a neighbour). */
  self?: Block,
): { at: number; insert: string; start: number } {
  const others = blocks.filter((b) => !self || b.from !== self.from);
  const target = drop.block;
  if (drop.side === "before") {
    const at = target.from;
    const prevBlank = at === 0 || blankBetween(text, lineStartAt(text, at - 1), at - 1);
    const previous = [...others].reverse().find((b) => b.to < at);
    const prefix = !prevBlank && previous && needsBlank(moved, previous) ? "\n" : "";
    const suffix = needsBlank(moved, target) ? "\n\n" : "\n";
    return { at, insert: prefix + movedText + suffix, start: prefix.length };
  }
  const at = target.to;
  const nextStart = at + 1;
  const nextBlank = nextStart >= text.length || blankBetween(text, nextStart, lineEndAt(text, nextStart));
  const next = others.find((b) => b.from > at);
  const prefix = needsBlank(moved, target) ? "\n\n" : "\n";
  const suffix = !nextBlank && next && needsBlank(moved, next) ? "\n" : "";
  return { at, insert: prefix + movedText + suffix, start: prefix.length };
}

/** Whether dropping a block there would leave it where it is. */
export function staysPut(blocks: Block[], block: Block, drop: Drop) {
  const index = blocks.findIndex((b) => b.from === block.from);
  const target = blocks.findIndex((b) => b.from === drop.block.from);
  return target === index || (drop.side === "before" && target === index + 1) || (drop.side === "after" && target === index - 1);
}

/** Moves a block within a text: the new text, and where the block starts in it. */
export function moveBlock(text: string, format: Format, block: Block, drop: Drop): { text: string; cursor: number } {
  const blocks = findBlocks(text, format);
  if (staysPut(blocks, block, drop)) return { text, cursor: block.from };
  const removal = removalOf(text, block, blocks);
  const insertion = insertionOf(text, blocks, block, text.slice(block.from, block.to), drop, block);
  if (insertion.at > removal.from && insertion.at < removal.to) return { text, cursor: block.from };
  const removed = removal.to - removal.from - removal.insert.length;
  if (insertion.at <= removal.from) {
    const result =
      text.slice(0, insertion.at) +
      insertion.insert +
      text.slice(insertion.at, removal.from) +
      removal.insert +
      text.slice(removal.to);
    return { text: result, cursor: insertion.at + insertion.start };
  }
  const result =
    text.slice(0, removal.from) + removal.insert + text.slice(removal.to, insertion.at) + insertion.insert + text.slice(insertion.at);
  return { text: result, cursor: insertion.at - removed + insertion.start };
}

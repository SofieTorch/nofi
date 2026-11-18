// Finds the formatting in a note's text (headings, bold, lists…) so the editor can show it styled
// while you type, Obsidian-style. Typst notes are read with Typst's own parser (typstFormatting.ts);
// Markdown notes with the scanner below, line by line. The real Typst compiler takes over later
// for things it has to draw, like maths.

import { typstFormatting } from "./typstFormatting";

export type Format = "typst" | "markdown";

/** The format of a note file, or null if the file isn't a note (e.g. a PDF). */
export function noteFormat(path: string): Format | null {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "typ") return "typst";
  if (extension === "md") return "markdown";
  return null;
}

export type Kind =
  | "heading"
  | "bold"
  | "italic"
  | "highlight"
  | "strikethrough"
  | "underline"
  | "smallcaps"
  | "superscript"
  | "subscript"
  | "overline"
  | "uppercase"
  | "lowercase"
  | "link"
  /** `#text(…)[…]`: colour, size… (in `args`). */
  | "text"
  | "align"
  | "justify"
  | "footnote"
  /** A Markdown divider: `---` on its own line. */
  | "divider"
  /** A fenced code block (```lang … ```); `args` is its language. */
  | "codeblock"
  /** `#quote(block: true)[…]`. */
  | "quote"
  /** `#quote[…]`: an inline quotation, shown in quotation marks. */
  | "quotation"
  /** A backslash keeping the next character as it is, like `\*`; the backslash is its marker. */
  | "escape"
  /** `#block(fill: …)[…]`: a shaded box. */
  | "callout"
  /** `#pad(left: …)[…]`. */
  | "indent"
  | "code"
  | "math"
  | "list-item"
  /** `- [ ] task` or `- [x] task`: a checklist's task. Its marker is the `- [ ] `. */
  | "task"
  | "comment";

export type Range = { from: number; to: number };

export type Span = Range & {
  kind: Kind;
  /** Headings only: 1 is the biggest. */
  level?: number;
  /** Maths only: `$ x $` (spaces inside the dollars) is a display equation, on its own line. */
  display?: boolean;
  /** Style functions only: their settings, like `fill: red` in `#text(fill: red)[…]`. */
  args?: string;
  /** Tasks only: whether it's done (`[x]`). */
  checked?: boolean;
  /** Code blocks only: whether its lines are numbered, and which lines are highlighted (from 1). */
  numbers?: boolean;
  highlights?: number[];
  /** Code blocks only, in Typst: the lines of the #[ … ] around it that hold those options. */
  wrapper?: Range[];
  /** The syntax around the content, like the stars of *bold*. Hidden when the cursor is away. */
  markers: Range[];
};

/** Markdown's syntax. */
const MARKDOWN = {
  heading: /^(#{1,6} +)/,
  list: /^\s*([-*+] +|\d+\. +)/,
  /** Longest first, so "**" wins over "*". */
  delimiters: [
    { text: "~~", kind: "strikethrough" },
    // Obsidian's highlight.
    { text: "==", kind: "highlight" },
    { text: "**", kind: "bold" },
    { text: "__", kind: "bold" },
    { text: "*", kind: "italic" },
    { text: "_", kind: "italic" },
  ] as { text: string; kind: Kind }[],
};

export function findFormatting(text: string, format: Format): Span[] {
  if (format === "typst") return typstFormatting(text);
  const spans: Span[] = [];
  scan(text, 0, text.length, spans);
  return spans;
}

const lineEndAt = (text: string, from: number) => {
  const end = text.indexOf("\n", from);
  return end === -1 ? text.length : end;
};

/** Where the paragraph `from` is in ends: at the next blank line. */
const paragraphEndAt = (text: string, from: number) => {
  const blank = /\n[ \t]*\n/.exec(text.slice(from));
  return blank ? from + blank.index : text.length;
};

/**
 * Finds the formatting in a Markdown note between `start` and `end`, in order (a style before the
 * styles inside it). Headings, list markers and code are per line; bold and italic can continue to
 * the end of their paragraph.
 */
function scan(text: string, start: number, end: number, spans: Span[]) {
  const syntax = MARKDOWN;
  let i = start;
  while (i < end) {
    const lineEnd = Math.min(lineEndAt(text, i), end);

    if (i === 0 || text[i - 1] === "\n") {
      const line = text.slice(i, lineEnd);
      // Fenced code blocks: nothing inside them is formatting.
      const block = codeBlockAt(text, i, lineEnd, end, false);
      if (block) {
        spans.push(block);
        i = block.to;
        continue;
      }
      if (line.startsWith("```")) {
        // Not closed (yet): the fence is just text for now.
        i = lineEnd;
        continue;
      }
      // Markdown dividers; right under text, dashes make that text a heading instead.
      const afterBlank = i === 0 || text.slice(0, i - 1).endsWith("\n") || i === 1;
      if (afterBlank && /^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
        spans.push({ kind: "divider", from: i, to: lineEnd, markers: [] });
        i = lineEnd;
        continue;
      }
      const heading = syntax.heading.exec(line);
      const list = syntax.list.exec(line);
      if (heading) {
        const marker = heading[1];
        spans.push({
          kind: "heading",
          level: marker.trim().length,
          from: i,
          to: lineEnd,
          markers: [{ from: i, to: i + marker.length }],
        });
        i += marker.length;
        continue;
      }
      if (list) {
        const from = i + list[0].length - list[1].length;
        const marker = { from, to: from + list[1].length };
        // A bullet followed by a box, [ ] or [x], is a task.
        const box = /^\[([ xX])\](?: |$)/.exec(text.slice(marker.to, lineEnd));
        if (box && /^[-*+]/.test(list[1])) {
          const task = { from, to: marker.to + box[0].length };
          spans.push({ kind: "task", ...task, checked: box[1] !== " ", markers: [task] });
          i = task.to;
          continue;
        }
        spans.push({ kind: "list-item", ...marker, markers: [marker] });
        i += list[0].length;
        continue;
      }
    }

    const char = text[i];
    if (char === "\\") {
      if (i + 1 < end && /[^\p{L}\p{N}\s]/u.test(text[i + 1])) {
        spans.push({ kind: "escape", from: i, to: i + 2, markers: [{ from: i, to: i + 1 }] });
      }
      i += 2;
      continue;
    }
    if (char === "`") {
      const close = text.indexOf(char, i + 1);
      if (close !== -1 && close < lineEnd) {
        spans.push({
          kind: "code",
          from: i,
          to: close + 1,
          markers: [
            { from: i, to: i + 1 },
            { from: close, to: close + 1 },
          ],
        });
        i = close + 1;
        continue;
      }
    }
    // Markdown links: [text](address); the brackets and address are its markers.
    const link = /^\[([^\]\n]*)\]\(([^)\s]*)\)/.exec(text.slice(i, end));
    if (link) {
      const labelEnd = i + 1 + link[1].length;
      spans.push({
        kind: "link",
        args: link[2],
        from: i,
        to: i + link[0].length,
        markers: [
          { from: i, to: i + 1 },
          { from: labelEnd, to: i + link[0].length },
        ],
      });
      scan(text, i + 1, labelEnd, spans);
      i += link[0].length;
      continue;
    }
    const delimiter = syntax.delimiters.find((d) => text.startsWith(d.text, i));
    if (delimiter) {
      const size = delimiter.text.length;
      const close = findCloser(text, delimiter.text, i + size, Math.min(paragraphEndAt(text, i), end));
      if (close !== -1) {
        spans.push({
          kind: delimiter.kind,
          from: i,
          to: close + size,
          markers: [
            { from: i, to: i + size },
            { from: close, to: close + size },
          ],
        });
        scan(text, i + size, close, spans);
        i = close + size;
        continue;
      }
      // No closer: skip the whole delimiter, so "**" isn't read as two "*".
      i += size;
      continue;
    }
    i++;
  }
}

/** The rule Marginalia writes in a #[ … ] around a Typst code block, to number or highlight lines. */
const LINES_RULE = "#show raw.line: it =>";

/** A ``` code block starting at `from` (a line start), with its options; null if there's none. */
export function codeBlockAt(text: string, from: number, lineEnd: number, end: number, typst: boolean): Span | null {
  const lineAt = (start: number) => {
    const stop = text.indexOf("\n", start);
    return { from: start, to: stop === -1 || stop > end ? end : stop };
  };
  const first = text.slice(from, lineEnd);

  // In Typst: #[, the rule, the fenced block, then ].
  if (typst && first.trim() === "#[") {
    const rule = lineAt(lineEnd + 1);
    const ruleText = text.slice(rule.from, rule.to);
    if (lineEnd >= end || !ruleText.startsWith(LINES_RULE)) return null;
    const inner = rule.to < end ? codeBlockAt(text, rule.to + 1, lineAt(rule.to + 1).to, end, typst) : null;
    if (!inner || inner.wrapper) return null;
    const closing = lineAt(inner.to + 1);
    if (inner.to >= end || text.slice(closing.from, closing.to).trim() !== "]") return null;
    const list = /it\.number in \((.*?)\) \[/.exec(ruleText)?.[1] ?? "";
    const highlights: number[] = [];
    for (const item of list.matchAll(/\.\.range\((\d+),\s*(\d+)\)|(\d+)/g)) {
      if (item[3]) highlights.push(Number(item[3]));
      else for (let n = Number(item[1]); n < Number(item[2]); n++) highlights.push(n);
    }
    return {
      ...inner,
      from,
      to: closing.to,
      numbers: ruleText.includes("str(it.number)"),
      highlights,
      wrapper: [
        { from, to: rule.to },
        { from: closing.from, to: closing.to },
      ],
    };
  }

  if (!first.startsWith("```")) return null;
  const close = /\n[ \t]*```[ \t]*(?=\n|$)/.exec(text.slice(lineEnd, end));
  if (!close) return null;
  const closeStart = lineEnd + close.index + 1;
  const closeEnd = lineEnd + close.index + close[0].length;
  const info = first.slice(3).trim();
  const language = info.split(/\s+/)[0] ?? "";
  const block: Span = {
    kind: "codeblock",
    args: language,
    from,
    to: closeEnd,
    markers: [
      { from, to: lineEnd },
      { from: closeStart, to: closeEnd },
    ],
  };
  // In Markdown, the options follow the language: ```python {2-4} showLineNumbers
  if (!typst) {
    const ranges = /\{([\d,\s-]+)\}/.exec(info)?.[1];
    if (/\bshowLineNumbers\b/.test(info)) block.numbers = true;
    if (ranges) {
      block.highlights = ranges.split(",").flatMap((part) => {
        const [a, b] = part.trim().split("-").map(Number);
        return Number.isNaN(a) ? [] : Array.from({ length: (b || a) - a + 1 }, (_, k) => a + k);
      });
    }
  }
  return block;
}

/** Where `delimiter` closes, skipping escaped characters and code; -1 if it doesn't. */
function findCloser(line: string, delimiter: string, from: number, end: number) {
  if (from >= end || line.startsWith(delimiter, from)) return -1; // empty, like "**"
  for (let i = from; i < end; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "`") {
      const close = line.indexOf("`", i + 1);
      if (close === -1 || close >= end) return -1;
      i = close;
    } else if (line.startsWith(delimiter, i)) {
      // For "*", a "**" means bold in Markdown: not our closer.
      if (delimiter.length === 1 && line[i + 1] === delimiter && line[i - 1] !== delimiter) {
        i++;
        continue;
      }
      return i;
    }
  }
  return -1;
}

/**
 * The markers to hide, given where the cursors are: a heading's markers show while a cursor is on
 * its line; bold, italic and code markers show while a cursor is inside or right next to them.
 * Maths, comments and list markers are never hidden.
 */
export function hiddenMarkers(spans: Span[], cursors: readonly Range[], text: string): Range[] {
  const lineOf = (span: Span): Range => ({
    from: text.lastIndexOf("\n", span.from - 1) + 1,
    to: (text.indexOf("\n", span.from) + 1 || text.length + 1) - 1,
  });
  return spans.flatMap((span) => {
    if (["list-item", "task", "math", "comment", "codeblock"].includes(span.kind)) return [];
    const editing = touches(span.kind === "heading" ? lineOf(span) : span, cursors);
    return editing ? [] : span.markers;
  });
}

/**
 * The maths to draw as formulas (by Typst): all of it except the maths a cursor is in or right
 * next to, which shows its source so it can be edited.
 */
export function drawnMaths(spans: Span[], cursors: readonly Range[]): Span[] {
  return spans.filter((span) => span.kind === "math" && !touches(span, cursors));
}

/** Whether a cursor is in (or right next to) a span: then it's shown as code, to edit. */
export const isBeingEdited = (range: Range, cursors: readonly Range[]) => touches(range, cursors);

const touches = (range: Range, cursors: readonly Range[]) =>
  cursors.some((cursor) => cursor.from <= range.to && cursor.to >= range.from);

// Adding, removing and changing styles on selected text, for the format toolbar and shortcuts.
// Styles are written the way a person would: `*bold*` where that works, `#strong[…]` where stars
// wouldn't (inside a word, across lines). Every Typst result in tests/fixtures/style-toggles.json
// is checked by the Rust tests to be valid Typst.

import { findFormatting, type Format, type Kind, type Range, type Span } from "./formatting";

/** Styles that are either on or off. */
export type Style =
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
  | "footnote"
  | "code"
  | "maths"
  | "justify";

/** Styles with a setting: a colour, a link's address, an alignment, a size, a font. */
export type Option = "colour" | "highlight" | "link" | "align" | "size" | "font";

/** Kinds of block the lines of a selection can be turned into. */
export type BlockType =
  | "text"
  | "heading-1"
  | "heading-2"
  | "heading-3"
  | "bulleted-list"
  | "numbered-list"
  | "quote"
  | "callout";

const CALLOUT = "#block(fill: luma(240), inset: 10pt, radius: 4pt, width: 100%)[";

const TYPST_STYLES: Style[] = [
  "bold",
  "italic",
  "highlight",
  "strikethrough",
  "underline",
  "smallcaps",
  "superscript",
  "subscript",
  "overline",
  "uppercase",
  "lowercase",
  "footnote",
  "code",
  "maths",
  "justify",
];
const MARKDOWN_STYLES: Style[] = ["bold", "italic", "strikethrough", "highlight", "code"];

export function availableStyles(format: Format): Style[] {
  return format === "typst" ? TYPST_STYLES : MARKDOWN_STYLES;
}

/** The Typst function each style is written with (bold and italic also have * and _). */
const FUNCTIONS: Partial<Record<Style, string>> = {
  bold: "strong",
  italic: "emph",
  highlight: "highlight",
  strikethrough: "strike",
  underline: "underline",
  smallcaps: "smallcaps",
  superscript: "super",
  subscript: "sub",
  overline: "overline",
  uppercase: "upper",
  lowercase: "lower",
  footnote: "footnote",
};

/** Styles that apply to whole lines (paragraphs), not just the selected words. */
const PARAGRAPH: (Style | Option)[] = ["justify", "align"];

const styleOf = (kind: Kind): Style | null =>
  kind === "math" ? "maths" : (TYPST_STYLES as string[]).includes(kind) ? (kind as Style) : null;

/** Where a styled span's text is (between its markers). */
function contentOf(span: Span): Range {
  if (span.kind === "math") return { from: span.from + 1, to: span.to - 1 };
  return { from: span.markers[0].to, to: span.markers[span.markers.length - 1].from };
}

/** The styled spans the selection is inside (or exactly covers), outermost first. */
function spansAround(text: string, format: Format, selection: Range): Span[] {
  return findFormatting(text, format).filter((span) => {
    if (span.markers.length === 0 && span.kind !== "math") return false;
    const content = contentOf(span);
    const inside = content.from <= selection.from && selection.to <= content.to;
    const whole = span.from === selection.from && span.to === selection.to;
    return inside || whole;
  });
}

/** The styles the selected text has, outermost first. */
export function stylesAt(text: string, format: Format, selection: Range): Style[] {
  return spansAround(text, format, selection)
    .map((span) => styleOf(span.kind))
    .filter((style): style is Style => style !== null);
}

/** The value of a setting like `fill: red` in a style function's settings. */
function setting(args: string | undefined, name: string): string | undefined {
  const match = new RegExp(`(?:^|,)\\s*${name}:\\s*`).exec(args ?? "");
  if (!match) return undefined;
  const rest = (args ?? "").slice(match.index + match[0].length);
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '"') {
      for (i++; i < rest.length && rest[i] !== '"'; i++) {
        if (rest[i] === "\\") i++;
      }
    } else if (rest[i] === "(") depth++;
    else if (rest[i] === ")") depth--;
    else if (rest[i] === "," && depth === 0) return rest.slice(0, i).trim();
  }
  return rest.trim();
}

const firstQuoted = (args: string | undefined) => {
  const match = /^\s*"((?:[^"\\]|\\.)*)"/.exec(args ?? "");
  return match ? match[1].replace(/\\(.)/g, "$1") : undefined;
};

export type Options = {
  colour?: string;
  highlight?: string;
  link?: string;
  align?: string;
  size?: string;
  font?: string;
  indent?: string;
};

/** The settings around the selection: its colour, highlight colour, link and alignment. */
export function optionsAt(text: string, format: Format, selection: Range): Options {
  const options: Options = {};
  for (const span of spansAround(text, format, selection)) {
    if (span.kind === "text") {
      const fill = setting(span.args, "fill");
      const size = setting(span.args, "size");
      const font = setting(span.args, "font");
      if (fill) options.colour = fill;
      if (size) options.size = size;
      if (font) options.font = firstQuoted(font) ?? font;
    }
    if (span.kind === "indent") options.indent = setting(span.args, "left");
    if (span.kind === "highlight") options.highlight = setting(span.args, "fill") ?? "default";
    if (span.kind === "link") options.link = format === "markdown" ? span.args : firstQuoted(span.args);
    if (span.kind === "align") options.align = span.args?.trim();
  }
  return options;
}

export type StyleEdit = {
  /** In positions of the text before the edit. */
  changes: { from: number; to: number; insert: string }[];
  /** What's selected afterwards: the same text, now styled (or not). */
  selection: Range;
};

/** Adds the style to the selected text, or removes it if the text already has it. */
export function toggleStyle(text: string, format: Format, selection: Range, style: Style): StyleEdit | null {
  const existing = spansAround(text, format, selection).filter((span) => styleOf(span.kind) === style);
  if (existing.length > 0) return removeSpan(existing[existing.length - 1], selection);
  return addStyle(text, format, selection, style);
}

/** Sets a style's setting (a colour, an address, an alignment); null takes it away. */
export function setOption(
  text: string,
  format: Format,
  selection: Range,
  option: Option,
  value: string | null,
): StyleEdit | null {
  const spans = spansAround(text, format, selection);
  const find = (test: (span: Span) => boolean) => spans.filter(test).pop();

  if (format === "markdown") {
    if (option !== "link") return null;
    const span = find((s) => s.kind === "link");
    if (span) return value === null ? removeSpan(span, selection) : replaceClosing(span, `](${value})`, selection);
    return value === null ? null : wrap(text, selection, "[", `](${value})`);
  }

  switch (option) {
    case "colour":
      return setTextSetting(text, selection, spans, "fill", value);
    case "size":
      return setTextSetting(text, selection, spans, "size", value);
    case "font":
      return setTextSetting(text, selection, spans, "font", value === null ? null : quoted(value));
    case "highlight": {
      const opening = value === null ? "#highlight[" : `#highlight(fill: ${value})[`;
      const span = find((s) => s.kind === "highlight");
      if (span) return replaceOpening(span, opening, selection);
      return wrapFunction(text, selection, opening);
    }
    case "link": {
      const opening = value === null ? null : `#link(${quoted(value)})[`;
      const span = find((s) => s.kind === "link");
      if (span) return opening === null ? removeSpan(span, selection) : replaceOpening(span, opening, selection);
      return opening === null ? null : wrapFunction(text, selection, opening);
    }
    case "align": {
      const span = find((s) => s.kind === "align");
      const isDefault = value === null || value === "left";
      if (span) return isDefault ? removeSpan(span, selection) : replaceOpening(span, `#align(${value})[`, selection);
      return isDefault ? null : wrapFunction(text, selection, `#align(${value})[`, wholeLines(text, selection));
    }
  }
}

const quoted = (text: string) => `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** A style function's settings, one by one (commas inside quotes or brackets don't split them). */
function splitSettings(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '"') {
      for (i++; i < args.length && args[i] !== '"'; i++) {
        if (args[i] === "\\") i++;
      }
    } else if (args[i] === "(") depth++;
    else if (args[i] === ")") depth--;
    else if (args[i] === "," && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** The settings with one changed (or added, or removed when null). */
function withSetting(args: string | undefined, name: string, value: string | null): string {
  const parts = splitSettings(args ?? "");
  const index = parts.findIndex((part) => new RegExp(`^${name}\\s*:`).test(part));
  if (value === null) {
    if (index >= 0) parts.splice(index, 1);
  } else if (index >= 0) parts[index] = `${name}: ${value}`;
  else parts.push(`${name}: ${value}`);
  return parts.join(", ");
}

/**
 * Sets one of #text's settings (fill, size, font). If the selection is all of the text of a #text
 * that already has settings, they're combined; part of it gets its own #text inside.
 */
function setTextSetting(text: string, selection: Range, spans: Span[], name: string, value: string | null) {
  const wanted = trimmed(text, selection);
  const coversAll = (span: Span) => {
    const content = contentOf(span);
    const whole = span.from === selection.from && span.to === selection.to;
    return whole || (wanted.from <= content.from && content.to <= wanted.to);
  };
  const edit = (span: Span) => {
    const args = withSetting(span.args, name, value);
    return args ? replaceOpening(span, `#text(${args})[`, selection) : removeSpan(span, selection);
  };
  const texts = spans.filter((span) => span.kind === "text");
  const withIt = texts.filter((span) => setting(span.args, name) !== undefined).pop();
  if (withIt && (value === null || coversAll(withIt))) return edit(withIt);
  if (value === null) return null;
  const sameText = texts.filter(coversAll).pop();
  if (sameText) return edit(sameText);
  return wrapFunction(text, selection, `#text(${name}: ${value})[`);
}

/** Changes a span's closing marker (like a Markdown link's address), keeping the selection. */
function replaceClosing(span: Span, closing: string, selection: Range): StyleEdit {
  const old = span.markers[span.markers.length - 1];
  const shift = closing.length - (old.to - old.from);
  const moved = (at: number) => (at >= old.to ? at + shift : at);
  return {
    changes: [{ from: old.from, to: old.to, insert: closing }],
    selection: { from: moved(selection.from), to: moved(selection.to) },
  };
}

/** From the start of the selection's first line to the end of its last. */
function wholeLines(text: string, selection: Range): Range {
  const from = text.lastIndexOf("\n", selection.from - 1) + 1;
  const end = text.indexOf("\n", selection.to);
  return { from, to: end === -1 ? text.length : end };
}

function removeSpan(span: Span, selection: Range): StyleEdit {
  const content = contentOf(span);
  const open = { from: span.from, to: content.from };
  const close = { from: content.to, to: span.to };
  const openLength = open.to - open.from;
  // Where a position ends up once the markers are gone.
  const moved = (at: number) =>
    at <= open.from ? at : at <= open.to ? open.from : at <= close.from ? at - openLength : close.from - openLength;
  return {
    changes: [
      { ...open, insert: "" },
      { ...close, insert: "" },
    ],
    selection: { from: moved(selection.from), to: moved(selection.to) },
  };
}

/** Changes a style function's opening (like its colour), keeping its text and the selection. */
function replaceOpening(span: Span, opening: string, selection: Range): StyleEdit {
  const old = span.markers[0];
  const shift = opening.length - (old.to - old.from);
  const moved = (at: number) => (at >= old.to ? at + shift : at);
  return {
    changes: [{ from: old.from, to: old.to, insert: opening }],
    selection: { from: moved(selection.from), to: moved(selection.to) },
  };
}

const isWordCharacter = (char: string | undefined) => !!char && /[\p{L}\p{N}_]/u.test(char);

/** Without spaces at the edges: they stay outside the style. */
function trimmed(text: string, selection: Range): Range {
  let { from, to } = selection;
  while (from < to && /\s/.test(text[from])) from++;
  while (to > from && /\s/.test(text[to - 1])) to--;
  return { from, to };
}

/**
 * Wraps `around` (the selection, without spaces at its edges, unless given) in markers. The
 * selected text stays selected; brackets in it that don't pair up are escaped for function styles.
 */
function wrap(text: string, selection: Range, open: string, close: string, around?: Range): StyleEdit | null {
  const range = around ?? trimmed(text, selection);
  if (range.from === range.to) return null;
  const inside = open.endsWith("[") ? unbalancedBrackets(text, range.from, range.to) : [];
  const selected = around ? selection : range;
  const addedBefore = (at: number) => inside.filter((change) => change.at < at).length;
  return {
    changes: [
      { from: range.from, to: range.from, insert: open },
      ...inside.map((change) => ({ from: change.at, to: change.at, insert: change.insert })),
      { from: range.to, to: range.to, insert: close },
    ],
    selection: {
      from: selected.from + open.length + addedBefore(selected.from),
      to: selected.to + open.length + addedBefore(selected.to),
    },
  };
}

const wrapFunction = (text: string, selection: Range, opening: string, around?: Range) =>
  wrap(text, selection, opening, "]", around);

function addStyle(text: string, format: Format, selection: Range, style: Style): StyleEdit | null {
  const { from, to } = trimmed(text, selection);
  if (from === to) return null;
  const selected = text.slice(from, to);
  const multiline = selected.includes("\n");

  if (format === "markdown") {
    const markers: Partial<Record<Style, string>> = {
      bold: "**",
      italic: selected.includes("*") ? "_" : "*",
      strikethrough: "~~",
      highlight: "==",
      code: "`",
    };
    const marker = markers[style];
    if (!marker || (style === "code" && (multiline || selected.includes("`")))) return null;
    return wrap(text, selection, marker, marker);
  }

  // Typst.
  if (style === "code") return multiline || selected.includes("`") ? null : wrap(text, selection, "`", "`");
  if (style === "maths") return multiline || selected.includes("$") ? null : wrap(text, selection, "$", "$");
  if (style === "justify") return wrapFunction(text, selection, "#par(justify: true)[", wholeLines(text, selection));
  if (style === "bold" || style === "italic") {
    const marker = style === "bold" ? "*" : "_";
    // Stars and underscores only work at the edges of words, on one line, around text without them.
    const simple =
      !multiline && !selected.includes(marker) && !isWordCharacter(text[from - 1]) && !isWordCharacter(text[to]);
    if (simple) return wrap(text, selection, marker, marker);
  }
  return wrapFunction(text, selection, `#${FUNCTIONS[style]}[`);
}

/** Whether a style or setting applies to whole lines rather than the selected words. */
export const isParagraphStyle = (style: Style | Option) => PARAGRAPH.includes(style);

/** Backslashes for brackets in the text that don't pair up, so they stay text inside [ ]. */
function unbalancedBrackets(text: string, from: number, to: number) {
  const open: number[] = [];
  const escapes: { at: number; insert: string }[] = [];
  for (let i = from; i < to; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === "[") open.push(i);
    else if (text[i] === "]") {
      if (open.length > 0) open.pop();
      else escapes.push({ at: i, insert: "\\" });
    }
  }
  for (const at of open) escapes.push({ at, insert: "\\" });
  return escapes.sort((a, b) => a.at - b.at);
}

// --- Blocks: turning lines into headings, lists, quotes…, and indenting them ---------------------

/** What starts a line of each kind of block, and how to recognise any of them to replace it. */
const LINE_STARTS: Record<Format, { pattern: RegExp; type: (match: RegExpExecArray) => BlockType }[]> = {
  typst: [
    { pattern: /^(=+) /, type: (m) => `heading-${Math.min(m[1].length, 3)}` as BlockType },
    { pattern: /^(\s*)- /, type: () => "bulleted-list" },
    { pattern: /^(\s*)\+ /, type: () => "numbered-list" },
  ],
  markdown: [
    { pattern: /^(#{1,6}) /, type: (m) => `heading-${Math.min(m[1].length, 3)}` as BlockType },
    { pattern: /^(\s*)[-*+] /, type: () => "bulleted-list" },
    { pattern: /^(\s*)\d+\. /, type: () => "numbered-list" },
    { pattern: /^> ?/, type: () => "quote" },
  ],
};

function lineStart(format: Format, line: string) {
  for (const { pattern, type } of LINE_STARTS[format]) {
    const match = pattern.exec(line);
    if (match) {
      const isList = type(match).endsWith("list");
      return { length: match[0].length, type: type(match), indent: isList ? match[1] : "" };
    }
  }
  return { length: 0, type: "text" as BlockType, indent: "" };
}

/** Quotes and callouts wrap their lines in Typst: the innermost one around the selection. */
const wrapperAround = (text: string, format: Format, selection: Range) =>
  format === "typst"
    ? spansAround(text, format, selection).filter((span) => span.kind === "quote" || span.kind === "callout").pop()
    : undefined;

/** The kind of block the selection is in (its first line's, or the quote or callout around it). */
export function blockTypeAt(text: string, format: Format, selection: Range): BlockType {
  const wrapper = wrapperAround(text, format, selection);
  if (wrapper) return wrapper.kind as BlockType;
  const lines = wholeLines(text, selection);
  return lineStart(format, text.slice(lines.from, lines.to)).type;
}

/**
 * Rewrites some lines: each line's start (like "- ") is replaced with a new one, and the whole can
 * be wrapped (like in #quote[…]). The selected text stays selected.
 */
function rewriteLines(
  text: string,
  selection: Range,
  region: Range,
  inner: Range,
  newStart: (line: string) => { old: number; start: string },
  open = "",
  close = "",
): StyleEdit {
  const lines = text.slice(inner.from, inner.to).split("\n");
  const starts = lines.map(newStart);
  const newLines = lines.map((line, i) => starts[i].start + line.slice(starts[i].old));
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of newLines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }
  const moved = (at: number) => {
    if (at <= inner.from) return region.from + open.length + (at < inner.from ? 0 : starts[0].start.length);
    if (at >= inner.to) return region.from + open.length + offset - 1;
    const before = text.slice(inner.from, at);
    const index = before.split("\n").length - 1;
    const column = at - (inner.from + before.lastIndexOf("\n") + 1);
    const inLine = Math.max(0, column - starts[index].old) + starts[index].start.length;
    return region.from + open.length + lineOffsets[index] + inLine;
  };
  return {
    changes: [{ from: region.from, to: region.to, insert: open + newLines.join("\n") + close }],
    selection: { from: moved(selection.from), to: moved(selection.to) },
  };
}

/** Turns the lines the selection is on into another kind of block. */
export function turnInto(text: string, format: Format, selection: Range, type: BlockType): StyleEdit | null {
  if (format === "markdown" && type === "callout") return null;
  const wrapper = wrapperAround(text, format, selection);
  const region = wrapper ? { from: wrapper.from, to: wrapper.to } : wholeLines(text, selection);
  const inner = wrapper ? contentOf(wrapper) : region;

  const heading = /^heading-(\d)$/.exec(type);
  const start = (indent: string): string => {
    if (heading) return (format === "typst" ? "=" : "#").repeat(Number(heading[1])) + " ";
    if (type === "bulleted-list") return `${indent}- `;
    if (type === "numbered-list") return `${indent}${format === "typst" ? "+" : "1."} `;
    if (type === "quote" && format === "markdown") return "> ";
    return "";
  };
  const newStart = (line: string) => {
    const old = lineStart(format, line);
    return { old: old.length, start: start(old.indent) };
  };
  if (format === "typst" && type === "quote") {
    return rewriteLines(text, selection, region, inner, newStart, "#quote(block: true)[", "]");
  }
  if (format === "typst" && type === "callout") return rewriteLines(text, selection, region, inner, newStart, CALLOUT, "]");
  return rewriteLines(text, selection, region, inner, newStart);
}

/**
 * Indents the lines the selection is on, or brings them back: list items are nested (two spaces),
 * other text is padded (#pad(left: 2em)[…], 2em more each time).
 */
export function indent(text: string, format: Format, selection: Range, direction: "in" | "out"): StyleEdit | null {
  const lines = wholeLines(text, selection);
  const all = text.slice(lines.from, lines.to).split("\n");
  if (all.every((line) => lineStart(format, line).type.endsWith("list"))) {
    if (direction === "out" && !all.every((line) => line.startsWith("  "))) return null;
    return rewriteLines(text, selection, lines, lines, () =>
      direction === "in" ? { old: 0, start: "  " } : { old: 2, start: "" },
    );
  }
  if (format !== "typst") return null;
  const pad = spansAround(text, format, selection).filter((span) => span.kind === "indent").pop();
  const amount = pad ? Number.parseFloat(setting(pad.args, "left") ?? "0") : 0;
  const next = amount + (direction === "in" ? 2 : -2);
  if (pad) return next > 0 ? replaceOpening(pad, `#pad(left: ${next}em)[`, selection) : removeSpan(pad, selection);
  return next > 0 ? wrapFunction(text, selection, `#pad(left: ${next}em)[`, lines) : null;
}

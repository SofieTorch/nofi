// The formatting in a Typst note, read from Typst's own syntax tree (see typstSyntax.ts): which
// parts are headings, bold, links, maths… as the spans the editor styles (see formatting.ts).
//
// The tree says exactly what each piece of the note is, so text and code never get mixed up (an
// underscore in a link's address isn't italic). Two things are this editor's own choices:
// - Something that isn't closed yet (a `$`, a `#highlight[`) is just text, and the rest of the
//   note keeps its formatting while you type, instead of everything after it turning into maths.
// - Only some functions count as styles, like `#highlight[…]` (see STYLE_FUNCTIONS); other code
//   is left as code, though text in its [brackets] is still formatted.

import { codeBlockAt, type Kind, type Range, type Span } from "./formatting";
import { parseTypst, type SyntaxNode } from "./typstSyntax";

/** Typst's style functions, written like `#highlight[text]`, and the kind of formatting each is. */
export const STYLE_FUNCTIONS: Record<string, Kind> = {
  strong: "bold",
  emph: "italic",
  highlight: "highlight",
  strike: "strikethrough",
  underline: "underline",
  smallcaps: "smallcaps",
  super: "superscript",
  sub: "subscript",
  overline: "overline",
  upper: "uppercase",
  lower: "lowercase",
  link: "link",
  text: "text",
  align: "align",
  // Only as #par(justify: true)[…]; other paragraph settings are left as code.
  par: "justify",
  quote: "quote",
  block: "callout",
  pad: "indent",
  footnote: "footnote",
};

/** Some functions only count as a style with certain settings; otherwise they're left as code. */
const NEEDED_SETTINGS: Record<string, RegExp> = {
  par: /justify:\s*true/,
  quote: /block:\s*true/,
  block: /fill:/,
  pad: /left:/,
};

const lineStartAt = (text: string, at: number) => text.lastIndexOf("\n", at - 1) + 1;
const lineEndAt = (text: string, at: number) => {
  const end = text.indexOf("\n", at);
  return end === -1 ? text.length : end;
};

/** The few last notes' formatting (several parts of the editor ask for the same note's). */
const recent: { text: string; spans: Span[] }[] = [];

export function typstFormatting(text: string): Span[] {
  const known = recent.find((entry) => entry.text === text);
  if (known) return known.spans;
  const spans: Span[] = [];
  walk(parseLeniently(text), text, spans);
  recent.unshift({ text, spans });
  recent.length = Math.min(recent.length, 4);
  return spans;
}

/**
 * The note's syntax tree, with what isn't closed yet read as text. Typst reads an unclosed `$` or
 * `[` as going on to the end of the note; here its opening character is read as a space (the same
 * length, so everything stays where it is) and the note is parsed again.
 */
function parseLeniently(text: string) {
  let source = text;
  for (let tries = 0; tries < 100; tries++) {
    const tree = parseTypst(source);
    const opener = unclosedOpener(tree, source);
    if (!opener) return tree;
    source = source.slice(0, opener.from) + " ".repeat(opener.to - opener.from) + source.slice(opener.to);
  }
  return parseTypst(source);
}

/** The first opening `$ [ ( { " /*` or backticks that are never closed, if there's one. */
function unclosedOpener(node: SyntaxNode, text: string): Range | null {
  if (node.kind === "BlockComment" && !text.slice(node.from, node.to).endsWith("*/")) return { from: node.from, to: node.from + 2 };
  // (An unclosed comment isn't an error to Typst, but it goes on to the end of the note.)
  if (!node.error && node.to !== text.length) return null;
  if (node.kind === "Error" && node.children.length === 0) {
    const source = text.slice(node.from, node.to);
    if (["$", "[", "(", "{"].includes(source)) return node;
    // (An unclosed string or raw text is one error from its start to the end.)
    if (source.startsWith('"')) return { from: node.from, to: node.from + 1 };
    const ticks = /^`+/.exec(source);
    if (ticks) return { from: node.from, to: node.from + ticks[0].length };
    return null;
  }
  for (const child of node.children) {
    const found = unclosedOpener(child, text);
    if (found) return found;
  }
  return null;
}

const first = (node: SyntaxNode, kind: string) => node.children.find((child) => child.kind === kind);
const range = (node: SyntaxNode): Range => ({ from: node.from, to: node.to });

/** Finds the formatting in a node and what's in it, in order (a style before the styles inside it). */
function walk(node: SyntaxNode, text: string, spans: Span[]) {
  const children = node.children;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    // `#` and the code after it, like #highlight[…].
    if (child.kind === "Hash" && children[i + 1]) {
      embedded(child, children[i + 1], text, spans);
      i++;
      continue;
    }
    visit(child, text, spans);
  }
}

function visit(node: SyntaxNode, text: string, spans: Span[]) {
  switch (node.kind) {
    case "Heading": {
      const marker = /^=+ */.exec(text.slice(node.from))![0];
      spans.push({
        kind: "heading",
        level: marker.trim().length,
        from: node.from,
        to: Math.min(lineEndAt(text, node.from), node.to),
        markers: [{ from: node.from, to: node.from + marker.length }],
      });
      return walk(node, text, spans);
    }
    case "ListItem":
    case "EnumItem": {
      const start = node.children[0];
      const marker = { from: start.from, to: start.to + /^ */.exec(text.slice(start.to))![0].length };
      // A bullet followed by a box, [ ] or [x], is a task.
      const box = node.kind === "ListItem" ? /^\[([ xX])\](?: |$)/m.exec(text.slice(marker.to, lineEndAt(text, marker.to))) : null;
      if (box) {
        const task = { from: marker.from, to: marker.to + box[0].length };
        spans.push({ kind: "task", ...task, checked: box[1] !== " ", markers: [task] });
      } else {
        spans.push({ kind: "list-item", ...marker, markers: [marker] });
      }
      return walk(node, text, spans);
    }
    case "Strong":
    case "Emph": {
      const open = node.children[0];
      const close = node.children[node.children.length - 1];
      const delimiter = node.kind === "Strong" ? "Star" : "Underscore";
      const content = first(node, "Markup");
      if (open !== close && open?.kind === delimiter && close?.kind === delimiter && content && content.to > content.from) {
        spans.push({ kind: node.kind === "Strong" ? "bold" : "italic", ...range(node), markers: [range(open), range(close)] });
      }
      // (Not closed: no style, but what's in it is still formatted.)
      return walk(node, text, spans);
    }
    case "Raw":
      return raw(node, text, spans);
    case "Equation": {
      const inside = text.slice(node.from + 1, node.to - 1);
      const [open, close] = [node.children[0], node.children[node.children.length - 1]];
      if (open !== close && open?.kind === "Dollar" && close?.kind === "Dollar") {
        spans.push({ kind: "math", ...range(node), display: /^\s/.test(inside) && /\s$/.test(inside), markers: [] });
      }
      return;
    }
    case "LineComment":
      spans.push({ kind: "comment", ...range(node), markers: [] });
      return;
    case "Escape":
      // A backslash keeping a character as it is, like \*.
      if (node.to - node.from === 2) spans.push({ kind: "escape", ...range(node), markers: [{ from: node.from, to: node.from + 1 }] });
      return;
    case "Str":
    case "BlockComment":
      return;
    default:
      return walk(node, text, spans);
  }
}

/** Raw text: `code`, or a ``` code block on lines of its own. */
function raw(node: SyntaxNode, text: string, spans: Span[]) {
  const delimiters = node.children.filter((child) => child.kind === "RawDelim");
  if (delimiters.length < 2) return;
  const [open, close] = [delimiters[0], delimiters[delimiters.length - 1]];
  if (open.to - open.from >= 3 && lineStartAt(text, node.from) === node.from) {
    const block = codeBlockAt(text, node.from, lineEndAt(text, node.from), text.length, true);
    if (block && block.to <= node.to + /^[ \t]*/.exec(text.slice(node.to))![0].length) return void spans.push(block);
  }
  spans.push({ kind: "code", ...range(node), markers: [range(open), range(close)] });
}

/** `#` and the code after it: a style function like #highlight[…], a code block's options, or other code. */
function embedded(hash: SyntaxNode, code: SyntaxNode, text: string, spans: Span[]) {
  // A code block in a #[ … ] that numbers or highlights its lines.
  if (code.kind === "ContentBlock" && lineStartAt(text, hash.from) === hash.from) {
    const block = codeBlockAt(text, hash.from, lineEndAt(text, hash.from), text.length, true);
    if (block?.wrapper) return void spans.push(block);
  }
  if (code.kind === "FuncCall") {
    const name = code.children[0]?.kind === "Ident" ? text.slice(code.children[0].from, code.children[0].to) : undefined;
    const args = first(code, "Args");
    const content = args?.children[args.children.length - 1];
    const open = args && first(args, "LeftParen");
    const close = args && first(args, "RightParen");
    const closed = (block: SyntaxNode) => block.children[block.children.length - 1]?.kind === "RightBracket";
    if (name && Object.prototype.hasOwnProperty.call(STYLE_FUNCTIONS, name) && content?.kind === "ContentBlock" && closed(content) && !!open === !!close) {
      const settings = open && close ? text.slice(open.to, close.from) : undefined;
      // An inline #quote[…] (without block: true) is a quotation.
      const quotation = name === "quote" && settings === undefined;
      if (quotation || !NEEDED_SETTINGS[name] || NEEDED_SETTINGS[name].test(settings ?? "")) {
        spans.push({
          kind: quotation ? "quotation" : STYLE_FUNCTIONS[name],
          ...(settings !== undefined && { args: settings }),
          from: hash.from,
          to: content.to,
          markers: [
            { from: hash.from, to: content.from + 1 },
            { from: content.to - 1, to: content.to },
          ],
        });
      }
    }
  }
  // Other code isn't text, but text in its [brackets] is.
  contentIn(code, text, spans);
}

/** Formats the text in a piece of code's [brackets], wherever they are in it. */
function contentIn(node: SyntaxNode, text: string, spans: Span[]) {
  if (node.kind === "Markup") return walk(node, text, spans);
  if (node.kind === "Equation" || node.kind === "Raw") return visit(node, text, spans);
  for (const child of node.children) contentIn(child, text, spans);
}

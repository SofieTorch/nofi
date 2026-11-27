// The code view of a Typst note (see tests/code-view.test.tsx): the file as it is, like in a code
// editor, with line numbers and Typst's syntax highlighted from Typst's own parser (the same one
// the formatted view reads notes with), so it's highlighted exactly as Typst reads it.

import { bracketMatching, indentUnit } from "@codemirror/language";
import { type Range as Ranged } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, highlightActiveLine, highlightActiveLineGutter, lineNumbers, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { parseTypst, type SyntaxNode, typstParserLoaded } from "./typstSyntax";

/** How each kind of Typst syntax (Typst's names for them) is highlighted. */
const LOOKS: Record<string, string> = {
  Let: "keyword", Set: "keyword", Show: "keyword", Context: "keyword", If: "keyword", Else: "keyword",
  For: "keyword", In: "keyword", While: "keyword", Break: "keyword", Continue: "keyword",
  Return: "keyword", Import: "keyword", Include: "keyword", As: "keyword", Not: "keyword",
  And: "keyword", Or: "keyword", Hash: "keyword",
  None: "constant", Auto: "constant", Bool: "constant",
  Int: "number", Float: "number", Numeric: "number",
  Str: "string",
  LineComment: "comment", BlockComment: "comment",
  Heading: "heading",
  Strong: "strong", Emph: "emph",
  Raw: "raw",
  Equation: "math",
  Label: "label", Ref: "label",
  Link: "link",
  ListMarker: "marker", EnumMarker: "marker", TermMarker: "marker",
  Escape: "escape", Shorthand: "escape",
};

const marks = new Map<string, Decoration>();
const markFor = (look: string) => {
  let mark = marks.get(look);
  if (!mark) marks.set(look, (mark = Decoration.mark({ class: `cm-typst-${look}` })));
  return mark;
};

/** The highlights in a note: each piece of syntax's look, and a called function's name. */
function highlights(text: string): DecorationSet {
  if (!typstParserLoaded()) return Decoration.none;
  const found: Ranged<Decoration>[] = [];
  const visit = (node: SyntaxNode) => {
    const look = LOOKS[node.kind];
    if (look && node.to > node.from) found.push(markFor(look).range(node.from, node.to));
    // A function called (`#emph[…]`, `text(…)`): its name, or the last name of `a.b`.
    if (node.kind === "FuncCall") {
      let callee: SyntaxNode | undefined = node.children[0];
      while (callee?.kind === "FieldAccess") callee = callee.children[callee.children.length - 1];
      if (callee?.kind === "Ident" && callee.to > callee.from) found.push(markFor("function").range(callee.from, callee.to));
    }
    // (In comments, strings and code blocks' text, nothing more is highlighted.)
    if (look === "comment" || look === "string" || look === "raw") return;
    node.children.forEach(visit);
  };
  visit(parseTypst(text));
  return Decoration.set(found, true);
}

const highlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = highlights(view.state.doc.toString());
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = highlights(update.state.doc.toString());
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

const theme = EditorView.theme({
  "&": { fontSize: "13px", color: "#262626" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: MONO, lineHeight: "1.6", overflow: "visible !important" },
  ".cm-content": { fontFamily: MONO, padding: "0" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "#c4c4c4", paddingRight: "8px" },
  ".cm-activeLine": { backgroundColor: "rgba(0, 0, 0, 0.025)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "#737373" },
  ".cm-typst-keyword": { color: "#c026d3" },
  ".cm-typst-function": { color: "#2563eb" },
  ".cm-typst-constant": { color: "#c2410c" },
  ".cm-typst-number": { color: "#c2410c" },
  ".cm-typst-string": { color: "#15803d" },
  ".cm-typst-comment": { color: "#a3a3a3", fontStyle: "italic" },
  ".cm-typst-heading": { color: "#0f172a", fontWeight: "700" },
  ".cm-typst-strong": { fontWeight: "700" },
  ".cm-typst-emph": { fontStyle: "italic" },
  ".cm-typst-raw": { color: "#0f766e" },
  ".cm-typst-math": { color: "#7c3aed" },
  ".cm-typst-label": { color: "#0e7490" },
  ".cm-typst-link": { color: "#0b6e99", textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-typst-marker": { color: "#c2410c" },
  ".cm-typst-escape": { color: "#a16207" },
});

/** The code view's editing features: line numbers, Typst's highlighting, brackets matched. */
export function codeView() {
  return [
    EditorView.editorAttributes.of({ class: "cm-code-view" }),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    bracketMatching(),
    indentUnit.of("  "),
    EditorView.lineWrapping,
    highlighter,
    theme,
  ];
}

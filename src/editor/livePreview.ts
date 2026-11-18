// The CodeMirror extension that makes a note look formatted while you type (Obsidian's "live
// preview"): headings are big, bold is bold, and markers like * or = only show where the cursor is.

import type { Range as Ranged } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { mdiCommentTextOutline } from "@mdi/js";
import { cssColour } from "./colours";
import { drawnMaths, findFormatting, hiddenMarkers, isBeingEdited, type Format, type Span } from "./formatting";
import { drawnPicture, drawPicture, type MathsPicture } from "./mathsPictures";
import { followAddress, quotedAddress } from "./noteLinks";

/** Maths drawn by Typst, shown in place of its source until the cursor goes into it. */
class MathsWidget extends WidgetType {
  constructor(
    readonly maths: string,
    readonly display: boolean,
  ) {
    super();
  }

  eq(other: MathsWidget) {
    return other.maths === this.maths && other.display === this.display;
  }

  toDOM() {
    const element = document.createElement("span");
    element.className = this.display ? "cm-maths cm-maths-display" : "cm-maths";
    const picture = drawnPicture(this.maths);
    if (picture) {
      show(element, this.maths, picture);
    } else {
      // Until Typst has drawn it, show the source, faded.
      element.textContent = this.maths;
      element.classList.add("cm-maths-drawing");
      drawPicture(this.maths).then((drawn) => show(element, this.maths, drawn));
    }
    return element;
  }

  // Clicks reach the editor, which moves the cursor into the maths and so shows its source.
  ignoreEvent() {
    return false;
  }
}

function show(element: HTMLElement, maths: string, picture: MathsPicture) {
  element.classList.remove("cm-maths-drawing");
  element.replaceChildren();
  if ("svg" in picture) {
    const image = document.createElement("img");
    image.alt = maths;
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}`;
    // On the text's baseline: lowered by as much as the maths reaches below it (like subscripts).
    const descent = /data-descent="([\d.]+)"/.exec(picture.svg)?.[1];
    if (descent !== undefined) image.style.verticalAlign = `-${descent}pt`;
    element.append(image);
  } else {
    element.textContent = maths;
    element.title = picture.error;
    element.classList.add("cm-maths-error");
  }
}

/** A note's text without Typst's markup, for the margin. */
const plain = (source: string) =>
  source
    .replace(/#[\w.]+(\((?:[^()"]|"(?:[^"\\]|\\.)*")*\))?\[/g, "")
    .replace(/[\]*_`]/g, "")
    .replace(/\\(.)/g, "$1");

/**
 * Notes shown in the margin: footnotes on the right (a number in the text), comments on the left
 * (a small mark in the text). Clicking one puts the cursor in its code, to edit it.
 */
class MarginNote extends WidgetType {
  constructor(
    readonly kind: "footnote" | "comment",
    readonly text: string,
    /** Footnotes are numbered in order, like Typst does. */
    readonly number: number,
    /** How far into the code the cursor goes when clicked (past "#footnote[" or "//"). */
    readonly codeStart: number,
    /** Its code, for the links in it (a footnote citing a source, say). */
    readonly source = "",
  ) {
    super();
  }

  eq(other: MarginNote) {
    return other.kind === this.kind && other.text === this.text && other.number === this.number && other.source === this.source;
  }

  /** The note's text, its links as links (clicking one follows it). */
  private content() {
    const links = findFormatting(this.source, "typst").filter((span) => span.kind === "link");
    const parts: (string | HTMLElement)[] = [];
    let at = 0;
    for (const link of links) {
      if (link.from < at) continue;
      const address = quotedAddress(link.args);
      if (!address) continue;
      parts.push(plain(this.source.slice(at, link.from)));
      const element = document.createElement("span");
      element.className = "cm-link";
      element.dataset.address = address;
      element.textContent = plain(this.source.slice(link.markers[0].to, link.markers[1].from));
      parts.push(element);
      at = link.to;
    }
    parts.push(plain(this.source.slice(at)));
    if (typeof parts[0] === "string") parts[0] = parts[0].trimStart();
    const last = parts.length - 1;
    if (typeof parts[last] === "string") parts[last] = (parts[last] as string).trimEnd();
    return parts.filter((part) => part !== "");
  }

  toDOM(view: EditorView) {
    const footnote = this.kind === "footnote";
    const reference = document.createElement(footnote ? "sup" : "span");
    reference.className = footnote ? "cm-footnote-ref" : "cm-comment-ref";
    reference.setAttribute("role", footnote ? "doc-noteref" : "presentation");
    reference.title = this.text;
    const mark = document.createElement("span");
    if (footnote) mark.textContent = String(this.number);
    // A comment is marked in the text with a small message icon.
    else mark.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="${mdiCommentTextOutline}"/></svg>`;
    const note = document.createElement("span");
    note.className = `cm-sidenote ${footnote ? "cm-margin-right" : "cm-margin-left"}`;
    note.setAttribute("role", "note");
    note.setAttribute("aria-label", footnote ? `Footnote ${this.number}` : "Comment");
    if (footnote) {
      const number = document.createElement("strong");
      number.textContent = `${this.number}.`;
      note.append(number, " ", ...this.content());
    } else {
      note.textContent = this.text;
    }
    reference.append(mark, note);
    reference.addEventListener("mousedown", (event) => {
      event.preventDefault();
      // A link in it is followed (in a new pane, with ⌘).
      const link = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-address]") : null;
      if (link && followAddress(view, link.dataset.address!, "typst", event.metaKey || event.ctrlKey)) return;
      view.focus();
      view.dispatch({ selection: { anchor: view.posAtDOM(reference) + this.codeStart } });
    });
    return reference;
  }

  ignoreEvent() {
    return true;
  }
}

/** A Markdown divider, shown as a line. */
class DividerWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const line = document.createElement("hr");
    line.className = "cm-divider";
    return line;
  }
}

/** A task's box: ticking it writes [x] (or [ ] again) in the note. */
class TaskBox extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly label: string,
  ) {
    super();
  }
  eq(other: TaskBox) {
    return other.checked === this.checked && other.label === this.label;
  }
  toDOM(view: EditorView) {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-task-box";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.label);
    // Ticking doesn't move the cursor.
    box.addEventListener("mousedown", (event) => event.preventDefault());
    box.addEventListener("click", () => {
      const at = view.posAtDOM(wrapper);
      const open = view.state.sliceDoc(at, at + 20).indexOf("[");
      if (open < 0) return;
      const mark = at + open + 1;
      view.dispatch({ changes: { from: mark, to: mark + 1, insert: this.checked ? " " : "x" }, userEvent: "input.task" });
    });
    wrapper.append(box);
    return wrapper;
  }
  ignoreEvent() {
    return true;
  }
}

const taskDone = Decoration.line({ class: "cm-task-done" });

const hide = Decoration.replace({});
const marker = Decoration.mark({ class: "cm-marker" });
const content = {
  bold: Decoration.mark({ tagName: "strong" }),
  italic: Decoration.mark({ tagName: "em" }),
  code: Decoration.mark({ tagName: "code", class: "cm-inline-code" }),
  highlight: Decoration.mark({ tagName: "mark", class: "cm-highlight" }),
  strikethrough: Decoration.mark({ tagName: "s" }),
  underline: Decoration.mark({ tagName: "u" }),
  smallcaps: Decoration.mark({ class: "cm-smallcaps" }),
  superscript: Decoration.mark({ tagName: "sup" }),
  subscript: Decoration.mark({ tagName: "sub" }),
  overline: Decoration.mark({ class: "cm-overline" }),
  uppercase: Decoration.mark({ class: "cm-uppercase" }),
  lowercase: Decoration.mark({ class: "cm-lowercase" }),
  link: Decoration.mark({ class: "cm-link" }),
  footnote: Decoration.mark({ class: "cm-footnote" }),
  quotation: Decoration.mark({ class: "cm-quotation" }),
};
/** A quotation's mark, shown instead of its hidden syntax (`#quote[` and `]`), as Typst prints it. */
class QuotationMark extends WidgetType {
  constructor(readonly mark: string) {
    super();
  }
  eq(other: QuotationMark) {
    return other.mark === this.mark;
  }
  toDOM() {
    const mark = document.createElement("span");
    mark.className = "cm-quotation-mark";
    mark.textContent = this.mark;
    return mark;
  }
}
const quotationMarks = [Decoration.replace({ widget: new QuotationMark("“") }), Decoration.replace({ widget: new QuotationMark("”") })];

/** A setting's value, like `red` in `fill: red`. */
const fillOf = (args: string | undefined) => /(?:^|,)\s*fill:\s*((?:[^,()]|\([^()]*\))+)/.exec(args ?? "")?.[1];

/** Styles whose look depends on their settings (colours, sizes, fonts). */
function coloured(span: Span) {
  const colour = cssColour(fillOf(span.args) ?? "");
  if (span.kind === "text") {
    const size = /(?:^|,)\s*size:\s*([\d.]+(?:em|pt))/.exec(span.args ?? "")?.[1];
    const font = /(?:^|,)\s*font:\s*"([^"]+)"/.exec(span.args ?? "")?.[1];
    const style = [
      colour && `color: ${colour}`,
      size && `font-size: ${size}`,
      font && `font-family: "${font}"`,
    ].filter(Boolean);
    return style.length ? Decoration.mark({ attributes: { style: style.join("; ") } }) : null;
  }
  return colour
    ? Decoration.mark({ tagName: "mark", class: "cm-highlight", attributes: { style: `background-color: ${colour}` } })
    : content.highlight;
}

/** Paragraph styles: every line of their text is aligned, indented, quoted or shaded. */
function lineStyle(span: Span) {
  switch (span.kind) {
    case "justify":
      return Decoration.line({ class: "cm-justify" });
    case "quote":
      return Decoration.line({ class: "cm-quote" });
    case "callout": {
      const colour = cssColour(fillOf(span.args) ?? "");
      return Decoration.line({ class: "cm-callout", attributes: colour ? { style: `background-color: ${colour}` } : {} });
    }
    case "indent": {
      const left = /left:\s*([\d.]+(?:em|pt|cm|mm|in))/.exec(span.args ?? "")?.[1];
      return Decoration.line({ class: "cm-indented", attributes: left ? { style: `padding-left: ${left}` } : {} });
    }
    default:
      return Decoration.line({ class: `cm-align-${span.args?.trim() ?? "left"}` });
  }
}
const whole = {
  math: Decoration.mark({ class: "cm-math" }),
  comment: Decoration.mark({ class: "cm-comment" }),
};
const heading = (level: number) =>
  Decoration.line({
    attributes: { role: "heading", "aria-level": String(level), class: `cm-heading cm-heading-${level}` },
  });

function decorate(view: EditorView, format: Format): DecorationSet {
  const text = view.state.doc.toString();
  const spans = findFormatting(text, format);
  // While you're not in the note, nothing is being edited: show it fully formatted.
  const cursors = view.hasFocus ? view.state.selection.ranges : [];
  const hidden = hiddenMarkers(spans, cursors, text);
  const isHidden = (range: { from: number }) => hidden.some((h) => h.from === range.from);
  const drawn = format === "typst" ? drawnMaths(spans, cursors) : [];

  const footnotes = spans.filter((span) => span.kind === "footnote").sort((a, b) => a.from - b.from);
  const decorations: Ranged<Decoration>[] = [];
  const inMargins: Span[] = [];
  for (const span of spans) {
    // Styles inside a note that went to the margin are shown there as plain text.
    if (inMargins.some((note) => note !== span && note.from <= span.from && span.to <= note.to)) continue;
    // Footnotes (on one line) and comments go in the margin, unless they're being edited.
    const inMargin =
      format === "typst" &&
      (span.kind === "footnote" || span.kind === "comment") &&
      !text.slice(span.from, span.to).includes("\n") &&
      !isBeingEdited(span, cursors);
    if (inMargin) {
      const footnote = span.kind === "footnote";
      const source = footnote
        ? text.slice(span.markers[0].to, span.markers[1].from)
        : text.slice(span.from + 2, span.to);
      const codeStart = footnote ? span.markers[0].to - span.from : 2;
      const note = new MarginNote(span.kind as "footnote" | "comment", plain(source).trim(), footnotes.indexOf(span) + 1, codeStart, source);
      decorations.push(Decoration.replace({ widget: note }).range(span.from, span.to));
      inMargins.push(span);
      continue;
    }
    if (span.kind === "divider") {
      if (!isBeingEdited(span, cursors)) {
        decorations.push(Decoration.replace({ widget: new DividerWidget() }).range(span.from, span.to));
      }
      continue;
    }
    if (span.kind === "task") {
      const line = view.state.doc.lineAt(span.from);
      if (span.checked) decorations.push(taskDone.range(line.from));
      if (isBeingEdited(span, cursors)) {
        decorations.push(marker.range(span.from, span.to));
      } else {
        const widget = new TaskBox(!!span.checked, plain(text.slice(span.to, line.to)).trim());
        decorations.push(Decoration.replace({ widget }).range(span.from, span.to));
      }
      continue;
    }
    // (Maths over several lines is shown as it's written: a picture can't replace line breaks here.)
    if (drawn.includes(span) && !text.slice(span.from, span.to).includes("\n")) {
      const widget = new MathsWidget(text.slice(span.from, span.to), !!span.display);
      decorations.push(Decoration.replace({ widget }).range(span.from, span.to));
      continue;
    }
    decorations.push(...decorationsFor(view, span));
    if (span.kind === "quotation" && isHidden(span.markers[0])) {
      span.markers.forEach((m, n) => decorations.push(quotationMarks[n].range(m.from, m.to)));
      continue;
    }
    for (const m of span.markers) {
      if (m.from === m.to) continue;
      decorations.push((isHidden(m) ? hide : marker).range(m.from, m.to));
    }
  }
  return Decoration.set(decorations, true);
}

function decorationsFor(view: EditorView, span: Span): Ranged<Decoration>[] {
  switch (span.kind) {
    case "heading":
      return [heading(span.level ?? 1).range(view.state.doc.lineAt(span.from).from)];
    case "bold":
    case "italic":
    case "strikethrough":
    case "underline":
    case "smallcaps":
    case "superscript":
    case "subscript":
    case "overline":
    case "uppercase":
    case "lowercase":
    case "link":
    case "footnote":
    case "quotation":
    case "code": {
      const [open, close] = span.markers;
      return open.to < close.from ? [content[span.kind].range(open.to, close.from)] : [];
    }
    case "highlight":
    case "text": {
      const [open, close] = span.markers;
      const look = coloured(span);
      return look && open.to < close.from ? [look.range(open.to, close.from)] : [];
    }
    case "align":
    case "justify":
    case "quote":
    case "callout":
    case "indent": {
      const [open, close] = span.markers;
      const lines = [];
      for (let line = view.state.doc.lineAt(open.to); ; line = view.state.doc.line(line.number + 1)) {
        lines.push(lineStyle(span).range(line.from));
        if (line.to >= close.from || line.number === view.state.doc.lines) break;
      }
      return lines;
    }
    case "math":
    case "comment":
      return [whole[span.kind].range(span.from, span.to)];
    case "list-item":
    case "task":
    case "divider":
    case "escape":
    // Code blocks are shown by codeBlocks.ts.
    case "codeblock":
      return [];
  }
}

/**
 * Notes in a margin stack like in a book: one that would overlap the note above it moves down just
 * enough. Measured after every change, since notes sit level with their line.
 */
const marginLayout = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.arrange(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.geometryChanged || update.viewportChanged || update.selectionSet || update.focusChanged) {
        this.arrange(update.view);
      }
    }
    arrange(view: EditorView) {
      view.requestMeasure({
        key: this,
        read: () =>
          [...view.contentDOM.querySelectorAll<HTMLElement>(".cm-sidenote")].map((note) => {
            const box = note.getBoundingClientRect();
            return {
              note,
              left: note.classList.contains("cm-margin-left"),
              // Where it would be without being moved down.
              top: box.top - Number(note.dataset.shift ?? 0),
              height: box.height,
            };
          }),
        write: (notes) => {
          const lowest = { left: -Infinity, right: -Infinity };
          for (const item of [...notes].sort((a, b) => a.top - b.top)) {
            const side = item.left ? "left" : "right";
            const top = Math.max(item.top, lowest[side] + 6);
            const shift = top - item.top;
            item.note.dataset.shift = String(shift);
            item.note.style.transform = shift ? `translateY(${shift}px)` : "";
            lowest[side] = top + item.height;
          }
        },
      });
    }
  },
);

export function livePreview(format: Format) {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorate(view, format);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.focusChanged) {
          this.decorations = decorate(update.view, format);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
  return [plugin, marginLayout, theme];
}

const theme = EditorView.theme({
  "&": { fontSize: "15px", color: "#262626" },
  "&.cm-focused": { outline: "none" },
  // CodeMirror defaults to a code font; notes use the app's normal font.
  // Visible overflow, so notes can sit in the margins outside the text.
  ".cm-scroller": { fontFamily: "inherit", overflow: "visible !important" },
  ".cm-content": { fontFamily: "inherit", lineHeight: "1.65", padding: "0" },
  ".cm-line": { padding: "0" },
  ".cm-heading": { fontWeight: "650", lineHeight: "1.3", paddingTop: "0.6em" },
  ".cm-heading-1": { fontSize: "1.75em" },
  ".cm-heading-2": { fontSize: "1.4em" },
  ".cm-heading-3": { fontSize: "1.2em" },
  ".cm-marker": { color: "#a3a3a3" },
  ".cm-heading .cm-marker": { fontWeight: "400" },
  ".cm-inline-code, .cm-math": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "0.9em",
  },
  ".cm-inline-code": { backgroundColor: "#f5f5f5", borderRadius: "4px", padding: "0.1em 0.25em" },
  ".cm-math": { color: "#7c3aed" },
  ".cm-maths img": { display: "inline-block", verticalAlign: "middle" },
  // Inline maths sits on the line like text (its picture says how far below it reaches).
  ".cm-maths:not(.cm-maths-display) img": { verticalAlign: "baseline" },
  ".cm-maths-display": { display: "block", textAlign: "center", padding: "0.4em 0" },
  ".cm-maths-drawing": { color: "#a3a3a3", fontFamily: "ui-monospace, Menlo, monospace" },
  ".cm-maths-error": {
    color: "#dc2626",
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: "0.9em",
    textDecoration: "underline wavy #f87171",
  },
  ".cm-comment": { color: "#a3a3a3" },
  ".cm-highlight": { backgroundColor: "#fef08a", color: "inherit", borderRadius: "2px", padding: "0 1px" },
  ".cm-smallcaps": { fontVariant: "small-caps" },
  ".cm-overline": { textDecoration: "overline" },
  ".cm-uppercase": { textTransform: "uppercase" },
  ".cm-lowercase": { textTransform: "lowercase" },
  ".cm-link": { color: "#0b6e99", textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-align-center": { textAlign: "center" },
  ".cm-align-right": { textAlign: "right" },
  ".cm-justify": { textAlign: "justify" },
  ".cm-footnote": { fontSize: "0.85em", color: "#737373" },
  ".cm-divider": { border: "none", borderTop: "1px solid #e5e5e5", margin: "0.6em 0" },
  ".cm-quote": { borderLeft: "3px solid #d4d4d4", paddingLeft: "1em !important", color: "#525252" },
  ".cm-callout": { backgroundColor: "#f0f0f0", padding: "0 0.75em !important" },
  ".cm-cursor": { borderLeftColor: "#262626" },
});

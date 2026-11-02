// Tables, figures and grids drawn in the writing view, like maths: a `#table(…)` written as its
// own block is shown as Typst draws it, and as code while the cursor is in it (or if Typst can't
// draw it, so its mistake can be seen and fixed).

import { type EditorState, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { blockPictures } from "./mathsPictures";
import { editingTable, editTableAt } from "./tableEditing";
import { TableGridWidget, tableEditorTheme } from "./TableGrid";

export type DrawnBlock = { from: number; to: number; kind: "table" | "figure" | "grid" | "line" };

/** Every `#table(…)`, `#figure(…)`, `#grid(…)` and `#line(…)` that starts a line and ends one. */
export function findDrawnBlocks(text: string): DrawnBlock[] {
  const blocks: DrawnBlock[] = [];
  const start = /^#(table|figure|grid|line)\(/gm;
  let match: RegExpExecArray | null;
  while ((match = start.exec(text))) {
    const close = matchingClose(text, match.index + match[0].length - 1);
    if (close === -1) continue;
    const lineEnd = text.indexOf("\n", close) === -1 ? text.length : text.indexOf("\n", close);
    if (text.slice(close + 1, lineEnd).trim() !== "") continue;
    blocks.push({ from: match.index, to: close + 1, kind: match[1] as DrawnBlock["kind"] });
    start.lastIndex = close + 1;
  }
  return blocks;
}

/**
 * Where the bracket at `open` closes, or -1. In code, (), [] and {} must match and "quotes" are
 * skipped; inside [content], only [ ] count (text can have any parentheses), except after #code.
 */
export function matchingClose(text: string, open: number): number {
  const stack: string[] = [text[open]];
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  for (let i = open + 1; i < text.length; i++) {
    const char = text[i];
    const inContent = stack[stack.length - 1] === "[";
    if (char === "\\") {
      i++;
    } else if (inContent) {
      if (char === "[") stack.push("[");
      else if (char === "]") stack.pop();
      else if (char === "#") {
        // Code inside content, like #text(red)[…]: its brackets count again.
        const call = /^#[\w.-]+\(/.exec(text.slice(i));
        if (call) {
          stack.push("(");
          i += call[0].length - 1;
        }
      } else if (char === "`") {
        const close = text.indexOf("`", i + 1);
        if (close === -1) return -1;
        i = close;
      }
    } else if (char === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (char === "/" && text[i + 1] === "/") {
      const lineEnd = text.indexOf("\n", i);
      if (lineEnd === -1) return -1;
      i = lineEnd;
    } else if ("([{".includes(char)) {
      stack.push(char);
    } else if (")]}".includes(char)) {
      if (stack.pop() !== pairs[char]) return -1;
    }
    if (stack.length === 0) return i;
  }
  return -1;
}

/** Sent when a picture couldn't be drawn, so the block's code is shown instead. */
const redraw = StateEffect.define<null>();

class BlockWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly kind: DrawnBlock["kind"],
    /** Tables open in the table editor when clicked; other blocks show their code. */
    readonly isTable = false,
  ) {
    super();
  }

  eq(other: BlockWidget) {
    return other.source === this.source;
  }

  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = "cm-drawn-block";
    // Clicking the picture shows the code, with the cursor at its start.
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (this.isTable) {
        // The note's cursor goes to the table's start (which doesn't show its code), so Undo of a
        // change made in the table puts it back there rather than wherever it was before.
        const at = view.posAtDOM(element);
        view.dispatch({ selection: { anchor: at }, effects: editTableAt.of(at) });
        return;
      }
      view.dispatch({ selection: { anchor: view.posAtDOM(element) + 1 } });
      view.focus();
    });
    const picture = blockPictures.drawn(this.source);
    if (picture && "svg" in picture) {
      this.show(element, picture.svg);
    } else {
      // Until Typst has drawn it, show the code, faded.
      element.textContent = this.source;
      element.classList.add("cm-drawn-block-waiting");
      blockPictures.draw(this.source).then((drawn) => {
        if ("svg" in drawn) this.show(element, drawn.svg);
        else view.dispatch({ effects: redraw.of(null) });
      });
    }
    return element;
  }

  private show(element: HTMLElement, svg: string) {
    element.classList.remove("cm-drawn-block-waiting");
    const image = document.createElement("img");
    image.alt = this.kind[0].toUpperCase() + this.kind.slice(1);
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    element.replaceChildren(image);
  }

  ignoreEvent() {
    return true;
  }
}

function decorate(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const editing = state.field(editingTable, false) ?? null;
  const decorations = findDrawnBlocks(text)
    .filter((block) => {
      // Being edited: a cursor in it (after its very start).
      const editing = state.selection.ranges.some((r) => r.head > block.from && r.head <= block.to);
      const picture = blockPictures.drawn(text.slice(block.from, block.to));
      return !editing && !(picture && "error" in picture);
    })
    .map((block) => {
      const source = text.slice(block.from, block.to);
      // Tables (also in figures) get the table editor; other blocks are drawn.
      const isTable = block.kind === "table" || (block.kind === "figure" && source.includes("table("));
      const widget =
        isTable && editing === block.from ? new TableGridWidget(source) : new BlockWidget(source, block.kind, isTable);
      return Decoration.replace({ widget, block: true }).range(block.from, block.to);
    });
  return Decoration.set(decorations);
}

export function drawnBlocks() {
  const field = StateField.define<DecorationSet>({
    create: decorate,
    update: (decorations, transaction) =>
      transaction.docChanged ||
      transaction.selection ||
      transaction.effects.some((e) => e.is(redraw) || e.is(editTableAt))
        ? decorate(transaction.state)
        : decorations,
    provide: (f) => EditorView.decorations.from(f),
  });
  return [editingTable, field, theme, tableEditorTheme];
}

const theme = EditorView.theme({
  ".cm-drawn-block": { padding: "0.5em 0", cursor: "pointer" },
  ".cm-drawn-block img": { display: "block", maxWidth: "100%", height: "auto" },
  ".cm-drawn-block-waiting": {
    whiteSpace: "pre-wrap",
    color: "#a3a3a3",
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: "0.85em",
  },
});

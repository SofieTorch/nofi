// Columns while writing: #columns(2)[… #colbreak() …] is shown as real columns, side by side, each
// a small editor with the note's writing features. What's typed in a column goes into the note at
// that column's place, and the note's changes (like Undo) go back into the columns. The note keeps
// the one undo history. A bar above them adds and removes columns, or shows the code.

import { defaultKeymap, redo, undo } from "@codemirror/commands";
import { Annotation, EditorState, Prec, StateField, Transaction } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { mdiCodeBraces, mdiTableColumnPlusAfter, mdiTableColumnRemove, mdiTextBoxOutline } from "@mdi/js";
import { editorFeatures } from "./features";
import type { Range } from "./formatting";

export type ColumnsBlock = Range & {
  /** How many columns it asks for. */
  count: number;
  /** Where the count is written (to change it). */
  countAt: Range;
  /** Each column's text, where it's written; null for columns with nothing written yet. */
  panes: (Range | null)[];
  /** The #colbreak()s between them. */
  breaks: Range[];
};

const OPENING = /#columns\((\d+)((?:\s*,[^()[\]\n]*)?)\)\[/g;
const BREAK = /^#colbreak\([^)\n]*\)/;

/** The #columns(…)[…] blocks in a note, each on lines of its own. */
export function findColumns(text: string): ColumnsBlock[] {
  const blocks: ColumnsBlock[] = [];
  for (const match of text.matchAll(OPENING)) {
    const from = match.index;
    if (from > 0 && text[from - 1] !== "\n") continue;
    const bodyFrom = from + match[0].length;
    const breaks: Range[] = [];
    let depth = 1;
    let i = bodyFrom;
    while (i < text.length && depth > 0) {
      if (text[i] === "\\") i += 2;
      else if (text.startsWith("```", i)) {
        const close = text.indexOf("```", i + 3);
        i = close < 0 ? text.length : close + 3;
      } else if (text[i] === "[") (depth++, i++);
      else if (text[i] === "]") (depth--, i++);
      else if (depth === 1 && BREAK.test(text.slice(i, i + 40))) {
        const length = BREAK.exec(text.slice(i, i + 40))![0].length;
        breaks.push({ from: i, to: i + length });
        i += length;
      } else i++;
    }
    if (depth > 0) continue;
    const to = i;
    // On lines of their own, so they can be shown as a block.
    if (to < text.length && text[to] !== "\n") continue;
    const bodyTo = to - 1;
    const segments: Range[] = [];
    let start = bodyFrom;
    for (const b of breaks) {
      segments.push({ from: start, to: b.from });
      start = b.to;
    }
    segments.push({ from: start, to: bodyTo });
    const count = Number(match[1]);
    const panes: (Range | null)[] = segments.map((segment) => paneIn(text, segment));
    while (panes.length < count) panes.push(null);
    const countFrom = from + "#columns(".length;
    blocks.push({ from, to, count, countAt: { from: countFrom, to: countFrom + match[1].length }, panes, breaks });
  }
  return blocks;
}

/**
 * A column's text in its part of the block: all of it, except the line break that starts it (after
 * the "[" or the #colbreak()) and the one that ends it (before the next one, or the "]").
 */
function paneIn(text: string, segment: Range): Range {
  const from = Math.min(segment.from + (text[segment.from] === "\n" ? 1 : 0), segment.to);
  const to = Math.max(from, segment.to - (text[segment.to - 1] === "\n" ? 1 : 0));
  return { from, to };
}

/** Changes the note makes in a column's editor (so they aren't sent back). */
const fromNote = Annotation.define<boolean>();

type Columns = { views: EditorView[] };
const shown = new WeakMap<HTMLElement, Columns>();

/** Where the block shown in `element` is now. */
function locate(note: EditorView, element: HTMLElement) {
  const at = note.posAtDOM(element);
  return findColumns(note.state.doc.toString()).find((block) => block.from === at) ?? null;
}


/** Makes a column's editor show the note's text for it, changing only what differs. */
function showText(view: EditorView, text: string) {
  const old = view.state.doc.toString();
  if (old === text) return;
  let start = 0;
  while (start < old.length && start < text.length && old[start] === text[start]) start++;
  let end = 0;
  while (end < old.length - start && end < text.length - start && old[old.length - 1 - end] === text[text.length - 1 - end]) end++;
  view.dispatch({
    changes: { from: start, to: old.length - end, insert: text.slice(start, text.length - end) },
    annotations: fromNote.of(true),
  });
}

// --- Arrow keys: into the columns, from one to the next, and back out --------------------------

/** The editors of the columns shown for `block`, if they're shown. */
function columnViews(note: EditorView, block: ColumnsBlock) {
  for (const element of note.contentDOM.querySelectorAll<HTMLElement>(".cm-columns-block")) {
    if (locate(note, element)?.from === block.from) return shown.get(element)?.views ?? null;
  }
  return null;
}

/**
 * Puts the note's cursor at the columns (without showing their code), so Undo of a change made
 * in them brings the note back there rather than to wherever its cursor was.
 */
function holdNoteCursor(note: EditorView, block: ColumnsBlock) {
  const selection = note.state.selection.main;
  if (selection.empty && selection.head === block.from) return;
  note.dispatch({ selection: { anchor: block.from } });
}

function enter(view: EditorView, at: "start" | "end") {
  view.focus();
  view.dispatch({ selection: { anchor: at === "start" ? 0 : view.state.doc.length }, scrollIntoView: true });
  return true;
}

function backToNote(note: EditorView, anchor: number) {
  note.focus();
  note.dispatch({ selection: { anchor }, scrollIntoView: true });
  return true;
}

/** Whether two positions are on the same row on screen (true where that can't be measured). */
function sameRow(view: EditorView, a: number, b: number) {
  const first = view.coordsAtPos(a);
  const second = view.coordsAtPos(b);
  return !first || !second || Math.abs(first.top - second.top) < 2;
}

/** In the note: → or ↓ right before columns go into the first; ← or ↑ right after, into the last. */
function intoColumns(key: "ArrowRight" | "ArrowDown" | "ArrowLeft" | "ArrowUp") {
  return (note: EditorView) => {
    const selection = note.state.selection.main;
    if (!selection.empty) return false;
    const head = selection.head;
    const line = note.state.doc.lineAt(head);
    for (const block of findColumns(note.state.doc.toString())) {
      const before =
        block.from > 0 &&
        (key === "ArrowRight" ? head === block.from - 1 : key === "ArrowDown" && line.to === block.from - 1 && sameRow(note, head, line.to));
      const after =
        block.to < note.state.doc.length &&
        (key === "ArrowLeft" ? head === block.to + 1 : key === "ArrowUp" && line.from === block.to + 1 && sameRow(note, head, line.from));
      if (!before && !after) continue;
      const views = columnViews(note, block);
      if (!views?.length) return false;
      return before ? enter(views[0], "start") : enter(views[views.length - 1], "end");
    }
    return false;
  };
}

const intoColumnsKeys = Prec.high(
  keymap.of((["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"] as const).map((key) => ({ key, run: intoColumns(key) }))),
);

function icon(path: string) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  shape.setAttribute("fill", "currentColor");
  svg.append(shape);
  return svg;
}

/** Whether a column's cursor is at its very start or end (nothing selected). */
function atEdge(view: EditorView, edge: "start" | "end") {
  const { empty, head } = view.state.selection.main;
  return empty && head === (edge === "start" ? 0 : view.state.doc.length);
}

/** Whether a column's cursor is on its first (or last) row. */
function onEdgeRow(view: EditorView, edge: "start" | "end") {
  const { empty, head } = view.state.selection.main;
  if (!empty) return false;
  const line = view.state.doc.lineAt(head);
  const edgeLine = edge === "start" ? 1 : view.state.doc.lines;
  return line.number === edgeLine && sameRow(view, head, edge === "start" ? 0 : view.state.doc.length);
}

class ColumnsWidget extends WidgetType {
  constructor(
    readonly source: string,
    readonly count: number,
  ) {
    super();
  }

  eq(other: ColumnsWidget) {
    return other.source === this.source;
  }

  toDOM(note: EditorView) {
    const element = document.createElement("div");
    element.className = "cm-columns-block";
    const block = findColumns(this.source)[0];
    const panes = block?.panes.length ?? this.count;

    const bar = document.createElement("div");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Columns");
    bar.className = "cm-columns-bar";
    const button = (label: string, path: string, run: () => void, disabled = false) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("aria-label", label);
      b.title = label;
      b.disabled = disabled;
      b.append(icon(path));
      b.addEventListener("mousedown", (event) => event.preventDefault());
      b.addEventListener("click", run);
      bar.append(b);
    };
    button("Add column", mdiTableColumnPlusAfter, () => this.addColumn(note, element));
    button("Remove column", mdiTableColumnRemove, () => this.removeColumn(note, element), panes <= 2);
    button("Back to text", mdiTextBoxOutline, () => this.backToText(note, element));
    button("Edit as code", mdiCodeBraces, () => {
      const at = locate(note, element);
      if (!at) return;
      note.dispatch({ selection: { anchor: at.from + 1 } });
      note.focus();
    });

    const grid = document.createElement("div");
    grid.setAttribute("role", "group");
    grid.setAttribute("aria-label", `${panes} columns`);
    grid.className = "cm-columns";
    grid.style.gridTemplateColumns = `repeat(${panes}, minmax(0, 1fr))`;

    const views: EditorView[] = [];
    for (let i = 0; i < panes; i++) {
      const pane = document.createElement("div");
      pane.className = "cm-column";
      grid.append(pane);
      const pick = block?.panes[i];
      const doc = pick ? this.source.slice(pick.from, pick.to) : "";
      views.push(this.columnEditor(note, element, pane, i, doc));
    }
    element.append(bar, grid);
    shown.set(element, { views });
    element.addEventListener("focusin", () => {
      const block = locate(note, element);
      if (block) holdNoteCursor(note, block);
    });
    return element;
  }

  /** A column's own editor: the note's writing features, its changes going into the note. */
  private columnEditor(note: EditorView, element: HTMLElement, parent: HTMLElement, index: number, doc: string) {
    const toNote = (run: typeof undo) => () => run(note);
    return new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [
          // Undo and Redo are the note's.
          Prec.highest(
            keymap.of([
              { key: "Mod-z", run: toNote(undo), preventDefault: true },
              { key: "Mod-Shift-z", run: toNote(redo), preventDefault: true },
              { key: "Mod-y", run: toNote(redo), preventDefault: true },
            ]),
          ),
          // Past a column's ends: the next column, or the note around the columns.
          Prec.high(
            keymap.of([
              { key: "ArrowRight", run: (view) => atEdge(view, "end") && this.leave(note, element, index, "next") },
              { key: "ArrowLeft", run: (view) => atEdge(view, "start") && this.leave(note, element, index, "previous") },
              { key: "ArrowDown", run: (view) => onEdgeRow(view, "end") && this.leave(note, element, index, "below") },
              { key: "ArrowUp", run: (view) => onEdgeRow(view, "start") && this.leave(note, element, index, "above") },
            ]),
          ),
          keymap.of(defaultKeymap),
          EditorView.contentAttributes.of({ "aria-label": `Column ${index + 1}`, spellcheck: "true" }),
          editorFeatures("typst", { inColumn: true }),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || update.transactions.some((t) => t.annotation(fromNote))) return;
            const block = locate(note, element);
            if (!block) return;
            const userEvent = update.transactions.map((t) => t.annotation(Transaction.userEvent)).find(Boolean);
            const pane = block.panes[index];
            const changes: { from: number; to?: number; insert: string }[] = [];
            if (pane) {
              update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) =>
                changes.push({ from: pane.from + fromA, to: pane.from + toA, insert: inserted.toString() }),
              );
            } else {
              // A column with nothing written yet: the breaks before it are written first.
              const written = block.panes.filter((p): p is Range => p !== null);
              const at = written.length ? written[written.length - 1].to : block.from;
              const breaks = index - written.length + 1;
              changes.push({ from: at, insert: "\n#colbreak()\n".repeat(breaks) + update.state.doc.toString() });
            }
            // The note's cursor stays at the columns: that's where Undo brings the note back to.
            note.dispatch({ changes, selection: { anchor: block.from }, userEvent: userEvent ?? "input" });
          }),
        ],
      }),
    });
  }

  private leave(note: EditorView, element: HTMLElement, index: number, where: "next" | "previous" | "above" | "below") {
    const views = shown.get(element)?.views ?? [];
    const block = locate(note, element);
    if (!block) return false;
    if (where === "next" && index < views.length - 1) return enter(views[index + 1], "start");
    if (where === "previous" && index > 0) return enter(views[index - 1], "end");
    if (where === "next" || where === "below") return block.to < note.state.doc.length && backToNote(note, block.to + 1);
    return block.from > 0 && backToNote(note, block.from - 1);
  }

  /** No more columns: their texts one after another (empty ones left out), a blank line apart. */
  private backToText(note: EditorView, element: HTMLElement) {
    const block = locate(note, element);
    if (!block) return;
    holdNoteCursor(note, block);
    const texts = block.panes
      .map((pane) => (pane ? note.state.sliceDoc(pane.from, pane.to) : ""))
      .filter((text) => text.trim() !== "");
    note.focus();
    note.dispatch({
      changes: { from: block.from, to: block.to, insert: texts.join("\n\n") },
      selection: { anchor: block.from },
      userEvent: "input.columns",
    });
  }

  private addColumn(note: EditorView, element: HTMLElement) {
    const block = locate(note, element);
    if (!block) return;
    holdNoteCursor(note, block);
    const written = block.panes.filter((p): p is Range => p !== null);
    const changes = [{ from: block.countAt.from, to: block.countAt.to, insert: String(block.count + 1) }];
    // Only a column with text before it needs a break; empty ones at the end are already there.
    if (written.length === block.panes.length) changes.push({ from: written[written.length - 1].to, to: written[written.length - 1].to, insert: "\n#colbreak()\n" });
    note.dispatch({ changes, selection: { anchor: block.from }, userEvent: "input.columns" });
  }

  /** Removes the last column; its text goes to the end of the one before. */
  private removeColumn(note: EditorView, element: HTMLElement) {
    const block = locate(note, element);
    if (!block || block.panes.length <= 2) return;
    holdNoteCursor(note, block);
    const changes = [{ from: block.countAt.from, to: block.countAt.to, insert: String(Math.max(block.count - 1, 1)) }];
    if (block.breaks.length >= block.panes.length - 1) {
      const last = block.breaks[block.breaks.length - 1];
      changes.push({ from: last.from, to: last.to, insert: "" });
    }
    note.dispatch({ changes, selection: { anchor: block.from }, userEvent: "input.columns" });
  }

  // The same columns (and the one being typed in) when only their text changed.
  updateDOM(element: HTMLElement, note: EditorView) {
    const columns = shown.get(element);
    const block = findColumns(this.source)[0];
    if (!columns || !block || block.panes.length !== columns.views.length) return false;
    block.panes.forEach((pane, i) => showText(columns.views[i], pane ? this.source.slice(pane.from, pane.to) : ""));
    void note;
    return true;
  }

  destroy(element: HTMLElement) {
    for (const view of shown.get(element)?.views ?? []) view.destroy();
    shown.delete(element);
  }

  ignoreEvent() {
    return true;
  }
}

function decorate(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const decorations = findColumns(text)
    // With the note's cursor in them (after their very start), they show as code.
    .filter((block) => !state.selection.ranges.some((r) => r.head > block.from && r.head <= block.to))
    .map((block) =>
      Decoration.replace({ widget: new ColumnsWidget(text.slice(block.from, block.to), block.count), block: true }).range(
        block.from,
        block.to,
      ),
    );
  return Decoration.set(decorations);
}

const theme = EditorView.theme({
  ".cm-columns-block": { position: "relative", padding: "0.25em 0 0.5em" },
  // In the left margin, beside the columns, so it takes no room above them.
  ".cm-columns-bar": {
    position: "absolute",
    top: "0.25em",
    left: "-34px",
    // Reaching the columns, so moving from them to it keeps it shown.
    paddingRight: "10px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
    opacity: "0",
    transition: "opacity 150ms",
  },
  ".cm-columns-block:hover .cm-columns-bar, .cm-columns-block:focus-within .cm-columns-bar": { opacity: "1" },
  ".cm-columns-bar button": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "24px",
    height: "24px",
    borderRadius: "6px",
    color: "#737373",
  },
  ".cm-columns-bar button:hover:not(:disabled)": { background: "#f5f5f5", color: "#262626" },
  ".cm-columns-bar button:disabled": { color: "#d4d4d4" },
  ".cm-columns": { display: "grid", gap: "1.75em" },
  // A light outline around each column, a little wider than its text (which stays in line).
  ".cm-column": {
    minWidth: "0",
    padding: "1px 6px",
    margin: "-1px -6px",
    borderRadius: "5px",
    outline: "1px solid transparent",
    transition: "outline-color 150ms",
  },
  ".cm-columns-block:hover .cm-column": { outlineColor: "#efefef" },
  ".cm-column:focus-within": { outlineColor: "#e5e5e5 !important" },
  ".cm-column .cm-editor": { background: "transparent" },
  ".cm-column .cm-editor.cm-focused": { outline: "none" },
  ".cm-column .cm-content": { padding: "0 !important", maxWidth: "none !important", margin: "0 !important", minHeight: "1.6em" },
  ".cm-column .cm-scroller": { overflow: "visible !important" },
});

export function columnBlocks() {
  const field = StateField.define<DecorationSet>({
    create: decorate,
    update: (decorations, transaction) =>
      transaction.docChanged || transaction.selection ? decorate(transaction.state) : decorations,
    provide: (f) => EditorView.decorations.from(f),
  });
  return [field, theme, intoColumnsKeys];
}

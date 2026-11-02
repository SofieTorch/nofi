// Paragraphs, like Notion's blocks. In Typst and Markdown a paragraph ends at a blank line, so
// Enter writes one: each Enter starts a new paragraph. The editor hides that blank line (the new
// paragraph shows on the next line, a little apart) and the cursor goes over it as if it weren't
// there: ← → skip it, and ⌫ / Delete take the whole break, joining the two paragraphs.
// Shift+Enter is a line break within a paragraph. Lists and code blocks keep their own Enter.

import { insertNewline } from "@codemirror/commands";
import {
  EditorSelection,
  EditorState,
  Prec,
  RangeSet,
  StateField,
  type Range as Ranged,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap } from "@codemirror/view";
import { findFormatting, type Format, type Range } from "./formatting";
import { continueList } from "./listItems";
import { joinAt, splitAt } from "./styleBreaks";

/**
 * Hides a blank line on its own, leaving the lines around it as they are (a heading's style, or
 * columns and tables drawn in place of their lines).
 */
const hideLine = Decoration.replace({ block: true });
const paragraphStart = Decoration.line({ class: "cm-paragraph-start" });

/**
 * The hidden blank lines: what's shown, where the cursor can't go, and where a cursor that lands
 * there anyway (like with End, or a click past a line's end) goes instead: back to the end of the
 * line above it.
 */
type Breaks = {
  decorations: DecorationSet;
  atomic: RangeSet<Decoration>;
  snaps: { from: number; to: number }[];
};

/** Where a position on a hidden blank line is shown: the end of the line above it. */
const snapped = (snaps: Breaks["snaps"], pos: number) => snaps.find((s) => s.from < pos && pos < s.to)?.from ?? pos;

/** Where code (and maths) is: blank lines there are part of it, and shown. */
const verbatim = (text: string, format: Format): Range[] =>
  findFormatting(text, format).filter((span) => span.kind === "codeblock" || span.kind === "math");

function findBreaks(doc: Text, format: Format): Breaks {
  const text = doc.toString();
  const code = verbatim(text, format);
  const inCode = (pos: number) => code.some((span) => span.from < pos && pos < span.to);
  const decorations: Ranged<Decoration>[] = [];
  const atomic: Ranged<Decoration>[] = [];
  const snaps: Breaks["snaps"] = [];
  let n = 1;
  while (n <= doc.lines) {
    const line = doc.line(n);
    if (line.text.trim() !== "" || n === 1) {
      n++;
      continue;
    }
    // A run of blank lines after a line with text.
    let last = n;
    while (last + 1 <= doc.lines && doc.line(last + 1).text.trim() === "") last++;
    const before = doc.line(n - 1);
    const after = last + 1 <= doc.lines ? doc.line(last + 1) : null;
    const count = last - n + 1;
    // (A single line break at the very end of the note is left as it is.)
    if (before.text.trim() !== "" && !inCode(line.from) && (after || count >= 2)) {
      // The first blank line isn't shown; the cursor can't stop on it.
      decorations.push(hideLine.range(line.from, line.to));
      atomic.push(hideLine.range(before.to, doc.line(n + 1).from));
      snaps.push({ from: before.to, to: doc.line(n + 1).from });
      // Between it and the next paragraph, an empty paragraph (or more): the blank line before
      // the next one isn't shown either, so an empty paragraph is one empty line.
      const hideLast = after && count >= 3;
      if (hideLast) {
        const lastLine = doc.line(last);
        const shown = doc.line(last - 1);
        decorations.push(hideLine.range(lastLine.from, lastLine.to));
        atomic.push(hideLine.range(shown.to, after.from));
        snaps.push({ from: shown.to, to: after.from });
      }
      // Each paragraph, empty ones included, a little apart from the one before.
      for (let m = n + 1; m <= (hideLast ? last - 1 : last); m++) decorations.push(paragraphStart.range(doc.line(m).from));
      if (after) decorations.push(paragraphStart.range(after.from));
    }
    n = last + 1;
  }
  return { decorations: Decoration.set(decorations, true), atomic: RangeSet.of(atomic, true), snaps };
}

function insideCode(state: EditorState, format: Format, pos: number) {
  return verbatim(state.doc.toString(), format).some((span) => span.from < pos && pos < span.to);
}

/**
 * Enter: a new paragraph (a blank line), except in lists and code, which keep their own. Inside
 * styled text, the styles are closed before the break and opened again after it.
 */
function newParagraph(format: Format) {
  const listItem = format === "typst" ? /^\s*([-+]|\/) / : /^\s*([-*+]|\d+\.) /;
  return (view: EditorView) => {
    const { state } = view;
    const head = state.selection.main.head;
    if (insideCode(state, format, head)) return false;
    if (listItem.test(state.doc.lineAt(head).text)) return continueList(view, format);
    // (What's selected goes first.)
    const cleared = state.update(state.replaceSelection(""));
    const after = cleared.state;
    const pos = after.selection.main.head;
    const split = splitAt(after.doc.toString(), format, pos);
    if (split === "line") return insertNewline(view);
    const changes = cleared.changes.compose(after.changes({ from: split.from, to: split.to, insert: split.insert }));
    view.dispatch({ changes, selection: { anchor: split.cursor }, scrollIntoView: true, userEvent: "input" });
    return true;
  };
}

/**
 * ⌫ at the start of a paragraph (or Delete at the end of one) joins it to the other one; when the
 * two end and start with the same styles, those merge, giving back the text as before a split.
 */
function joinParagraphs(format: Format, forward: boolean) {
  return (view: EditorView) => {
    const { state } = view;
    const selection = state.selection.main;
    if (!selection.empty) return false;
    const text = state.doc.toString();
    let start = selection.head;
    if (forward) {
      const gap = /^\n[ \t]*\n/.exec(text.slice(start));
      if (!gap) return false;
      start += gap[0].length;
    }
    const join = joinAt(text, format, start);
    if (!join) return false;
    view.dispatch({
      changes: join,
      selection: { anchor: join.from },
      scrollIntoView: true,
      userEvent: forward ? "delete.forward" : "delete.backward",
    });
    return true;
  };
}

const theme = EditorView.theme({
  // A little apart from the paragraph before, as the blank line between them isn't shown.
  ".cm-line.cm-paragraph-start": { paddingTop: "0.45em" },
});

export function paragraphs(format: Format) {
  const breaks = StateField.define<Breaks>({
    create: (state) => findBreaks(state.doc, format),
    update: (value, transaction) => (transaction.docChanged ? findBreaks(transaction.newDoc, format) : value),
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
    ],
  });
  // A cursor that lands on a hidden blank line goes to where it's shown.
  const snapCursor = EditorState.transactionFilter.of((transaction) => {
    if (!transaction.selection && !transaction.docChanged) return transaction;
    const { snaps } = transaction.docChanged
      ? findBreaks(transaction.newDoc, format)
      : transaction.startState.field(breaks);
    const snap = (pos: number) => snapped(snaps, pos);
    const selection = transaction.newSelection;
    let moved = false;
    const ranges = selection.ranges.map((range) => {
      const anchor = snap(range.anchor);
      const head = snap(range.head);
      if (anchor !== range.anchor || head !== range.head) moved = true;
      return EditorSelection.range(anchor, head);
    });
    if (!moved) return transaction;
    return [transaction, { selection: EditorSelection.create(ranges, selection.mainIndex), sequential: true }];
  });
  // A click past the end of a line lands on the hidden blank line after it. CodeMirror would push
  // it out to the nearest edge, which can be the next paragraph; it stays on the clicked line.
  const clickPastEnd = EditorView.mouseSelectionStyle.of((view, event) => {
    if (event.button !== 0 || event.detail !== 1 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return null;
    const at = (e: MouseEvent) => view.posAtCoords({ x: e.clientX, y: e.clientY }, false);
    const pos = at(event);
    let anchor = snapped(view.state.field(breaks).snaps, pos);
    if (anchor === pos) return null;
    return {
      get: (current) => EditorSelection.create([EditorSelection.range(anchor, snapped(view.state.field(breaks).snaps, at(current)))]),
      update: (update) => {
        if (update.docChanged) anchor = update.changes.mapPos(anchor);
        return false;
      },
    };
  });
  return [
    breaks,
    snapCursor,
    clickPastEnd,
    theme,
    Prec.high(
      keymap.of([
        { key: "Enter", run: newParagraph(format) },
        { key: "Shift-Enter", run: insertNewline },
        { key: "Backspace", run: joinParagraphs(format, false) },
        { key: "Delete", run: joinParagraphs(format, true) },
      ]),
    ),
  ];
}

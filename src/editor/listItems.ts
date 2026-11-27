// Writing lists: Enter in a list item starts the next one, with the same marker (the next number
// in a Markdown numbered list, an unchecked box in a to-do list), and the text after the cursor
// goes into it. Enter on an empty item ends the list (with a blank line after it, so what comes
// next is a paragraph of its own), or, nested, brings the item out a level.

import type { EditorView } from "@codemirror/view";
import type { Format } from "./formatting";

const ITEM = {
  typst: /^(\s*)([-+]|\d+\.)( +)(\[[ xX]\] +)?/,
  markdown: /^(\s*)([-*+]|\d+[.)])( +)(\[[ xX]\] +)?/,
};

/** Enter in a list item; false if the cursor isn't in one (Enter then does what it does elsewhere). */
export function continueList(view: EditorView, format: Format): boolean {
  const { state } = view;
  const { from, to } = state.selection.main;
  const line = state.doc.lineAt(from);
  if (state.doc.lineAt(to).number !== line.number) return false;
  const item = ITEM[format].exec(line.text);
  if (!item) return false;
  const [whole, indent, marker, space, box] = item;
  const contentFrom = line.from + whole.length;

  // An empty item: out a level if it's nested, otherwise the list ends here.
  if (line.text.slice(whole.length).trim() === "" && from === to) {
    if (indent.length > 0) {
      const less = indent.slice(Math.min(2, indent.length));
      view.dispatch({
        changes: { from: line.from, to: line.from + indent.length, insert: less },
        userEvent: "input",
      });
      return true;
    }
    // A blank line after the list, so what's written next is a paragraph of its own (in Markdown,
    // a line right after an item would still be part of it).
    view.dispatch({ changes: { from: line.from, to: line.to, insert: "\n" }, selection: { anchor: line.from + 1 }, userEvent: "input" });
    return true;
  }

  const numbered = /^(\d+)([.)])$/.exec(marker);
  const next = numbered ? `${Number(numbered[1]) + 1}${numbered[2]}` : marker;
  const newItem = `\n${indent}${next}${space}${box ? "[ ] " : ""}`;
  // (From the start of the item's text at the earliest: the marker stays whole.)
  const at = Math.max(from, contentFrom);
  // Spaces at the split are dropped: "milk |and" makes "milk" and "and".
  const before = state.sliceDoc(line.from, at);
  const trimmedFrom = line.from + Math.max(whole.length, before.trimEnd().length);
  const after = state.sliceDoc(Math.max(to, at), line.to);
  const skip = after.length - after.trimStart().length;
  view.dispatch({
    changes: { from: Math.min(trimmedFrom, at), to: Math.max(to, at) + skip, insert: newItem },
    selection: { anchor: Math.min(trimmedFrom, at) + newItem.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  return true;
}

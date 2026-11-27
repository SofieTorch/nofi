// How lists look (see tests/lists.test.tsx › How lists look): nested items show nested, each level
// a step further in, however many spaces they're written with. An item's text, wrapped onto more
// lines too, lines up under where its text starts: its marker hangs to the left of it. The spaces
// before a nested item aren't shown; its level says how far in it is.

import type { Range as Ranged, Text } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import type { Span } from "./formatting";

/** How far in each level is, and how wide a marker (with the space after it) is. */
const STEP = 1.6;

const hideSpaces = Decoration.replace({});
const itemMarker = Decoration.mark({ class: "cm-list-marker" });

const itemLine = (depth: number) =>
  Decoration.line({
    class: "cm-list-line",
    attributes: { style: `padding-left: ${Number(((depth + 1) * STEP).toFixed(2))}em; text-indent: -${STEP}em` },
  });

/** The decorations that indent the list items among `spans` (a note's formatting). */
export function listIndents(doc: Text, spans: Span[]): Ranged<Decoration>[] {
  const items = spans
    .filter((span) => span.kind === "list-item" || span.kind === "task")
    .sort((a, b) => a.from - b.from);
  const decorations: Ranged<Decoration>[] = [];
  // Where the items this one could be nested in start, innermost last.
  let parents: number[] = [];
  let lastLine = 0;
  for (const item of items) {
    const line = doc.lineAt(item.from);
    const spaces = item.from - line.from;
    // Only a marker at the start of its line (with spaces before it) makes a list item.
    if (line.number === lastLine || line.text.slice(0, spaces).trim() !== "") continue;
    // A line of text at the left between two items ends the list: the next one starts again.
    for (let n = lastLine + 1; n < line.number && lastLine > 0; n++) {
      const between = doc.line(n).text;
      if (between.trim() !== "" && !/^\s/.test(between)) parents = [];
    }
    while (parents.length && parents[parents.length - 1] >= spaces) parents.pop();
    decorations.push(itemLine(parents.length).range(line.from));
    if (spaces > 0) decorations.push(hideSpaces.range(line.from, item.from));
    if (item.kind === "list-item") decorations.push(itemMarker.range(item.from, item.to));
    parents.push(spaces);
    lastLine = line.number;
  }
  return decorations;
}

export const listTheme = {
  // The marker hangs to the left of the text: as wide as one step, whatever it is ("-", "10.").
  ".cm-list-marker": { display: "inline-block", minWidth: `${STEP}em`, textIndent: "0" },
  ".cm-list-line .cm-task-box": { minWidth: `${STEP}em`, marginRight: "0", textIndent: "0" },
};

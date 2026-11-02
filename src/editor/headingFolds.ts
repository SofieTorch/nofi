// Collapsing headings, like Notion's toggle headings: an arrow at the end of a heading's text
// (shown on hover, and always while collapsed) hides everything under it, up to the next heading of
// the same level or a bigger one. Only the editor hides it: the note's text stays as it is.
// While collapsed, the cursor skips the hidden part; if it gets there anyway (like with Undo), the
// part is shown again. Which headings are collapsed is kept with the note's editor state.

import { invertedEffects } from "@codemirror/commands";
import {
  type ChangeSet,
  EditorState,
  Facet,
  RangeSet,
  StateEffect,
  StateField,
  type Range as Ranged,
  type Text,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { findBlocks } from "./blocks";
import type { Format } from "./formatting";

/** Collapses or expands the heading starting at a position. */
const toggleFold = StateEffect.define<number>({ map: (pos, changes) => changes.mapPos(pos) });

/** Which headings are collapsed, all at once (after a block moved, or to undo that). */
const setFolded = StateEffect.define<number[]>();

const foldFormat = Facet.define<Format, Format>({ combine: (formats) => formats[0] ?? "typst" });

/** A heading and what's under it. */
type Section = {
  /** Where the heading starts, and where its line ends. */
  heading: number;
  headingEnd: number;
  /** The end of what's under it (the line before the next heading as big, or the note's end). */
  to: number;
  /** Where that next heading starts, if there is one. */
  next: number | null;
};

function sectionsOf(doc: Text, format: Format): Section[] {
  const text = doc.toString();
  const blocks = findBlocks(text, format);
  const level = (from: number) => /^(=+|#+)/.exec(text.slice(from))?.[1].length ?? 1;
  const sections: Section[] = [];
  blocks.forEach((block, i) => {
    if (block.kind !== "heading") return;
    const own = level(block.from);
    const next = blocks.slice(i + 1).find((b) => b.kind === "heading" && level(b.from) <= own);
    sections.push({
      heading: block.from,
      headingEnd: doc.lineAt(block.from).to,
      to: next ? next.from - 1 : doc.length,
      next: next?.from ?? null,
    });
  });
  return sections;
}

type Folds = {
  /** Where the collapsed headings start. */
  folded: number[];
  sections: Section[];
  decorations: DecorationSet;
  atomic: RangeSet<Decoration>;
};

const hidden = Decoration.replace({ block: true });

class FoldArrow extends WidgetType {
  constructor(readonly folded: boolean) {
    super();
  }

  eq(other: FoldArrow) {
    return other.folded === this.folded;
  }

  toDOM(view: EditorView) {
    const arrow = document.createElement("span");
    arrow.className = "cm-fold-arrow";
    arrow.setAttribute("role", "button");
    arrow.setAttribute("aria-label", this.folded ? "Expand section" : "Collapse section");
    arrow.setAttribute("aria-expanded", String(!this.folded));
    arrow.title = this.folded ? "Expand" : "Collapse";
    arrow.innerHTML =
      '<svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path fill="currentColor" d="M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z"/></svg>';
    arrow.addEventListener("mousedown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const line = view.state.doc.lineAt(view.posAtDOM(arrow));
      view.dispatch({ effects: toggleFold.of(line.from) });
    });
    return arrow;
  }

  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState, wanted: readonly number[]): Folds {
  const sections = sectionsOf(state.doc, state.facet(foldFormat));
  const folded = sections.filter((s) => wanted.includes(s.heading)).map((s) => s.heading);
  const decorations: Ranged<Decoration>[] = [];
  const atomic: Ranged<Decoration>[] = [];
  for (const section of sections) {
    const isFolded = folded.includes(section.heading);
    decorations.push(Decoration.widget({ widget: new FoldArrow(isFolded), side: 1 }).range(section.headingEnd));
    if (!isFolded || section.to <= section.headingEnd) continue;
    decorations.push(hidden.range(section.headingEnd + 1, section.to));
    atomic.push(hidden.range(section.headingEnd, section.next ?? section.to));
  }
  return { folded, sections, decorations: Decoration.set(decorations, true), atomic: RangeSet.of(atomic, true) };
}

/** Whether a position is in a collapsed heading's hidden part. */
const hiddenAt = (folds: Folds, pos: number) =>
  folds.sections.find((s) => folds.folded.includes(s.heading) && s.headingEnd < pos && pos < (s.next ?? s.to + 1));

export const headingFoldsField = StateField.define<Folds>({
  create: (state) => build(state, []),
  update(value, transaction) {
    let folded = value.folded.map((pos) => transaction.changes.mapPos(pos));
    for (const effect of transaction.effects) {
      if (effect.is(setFolded)) folded = effect.value;
      if (!effect.is(toggleFold)) continue;
      folded = folded.includes(effect.value) ? folded.filter((pos) => pos !== effect.value) : [...folded, effect.value];
    }
    const changed = transaction.docChanged || folded.length !== value.folded.length || folded.some((p, i) => p !== value.folded[i]);
    let next = changed ? build(transaction.state, folded) : value;
    // The cursor got into a hidden part (like with Undo, or a search): it's shown again.
    if (transaction.selection || transaction.docChanged) {
      const section = hiddenAt(next, transaction.state.selection.main.head);
      if (section) next = build(transaction.state, next.folded.filter((pos) => pos !== section.heading));
    }
    return next;
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
  // Kept with the note's editor state, so switching notes and back keeps them collapsed.
  toJSON: (value) => value.folded,
  fromJSON: (json, state) => build(state, Array.isArray(json) ? json.filter((p) => typeof p === "number") : []),
});

/** The collapsed headings, each with the end of what it hides (for moving it all as one block). */
export function foldedSections(state: EditorState): { from: number; to: number }[] {
  const folds = state.field(headingFoldsField, false);
  if (!folds) return [];
  return folds.sections.filter((s) => folds.folded.includes(s.heading)).map((s) => ({ from: s.heading, to: s.to }));
}

/**
 * After moving a block (`moved`, now starting at `start`): the collapsed headings in it go with
 * it, so a collapsed heading moved with what it hides stays collapsed.
 */
export function foldsAfterMove(state: EditorState, moved: { from: number; to: number }, changes: ChangeSet, start: number) {
  const folds = state.field(headingFoldsField, false);
  if (!folds?.folded.length) return [];
  return [setFolded.of(folds.folded.map((p) => (p >= moved.from && p <= moved.to ? start + (p - moved.from) : changes.mapPos(p))))];
}

/** Undo puts back which headings were collapsed before a move. */
const undoFolds = invertedEffects.of((transaction) =>
  transaction.effects.some((e) => e.is(setFolded)) ? [setFolded.of(transaction.startState.field(headingFoldsField).folded)] : [],
);

const theme = EditorView.theme({
  ".cm-fold-arrow": {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    verticalAlign: "middle",
    marginLeft: "0.3em",
    width: "1.15em",
    height: "1.15em",
    fontSize: "0.85em",
    color: "#a3a3a3",
    cursor: "pointer",
    opacity: "0",
    transition: "opacity 120ms, transform 120ms",
  },
  ".cm-fold-arrow:hover": { color: "#525252" },
  ".cm-line:hover .cm-fold-arrow": { opacity: "1" },
  // Collapsed: always shown, pointing right.
  ".cm-fold-arrow[aria-expanded=false]": { opacity: "1", transform: "rotate(-90deg)" },
});

export function headingFolds(format: Format) {
  return [foldFormat.of(format), headingFoldsField, undoFolds, theme];
}

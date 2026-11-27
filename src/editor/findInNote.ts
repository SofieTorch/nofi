// Finding (and replacing) in a note: ⌘F, like VS Code (see tests/find.test.tsx › Finding in a
// note). The matches are highlighted, the one you're on selected; the bar sits at the note's top
// right, staying in view as it scrolls.

import { StateEffect, StateField, type EditorState, type Range as Ranged } from "@codemirror/state";
import { Decoration, EditorView, keymap, showPanel, type Panel } from "@codemirror/view";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { FindBar, matchesIn } from "../ui/FindBar";

type Find = {
  open: boolean;
  query: string;
  /** The match you're on (from 0). */
  current: number;
  /** Counts the times it was asked for (⌘F): its field gets the focus each time. */
  focus: number;
  replaceShown: boolean;
  replaceWith: string;
};

const CLOSED: Find = { open: false, query: "", current: 0, focus: 0, replaceShown: false, replaceWith: "" };
const changeFind = StateEffect.define<Partial<Find>>();

const findField = StateField.define<Find>({
  create: () => CLOSED,
  update(find, transaction) {
    for (const effect of transaction.effects) if (effect.is(changeFind)) find = { ...find, ...effect.value };
    return find;
  },
  provide: (field) => [
    showPanel.from(field, (find) => (find.open ? findPanel : null)),
    EditorView.decorations.compute([field, "doc"], (state) => {
      const find = state.field(field);
      if (!find.open) return Decoration.none;
      const marks: Ranged<Decoration>[] = matchesOf(state).map((m, i) => (i === find.current ? current : found).range(m.from, m.to));
      return Decoration.set(marks.filter((m) => m.from < m.to), true);
    }),
  ],
});

const found = Decoration.mark({ class: "cm-found" });
const current = Decoration.mark({ class: "cm-found cm-found-current" });

const matchesOf = (state: EditorState) => matchesIn(state.doc.toString(), state.field(findField).query);

/** Goes to a match: selected, and in view. */
function select(view: EditorView, changes: Partial<Find>, index: number | null) {
  const query = changes.query ?? view.state.field(findField).query;
  const matches = matchesIn(view.state.doc.toString(), query);
  const at = index === null || !matches.length ? 0 : ((index % matches.length) + matches.length) % matches.length;
  const match = matches[at];
  view.dispatch({
    effects: changeFind.of({ ...changes, current: at }),
    selection: match ? { anchor: match.from, head: match.to } : undefined,
    scrollIntoView: !!match,
  });
}

/** The first match from where the selection starts (or the first of all). */
function firstFrom(state: EditorState, query: string) {
  const index = matchesIn(state.doc.toString(), query).findIndex((m) => m.from >= state.selection.main.from);
  return Math.max(0, index);
}

/**
 * Opens the find bar: with the selected text (on one line), or `query`, on its `nth` match (else
 * the first from the cursor); ready to replace with `replace`.
 */
export function openFind(view: EditorView, { query, nth, replace }: { query?: string; nth?: number; replace?: boolean } = {}) {
  const find = view.state.field(findField, false);
  if (!find) return false;
  const { from, to } = view.state.selection.main;
  const selectedText = view.state.sliceDoc(from, to);
  const wanted = query ?? (selectedText && !selectedText.includes("\n") ? selectedText : find.query);
  const changes = { open: true, query: wanted, focus: find.focus + 1, replaceShown: replace || find.replaceShown };
  select(view, changes, nth ?? firstFrom(view.state, wanted));
  return true;
}

function closeFind(view: EditorView) {
  if (!view.state.field(findField).open) return false;
  view.dispatch({ effects: changeFind.of({ open: false }) });
  view.focus();
  return true;
}

function replaceOne(view: EditorView) {
  const find = view.state.field(findField);
  const match = matchesOf(view.state)[find.current];
  if (!match) return;
  view.dispatch({ changes: { from: match.from, to: match.to, insert: find.replaceWith }, userEvent: "input.replace" });
  // On to the next one, after what was put in.
  const after = match.from + find.replaceWith.length;
  const index = matchesOf(view.state).findIndex((m) => m.from >= after);
  select(view, {}, Math.max(0, index));
}

function replaceAll(view: EditorView) {
  const find = view.state.field(findField);
  const changes = matchesOf(view.state).map((m) => ({ from: m.from, to: m.to, insert: find.replaceWith }));
  if (!changes.length) return;
  // (One change: one undo.)
  view.dispatch({ changes, userEvent: "input.replace.all" });
  select(view, {}, 0);
}

/** The bar, drawn by React in the editor's top panel. */
function findPanel(view: EditorView): Panel {
  const dom = document.createElement("div");
  dom.className = "cm-find-panel";
  const holder = document.createElement("div");
  holder.className = "cm-find-holder";
  dom.append(holder);
  const root = createRoot(holder);
  const draw = (state: EditorState) => {
    const find = state.field(findField);
    const count = matchesOf(state).length;
    root.render(
      createElement(FindBar, {
        query: find.query,
        onQuery: (query: string) => select(view, { query }, firstFrom(view.state, query)),
        count,
        current: count ? find.current : null,
        onNext: () => select(view, {}, view.state.field(findField).current + 1),
        onPrevious: () => select(view, {}, view.state.field(findField).current - 1),
        onClose: () => closeFind(view),
        focusSignal: find.focus,
        replace: {
          shown: find.replaceShown,
          onShown: (shown: boolean) => view.dispatch({ effects: changeFind.of({ replaceShown: shown }) }),
          value: find.replaceWith,
          onValue: (value: string) => view.dispatch({ effects: changeFind.of({ replaceWith: value }) }),
          onReplace: () => replaceOne(view),
          onReplaceAll: () => replaceAll(view),
        },
      }),
    );
  };
  draw(view.state);
  return {
    dom,
    top: true,
    update: (update) => draw(update.state),
    // React doesn't like being unmounted while it renders; wait a moment.
    destroy: () => setTimeout(() => root.unmount()),
  };
}

const theme = EditorView.theme({
  ".cm-panels": { backgroundColor: "transparent", color: "inherit" },
  ".cm-panels-top": { borderBottom: "none", top: "0" },
  // No room taken: the bar floats over the note's top right.
  ".cm-find-panel": { position: "relative", height: "0" },
  ".cm-find-holder": { position: "absolute", top: "6px", right: "0", zIndex: "20", display: "flex", justifyContent: "flex-end", left: "0", pointerEvents: "none" },
  ".cm-found": { backgroundColor: "rgba(253, 224, 71, 0.45)", borderRadius: "2px" },
  ".cm-found-current": { backgroundColor: "rgba(251, 146, 60, 0.55)" },
});

/** ⌘F finds in the note, ⌥⌘F replaces, Esc closes the bar. */
export function findInNote() {
  return [
    findField,
    theme,
    keymap.of([
      { key: "Mod-f", run: (view) => openFind(view), preventDefault: true },
      { key: "Mod-Alt-f", run: (view) => openFind(view, { replace: true }), preventDefault: true },
      { key: "Escape", run: closeFind },
    ]),
  ];
}

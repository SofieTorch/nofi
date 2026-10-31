// Suggestions while writing Typst, shown in a list at the cursor. They come from Typst itself,
// so they know every function, what it can be set to, valid values, fonts and maths symbols.

import {
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import * as api from "../api";

/** CodeMirror's names for kinds of suggestions (they pick the little icon). */
const TYPES: Record<string, string> = {
  function: "function",
  parameter: "property",
  constant: "constant",
  type: "type",
  syntax: "keyword",
  font: "text",
  symbol: "text",
  label: "variable",
};

async function suggest(context: CompletionContext): Promise<CompletionResult | null> {
  const result = await api.completeTypst(context.state.doc.toString(), context.pos, context.explicit);
  if (!result || context.aborted) return null;
  return {
    from: result.from,
    options: result.items.map(
      (item): Completion => ({
        label: item.label,
        detail: item.symbol ?? undefined,
        info: item.detail ?? undefined,
        type: TYPES[item.kind],
        apply: (view, _completion, from, to) => {
          const at = from + item.cursor;
          view.dispatch({
            changes: { from, to, insert: item.insert },
            selection: { anchor: at, head: at + item.selection },
            userEvent: "input.complete",
          });
        },
      }),
    ),
    // While you keep typing a name, filter this list instead of asking again.
    validFor: /^[\w-]*$/,
  };
}

/** Typst's suggestions, plus any other sources (like the "/" menu) in the same list. */
export function typstSuggestions(others: CompletionSource[] = []) {
  return suggestions([...others, suggest]);
}

/** A list of suggestions at the cursor, from these sources, opened by typing or ⌘I. */
export function suggestions(sources: CompletionSource[]) {
  return [
    autocompletion({ override: sources, icons: true, closeOnBlur: true }),
    // Ctrl+Space works too, but on a Mac it usually switches the keyboard language.
    Prec.high(keymap.of([{ key: "Mod-i", run: startCompletion }])),
    theme,
  ];
}

const theme = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    border: "none",
    borderRadius: "10px",
    background: "white",
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
    padding: "4px",
    fontSize: "13px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "inherit", maxHeight: "16em" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    borderRadius: "6px",
    padding: "3px 8px",
    lineHeight: "1.5",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    background: "#f5f5f5",
    color: "#171717",
  },
  ".cm-completionDetail": { color: "#737373", fontStyle: "normal", marginLeft: "0.75em" },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "600" },
  ".cm-tooltip.cm-completionInfo": {
    border: "none",
    borderRadius: "10px",
    background: "white",
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
    padding: "6px 10px",
    fontSize: "12px",
    color: "#525252",
    maxWidth: "18em",
  },
  ".cm-completionIcon": { opacity: "0.5", width: "1.2em" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    display: "block",
    padding: "6px 8px 2px",
    fontSize: "11px",
    color: "#a3a3a3",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    border: "none",
    borderBottom: "none",
  },
});

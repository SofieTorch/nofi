// Keeps Typst notes valid while they're written: the note is checked by Typst shortly after each
// change, mistakes are underlined with a plain explanation and fixes (hover them, or open the list),
// and brackets close themselves as they're typed.

import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { type Diagnostic, forEachDiagnostic, linter, lintKeymap } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import * as api from "../api";
import { notePath } from "./noteLinks";

/** The problem each underline stands for (to show its hints in the problems list). */
const problemOf = new WeakMap<Diagnostic, api.Problem>();

/** A problem as it is now: where it is in the note (it moves as you type) and how to fix it. */
export type CurrentProblem = {
  from: number;
  problem: api.Problem;
  fixes: { label: string; apply: () => void }[];
};

/** The note's problems where they are now, in order. */
export function currentProblems(view: EditorView): CurrentProblem[] {
  const found: CurrentProblem[] = [];
  forEachDiagnostic(view.state, (diagnostic, from, to) => {
    const problem = problemOf.get(diagnostic);
    if (!problem) return;
    found.push({
      from,
      problem,
      fixes: (diagnostic.actions ?? []).map((action) => ({
        label: action.name,
        apply: () => action.apply(view, from, to),
      })),
    });
  });
  return found;
}

/** How long typing has to pause before the note is checked again. */
const CHECK_DELAY_MS = 300;

export function typstProblems(onProblems: (problems: api.Problem[]) => void) {
  const check = linter(
    async (view): Promise<Diagnostic[]> => {
      const text = view.state.doc.toString();
      const path = view.state.facet(notePath);
      const problems = await (path ? api.checkNote(text, path) : api.checkNote(text)).catch(() => [] as api.Problem[]);
      // If the note changed while it was being checked, a newer check is on its way.
      if (view.state.doc.toString() !== text) return [];
      onProblems(problems);
      return problems.map((problem) => {
        const diagnostic: Diagnostic = {
          from: problem.from,
          to: problem.to,
          severity: problem.severity,
          message: problem.message,
          renderMessage: () => explain(problem),
          actions: problem.fixes.map((fix) => ({
            name: fix.label,
            // The problem may have moved since it was found: apply the fix where it is now.
            apply: (view, from) => {
              const shift = from - problem.from;
              view.dispatch({
                changes: { from: fix.from + shift, to: fix.to + shift, insert: fix.insert },
                userEvent: "input.fix",
              });
            },
          })),
        };
        problemOf.set(diagnostic, problem);
        return diagnostic;
      });
    },
    { delay: CHECK_DELAY_MS },
  );

  return [
    check,
    keymap.of(lintKeymap),
    // Only brackets and quotes close themselves: harmless in text, needed in code. "$", "*" and "_"
    // don't, or "$5" would silently become maths; those get a fix instead.
    EditorState.languageData.of(() => [{ closeBrackets: { brackets: ["(", "[", "{", '"'] } }]),
    closeBrackets(),
    keymap.of(closeBracketsKeymap),
    EditorState.phrases.of({ Diagnostics: "Problems" }),
    theme,
  ];
}

function explain(problem: api.Problem) {
  const element = document.createElement("div");
  const message = document.createElement("div");
  message.textContent = problem.message;
  element.append(message);
  for (const hint of problem.hints) {
    const line = document.createElement("div");
    line.className = "cm-problem-hint";
    line.textContent = hint;
    element.append(line);
  }
  return element;
}

const theme = EditorView.theme({
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy #f87171",
    textUnderlineOffset: "3px",
  },
  ".cm-lintRange-warning": {
    backgroundImage: "none",
    textDecoration: "underline wavy #fbbf24",
    textUnderlineOffset: "3px",
  },
  ".cm-lintPoint-error:after": { borderBottomColor: "#f87171" },
  ".cm-tooltip.cm-tooltip-lint, .cm-tooltip-hover": {
    border: "none",
    borderRadius: "10px",
    background: "white",
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
    fontSize: "13px",
  },
  ".cm-diagnostic": { padding: "6px 10px", borderLeft: "none" },
  ".cm-diagnostic-error": { borderLeft: "3px solid #f87171" },
  ".cm-diagnostic-warning": { borderLeft: "3px solid #fbbf24" },
  ".cm-problem-hint": { color: "#737373", fontSize: "12px", marginTop: "2px" },
  ".cm-diagnosticAction": {
    background: "#f5f5f5",
    color: "#262626",
    borderRadius: "6px",
    padding: "2px 8px",
    marginLeft: "0",
    marginRight: "6px",
    marginTop: "4px",
    font: "inherit",
    fontSize: "12px",
  },
  ".cm-diagnosticAction:hover": { background: "#e5e5e5" },
  ".cm-panel.cm-panel-lint": { borderTop: "0.5px solid #e5e5e5", background: "white" },
  ".cm-panel.cm-panel-lint ul [aria-selected]": { background: "#f5f5f5" },
});

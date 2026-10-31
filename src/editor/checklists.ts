// Checklists in Typst notes. Typst has no checklists of its own, so a note with a task ("- [ ]" or
// "- [x]") carries a small rule that draws them as checkboxes on the pages (checklistRule.typ). The
// rule is added at the note's top with its first task, in the same change (so one Undo takes both
// back), and isn't shown while writing.

import { EditorState, StateField, type Text } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import RULE from "./checklistRule.typ?raw";
import { findFormatting } from "./formatting";

export { RULE as CHECKLIST_RULE };

/** A quick look for a line that might be a task, before reading the note properly. */
const MAYBE_TASK = /^\s*- \[[ xX]\]/m;

const hasTask = (text: string) =>
  MAYBE_TASK.test(text) && findFormatting(text, "typst").some((span) => span.kind === "task");

/** The rule's lines are hidden, wherever it is. */
function hideRule(doc: Text): DecorationSet {
  const at = doc.toString().indexOf(RULE);
  if (at < 0) return Decoration.none;
  return Decoration.set([Decoration.replace({ block: true }).range(at, at + RULE.length - 1)]);
}

const hiddenRule = StateField.define<DecorationSet>({
  create: (state) => hideRule(state.doc),
  update: (hidden, transaction) => (transaction.docChanged ? hideRule(transaction.newDoc) : hidden),
  provide: (field) => EditorView.decorations.from(field),
});

/** With a note's first task, the rule goes at its top. */
const addRule = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.docChanged) return transaction;
  const text = transaction.newDoc.toString();
  if (text.includes(RULE) || !hasTask(text)) return transaction;
  return [transaction, { changes: { from: 0, insert: RULE }, sequential: true }];
});

export function checklists() {
  return [hiddenRule, addRule];
}

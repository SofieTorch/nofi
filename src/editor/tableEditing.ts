// Which table is open in the table editor, if any. While writing, tables are shown as Typst draws
// them; clicking one opens it in the editor, and leaving it shows the picture again.

import { StateEffect, StateField } from "@codemirror/state";

/** Opens the table starting at this position in the editor (null closes it). */
export const editTableAt = StateEffect.define<number | null>({
  map: (at, mapping) => (at === null ? null : mapping.mapPos(at, -1)),
});

/** Where the table being edited starts (it moves along as the note changes), or null. */
export const editingTable = StateField.define<number | null>({
  create: () => null,
  update: (at, transaction) => {
    for (const effect of transaction.effects) if (effect.is(editTableAt)) return effect.value;
    return at === null ? null : transaction.changes.mapPos(at, -1);
  },
});

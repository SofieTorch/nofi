// What a note's editor can do, shared by the note's editor and the small editors of its columns.

import { EditorView } from "@codemirror/view";
import type { Format } from "./formatting";
import { checklists } from "./checklists";
import { codeBlocks } from "./codeBlocks";
import { columnBlocks } from "./columns";
import { drawnBlocks } from "./drawnBlocks";
import { livePreview } from "./livePreview";
import { propertiesField } from "./propertiesField";
import { formatToolbar } from "./selectionToolbar";
import { slashMenu } from "./slashMenu";
import { tableBar } from "./tableBar";
import { suggestions, typstSuggestions } from "./typstSuggestions";

/**
 * The writing features: the live preview, code blocks, tables, the toolbar and the "/" menu.
 * In a column, what belongs to the whole note (its properties, the checklist rule, columns within
 * columns) is left to the note's editor.
 */
export function editorFeatures(format: Format, { inColumn = false } = {}) {
  const typst = format === "typst";
  return [
    EditorView.lineWrapping,
    livePreview(format),
    inColumn ? [] : propertiesField(format),
    codeBlocks(format),
    typst && !inColumn ? checklists() : [],
    typst && !inColumn ? columnBlocks() : [],
    formatToolbar(format),
    typst ? drawnBlocks() : [],
    typst ? tableBar() : [],
    typst ? typstSuggestions([slashMenu("typst")]) : suggestions([slashMenu("markdown")]),
  ];
}

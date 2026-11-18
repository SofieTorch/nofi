// What a note's editor can do, shared by the note's editor and the small editors of its columns.

import { EditorView } from "@codemirror/view";
import type { Format } from "./formatting";
import { blockHandles } from "./blockHandles";
import { checklists } from "./checklists";
import { codeBlocks } from "./codeBlocks";
import { columnBlocks } from "./columns";
import { drawnBlocks } from "./drawnBlocks";
import { headingFolds } from "./headingFolds";
import { images } from "./images";
import { livePreview } from "./livePreview";
import { followNoteLinks, noteLinkSource } from "./noteLinks";
import { paragraphs } from "./paragraphs";
import { propertiesField } from "./propertiesField";
import { formatToolbar } from "./selectionToolbar";
import { slashMenu } from "./slashMenu";
import { tableBar } from "./tableBar";
import { suggestions, typstSuggestions } from "./typstSuggestions";

/**
 * The writing features: the live preview, code blocks, tables, the toolbar and the "/" menu.
 * In a column, what belongs to the whole note (its properties, the checklist rule, columns within
 * columns) is left to the note's editor. On a board's card, only the writing itself: no handles,
 * folds, properties or columns; a card that only shows a note (`readOnly`) has no toolbar or menus.
 */
export function editorFeatures(format: Format, { inColumn = false, inCard = false, readOnly = false } = {}) {
  const typst = format === "typst";
  if (inCard) {
    return [
      EditorView.lineWrapping,
      livePreview(format),
      codeBlocks(format),
      images(format),
      typst ? drawnBlocks() : [],
      followNoteLinks(format),
      readOnly
        ? []
        : [
            paragraphs(format),
            formatToolbar(format),
            typst ? typstSuggestions([slashMenu("typst"), noteLinkSource("typst")]) : suggestions([slashMenu("markdown"), noteLinkSource("markdown")]),
          ],
    ];
  }
  return [
    EditorView.lineWrapping,
    livePreview(format),
    paragraphs(format),
    inColumn ? [] : propertiesField(format),
    codeBlocks(format),
    typst && !inColumn ? checklists() : [],
    typst && !inColumn ? columnBlocks() : [],
    formatToolbar(format),
    headingFolds(format),
    images(format),
    blockHandles(format),
    typst ? drawnBlocks() : [],
    typst ? tableBar() : [],
    followNoteLinks(format),
    typst ? typstSuggestions([slashMenu("typst"), noteLinkSource("typst")]) : suggestions([slashMenu("markdown"), noteLinkSource("markdown")]),
  ];
}

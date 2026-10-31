import { defaultKeymap, history, historyField, historyKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { type RefObject, useEffect, useRef } from "react";
import type { Format } from "./formatting";
import { codeBlocks } from "./codeBlocks";
import { drawnBlocks } from "./drawnBlocks";
import { formatToolbar } from "./selectionToolbar";
import { livePreview } from "./livePreview";
import { recallNoteState, rememberNoteState } from "./noteHistory";
import { propertiesField } from "./propertiesField";
import { typstProblems } from "./typstProblems";
import { slashMenu } from "./slashMenu";
import { tableBar } from "./tableBar";
import { suggestions, typstSuggestions } from "./typstSuggestions";
import type { Problem } from "../api";

type Props = {
  /** The note's file name; also the editor's accessible name. */
  name: string;
  /** The note's path: its undo history is kept under it while you switch notes. */
  historyKey: string;
  format: Format;
  initialText: string;
  onChange: (text: string) => void;
  /** Called with the note's mistakes each time a Typst note is checked. */
  onProblems?: (problems: Problem[]) => void;
  /** Gives access to the editor, e.g. to move the cursor from outside. */
  viewRef?: RefObject<EditorView | null>;
};

/** A CodeMirror editor for one note. Remount it (with `key`) to edit another note. */
export function NoteEditor({
  name,
  historyKey,
  format,
  initialText,
  onChange,
  onProblems,
  viewRef,
}: Props) {
  const parent = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onProblemsRef = useRef(onProblems);
  onProblemsRef.current = onProblems;

  useEffect(() => {
    const extensions = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ "aria-label": name, spellcheck: "true" }),
      livePreview(format),
      propertiesField(format),
      codeBlocks(format),
      formatToolbar(format),
      format === "typst" ? drawnBlocks() : [],
      format === "typst" ? tableBar() : [],
      format === "typst" ? typstSuggestions([slashMenu("typst")]) : suggestions([slashMenu("markdown")]),
      format === "typst" ? typstProblems((problems) => onProblemsRef.current?.(problems)) : [],
      EditorView.updateListener.of((update) => {
        if (update.docChanged || update.selectionSet) rememberNoteState(historyKey, update.state);
        if (update.docChanged) onChangeRef.current(update.state.doc.toString());
      }),
    ];
    // Pick up where this note was left, undo history included, if its text is unchanged.
    const saved = recallNoteState(historyKey, initialText);
    const state = saved
      ? EditorState.fromJSON(
          saved.toJSON({ history: historyField }),
          { extensions },
          { history: historyField },
        )
      : EditorState.create({ doc: initialText, extensions });
    const view = new EditorView({ parent: parent.current!, state });
    if (viewRef) viewRef.current = view;
    return () => {
      if (viewRef) viewRef.current = null;
      view.destroy();
    };
    // The editor owns the text from here on; it isn't reset by new props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={parent} />;
}

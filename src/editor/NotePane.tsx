import type { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { Autosave } from "./autosave";
import { noteFormat } from "./formatting";
import { NoteEditor } from "./NoteEditor";
import { NoPages, PagesPane } from "./PagesPane";
import { ProblemsButton } from "./ProblemsButton";

type State =
  | { status: "loading" }
  | { status: "failed"; reason: string }
  | { status: "ready"; text: string };

type Props = {
  path: string;
  autosave: Autosave;
  /** Also show the note as pages, next to the editor. */
  showPages: boolean;
  /** Called with whether the note has mistakes (errors), each time it's checked. */
  onMistakes?: (path: string, hasMistakes: boolean) => void;
};

/** Loads one note and shows it in the editor. Saves what's waiting when it closes. */
export function NotePane({ path, autosave, showPages, onMistakes }: Props) {
  const [problems, setProblems] = useState<api.Problem[]>([]);
  const [state, setState] = useState<State>({ status: "loading" });
  // The text as typed so far, for the pages (the editor itself keeps its own copy).
  const [text, setText] = useState("");
  const view = useRef<EditorView | null>(null);
  const format = noteFormat(path) ?? "typst";

  useEffect(() => {
    let current = true;
    api.readNote(path).then(
      (loaded) => {
        if (!current) return;
        setState({ status: "ready", text: loaded });
        setText(loaded);
      },
      (reason) => current && setState({ status: "failed", reason: String(reason) }),
    );
    return () => {
      current = false;
      autosave.flush();
    };
  }, [path, autosave]);

  if (state.status === "failed") {
    return (
      <p role="alert" className="p-6 text-sm text-red-600">
        Couldn't open the note: {state.reason}
      </p>
    );
  }
  if (state.status === "loading") return null;

  /** Puts the cursor at a position in the text, e.g. the spot clicked on a page. */
  function jumpTo(position: number) {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({
      selection: { anchor: Math.min(position, editor.state.doc.length) },
      scrollIntoView: true,
    });
    editor.focus();
  }

  /** Replaces the note's text in the editor, changing only the part that differs. */
  function replaceText(next: string) {
    const editor = view.current;
    if (!editor) return;
    const current = editor.state.doc.toString();
    let start = 0;
    while (start < current.length && start < next.length && current[start] === next[start]) start++;
    let end = 0;
    while (
      end < current.length - start &&
      end < next.length - start &&
      current[current.length - 1 - end] === next[next.length - 1 - end]
    ) {
      end++;
    }
    editor.dispatch({
      changes: { from: start, to: current.length - end, insert: next.slice(start, next.length - end) },
    });
  }

  return (
    <div className="flex h-full">
      <div className="note-column relative h-full min-w-0 flex-1 overflow-auto">
        {problems.length > 0 && <ProblemsButton problems={problems} view={view} />}
        <div className="mx-auto max-w-[44rem] px-12 pt-10 pb-[40vh]">
          <NoteEditor
            name={path.split("/").pop()!}
            historyKey={path}
            format={format}
            initialText={state.text}
            viewRef={view}
            onProblems={(found) => {
              setProblems(found);
              onMistakes?.(path, found.some((p) => p.severity === "error"));
            }}
            onChange={(changed) => {
              autosave.change(path, changed);
              setText(changed);
            }}
          />
        </div>
      </div>
      {showPages && (
        <div className="h-full min-w-0 flex-1 border-l-[0.5px] border-neutral-200">
          {format === "typst" ? <PagesPane text={text} onJump={jumpTo} onChangeText={replaceText} /> : <NoPages />}
        </div>
      )}
    </div>
  );
}

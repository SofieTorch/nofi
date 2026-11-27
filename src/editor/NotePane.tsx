import { EditorView } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { Autosave } from "./autosave";
import { noteFormat } from "./formatting";
import { openFind } from "./findInNote";
import { goToPart } from "./noteLinks";
import { NoteEditor } from "./NoteEditor";
import { NoPages, PagesPane } from "./PagesPane";
import { useScrollSync } from "./scrollSync";

/** How much of the width the note takes beside its pages (the rest is theirs), remembered. */
const SHARE_KEY = "marginalia.pagesShare";
const SHARE = { least: 0.2, most: 0.8, start: 0.5, step: 0.05 };
const clampShare = (share: number) => Math.round(Math.min(SHARE.most, Math.max(SHARE.least, share)) * 100) / 100;
function rememberedShare() {
  try {
    const saved = Number(localStorage.getItem(SHARE_KEY));
    return saved ? clampShare(saved) : SHARE.start;
  } catch {
    return SHARE.start;
  }
}

/** Whether the editor and the pages scroll together (the pages' switch), remembered. */
const SYNC_KEY = "marginalia.syncScrolling";
function rememberedSyncing() {
  try {
    return localStorage.getItem(SYNC_KEY) !== "off";
  } catch {
    return true;
  }
}
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
  /** Show the note as code (a Typst note's code view), not formatted. */
  showCode?: boolean;
  /** Called with whether the note has mistakes (errors), each time it's checked. */
  onMistakes?: (path: string, hasMistakes: boolean) => void;
  /** Text to select (a search match), once the note is shown; selected again for a new object. */
  reveal?: { line: number; column: number; length: number };
  /** A part of the note to go to (a link's anchor, after its #); gone to again for a new object. */
  goTo?: { part?: string; find?: { query: string; nth?: number } };
  /** Called when the note's text is changed (typed in), the first time and after. */
  onEdited?: (path: string) => void;
  /** Called when the part to go to isn't in the note. */
  onMissingPart?: (path: string, part: string) => void;
  /** Exports the note as a PDF (from the page view). */
  onExportPdf?: () => void;
};

/** Loads one note and shows it in the editor. Saves what's waiting when it closes. */
export function NotePane({ path, autosave, showPages, showCode = false, onMistakes, reveal, goTo, onEdited, onMissingPart, onExportPdf }: Props) {
  const [problems, setProblems] = useState<api.Problem[]>([]);
  const [state, setState] = useState<State>({ status: "loading" });
  // The text as typed so far, for the pages (the editor itself keeps its own copy).
  const [text, setText] = useState("");
  const view = useRef<EditorView | null>(null);
  const format = noteFormat(path) ?? "typst";
  // Scrolling the editor and the pages together.
  const editorScroller = useRef<HTMLDivElement>(null);
  const [pagesScroller, setPagesScroller] = useState<HTMLElement | null>(null);
  const [drawn, setDrawn] = useState<{ pages: api.PagePicture[]; places: api.PagePlace[] }>({ pages: [], places: [] });
  // The line between the note and its pages: dragged (or the arrow keys) to share the width.
  const split = useRef<HTMLDivElement>(null);
  const [share, setShare] = useState(rememberedShare);
  const changeShare = (next: number) => {
    const shared = clampShare(next);
    setShare(shared);
    try {
      localStorage.setItem(SHARE_KEY, String(shared));
    } catch {
      // (Not remembered, then.)
    }
  };
  const startResizing = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const width = split.current?.getBoundingClientRect().width || 1;
    const from = { x: event.clientX, share };
    const onMove = (move: PointerEvent) => changeShare(from.share + (move.clientX - from.x) / width);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing-column");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add("resizing-column");
  };
  const [syncing, setSyncing] = useState(rememberedSyncing);
  const changeSyncing = (on: boolean) => {
    setSyncing(on);
    try {
      localStorage.setItem(SYNC_KEY, on ? "on" : "off");
    } catch {
      // (Not remembered, then.)
    }
  };
  useScrollSync({
    on: syncing && showPages && format === "typst",
    view,
    editorScroller,
    pagesScroller,
    pages: drawn.pages,
    places: drawn.places,
  });

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

  // A search match: selected, in view, with the cursor in the note. (On the next frame: the
  // editor may have just been made again, as React does while developing.)
  useEffect(() => {
    if (!reveal || state.status !== "ready") return;
    const frame = requestAnimationFrame(() => {
      const editor = view.current;
      if (!editor) return;
      const { doc } = editor.state;
      const line = doc.line(Math.min(Math.max(reveal.line, 1), doc.lines));
      const from = Math.min(line.from + reveal.column, line.to);
      editor.dispatch({
        selection: { anchor: from, head: Math.min(from + reveal.length, line.to) },
        effects: EditorView.scrollIntoView(from, { y: "center" }),
      });
      editor.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [reveal, state.status]);

  // A link to a part of the note: it's shown, highlighted for a moment.
  const onMissingRef = useRef(onMissingPart);
  onMissingRef.current = onMissingPart;
  useEffect(() => {
    if (!goTo || state.status !== "ready") return;
    const frame = requestAnimationFrame(() => {
      const editor = view.current;
      if (!editor) return;
      // A match found by the workspace's search: found here too.
      if (goTo.find) openFind(editor, { query: goTo.find.query, nth: goTo.find.nth });
      if (goTo.part && !goToPart(editor, format, goTo.part)) onMissingRef.current?.(path, goTo.part);
    });
    return () => cancelAnimationFrame(frame);
  }, [goTo, state.status, format, path]);

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
    <div ref={split} className="flex h-full">
      <div
        ref={editorScroller}
        style={showPages ? { flexGrow: share, flexShrink: 1, flexBasis: 0 } : undefined}
        className={`note-column relative h-full min-w-0 overflow-auto ${showPages ? "" : "flex-1"}`}
      >
        {problems.length > 0 && <ProblemsButton problems={problems} view={view} />}
        {/* Code is wider than reading text: wider than the note, not the whole pane. */}
        <div className={`mx-auto ${showCode && format === "typst" ? "max-w-[60rem] px-8" : "max-w-[44rem] px-12"} pt-10 pb-[40vh]`}>
          <NoteEditor
            // (Made again to switch between the formatted and code views, from the text as it is now.)
            key={showCode && format === "typst" ? "code" : "formatted"}
            code={showCode && format === "typst"}
            name={path.split("/").pop()!}
            historyKey={path}
            format={format}
            initialText={text}
            viewRef={view}
            onProblems={(found) => {
              setProblems(found);
              onMistakes?.(path, found.some((p) => p.severity === "error"));
            }}
            onChange={(changed) => {
              autosave.change(path, changed);
              setText(changed);
              onEdited?.(path);
            }}
          />
        </div>
      </div>
      {showPages && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the note and its pages"
          aria-valuenow={Math.round(share * 100)}
          aria-valuemin={SHARE.least * 100}
          aria-valuemax={SHARE.most * 100}
          tabIndex={0}
          onPointerDown={startResizing}
          onDoubleClick={() => changeShare(SHARE.start)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            changeShare(share + (event.key === "ArrowRight" ? SHARE.step : -SHARE.step));
          }}
          className="group/divider relative z-10 w-px shrink-0 cursor-col-resize bg-neutral-200 outline-none focus-visible:bg-sky-400"
        >
          {/* A wider area to grab than the hairline. */}
          <span className="absolute inset-y-0 -right-1 -left-1 group-hover/divider:bg-neutral-300/40" />
        </div>
      )}
      {showPages && (
        <div style={{ flexGrow: 1 - share, flexShrink: 1, flexBasis: 0 }} className="h-full min-w-0">
          {format === "typst" ? <PagesPane
              text={text}
              path={path}
              onJump={jumpTo}
              onChangeText={replaceText}
              onExport={onExportPdf}
              onDrawn={(pages, places) => setDrawn({ pages, places })}
              scrollerRef={setPagesScroller}
              syncing={syncing}
              onSyncing={changeSyncing}
            /> : <NoPages />}
        </div>
      )}
    </div>
  );
}

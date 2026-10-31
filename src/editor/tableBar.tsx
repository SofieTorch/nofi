// The table bar: with the cursor in a table (shown as code then), a bar above it adds and removes
// rows and columns, turns the header row on and off, and sets a caption. The backend does the
// changes (src-tauri/src/tables.rs), and checks they keep the table valid.

import {
  mdiClosedCaptionOutline,
  mdiPageLayoutHeader,
  mdiTableColumnPlusAfter,
  mdiTableColumnRemove,
  mdiTableRowPlusAfter,
  mdiTableRowRemove,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { type EditorState, StateField } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import * as api from "../api";
import { findDrawnBlocks } from "./drawnBlocks";

type Props = { view: EditorView; block: string; from: number; cursor: number };

function TableBar({ view, block, from, cursor }: Props) {
  const [info, setInfo] = useState<api.TableInfo | null>(null);
  const [problem, setProblem] = useState<string>();
  const [captioning, setCaptioning] = useState(false);

  useEffect(() => {
    let current = true;
    api.tableInfo(block, cursor).then(
      (read) => current && setInfo(read),
      (reason) => current && setProblem(String(reason)),
    );
    return () => {
      current = false;
    };
  }, [block, cursor]);

  async function change(action: api.TableAction) {
    try {
      const edited = await api.editTable(block, cursor, action);
      view.dispatch({
        changes: { from, to: from + block.length, insert: edited.block },
        selection: { anchor: from + edited.cursor },
        userEvent: "input.table",
      });
      view.focus();
    } catch (reason) {
      setProblem(String(reason));
    }
  }

  if (!info) {
    return (
      <div role="toolbar" aria-label="Table" className="cm-table-bar">
        {problem && <span className="cm-table-bar-note">{problem}</span>}
      </div>
    );
  }

  const button = (label: string, icon: string, onClick: () => void, extra: { pressed?: boolean; disabled?: boolean } = {}) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={extra.pressed}
      data-pressed={extra.pressed}
      disabled={extra.disabled}
      onClick={onClick}
    >
      <Icon path={icon} size="16px" />
    </button>
  );

  return (
    <div
      role="toolbar"
      aria-label="Table"
      className="cm-table-bar"
      onMouseDown={(event) => {
        if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
      }}
    >
      <div className="cm-format-buttons">
        {button("Add row below", mdiTableRowPlusAfter, () => change({ action: "addRowBelow" }))}
        {button("Add column right", mdiTableColumnPlusAfter, () => change({ action: "addColumnRight" }))}
        {button("Delete row", mdiTableRowRemove, () => change({ action: "deleteRow" }), { disabled: info.rows <= 1 })}
        {button("Delete column", mdiTableColumnRemove, () => change({ action: "deleteColumn" }), {
          disabled: info.columns <= 1,
        })}
        <span className="cm-format-separator" />
        {button("Header row", mdiPageLayoutHeader, () => change({ action: "toggleHeader" }), { pressed: info.header })}
        {button("Caption", mdiClosedCaptionOutline, () => setCaptioning(!captioning), { pressed: !!info.caption })}
      </div>
      {problem && <p className="cm-table-bar-note">{problem}</p>}
      {captioning && (
        <CaptionField
          current={info.caption}
          onSave={(caption) => change({ action: "setCaption", value: caption })}
          onRemove={() => change({ action: "setCaption", value: null })}
          onCancel={() => {
            setCaptioning(false);
            view.focus();
          }}
        />
      )}
    </div>
  );
}

function CaptionField({
  current,
  onSave,
  onRemove,
  onCancel,
}: {
  current: string | null;
  onSave: (caption: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [caption, setCaption] = useState(current ?? "");
  return (
    <div className="cm-format-panel cm-link-panel">
      <input
        aria-label="Caption"
        autoFocus
        placeholder="A caption makes it a numbered figure"
        value={caption}
        onChange={(event) => setCaption(event.target.value)}
        onKeyDown={(event) => {
          // Keys typed here are for this field, not for the note under it.
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            if (caption.trim()) onSave(caption.trim());
          }
          if (event.key === "Escape") onCancel();
        }}
      />
      {current && (
        <button type="button" onClick={onRemove}>
          Remove caption
        </button>
      )}
    </div>
  );
}

/** The table the cursor is in (a table, or a figure with one), if any. */
function tableAt(state: EditorState) {
  const { from, to, head } = state.selection.main;
  if (from !== to) return null;
  const text = state.doc.toString();
  return (
    findDrawnBlocks(text).find(
      (block) =>
        head > block.from &&
        head <= block.to &&
        (block.kind === "table" || text.slice(block.from, block.to).includes("table(")),
    ) ?? null
  );
}

function barFor(state: EditorState): Tooltip | null {
  const table = tableAt(state);
  if (!table) return null;
  const block = state.sliceDoc(table.from, table.to);
  const cursor = state.selection.main.head - table.from;
  return {
    pos: table.from,
    above: true,
    arrow: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "cm-format-tooltip";
      const root = createRoot(dom);
      // Drawn right away, so the editor knows its size and places it above the table.
      flushSync(() => root.render(<TableBar view={view} block={block} from={table.from} cursor={cursor} />));
      return { dom, destroy: () => setTimeout(() => root.unmount()) };
    },
  };
}

export function tableBar() {
  const field = StateField.define<Tooltip | null>({
    create: barFor,
    update: (bar, transaction) => (transaction.docChanged || transaction.selection ? barFor(transaction.state) : bar),
    provide: (f) => showTooltip.from(f),
  });
  return [field, theme];
}

const theme = EditorView.theme({
  ".cm-table-bar": { position: "relative", transform: "translateY(-6px)", fontSize: "13px" },
  ".cm-table-bar-note": {
    display: "block",
    padding: "4px 8px",
    borderRadius: "8px",
    background: "white",
    color: "#737373",
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
  },
});

// The table editor: a table in the writing view shown as a grid of cells to type in, with a bar to
// add and remove rows and columns, switch the header row, and set the caption. The backend reads
// the cells and makes the changes (src-tauri/src/tables.rs), keeping the table valid. Tables it
// can't read are drawn as a picture instead.

import {
  mdiClosedCaptionOutline,
  mdiCodeBraces,
  mdiPageLayoutHeader,
  mdiTableColumnPlusAfter,
  mdiTableColumnRemove,
  mdiTableRowPlusAfter,
  mdiTableRowRemove,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { EditorView, WidgetType } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as api from "../api";
import { blockPictures } from "./mathsPictures";
import { editTableAt } from "./tableEditing";

/** Where a cell is: `row` null for the header. */
type Place = { row: number | null; column: number };

// What each table's cells were read as, so they're only read once per version of the table.
const reads = new Map<string, Promise<api.TableCells | { error: string }>>();
const readCells = (source: string) => {
  if (!reads.has(source)) {
    reads.set(source, api.readTable(source).catch((reason) => ({ error: String(reason) })));
  }
  return reads.get(source)!;
};

/** Forgets what tables were read as (for tests, which each use their own fake backend). */
export function forgetTableReads() {
  reads.clear();
}

type Props = {
  view: EditorView;
  source: string;
  /** Where the table starts in the note now. */
  locate: () => number;
};

function TableGrid({ view, source, locate }: Props) {
  const [cells, setCells] = useState<api.TableCells | null>(null);
  const [focused, setFocused] = useState<Place | null>(null);
  const [addingCaption, setAddingCaption] = useState(false);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const opened = useRef(false);

  useEffect(() => {
    let current = true;
    readCells(source).then((read) => {
      if (!current) return;
      // Not something the grid can edit: it opens as code instead.
      if ("error" in read) editAsCode();
      else setCells(read);
    });
    return () => {
      current = false;
    };
  }, [source]);

  // When it opens, the first cell is ready to type in.
  useEffect(() => {
    if (!cells || opened.current) return;
    opened.current = true;
    moveTo(cells.rows.length > 0 ? { row: 0, column: 0 } : { row: null, column: 0 });
  }, [cells]);

  /** Back to the picture. */
  const close = () => view.dispatch({ effects: editTableAt.of(null) });

  const key = (place: Place) => `${place.row ?? "h"}-${place.column}`;
  const cellAt = (place: Place) =>
    place.row === null ? cells?.header?.[place.column] : cells?.rows[place.row]?.[place.column];

  async function change(action: api.TableAction, at?: Place | null) {
    const target = at ?? focused;
    const cursor = (target && cellAt(target)?.start) ?? 0;
    try {
      const edited = await api.editTable(source, cursor, action);
      const from = locate();
      view.dispatch({
        changes: { from, to: from + source.length, insert: edited.block },
        userEvent: "input.table",
      });
    } catch (reason) {
      console.error(reason);
    }
  }

  function moveTo(place: Place) {
    inputs.current.get(key(place))?.focus();
  }

  function editAsCode() {
    // Where the table is, before focusing the note closes the editor.
    const at = locate();
    view.dispatch({ selection: { anchor: at + 1 }, effects: editTableAt.of(null) });
    view.focus();
  }

  if (!cells) {
    // While the cells are read (a moment), keep showing the picture.
    const picture = blockPictures.drawn(source);
    return picture && "svg" in picture ? (
      <img
        alt=""
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(picture.svg)}`}
        className="cm-table-picture"
      />
    ) : (
      <pre className="cm-drawn-block-waiting">{source}</pre>
    );
  }

  const rows = cells.rows.length;
  const button = (label: string, icon: string, onClick: () => void, extra: { pressed?: boolean; disabled?: boolean } = {}) => (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={extra.pressed}
      data-pressed={extra.pressed}
      disabled={extra.disabled}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      <Icon path={icon} size="15px" />
    </button>
  );

  const field = (place: Place, cell: api.TableCell, label: string) => (
    <CellField
      key={key(place)}
      label={label}
      cell={cell}
      inputRef={(input) => {
        if (input) inputs.current.set(key(place), input);
        else inputs.current.delete(key(place));
      }}
      onFocus={() => setFocused(place)}
      onSave={(text) => change({ action: "setCell", value: { row: place.row, column: place.column, text } }, place)}
      onMove={(step) => {
        const order: Place[] = [
          ...(cells.header ?? []).map((_, column) => ({ row: null, column })),
          ...cells.rows.flatMap((row, r) => row.map((_, column) => ({ row: r, column }))),
        ];
        const index = order.findIndex((p) => key(p) === key(place));
        if (step === "down") {
          const below = { row: place.row === null ? 0 : place.row + 1, column: place.column };
          if (cellAt(below)) moveTo(below);
        } else {
          const next = order[index + (step === "next" ? 1 : -1)];
          if (next) moveTo(next);
        }
      }}
    />
  );

  return (
    <div
      role="group"
      aria-label="Table editor"
      className="cm-table-editor"
      // Leaving the table (clicking in the note, or Escape) shows the picture again.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <div role="toolbar" aria-label="Table" className="cm-table-editor-bar">
        {button("Add row below", mdiTableRowPlusAfter, () => change({ action: "addRowBelow" }))}
        {button("Add column right", mdiTableColumnPlusAfter, () => change({ action: "addColumnRight" }))}
        {button("Delete row", mdiTableRowRemove, () => change({ action: "deleteRow" }), { disabled: rows <= 1 })}
        {button("Delete column", mdiTableColumnRemove, () => change({ action: "deleteColumn" }), {
          disabled: cells.columns <= 1,
        })}
        <span className="cm-format-separator" />
        {button("Header row", mdiPageLayoutHeader, () => change({ action: "toggleHeader" }), { pressed: !!cells.header })}
        {button("Caption", mdiClosedCaptionOutline, () => setAddingCaption(true), { pressed: cells.caption !== null })}
        {button("Edit as code", mdiCodeBraces, editAsCode)}
      </div>
      <table role="grid" aria-label="Table cells">
        {cells.header && (
          <thead>
            <tr>
              {cells.header.map((cell, column) => (
                <th key={column}>{field({ row: null, column }, cell, `Header ${column + 1}`)}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {cells.rows.map((row, r) => (
            <tr key={r}>
              {row.map((cell, column) => (
                <td key={column}>{field({ row: r, column }, cell, `Row ${r + 1}, column ${column + 1}`)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(cells.caption !== null || addingCaption) && (
        <CaptionField
          caption={cells.caption}
          autoFocus={addingCaption}
          onSave={(caption) => {
            setAddingCaption(false);
            change({ action: "setCaption", value: caption });
          }}
        />
      )}
    </div>
  );
}

/** A cell's text, saved on Enter (moving down), Tab (moving on) or leaving; Escape puts it back. */
function CellField({
  label,
  cell,
  inputRef,
  onFocus,
  onSave,
  onMove,
}: {
  label: string;
  cell: api.TableCell;
  inputRef: (input: HTMLInputElement | null) => void;
  onFocus: () => void;
  onSave: (text: string) => void;
  onMove: (step: "next" | "previous" | "down") => void;
}) {
  const [draft, setDraft] = useState(cell.text);
  useEffect(() => setDraft(cell.text), [cell.text]);
  // Set by Escape, so leaving the cell afterwards doesn't save what was typed.
  const cancelled = useRef(false);
  const save = () => {
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    if (draft !== cell.text) onSave(draft);
  };
  return (
    <input
      ref={inputRef}
      aria-label={label}
      value={draft}
      readOnly={!cell.editable}
      title={cell.editable ? undefined : "Written as code: change it with 'Edit as code'"}
      spellCheck={false}
      onFocus={onFocus}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        // Keys typed here are for the table, not for the note around it.
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          save();
          onMove("down");
        } else if (event.key === "Tab") {
          event.preventDefault();
          save();
          onMove(event.shiftKey ? "previous" : "next");
        } else if (event.key === "Escape") {
          cancelled.current = true;
          setDraft(cell.text);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function CaptionField({
  caption,
  autoFocus,
  onSave,
}: {
  caption: string | null;
  autoFocus: boolean;
  onSave: (caption: string | null) => void;
}) {
  const [draft, setDraft] = useState(caption ?? "");
  useEffect(() => setDraft(caption ?? ""), [caption]);
  const save = () => {
    const text = draft.trim() || null;
    if (text !== caption) onSave(text);
  };
  return (
    <input
      aria-label="Caption"
      autoFocus={autoFocus}
      placeholder="Caption (makes it a numbered figure)"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={save}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          save();
        }
      }}
      className="cm-table-caption"
    />
  );
}

const roots = new WeakMap<HTMLElement, Root>();

/** The table editor, in place of a table's code in the writing view. */
export class TableGridWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: TableGridWidget) {
    return other.source === this.source;
  }

  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = "cm-table-widget";
    const root = createRoot(element);
    roots.set(element, root);
    this.render(root, view, element);
    return element;
  }

  // Keep the same editor (and the cell being typed in) when only the table's text changed.
  updateDOM(element: HTMLElement, view: EditorView) {
    const root = roots.get(element);
    if (!root) return false;
    this.render(root, view, element);
    return true;
  }

  destroy(element: HTMLElement) {
    const root = roots.get(element);
    roots.delete(element);
    setTimeout(() => root?.unmount());
  }

  ignoreEvent() {
    return true;
  }

  private render(root: Root, view: EditorView, element: HTMLElement) {
    root.render(<TableGrid view={view} source={this.source} locate={() => view.posAtDOM(element)} />);
  }
}

export const tableEditorTheme = EditorView.theme({
  ".cm-table-editor": { padding: "0.5em 0", fontSize: "14px" },
  ".cm-table-editor-bar": {
    display: "flex",
    gap: "2px",
    marginBottom: "4px",
    opacity: "0.35",
    transition: "opacity 150ms",
  },
  ".cm-table-editor:hover .cm-table-editor-bar, .cm-table-editor:focus-within .cm-table-editor-bar": { opacity: "1" },
  ".cm-table-editor-bar button": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "26px",
    height: "26px",
    borderRadius: "6px",
    color: "#525252",
  },
  ".cm-table-editor-bar button:hover:not(:disabled)": { background: "#f5f5f5" },
  ".cm-table-editor-bar button[data-pressed=true]": { background: "#e5e5e5", color: "#171717" },
  ".cm-table-editor-bar button:disabled": { color: "#d4d4d4" },
  ".cm-table-editor table": { borderCollapse: "collapse", width: "100%" },
  ".cm-table-editor th, .cm-table-editor td": { border: "1px solid #e5e5e5", padding: "0" },
  ".cm-table-editor th": { background: "#fafafa" },
  ".cm-table-editor input": {
    width: "100%",
    padding: "5px 8px",
    font: "inherit",
    background: "transparent",
    outline: "none",
  },
  ".cm-table-editor th input": { fontWeight: "600" },
  ".cm-table-editor input:focus": { background: "#f0f7ff" },
  ".cm-table-editor input[readonly]": { color: "#a3a3a3", fontFamily: "ui-monospace, Menlo, monospace" },
  "input.cm-table-caption": { marginTop: "4px", textAlign: "center", color: "#525252", fontSize: "13px" },
  ".cm-table-picture": { display: "block", maxWidth: "100%", cursor: "pointer" },
});

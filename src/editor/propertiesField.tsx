// Shows a note's properties block as an editable table at the top of the editor, instead of
// the raw `---` or `#metadata` text. "Edit as text" (or undoing into it) shows the raw block.

import { type EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { createRoot, type Root } from "react-dom/client";
import type { Format } from "./formatting";
import { findPropertiesBlock } from "./properties";
import { PropertiesTable } from "./PropertiesTable";

const roots = new WeakMap<HTMLElement, Root>();

class PropertiesWidget extends WidgetType {
  constructor(
    readonly format: Format,
    /** The block's text, or null when the note has none yet. */
    readonly block: string | null,
  ) {
    super();
  }

  eq(other: PropertiesWidget) {
    return other.format === this.format && other.block === this.block;
  }

  toDOM(view: EditorView) {
    const element = document.createElement("div");
    element.className = "cm-properties-widget";
    const root = createRoot(element);
    roots.set(element, root);
    this.render(root, view);
    return element;
  }

  // Keep the same table (and the field being edited) when only the block's text changed.
  updateDOM(element: HTMLElement, view: EditorView) {
    const root = roots.get(element);
    if (!root) return false;
    this.render(root, view);
    return true;
  }

  destroy(element: HTMLElement) {
    const root = roots.get(element);
    roots.delete(element);
    // React doesn't like being unmounted while it renders; wait a moment.
    setTimeout(() => root?.unmount());
  }

  // The table handles its own clicks and typing; the editor stays out of it.
  ignoreEvent() {
    return true;
  }

  private render(root: Root, view: EditorView) {
    root.render(
      <PropertiesTable
        format={this.format}
        block={this.block}
        onWrite={(block) => writeBlock(view, this.format, block)}
        onEditAsText={() => editAsText(view, this.format)}
      />,
    );
  }
}

/** Puts a new properties block into the note (or removes it, if empty). */
function writeBlock(view: EditorView, format: Format, block: string) {
  const text = view.state.doc.toString();
  const range = findPropertiesBlock(text, format);
  if (range) {
    // Without a block, the newline after it would be left as an empty first line.
    const to = block === "" && text[range.to] === "\n" ? range.to + 1 : range.to;
    view.dispatch({ changes: { from: range.from, to, insert: block } });
  } else if (block !== "") {
    view.dispatch({ changes: { from: 0, insert: `${block}\n` } });
  }
}

/** Shows the block as text by putting the cursor inside it. */
function editAsText(view: EditorView, format: Format) {
  const range = findPropertiesBlock(view.state.doc.toString(), format);
  if (!range) return;
  const firstLineEnd = view.state.doc.lineAt(range.from).to;
  view.dispatch({ selection: { anchor: firstLineEnd } });
  view.focus();
}

function decorate(state: EditorState, format: Format): DecorationSet {
  const range = findPropertiesBlock(state.doc.toString(), format);
  if (!range) {
    const widget = new PropertiesWidget(format, null);
    return Decoration.set([Decoration.widget({ widget, block: true, side: -1 }).range(0)]);
  }
  // A cursor inside the block (after its very start) means it's being edited as text.
  const editing = state.selection.ranges.some((r) => r.head > range.from && r.head <= range.to);
  if (editing) return Decoration.none;
  const widget = new PropertiesWidget(format, state.doc.sliceString(range.from, range.to));
  return Decoration.set([Decoration.replace({ widget, block: true }).range(range.from, range.to)]);
}

export function propertiesField(format: Format) {
  const field = StateField.define<DecorationSet>({
    create: (state) => decorate(state, format),
    update: (decorations, transaction) =>
      transaction.docChanged || transaction.selection ? decorate(transaction.state, format) : decorations,
    provide: (f) => EditorView.decorations.from(f),
  });
  return [field, theme];
}

const theme = EditorView.theme({
  // The table's margins stay inside its widget: the editor measures the widget to know where the
  // lines below it are, and space spilling out of it would put every click on the line underneath.
  ".cm-properties-widget": { display: "flow-root" },
  ".cm-properties": {
    margin: "0 0 1.25em",
    padding: "0.5em 0",
    borderBottom: "0.5px solid #e5e5e5",
    fontSize: "13px",
  },
  ".cm-property": {
    display: "grid",
    gridTemplateColumns: "9rem 1fr auto auto",
    alignItems: "center",
    gap: "0.25rem",
    padding: "0.1rem 0",
  },
  ".cm-property-name, .cm-property-value, .cm-property-type": {
    font: "inherit",
    border: "none",
    background: "transparent",
    borderRadius: "4px",
    padding: "0.15rem 0.35rem",
    outline: "none",
    minWidth: "0",
  },
  ".cm-property-name": { color: "#737373" },
  ".cm-property-value": { color: "#262626" },
  ".cm-property-name:hover, .cm-property-value:hover, .cm-property-name:focus, .cm-property-value:focus":
    { background: "#f5f5f5" },
  ".cm-property-type": { color: "#a3a3a3", fontSize: "12px", opacity: "0" },
  ".cm-property-remove": {
    display: "flex",
    color: "#a3a3a3",
    padding: "0.2rem",
    borderRadius: "4px",
    opacity: "0",
  },
  ".cm-property:hover .cm-property-type, .cm-property:hover .cm-property-remove, .cm-property-type:focus":
    { opacity: "1" },
  ".cm-property-remove:hover": { background: "#f5f5f5", color: "#525252" },
  ".cm-property-raw": {
    fontFamily: "ui-monospace, Menlo, monospace",
    fontSize: "12px",
    color: "#737373",
    whiteSpace: "pre-wrap",
    padding: "0.15rem 0.35rem",
    gridColumn: "2 / 4",
  },
  ".cm-properties-footer": { display: "flex", gap: "0.25rem", marginTop: "0.25rem" },
  ".cm-properties-add": {
    display: "flex",
    alignItems: "center",
    gap: "0.25rem",
    color: "#a3a3a3",
    fontSize: "13px",
    padding: "0.15rem 0.35rem",
    borderRadius: "4px",
  },
  ".cm-properties-add:hover": { background: "#f5f5f5", color: "#525252" },
  // Without properties, the "Add property" button only shows while the note is hovered or edited.
  ".cm-properties-empty": { opacity: "0", transition: "opacity 150ms", marginBottom: "0.5em" },
  "&:hover .cm-properties-empty, &.cm-focused .cm-properties-empty, .cm-properties-empty:focus-within":
    { opacity: "1" },
  ".cm-suggesting": { position: "relative", display: "block", minWidth: "0" },
  ".cm-suggesting > input": { width: "100%" },
  ".cm-suggestions": {
    position: "absolute",
    zIndex: "30",
    top: "calc(100% + 2px)",
    left: "0",
    minWidth: "12rem",
    maxHeight: "14rem",
    overflowY: "auto",
    margin: "0",
    padding: "4px",
    listStyle: "none",
    background: "white",
    borderRadius: "10px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
  },
  ".cm-suggestion": { padding: "3px 8px", borderRadius: "6px", cursor: "default", color: "#404040" },
  ".cm-suggestion[aria-selected=true]": { background: "#f5f5f5", color: "#171717" },
  ".cm-properties-problem": { color: "#dc2626", fontSize: "12px", padding: "0 0.35rem 0.25rem" },
});

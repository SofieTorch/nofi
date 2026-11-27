// The format toolbar: a bubble above selected text with the styles that can be applied to it
// (see FormatToolbar), plus shortcuts like ⌘B and ⌘I.

import { type EditorState, Prec, StateField } from "@codemirror/state";
import { EditorView, keymap, showTooltip, type Tooltip } from "@codemirror/view";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { findFormatting, type Format } from "./formatting";
import { FormatToolbar } from "./FormatToolbar";
import { availableStyles, indent, type Style, toggleStyle } from "./styles";

const SHORTCUTS: Partial<Record<Style, string>> = {
  bold: "Mod-b",
  italic: "Mod-i",
  underline: "Mod-u",
  strikethrough: "Mod-Shift-x",
  highlight: "Mod-Shift-h",
  code: "Mod-e",
  // No shortcut for maths: ⌘M minimises the window on a Mac.
};

/** Whether a selection is all inside code (a code block, or inline code): code has no styles. */
function inCode(state: EditorState, format: Format, from: number, to: number) {
  return findFormatting(state.doc.toString(), format).some(
    (span) => (span.kind === "codeblock" || span.kind === "code") && span.from <= from && to <= span.to,
  );
}

/** Adds or removes a style on the selection. False if there's nothing selected (or it can't). */
function applyStyle(view: EditorView, format: Format, style: Style) {
  const { from, to } = view.state.selection.main;
  if (from === to) return false;
  // (In code, the shortcut does nothing, rather than reaching the browser's own bold or italic.)
  if (inCode(view.state, format, from, to)) return true;
  const edit = toggleStyle(view.state.doc.toString(), format, { from, to }, style);
  if (!edit) return false;
  view.dispatch({
    changes: edit.changes,
    selection: { anchor: edit.selection.from, head: edit.selection.to },
    userEvent: "input.format",
  });
  return true;
}

function toolbarFor(state: EditorState, format: Format): Tooltip | null {
  const { from, to } = state.selection.main;
  if (from === to || inCode(state, format, from, to)) return null;
  return {
    pos: from,
    above: true,
    arrow: false,
    create: (view) => {
      const dom = document.createElement("div");
      dom.className = "cm-format-tooltip";
      const root = createRoot(dom);
      // Drawn right away, so the editor knows its size and places it above the text, not on it.
      flushSync(() =>
        root.render(<FormatToolbar view={view} format={format} text={state.doc.toString()} selection={{ from, to }} />),
      );
      // React doesn't like being unmounted while it renders; wait a moment.
      return { dom, destroy: () => setTimeout(() => root.unmount()) };
    },
  };
}

export function formatToolbar(format: Format) {
  const toolbar = StateField.define<Tooltip | null>({
    create: (state) => toolbarFor(state, format),
    update: (tooltip, transaction) =>
      transaction.docChanged || transaction.selection ? toolbarFor(transaction.state, format) : tooltip,
    provide: (field) => showTooltip.from(field),
  });
  const shortcuts = availableStyles(format)
    .filter((style) => SHORTCUTS[style])
    .map((style) => ({ key: SHORTCUTS[style]!, run: (view: EditorView) => applyStyle(view, format, style) }));
  const indenting = (direction: "in" | "out", onlyLists: boolean) => (view: EditorView) => {
    const { from, to } = view.state.selection.main;
    const text = view.state.doc.toString();
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    // Tab only nests list items; elsewhere it's left alone.
    if (onlyLists && !/^\s*([-+*]|\d+\.) /.test(text.slice(lineStart))) return false;
    const edit = indent(text, format, { from, to }, direction);
    if (!edit) return onlyLists;
    view.dispatch({
      changes: edit.changes,
      selection: { anchor: edit.selection.from, head: edit.selection.to },
      userEvent: "input.indent",
    });
    return true;
  };
  shortcuts.push(
    { key: "Tab", run: indenting("in", true) },
    { key: "Shift-Tab", run: indenting("out", true) },
    { key: "Mod-]", run: indenting("in", false) },
    { key: "Mod-[", run: indenting("out", false) },
  );
  // Highest, so ⌘I italicises a selection; without one, it falls through to "show suggestions".
  return [toolbar, Prec.highest(keymap.of(shortcuts)), theme];
}

const theme = EditorView.theme({
  ".cm-tooltip.cm-format-tooltip": { border: "none", background: "transparent" },
  ".cm-format-toolbar": { position: "relative", transform: "translateY(-6px)", fontSize: "13px" },
  ".cm-format-buttons": {
    display: "flex",
    alignItems: "center",
    gap: "2px",
    padding: "3px",
    borderRadius: "10px",
    background: "white",
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
  },
  ".cm-format-buttons button": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderRadius: "6px",
    color: "#525252",
  },
  ".cm-format-buttons button:hover:not(:disabled)": { background: "#f5f5f5", color: "#171717" },
  ".cm-format-buttons button[data-pressed=true]": { background: "#e5e5e5", color: "#171717" },
  ".cm-format-buttons button:disabled": { color: "#d4d4d4" },
  ".cm-format-separator": { width: "1px", height: "18px", background: "#e5e5e5", margin: "0 3px" },
  ".cm-format-panel": {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: "0",
    zIndex: "40",
    padding: "6px",
    borderRadius: "10px",
    background: "white",
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
  },
  ".cm-format-menu": { display: "flex", flexDirection: "column", minWidth: "10rem" },
  ".cm-format-menu button": { textAlign: "left", padding: "4px 8px", borderRadius: "6px", color: "#404040" },
  ".cm-format-menu button:hover:not(:disabled)": { background: "#f5f5f5" },
  ".cm-format-menu button[aria-checked=true]": { fontWeight: "600" },
  ".cm-format-menu button:disabled": { color: "#d4d4d4" },
  ".cm-palette": { display: "flex", flexDirection: "column", gap: "4px", padding: "2px" },
  ".cm-palette + .cm-palette": { marginTop: "6px" },
  ".cm-palette-name": { fontSize: "11px", color: "#a3a3a3", textTransform: "uppercase", letterSpacing: "0.04em" },
  ".cm-palette-swatches": { display: "flex", gap: "4px" },
  ".cm-swatch": {
    width: "24px",
    height: "24px",
    borderRadius: "6px",
    border: "1px solid #e5e5e5",
    fontWeight: "600",
    fontSize: "13px",
  },
  ".cm-swatch[aria-pressed=true]": { outline: "2px solid #a3a3a3", outlineOffset: "1px" },
  ".cm-link-panel": { display: "flex", gap: "6px", alignItems: "center" },
  // Wider than the icon buttons: it says what kind of block the text is.
  ".cm-format-buttons button.cm-turn-into": {
    width: "auto",
    gap: "2px",
    padding: "0 4px 0 8px",
    color: "#404040",
    whiteSpace: "nowrap",
  },
  ".cm-format-row": { display: "flex", alignItems: "center", gap: "2px" },
  ".cm-format-row button": {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "28px",
    height: "28px",
    borderRadius: "6px",
    color: "#525252",
  },
  ".cm-format-row button:hover:not(:disabled)": { background: "#f5f5f5" },
  ".cm-format-row button[data-pressed=true]": { background: "#e5e5e5", color: "#171717" },
  ".cm-format-row button:disabled": { color: "#d4d4d4" },
  ".cm-text-panel": { display: "flex", flexDirection: "column", gap: "6px" },
  ".cm-sizes": { display: "flex", gap: "2px" },
  ".cm-sizes button": { padding: "3px 8px", borderRadius: "6px", color: "#404040", fontSize: "12px" },
  ".cm-sizes button:hover": { background: "#f5f5f5" },
  ".cm-sizes button[aria-pressed=true]": { background: "#e5e5e5", color: "#171717" },
  ".cm-font-picker": { padding: "4px 6px", borderRadius: "6px", background: "#f5f5f5", font: "inherit", fontSize: "12px" },
  ".cm-link-panel input": {
    width: "16rem",
    padding: "4px 8px",
    borderRadius: "6px",
    background: "#f5f5f5",
    outline: "none",
    font: "inherit",
  },
  ".cm-link-panel button": { fontSize: "12px", color: "#b91c1c", padding: "4px 6px", borderRadius: "6px" },
});

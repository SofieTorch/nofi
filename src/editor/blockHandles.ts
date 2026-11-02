// Moving blocks around, like in Notion. Hovering a block shows a handle (⋮⋮) in the margin;
// dragging it moves the block, with a line showing where it'll go; clicking it selects the block.
// ⌘⇧↑ / ⌘⇧↓ move the block the cursor is in. The note's editor and each column's editor have
// handles, and blocks can move between them: every editor's text is a part of the note's, so a
// move is always one change to the note (one Undo takes it back). Right-clicking a heading's,
// paragraph's or list item's handle offers "Copy link", for a link to it.

import { Prec } from "@codemirror/state";
import { BlockType, EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { type Block, type Drop, findBlocks, insertionOf, removalOf, staysPut } from "./blocks";
import { findColumns } from "./columns";
import type { Format } from "./formatting";
import { foldedSections, foldsAfterMove } from "./headingFolds";
import { copyLinkTo } from "./noteLinks";
import { itemStyle } from "../ui/Menu";

/** Where an editor's text is in the note. The note's own editor is the note. */
type Place = {
  format: Format;
  note: EditorView;
  /** Where its text starts in the note (null if it isn't written there yet). */
  offset: () => number | null;
  /** For a column: where its columns start in the note. */
  columnsAt?: () => number | null;
};

const places = new WeakMap<EditorView, Place>();
const formats = new WeakMap<EditorView, Format>();

/** A column's editor says where its text is in the note. */
export function registerColumn(view: EditorView, place: Omit<Place, "format">) {
  places.set(view, { format: "typst", ...place });
}

const placeOf = (view: EditorView): Place =>
  places.get(view) ?? { format: formats.get(view) ?? "typst", note: view, offset: () => 0 };

/** The blocks of an editor's text; a collapsed heading is one block with what it hides. */
function blocksOf(view: EditorView) {
  const blocks = findBlocks(view.state.doc.toString(), placeOf(view).format);
  for (const section of foldedSections(view.state)) {
    const heading = blocks.find((b) => b.from === section.from);
    const inside = blocks.filter((b) => b.from > section.from && b.from <= section.to);
    if (!heading || !inside.length) continue;
    heading.to = Math.max(...inside.map((b) => b.to));
    blocks.splice(blocks.indexOf(inside[0]), inside.length);
  }
  return blocks;
}

/** The block at a position or, on an empty line (a new, empty paragraph), that line. */
function blockAt(view: EditorView, pos: number): Block | undefined {
  const block = blocksOf(view).find((b) => b.from <= pos && pos <= b.to);
  if (block) return block;
  const line = view.state.doc.lineAt(pos);
  return line.text.trim() === "" ? { from: line.from, to: line.to, kind: "paragraph" } : undefined;
}

export function makeIcon(path: string, size = 16) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");
  shape.setAttribute("d", path);
  shape.setAttribute("fill", "currentColor");
  svg.append(shape);
  return svg;
}

function coordsOf(view: EditorView, pos: number) {
  try {
    return view.coordsAtPos(pos);
  } catch {
    return null;
  }
}

/** The element directly in the editor's text that holds `target` (a line, or a block shown as a picture). */
function lineElementOf(view: EditorView, target: Element | null) {
  let element = target;
  while (element && element.parentElement !== view.contentDOM) element = element.parentElement;
  return element as HTMLElement | null;
}

// --- Moving -------------------------------------------------------------------------------------

/**
 * Where a dragged block would land: at a place between blocks (`drop`; null into an empty column),
 * or beside a block, making columns (or, beside a column, a new column next to it).
 */
type Target = { view: EditorView; drop: Drop | null; beside?: { block: Block; side: "left" | "right" } };

/**
 * Moves a block from one editor to a place in another (or the same): one change to the note.
 * Returns where the block starts in the note afterwards.
 */
function move(source: EditorView, block: Block, target: Target): number | null {
  if (target.beside) return moveBeside(source, block, target.view, target.beside);
  const from = placeOf(source);
  const to = placeOf(target.view);
  const note = from.note;
  const fromOffset = from.offset();
  const toOffset = to.offset();
  if (fromOffset === null || toOffset === null || to.note !== note) return null;

  const sourceText = source.state.doc.toString();
  const targetText = target.view.state.doc.toString();
  const same = source === target.view;
  const sourceBlocks = blocksOf(source);
  const movedText = sourceText.slice(block.from, block.to);
  const removal = removalOf(sourceText, block, sourceBlocks);
  const insertion = target.drop
    ? insertionOf(targetText, blocksOf(target.view), block, movedText, target.drop, same ? block : undefined)
    : // Into an empty column.
      { at: targetText.length, insert: movedText, start: 0 };
  const removeFrom = removal.from + fromOffset;
  const removeTo = removal.to + fromOffset;
  const at = insertion.at + toOffset;
  if (at > removeFrom && at < removeTo) return null;

  // The note's cursor goes to where the block was, so Undo brings the note back there.
  const before = from.columnsAt ? from.columnsAt() : block.from;
  if (before !== null) note.dispatch({ selection: { anchor: before } });

  const changes = note.state.changes([
    { from: removeFrom, to: removeTo, insert: removal.insert },
    { from: at, insert: insertion.insert },
  ]);
  const start = changes.mapPos(at, -1) + insertion.start;
  // In the note, the cursor goes to the block; in columns, the note's stays at the columns.
  const columnsAt = to.columnsAt?.();
  const anchor = columnsAt != null ? changes.mapPos(columnsAt, -1) : start;
  // (Collapsed headings go with the block, within the same editor.)
  const effects = same && source === note ? foldsAfterMove(note.state, block, changes, start) : [];
  note.dispatch({ changes, selection: { anchor }, effects, userEvent: "move.block" });
  return start;
}

/**
 * Moves a block beside another: the two become columns, side by side. Beside a column, it becomes
 * a new column next to that one. One change to the note.
 */
function moveBeside(source: EditorView, block: Block, view: EditorView, beside: NonNullable<Target["beside"]>) {
  const from = placeOf(source);
  const to = placeOf(view);
  const note = from.note;
  const fromOffset = from.offset();
  const toOffset = to.offset();
  if (fromOffset === null || toOffset === null || to.note !== note) return null;
  const sourceText = source.state.doc.toString();
  const movedText = sourceText.slice(block.from, block.to);
  const removal = removalOf(sourceText, block, blocksOf(source));
  const edits = [{ from: removal.from + fromOffset, to: removal.to + fromOffset, insert: removal.insert }];
  let anchor: number;

  const columnsAt = to.columnsAt?.();
  if (columnsAt != null) {
    // Beside a column: a new column, before or after it.
    const columns = findColumns(note.state.doc.toString()).find((c) => c.from === columnsAt);
    const pane = columns?.panes.find((p) => p?.from === toOffset);
    if (!columns || !pane) return null;
    const count = Math.max(columns.count, columns.breaks.length + 2);
    edits.push({ from: columns.countAt.from, to: columns.countAt.to, insert: String(count) });
    edits.push(
      beside.side === "right"
        ? { from: pane.to, to: pane.to, insert: `\n#colbreak()\n${movedText}` }
        : { from: pane.from, to: pane.from, insert: `${movedText}\n#colbreak()\n` },
    );
    anchor = columns.from;
  } else {
    // Beside a block in the note: the two become two columns.
    const target = beside.block;
    const targetText = view.state.sliceDoc(target.from, target.to);
    const [left, right] = beside.side === "right" ? [targetText, movedText] : [movedText, targetText];
    edits.push({ from: target.from + toOffset, to: target.to + toOffset, insert: `#columns(2)[\n${left}\n#colbreak()\n${right}\n]` });
    anchor = target.from + toOffset;
  }
  const [removed, ...rest] = edits;
  if (rest.some((edit) => edit.from < removed.to && removed.from < edit.to)) return null;

  const before = from.columnsAt ? from.columnsAt() : block.from;
  if (before !== null) note.dispatch({ selection: { anchor: before } });
  const changes = note.state.changes(edits);
  note.dispatch({ changes, selection: { anchor: changes.mapPos(anchor, -1) }, userEvent: "move.block" });
  return changes.mapPos(anchor, -1);
}

/** Whether the mouse is near the left or right edge of an editor's text (to drop beside). */
function besideZone(view: EditorView, x: number): "left" | "right" | null {
  const content = view.contentDOM.getBoundingClientRect();
  if (content.width < 100) return null;
  const edge = Math.min(48, content.width * 0.15);
  if (x <= content.left + Math.min(24, edge)) return "left";
  if (x >= content.right - edge) return "right";
  return null;
}

// --- The drop line, and dragging ----------------------------------------------------------------

let dropLine: HTMLElement | null = null;

function showDropLine(target: Target | null) {
  if (!target) {
    dropLine?.remove();
    dropLine = null;
    return;
  }
  const { view, drop } = target;
  dropLine ??= Object.assign(document.createElement("div"), { className: "cm-drop-line" });
  if (dropLine.parentElement !== view.dom) view.dom.append(dropLine);
  const box = view.dom.getBoundingClientRect();
  const content = view.contentDOM.getBoundingClientRect();
  dropLine.classList.toggle("cm-drop-line-beside", !!target.beside);
  if (target.beside) {
    // Along the edge of the block (or of the whole column).
    const inColumn = placeOf(view).columnsAt?.() != null;
    const top = inColumn ? content.top : (coordsOf(view, target.beside.block.from)?.top ?? content.top);
    const bottom = inColumn ? content.bottom : (coordsOf(view, target.beside.block.to)?.bottom ?? top + view.defaultLineHeight);
    const x = target.beside.side === "right" ? content.right + 3 : content.left - 5;
    dropLine.style.top = `${top - box.top}px`;
    dropLine.style.left = `${x - box.left}px`;
    dropLine.style.width = "";
    dropLine.style.height = `${Math.max(bottom - top, view.defaultLineHeight)}px`;
    return;
  }
  dropLine.style.height = "";
  let y = content.top;
  if (drop) {
    const coords = drop.side === "before" ? coordsOf(view, drop.block.from) : coordsOf(view, drop.block.to);
    if (coords) y = drop.side === "before" ? coords.top : coords.bottom;
  }
  dropLine.style.top = `${y - box.top - 1}px`;
  dropLine.style.left = `${content.left - box.left}px`;
  dropLine.style.width = `${content.width}px`;
}

/** Where a block would land with the mouse over `element`, or null if nowhere (or where it is). */
function targetAt(element: EventTarget | null, x: number, y: number, source: EditorView, block: Block): Target | null {
  if (!(element instanceof Element)) return null;
  // In the margin beside the note's text: what's in the text level with the mouse.
  if (!element.closest(".cm-content")) {
    const note = placeOf(source).note;
    const box = note.dom.getBoundingClientRect();
    const content = note.contentDOM.getBoundingClientRect();
    const inMargin = y >= box.top && y <= box.bottom && x < content.left && x >= content.left - MARGIN;
    const inText = inMargin ? document.elementFromPoint?.(content.left + 2, y) : null;
    // (As if in the middle of the text: not near its left edge, which would drop it beside.)
    return inText?.closest(".cm-content") ? targetAt(inText, content.left + content.width / 2, y, source, block) : null;
  }
  const editor = element.closest<HTMLElement>(".cm-editor");
  if (!editor) return null;
  const view = EditorView.findFromDOM(editor);
  if (!view || placeOf(view).note !== placeOf(source).note) return null;
  // Not into the columns being moved.
  if (view !== source && block.kind === "columns" && placeOf(view).columnsAt?.() === block.from) return null;

  const blocks = blocksOf(view);
  if (blocks.length === 0) return view.state.doc.length === 0 ? { view, drop: null } : null;
  const line = lineElementOf(view, element);
  if (!line) return null;
  const pos = view.posAtDOM(line);
  let target = blocks.find((b) => b.from <= pos && pos <= b.to);
  // Near a block's left or right edge: beside it.
  const zone = target ? besideZone(view, x) : null;
  if (target && zone) {
    const inColumn = placeOf(view).columnsAt?.() != null;
    const overlapsSource = view === source && target.from < block.to && block.from < target.to;
    // (Beside its own column, a column's only block would leave it empty.)
    const ownOnlyBlock = inColumn && view === source && blocks.length === 1;
    if (!overlapsSource && !ownOnlyBlock && (inColumn || (target.kind !== "columns" && block.kind !== "columns"))) {
      return { view, drop: null, beside: { block: target, side: zone } };
    }
  }
  let side: Drop["side"];
  if (target) {
    const top = coordsOf(view, target.from)?.top ?? 0;
    const bottom = coordsOf(view, target.to)?.bottom ?? 0;
    side = y < (top + bottom) / 2 ? "before" : "after";
  } else {
    // Between blocks (on a blank line): before the next one, or after the last.
    target = blocks.find((b) => b.from > pos);
    side = target ? "before" : "after";
    target ??= blocks[blocks.length - 1];
  }
  const drop = { block: target, side };
  if (view === source && staysPut(blocks, block, drop)) return null;
  if (view === source && target.from < block.to && block.from < target.to) return null;
  return { view, drop };
}

/** Starts dragging a block by its handle: moving it on release, or selecting it if it wasn't moved. */
export function startDrag(source: EditorView, block: Block, start: MouseEvent, handle: HTMLElement) {
  start.preventDefault();
  let dragged = false;
  let target: Target | null = null;
  document.body.classList.add("cm-dragging-block");

  const onMove = (event: MouseEvent) => {
    if (!dragged && event.target === handle && Math.abs(event.clientY - start.clientY) < 3) return;
    dragged = true;
    target = targetAt(event.target, event.clientX, event.clientY, source, block);
    showDropLine(target);
  };
  const stop = () => {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("mouseup", onUp, true);
    document.removeEventListener("keydown", onKey, true);
    document.body.classList.remove("cm-dragging-block");
    showDropLine(null);
  };
  const onUp = () => {
    stop();
    if (!dragged) {
      // A click: the block is selected (not for columns, which would show as code).
      if (block.kind === "columns") return;
      source.focus();
      source.dispatch({ selection: { anchor: block.from, head: block.to } });
    } else if (target) {
      move(source, block, target);
      // Writing goes on where the block landed (and Undo knows it's about the note).
      target.view.focus();
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    target = null;
    dragged = true;
    stop();
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("mouseup", onUp, true);
  document.addEventListener("keydown", onKey, true);
}

// --- The handle ---------------------------------------------------------------------------------

/** How wide the note's margin is, where the handle shows (and where it can be dragged). */
const MARGIN = 56;

/** Six dots in two columns, a little apart. */
export function gripIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 14 14");
  svg.setAttribute("width", "14");
  svg.setAttribute("height", "14");
  for (const cx of [4, 10]) {
    for (const cy of [2.5, 7, 11.5]) {
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("cx", String(cx));
      dot.setAttribute("cy", String(cy));
      dot.setAttribute("r", "1.3");
      dot.setAttribute("fill", "currentColor");
      svg.append(dot);
    }
  }
  return svg;
}

/**
 * How far down the page the middle of a block's first row is: of the first thing shown for it
 * (a line, or a picture like a table's), skipping hidden lines like a code block's fences.
 */
function firstRowMiddle(view: EditorView, block: Block) {
  let first: HTMLElement | null = null;
  for (const child of view.contentDOM.children) {
    // (The properties above the text aren't a block, even when empty, showing "Add property".)
    if (!(child instanceof HTMLElement) || child.matches(".cm-properties-widget") || child.querySelector(".cm-properties")) continue;
    const pos = view.posAtDOM(child);
    if (pos > block.to) break;
    if (pos >= block.from && child.getBoundingClientRect().height > 0) {
      first = child;
      break;
    }
  }
  if (!first) return view.contentDOM.getBoundingClientRect().top;
  const box = first.getBoundingClientRect();
  if (!first.classList.contains("cm-line")) return box.top + Math.min(12, box.height / 2);
  const style = getComputedStyle(first);
  const row = Number.parseFloat(style.lineHeight) || view.defaultLineHeight;
  return box.top + (Number.parseFloat(style.paddingTop) || 0) + row / 2;
}

/** Whether blocks show their handle (a setting, for every editor). */
let handlesShown = true;

/** Settings › Block handles: shows or hides the handles in every editor. */
export function showBlockHandles(shown: boolean) {
  handlesShown = shown;
}

class Handles {
  handle: HTMLElement;
  block: Block | null = null;
  private hiding: ReturnType<typeof setTimeout> | null = null;

  constructor(readonly view: EditorView) {
    const handle = document.createElement("div");
    handle.className = "cm-block-handle";
    handle.setAttribute("role", "button");
    handle.setAttribute("aria-label", "Drag to move");
    handle.title = "Drag to move · Click to select";
    handle.append(gripIcon());
    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || !this.block) return;
      event.stopPropagation();
      startDrag(view, this.block, event, handle);
    });
    // The handle is in the margin, outside the text. The mouse anywhere in the margin beside a
    // block shows that block's handle; away from the text and its margin, it hides after a moment.
    handle.addEventListener("contextmenu", (event) => {
      const block = this.block;
      if (!block || (block.kind !== "heading" && block.kind !== "paragraph" && block.kind !== "list")) return;
      event.preventDefault();
      const place = placeOf(view);
      const offset = place.offset();
      if (offset === null) return;
      const part = { from: block.from + offset, to: block.to + offset, kind: block.kind };
      showMenu(event.clientX, event.clientY, [{ label: "Copy link", run: () => copyLinkTo(place.note, place.format, part) }]);
    });
    handle.addEventListener("mouseenter", () => this.keep());
    handle.addEventListener("mouseleave", () => this.hideSoon());
    document.addEventListener("mousemove", this.onMouseMove, true);
    view.dom.append(handle);
    this.handle = handle;
  }

  private onMouseMove = (event: MouseEvent) => {
    if (document.body.classList.contains("cm-dragging-block")) return;
    const view = this.view;
    const target = event.target instanceof Element ? event.target : null;
    if (target && this.handle.contains(target)) return this.keep();
    // On the text itself (or a column's, inside it): the line under the mouse.
    if (target && view.dom.contains(target) && target.closest(".cm-content")) return this.showFor(target);
    const box = view.dom.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    // The margin to the left of the text: wide in the note, the gap beside a column.
    const margin = placeOf(view).columnsAt ? 28 : MARGIN;
    const beside =
      event.clientY >= box.top &&
      event.clientY <= box.bottom &&
      event.clientX >= content.left - margin &&
      event.clientX < content.left;
    if (!beside) return this.hideSoon();
    this.keep();
    // Level with something shown above or below a line (like the properties): no block.
    const row = view.lineBlockAtHeight(event.clientY - view.documentTop);
    if (row.type === BlockType.WidgetBefore || row.type === BlockType.WidgetAfter) return this.hide();
    const pos = view.posAtCoords({ x: content.left + 1, y: event.clientY });
    if (pos === null) return this.hideSoon();
    const block = blockAt(view, pos);
    if (!block || block.kind === "columns") return this.hide();
    this.place(block);
  };

  private keep() {
    if (this.hiding) clearTimeout(this.hiding);
    this.hiding = null;
  }

  private hideSoon() {
    this.keep();
    this.hiding = setTimeout(() => this.hide(), 300);
  }

  update(update: ViewUpdate) {
    // The text moved under it: shown again when the mouse moves.
    if (update.docChanged || update.geometryChanged) this.hide();
  }

  showFor(target: Element | null) {
    const view = this.view;
    this.keep();
    // Over a column's editor: that one shows its own handle.
    if (target?.closest(".cm-editor") !== view.dom) return this.hide();
    const line = lineElementOf(view, target);
    if (!line) return;
    // The properties at the top aren't a block.
    if (line.querySelector(".cm-properties") || line.classList.contains("cm-properties")) return this.hide();
    const pos = view.posAtDOM(line);
    const block = blockAt(view, pos);
    // Columns have their grip in their own bar.
    if (!block || block.kind === "columns") return this.hide();
    this.place(block);
  }

  /** Shows the handle beside a block's first row. */
  private place(block: Block) {
    if (!handlesShown) return this.hide();
    const view = this.view;
    this.block = block;
    const box = view.dom.getBoundingClientRect();
    const content = view.contentDOM.getBoundingClientRect();
    this.handle.style.top = `${firstRowMiddle(view, block) - box.top - 11}px`;
    // A little apart from the text (its hover area still reaches it, so there's no gap to cross).
    const apart = placeOf(view).columnsAt ? 4 : 8;
    this.handle.style.left = `${content.left - box.left - 22 - apart}px`;
    this.handle.style.setProperty("--apart", `${apart}px`);
    this.handle.classList.add("cm-block-handle-shown");
  }

  hide() {
    this.handle.classList.remove("cm-block-handle-shown");
  }

  destroy() {
    this.keep();
    document.removeEventListener("mousemove", this.onMouseMove, true);
    this.handle.remove();
  }
}

// --- Keys ---------------------------------------------------------------------------------------

/** ⌘⇧↑ / ⌘⇧↓: the block the cursor is in swaps with the one above or below; the cursor goes along. */
function moveByKey(direction: "up" | "down") {
  return (view: EditorView) => {
    const head = view.state.selection.main.head;
    const blocks = blocksOf(view);
    const index = blocks.findIndex((b) => b.from <= head && head <= b.to);
    if (index < 0) return false;
    const block = blocks[index];
    const neighbour = blocks[direction === "up" ? index - 1 : index + 1];
    if (!neighbour) return true;
    const start = move(view, block, { view, drop: { block: neighbour, side: direction === "up" ? "before" : "after" } });
    if (start === null) return true;
    const offset = placeOf(view).offset();
    if (offset !== null) view.dispatch({ selection: { anchor: start - offset + (head - block.from) }, scrollIntoView: true });
    return true;
  };
}

const theme = EditorView.theme({
  ".cm-block-handle": {
    position: "absolute",
    width: "22px",
    height: "22px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "4px",
    color: "#bdbdbd",
    cursor: "grab",
    opacity: "0",
    pointerEvents: "none",
    transition: "opacity 120ms",
    zIndex: "6",
  },
  ".cm-block-handle.cm-block-handle-shown": { opacity: "1", pointerEvents: "auto" },
  // Its hover area reaches the text: going from the text to it never leaves it.
  ".cm-block-handle::after": {
    content: '""',
    position: "absolute",
    left: "100%",
    top: "0",
    width: "var(--apart, 8px)",
    height: "100%",
  },
  ".cm-block-handle:hover": { background: "#f0f0f0", color: "#737373" },
  ".cm-drop-line": {
    position: "absolute",
    height: "2px",
    width: "2px",
    borderRadius: "1px",
    background: "#93c5fd",
    pointerEvents: "none",
    zIndex: "7",
  },
});

export function blockHandles(format: Format) {
  const plugin = ViewPlugin.fromClass(
    class extends Handles {
      constructor(view: EditorView) {
        super(view);
        formats.set(view, format);
      }
    },
    {},
  );
  return [
    plugin,
    theme,
    Prec.high(
      keymap.of([
        { key: "Mod-Shift-ArrowUp", run: moveByKey("up"), preventDefault: true },
        { key: "Mod-Shift-ArrowDown", run: moveByKey("down"), preventDefault: true },
      ]),
    ),
  ];
}

/** A small right-click menu at the mouse (like the app's other menus); Escape or a click elsewhere closes it. */
function showMenu(x: number, y: number, items: { label: string; run: () => void }[]) {
  const menu = document.createElement("div");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "Block");
  menu.className = "fixed z-50 min-w-36 rounded-lg bg-white p-1 text-sm shadow-[0_2px_12px_rgba(0,0,0,0.12)]";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  const close = () => {
    menu.remove();
    window.removeEventListener("mousedown", onMouseDown, true);
    window.removeEventListener("keydown", onKeyDown, true);
  };
  const onMouseDown = (event: MouseEvent) => !menu.contains(event.target as Node) && close();
  const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && close();
  for (const item of items) {
    const button = document.createElement("button");
    button.setAttribute("role", "menuitem");
    button.className = `${itemStyle} text-neutral-700`;
    button.textContent = item.label;
    button.addEventListener("click", () => {
      close();
      item.run();
    });
    menu.append(button);
  }
  window.addEventListener("mousedown", onMouseDown, true);
  window.addEventListener("keydown", onKeyDown, true);
  document.body.append(menu);
  menu.querySelector<HTMLElement>("button")?.focus();
}

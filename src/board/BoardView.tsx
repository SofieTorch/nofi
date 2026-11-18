import { mdiCircleMedium, mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { BoardBackground } from "../api";
import type { Autosave } from "../editor/autosave";
import { draggedNote, stopDragging } from "../workspace/Panes";
import {
  addArrow,
  addCard,
  arrowPoints,
  type Board,
  type Card,
  CARD_TYPE,
  changeCard,
  type Dragged,
  newId,
  parseBoard,
  readPart,
  removeArrow,
  removeCard,
  startingSize,
  writeBoard,
} from "./board";
import { Menu, type MenuItem } from "../ui/Menu";
import { CardEditor, cardName, CardText, FileContent, MeasureHeight, PdfCache } from "./cards";

type Props = {
  path: string;
  autosave: Autosave;
  /** Changes when notes are saved: cards showing notes read them again. */
  version: number;
  /** Opens what a file card shows (in a new pane, for ⌘-click). */
  onOpen: (file: string, part: string | undefined, newPane: boolean) => void;
  /** What the board is drawn on (a setting). */
  background?: BoardBackground;
  /** Called when the board is changed (its tab is kept, not a preview). */
  onEdited?: (path: string) => void;
};

type View = { x: number; y: number; zoom: number };
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
/** How far the mouse moves before a press is a drag, not a click. */
const DRAG = 3;

/**
 * A board (whiteboard), like Muse: cards on an endless surface, and arrows between them. See
 * tests/boards.test.tsx for what can be done on it.
 */
export function BoardView({ path, autosave, version, background = "plain", onOpen, onEdited }: Props) {
  const [board, setBoardState] = useState<Board | null>(null);
  const [problem, setProblem] = useState<string>();
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const [selected, setSelected] = useState<{ card: string } | { arrow: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** An arrow being drawn: from a card, to where the mouse is (on the board). */
  const [drawing, setDrawing] = useState<{ from: string; x: number; y: number } | null>(null);
  /** What cards are called once they know (a heading's text, read from its note). */
  const [names, setNames] = useState<Record<string, string>>({});
  /** A right-click menu, at the mouse. */
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const boardRef = useRef(board);
  boardRef.current = board;
  const pdfs = useMemo(() => new PdfCache(), []);
  useEffect(() => () => pdfs.close(), [pdfs]);

  useEffect(() => {
    let current = true;
    api.readNote(path).then(
      (text) => {
        if (!current) return;
        try {
          setBoardState(parseBoard(text));
        } catch (error) {
          setProblem(error instanceof Error ? error.message : String(error));
        }
      },
      (reason) => current && setProblem(String(reason)),
    );
    return () => {
      current = false;
      autosave.flush();
    };
  }, [path, autosave]);

  /** Changes the board, and saves it (unless it's a change still under way, like a card being dragged). */
  const change = useCallback(
    (update: (board: Board) => Board, save = true) => {
      const before = boardRef.current;
      if (!before) return;
      const next = update(before);
      boardRef.current = next;
      setBoardState(next);
      if (save) {
        autosave.change(path, writeBoard(next));
        onEdited?.(path);
      }
    },
    [autosave, path, onEdited],
  );
  const save = useCallback(() => change((b) => b), [change]);

  /** A point in the window, on the board. */
  const toBoard = useCallback((clientX: number, clientY: number) => {
    const box = surface.current?.getBoundingClientRect();
    const { x, y, zoom } = viewRef.current;
    return { x: (clientX - (box?.left ?? 0) - x) / zoom, y: (clientY - (box?.top ?? 0) - y) / zoom };
  }, []);

  // Scrolling moves around; ⌘-scroll (and pinching, which comes as Ctrl-scroll) zooms at the mouse
  // (a mouse wheel's big steps are kept small).
  useEffect(() => {
    const element = surface.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      setView((current) => {
        if (!(event.ctrlKey || event.metaKey)) return { ...current, x: current.x - event.deltaX, y: current.y - event.deltaY };
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current.zoom * Math.exp(-Math.max(-25, Math.min(25, event.deltaY)) * 0.01)));
        const box = element.getBoundingClientRect();
        const at = { x: event.clientX - box.left, y: event.clientY - box.top };
        return { zoom, x: at.x - ((at.x - current.x) * zoom) / current.zoom, y: at.y - ((at.y - current.y) * zoom) / current.zoom };
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [board !== null]);

  function zoomToFit() {
    const cards = boardRef.current?.nodes ?? [];
    const box = surface.current?.getBoundingClientRect();
    if (!cards.length || !box?.width) return setView({ x: 0, y: 0, zoom: 1 });
    const left = Math.min(...cards.map((c) => c.x));
    const top = Math.min(...cards.map((c) => c.y));
    const right = Math.max(...cards.map((c) => c.x + c.width));
    const bottom = Math.max(...cards.map((c) => c.y + c.height));
    const zoom = Math.min(1, (box.width - 80) / (right - left), (box.height - 80) / (bottom - top));
    setView({ zoom, x: (box.width - (right - left) * zoom) / 2 - left * zoom, y: (box.height - (bottom - top) * zoom) / 2 - top * zoom });
  }

  /** Follows the mouse from a press until it's let go: `move` with how far it went (on the board), `end` with whether it moved. */
  function follow(start: React.PointerEvent, move: (dx: number, dy: number, event: PointerEvent) => void, end: (moved: boolean, event: PointerEvent) => void) {
    let moved = false;
    const onMove = (event: PointerEvent) => {
      const dx = event.clientX - start.clientX;
      const dy = event.clientY - start.clientY;
      if (!moved && Math.hypot(dx, dy) < DRAG) return;
      moved = true;
      move(dx / viewRef.current.zoom, dy / viewRef.current.zoom, event);
    };
    const onUp = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      end(moved, event);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /** Pressing empty space: dragging moves around the board. */
  function pressSurface(event: React.PointerEvent) {
    if (event.button !== 0 || (event.target as Element).closest("[data-card], [data-arrow]")) return;
    surface.current?.focus({ preventScroll: true });
    setSelected(null);
    const start = viewRef.current;
    follow(
      event,
      (dx, dy) => setView({ ...start, x: start.x + dx * start.zoom, y: start.y + dy * start.zoom }),
      () => {},
    );
  }

  /** Pressing a card: a click selects it, dragging moves it. */
  function pressCard(event: React.PointerEvent, card: Card) {
    if (event.button !== 0 || editing === card.id) return;
    event.stopPropagation();
    surface.current?.focus({ preventScroll: true });
    setSelected({ card: card.id });
    follow(
      event,
      (dx, dy) => change((b) => changeCard(b, card.id, { x: Math.round(card.x + dx), y: Math.round(card.y + dy) }), false),
      (moved) => moved && save(),
    );
  }

  /** Double-clicking a card: text is edited; a file opens (in a new pane with ⌘). */
  function openCard(card: Card, newPane: boolean) {
    if (card.type === "text") return setEditing(card.id);
    onOpen(card.file, card.subpath?.replace(/^#/, "") || undefined, newPane);
  }

  function pressResize(event: React.PointerEvent, card: Card) {
    event.stopPropagation();
    // (Plain text's height follows its text: only its width changes.)
    const plain = isPlain(card);
    follow(
      event,
      (dx, dy) =>
        change(
          (b) => changeCard(b, card.id, { width: Math.max(plain ? 60 : 120, Math.round(card.width + dx)), ...(plain ? {} : { height: Math.max(60, Math.round(card.height + dy)) }) }),
          false,
        ),
      (moved) => moved && save(),
    );
  }

  /** A card's right-click menu. */
  function cardMenu(event: React.MouseEvent, card: Card) {
    event.preventDefault();
    event.stopPropagation();
    setSelected({ card: card.id });
    const items: MenuItem[] =
      card.type === "text"
        ? [
            card.card
              ? { label: "Show as plain text", run: () => change((b) => changeCard(b, card.id, { card: undefined })) }
              : { label: "Show as card", run: () => change((b) => changeCard(b, card.id, { card: true })) },
            { label: "Edit", run: () => setEditing(card.id) },
          ]
        : [
            { label: "Open", run: () => openCard(card, false) },
            { label: "Open in a new pane", run: () => openCard(card, true) },
          ];
    items.push({ label: "Remove from board", danger: true, run: () => remove(card.id) });
    setMenu({ x: event.clientX, y: event.clientY, items });
  }

  /** Pressing a card's dot: dragging draws an arrow, to the card it's let go on. */
  function pressConnect(event: React.PointerEvent, card: Card) {
    event.stopPropagation();
    follow(
      event,
      (_dx, _dy, move) => setDrawing({ from: card.id, ...toBoard(move.clientX, move.clientY) }),
      (_moved, up) => {
        setDrawing(null);
        const target = (up.target instanceof Element ? up.target : null)?.closest<HTMLElement>("[data-card]")?.dataset.card;
        if (target && target !== card.id) change((b) => addArrow(b, card.id, target));
      },
    );
  }

  function remove(id: string) {
    change((b) => removeCard(b, id));
    setSelected(null);
    if (editing === id) setEditing(null);
  }

  /** Writes text on the board at a spot (in a card, with `boxed`). */
  function writeOn(x: number, y: number, text = "", boxed = false) {
    const id = newId();
    const size = boxed ? startingSize(null, {}) : { width: 260, height: 40 };
    change((b) => addCard(b, { id, type: "text", text, ...(boxed ? { card: true } : {}), x: Math.round(x), y: Math.round(y), ...size }), text !== "");
    if (!text) setEditing(id);
    setSelected({ card: id });
  }

  /** A text card is done being edited: one left empty goes. */
  function doneEditing(id: string) {
    setEditing((current) => (current === id ? null : current));
    const card = boardRef.current?.nodes.find((c) => c.id === id);
    if (card?.type === "text" && !card.text.trim()) {
      change((b) => removeCard(b, id));
    }
  }

  // Dropping: a file from the explorer (not at the pane's very edge: that splits the pane), a part
  // of a note or PDF dragged from another pane, or text.
  const accepts = (event: React.DragEvent) => {
    const types = [...(event.dataTransfer?.types ?? [])];
    return types.includes(CARD_TYPE) || draggedNote() !== null || types.includes("text/plain");
  };
  function onDrop(event: React.DragEvent) {
    if (!accepts(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const at = toBoard(event.clientX, event.clientY);
    let dropped: Dragged | null = null;
    const data = event.dataTransfer.getData(CARD_TYPE);
    if (data) {
      try {
        dropped = JSON.parse(data) as Dragged;
      } catch {
        dropped = null;
      }
    }
    const fromExplorer = draggedNote();
    if (!dropped && fromExplorer) dropped = { file: fromExplorer, subpath: fromExplorer.toLowerCase().endsWith(".pdf") ? "#page=1" : undefined };
    stopDragging();
    if (dropped?.file) {
      const size = startingSize(dropped.file, readPart(dropped.subpath));
      const card: Card = { id: newId(), type: "file", file: dropped.file, ...(dropped.subpath ? { subpath: dropped.subpath } : {}), x: Math.round(at.x), y: Math.round(at.y), ...size };
      change((b) => addCard(b, card));
      setSelected({ card: card.id });
      return;
    }
    const text = event.dataTransfer.getData("text/plain").trim();
    if (text) writeOn(at.x, at.y, text);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (editing || (event.key !== "Backspace" && event.key !== "Delete") || !selected) return;
    event.preventDefault();
    if ("card" in selected) remove(selected.card);
    else {
      change((b) => removeArrow(b, selected.arrow));
      setSelected(null);
    }
  }

  if (problem) {
    return (
      <p role="alert" className="p-6 text-sm text-red-600">
        Couldn't open the board: {problem}
      </p>
    );
  }
  if (!board) return null;

  const nameOfCard = (card: Card) => (card.type === "text" ? (card.card ? "Text card" : "Text") : cardName(card, names[card.id]));
  const byId = new Map(board.nodes.map((card) => [card.id, card]));

  return (
    <div
      ref={surface}
      role="group"
      aria-label="Board"
      tabIndex={0}
      onPointerDown={pressSurface}
      onContextMenu={(event) => {
        if ((event.target as Element).closest("[data-card], [data-arrow]")) return;
        event.preventDefault();
        const at = toBoard(event.clientX, event.clientY);
        setMenu({
          x: event.clientX,
          y: event.clientY,
          items: [
            { label: "Write text here", run: () => writeOn(at.x, at.y) },
            { label: "Add a card here", run: () => writeOn(at.x, at.y, "", true) },
          ],
        });
      }}
      onDoubleClick={(event) => {
        if ((event.target as Element).closest("[data-card]")) return;
        const at = toBoard(event.clientX, event.clientY);
        writeOn(at.x, at.y);
      }}
      onDragOver={(event) => {
        if (!accepts(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragEnter={(event) => accepts(event) && event.preventDefault()}
      onDrop={onDrop}
      onKeyDown={onKeyDown}
      // The browser scrolls the surface to keep the cursor in view while writing: the board moves instead.
      onScroll={(event) => {
        const element = event.currentTarget;
        const { scrollLeft, scrollTop } = element;
        if (!scrollLeft && !scrollTop) return;
        element.scrollLeft = 0;
        element.scrollTop = 0;
        setView((current) => ({ ...current, x: current.x - scrollLeft, y: current.y - scrollTop }));
      }}
      data-background={background}
      className="board relative h-full w-full overflow-hidden outline-none"
      style={backgroundStyle(background, view)}
    >
      <div className="board-layer absolute top-0 left-0" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: "0 0" }}>
        <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width="1" height="1">
          <defs>
            <marker id={`arrowhead-${path}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
            </marker>
          </defs>
          {board.edges.map((arrow) => {
            const points = arrowPoints(board, arrow);
            if (!points) return null;
            const from = byId.get(arrow.fromNode)!;
            const to = byId.get(arrow.toNode)!;
            const isSelected = !!selected && "arrow" in selected && selected.arrow === arrow.id;
            const d = curve(points.from, points.fromSide, points.to, points.toSide);
            return (
              <g
                key={arrow.id}
                role="img"
                aria-label={`Arrow from ${nameOfCard(from)} to ${nameOfCard(to)}`}
                data-arrow={arrow.id}
                className="pointer-events-auto cursor-pointer"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  surface.current?.focus({ preventScroll: true });
                  setSelected({ arrow: arrow.id });
                }}
              >
                <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
                <path
                  d={d}
                  fill="none"
                  stroke={isSelected ? "rgb(14 165 233)" : "rgb(163 163 163)"}
                  strokeWidth={isSelected ? 2.5 : 1.75}
                  markerEnd={arrow.toEnd === "none" ? undefined : `url(#arrowhead-${path})`}
                />
              </g>
            );
          })}
          {drawing &&
            (() => {
              const from = byId.get(drawing.from);
              if (!from) return null;
              const start = { x: from.x + from.width, y: from.y + from.height / 2 };
              return <path d={`M ${start.x} ${start.y} L ${drawing.x} ${drawing.y}`} fill="none" stroke="rgb(14 165 233)" strokeWidth={1.75} strokeDasharray="4 4" />;
            })()}
        </svg>
        {board.nodes.map((card) => {
          const name = nameOfCard(card);
          const isSelected = !!selected && "card" in selected && selected.card === card.id;
          const plain = isPlain(card);
          return (
            <div
              key={card.id}
              role="article"
              aria-label={name}
              data-card={card.id}
              data-look={plain ? "text" : "card"}
              data-selected={isSelected ? "true" : undefined}
              onPointerDown={(event) => pressCard(event, card)}
              onDoubleClick={(event) => {
                event.stopPropagation();
                openCard(card, event.metaKey || event.ctrlKey);
              }}
              onContextMenu={(event) => cardMenu(event, card)}
              className={`group/card absolute flex flex-col rounded-lg ${
                plain ? "" : "bg-[#f4f7fb] shadow-[0_1px_3px_rgba(15,23,42,0.08)]"
              } ${isSelected ? "ring-2 ring-sky-400" : plain ? "hover:ring-1 hover:ring-neutral-300" : "ring-1 ring-slate-200/80"} ${editing === card.id ? "" : "select-none"}`}
              // Plain text is as tall as its text.
              style={{ left: card.x, top: card.y, width: card.width, height: plain ? undefined : card.height }}
            >
              {plain && (
                <MeasureHeight
                  onHeight={(height) => {
                    if (height && Math.abs(height - card.height) > 1) change((b) => changeCard(b, card.id, { height }), false);
                  }}
                />
              )}
              {card.type === "file" && (
                <div className="flex h-6 shrink-0 items-center truncate border-b border-slate-200/70 px-3 text-[11px] text-slate-400" title={card.file}>
                  {name}
                </div>
              )}
              <div className={`min-h-0 flex-1 rounded-b-lg ${plain ? "" : editing === card.id ? "overflow-auto" : "overflow-hidden"}`}>
                {card.type === "text" ? (
                  editing === card.id ? (
                    <CardEditor
                      text={card.text}
                      boardPath={path}
                      onChange={(text) => change((b) => changeCard(b, card.id, { text }))}
                      onDone={() => doneEditing(card.id)}
                    />
                  ) : (
                    <CardText text={card.text} boardPath={path} />
                  )
                ) : (
                  <FileContent
                    card={card}
                    boardPath={path}
                    pdfs={pdfs}
                    version={version}
                    onName={(shown) => setNames((current) => (current[card.id] === shown ? current : { ...current, [card.id]: shown }))}
                  />
                )}
              </div>
              <button
                aria-label="Remove from board"
                title="Remove from board"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => remove(card.id)}
                className="absolute -top-2 -right-2 hidden size-5 items-center justify-center rounded-full bg-white text-neutral-500 shadow ring-1 ring-neutral-200 group-hover/card:flex hover:text-neutral-800"
              >
                <Icon path={mdiClose} size="12px" />
              </button>
              <button
                aria-label="Draw an arrow"
                title="Drag to another card to draw an arrow"
                onPointerDown={(event) => pressConnect(event, card)}
                className="absolute top-1/2 -right-3 hidden size-5 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full text-sky-500 group-hover/card:flex"
              >
                <Icon path={mdiCircleMedium} size="18px" />
              </button>
              <span
                role="button"
                aria-label="Resize"
                onPointerDown={(event) => pressResize(event, card)}
                className="absolute -right-1 -bottom-1 size-3 cursor-nwse-resize"
              />
            </div>
          );
        })}
      </div>
      {board.nodes.length === 0 && (
        <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-neutral-400">
          Double-click to write, or drag notes and PDFs here.
        </p>
      )}
      {menu && <Menu label="Board" at={menu} items={menu.items} onClose={() => setMenu(null)} />}
      <button
        aria-label="Zoom to fit"
        title="Zoom to fit"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={zoomToFit}
        className="absolute right-3 bottom-3 rounded-md bg-white px-2 py-1 text-xs text-neutral-500 shadow-[0_1px_4px_rgba(0,0,0,0.12)] hover:text-neutral-800"
      >
        {Math.round(view.zoom * 100)}%
      </button>
    </div>
  );
}

/** A soft curve from one card's side to another's. */
function curve(from: { x: number; y: number }, fromSide: string, to: { x: number; y: number }, toSide: string) {
  const reach = Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) / 3);
  const out = (side: string, point: { x: number; y: number }) => ({
    x: point.x + (side === "right" ? reach : side === "left" ? -reach : 0),
    y: point.y + (side === "bottom" ? reach : side === "top" ? -reach : 0),
  });
  const a = out(fromSide, from);
  const b = out(toSide, to);
  return `M ${from.x} ${from.y} C ${a.x} ${a.y}, ${b.x} ${b.y}, ${to.x} ${to.y}`;
}

/** Text shown as plain text on the board (not in a card). */
const isPlain = (card: Card) => card.type === "text" && !card.card;

/**
 * What the board is drawn on: plain white, or a grid like Miro's (fine lines every 24 points, and
 * stronger ones every 120), moving and zooming with the board.
 */
function backgroundStyle(background: BoardBackground, view: View): React.CSSProperties {
  if (background !== "grid") return { backgroundColor: "white" };
  const line = (colour: string, direction: string) => `linear-gradient(to ${direction}, ${colour} 1px, transparent 1px)`;
  const fine = "rgb(15 23 42 / 0.045)";
  const strong = "rgb(15 23 42 / 0.08)";
  const small = 24 * view.zoom;
  const big = small * 5;
  return {
    backgroundColor: "white",
    backgroundImage: [line(strong, "right"), line(strong, "bottom"), line(fine, "right"), line(fine, "bottom")].join(", "),
    backgroundSize: `${big}px ${big}px, ${big}px ${big}px, ${small}px ${small}px, ${small}px ${small}px`,
    backgroundPosition: `${view.x}px ${view.y}px`,
  };
}

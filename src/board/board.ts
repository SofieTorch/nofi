// A board (whiteboard): cards on an endless surface, and arrows between them. It's a file of its
// own, `Name.canvas`, in the JSON Canvas format (https://jsoncanvas.org), so other apps can open it.
// A card is text written on the board (plain text, or shown in a card), or a file shown live: a note, a part of a note, a PDF page,
// a passage or an area of a PDF. A file card names the part after a # (`subpath`), like a link:
// `#methods` (a note's heading or paragraph), `#quote=…` (text in a note), `#page=3`,
// `#page=3&quote=…` (a passage of a PDF), `#page=4&area=x,y,w,h` (an area of a PDF page, in the
// page's points from its top left). Paths are from the workspace's top. Everything here makes a
// new board: the view keeps the old one for Undo.

/** Text written on the board: plain text, right on the board, unless it's shown as a `card`. */
export type TextCard = { id: string; type: "text"; text: string; card?: boolean; x: number; y: number; width: number; height: number };
export type FileCard = { id: string; type: "file"; file: string; subpath?: string; x: number; y: number; width: number; height: number };
export type Card = TextCard | FileCard;
export type Side = "top" | "right" | "bottom" | "left";
export type Arrow = { id: string; fromNode: string; toNode: string; fromSide?: Side; toSide?: Side; toEnd?: "arrow" | "none"; label?: string };
export type Board = { nodes: Card[]; edges: Arrow[] };

/** Anything else in the file (other apps' additions) is kept as it was. */
type Kept = Record<string, unknown>;

export const emptyBoard = (): Board => ({ nodes: [], edges: [] });

/** Reads a board's file. An empty file is an empty board. */
export function parseBoard(text: string): Board {
  if (!text.trim()) return emptyBoard();
  const json = JSON.parse(text) as Partial<Board> & Kept;
  if (typeof json !== "object" || json === null) throw new Error("This isn't a board.");
  return { ...json, nodes: Array.isArray(json.nodes) ? json.nodes : [], edges: Array.isArray(json.edges) ? json.edges : [] };
}

/** A board as it's written in its file (with tabs, like Obsidian writes them). */
export const writeBoard = (board: Board) => `${JSON.stringify(board, null, "\t")}\n`;

/** A new id for a card or an arrow (16 hex digits, like JSON Canvas apps use). */
export const newId = () =>
  Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

export const addCard = (board: Board, card: Card): Board => ({ ...board, nodes: [...board.nodes, card] });

export const changeCard = (board: Board, id: string, change: Partial<Card>): Board => ({
  ...board,
  nodes: board.nodes.map((card) => (card.id === id ? ({ ...card, ...change } as Card) : card)),
});

/** Takes a card off the board, with its arrows. */
export const removeCard = (board: Board, id: string): Board => ({
  ...board,
  nodes: board.nodes.filter((card) => card.id !== id),
  edges: board.edges.filter((arrow) => arrow.fromNode !== id && arrow.toNode !== id),
});

/** Draws an arrow between two cards (not from a card to itself, nor a second between the same two). */
export function addArrow(board: Board, from: string, to: string): Board {
  if (from === to || board.edges.some((a) => a.fromNode === from && a.toNode === to)) return board;
  const a = board.nodes.find((card) => card.id === from);
  const b = board.nodes.find((card) => card.id === to);
  if (!a || !b) return board;
  const [fromSide, toSide] = facingSides(a, b);
  return { ...board, edges: [...board.edges, { id: newId(), fromNode: from, toNode: to, fromSide, toSide }] };
}

export const removeArrow = (board: Board, id: string): Board => ({ ...board, edges: board.edges.filter((arrow) => arrow.id !== id) });

const centre = (card: Card) => ({ x: card.x + card.width / 2, y: card.y + card.height / 2 });

/** The sides of two cards that face each other. */
export function facingSides(a: Card, b: Card): [Side, Side] {
  const from = centre(a);
  const to = centre(b);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ["right", "left"] : ["left", "right"];
  return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
}

/** The middle of a card's side. */
export function sidePoint(card: Card, side: Side) {
  const { x, y } = centre(card);
  return {
    top: { x, y: card.y },
    bottom: { x, y: card.y + card.height },
    left: { x: card.x, y },
    right: { x: card.x + card.width, y },
  }[side];
}

/** Where an arrow goes: from the middle of a card's side to the middle of the other's, the sides facing each other. */
export function arrowPoints(board: Board, arrow: Arrow) {
  const a = board.nodes.find((card) => card.id === arrow.fromNode);
  const b = board.nodes.find((card) => card.id === arrow.toNode);
  if (!a || !b) return null;
  const [fromSide, toSide] = facingSides(a, b);
  return { from: sidePoint(a, fromSide), to: sidePoint(b, toSide), fromSide, toSide };
}

/** What a file card's part says: a heading or paragraph's anchor, or a PDF page, passage or area. */
export type Part = {
  anchor?: string;
  page?: number;
  quote?: string;
  area?: { x: number; y: number; width: number; height: number };
  /** A spot on a page (a PDF note's), in the page's points from its top left. */
  point?: { x: number; y: number };
};

export function readPart(subpath = ""): Part {
  const text = subpath.replace(/^#/, "");
  if (!text) return {};
  if (!/^(page|quote|area|point)=/.test(text)) return { anchor: text };
  const part: Part = {};
  for (const piece of text.split("&")) {
    const [key, value = ""] = piece.split(/=(.*)/s);
    if (key === "page" && /^\d+$/.test(value)) part.page = Number(value);
    if (key === "quote") {
      try {
        part.quote = decodeURIComponent(value);
      } catch {
        part.quote = value;
      }
    }
    if (key === "area") {
      const [x, y, width, height] = value.split(",").map(Number);
      if ([x, y, width, height].every(Number.isFinite)) part.area = { x, y, width, height };
    }
    if (key === "point") {
      const [x, y] = value.split(",").map(Number);
      if ([x, y].every(Number.isFinite)) part.point = { x, y };
    }
  }
  return part;
}

export function writePart(part: Part): string {
  if (part.anchor) return `#${part.anchor}`;
  const pieces = [];
  if (part.page) pieces.push(`page=${part.page}`);
  if (part.quote !== undefined) pieces.push(`quote=${encodeURIComponent(part.quote)}`);
  if (part.area) pieces.push(`area=${[part.area.x, part.area.y, part.area.width, part.area.height].map((n) => Math.round(n)).join(",")}`);
  if (part.point) pieces.push(`point=${[part.point.x, part.point.y].map((n) => Math.round(n)).join(",")}`);
  return pieces.length ? `#${pieces.join("&")}` : "";
}

/** What's being dragged onto a board from another pane: a file, maybe a part of it. */
export const CARD_TYPE = "application/x-marginalia-card";
export type Dragged = { file: string; subpath?: string };

/** The size a new card starts with. */
export function startingSize(file: string | null, part: Part): { width: number; height: number } {
  if (file === null) return { width: 260, height: 120 };
  if (part.area) {
    const width = Math.min(480, Math.max(160, part.area.width));
    return { width, height: Math.round((width * part.area.height) / part.area.width) };
  }
  if (file.toLowerCase().endsWith(".pdf")) return part.quote !== undefined ? { width: 300, height: 160 } : { width: 300, height: 400 };
  if (part.quote !== undefined || part.anchor) return { width: 320, height: 180 };
  return { width: 340, height: 260 };
}

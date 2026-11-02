import { useEffect, useMemo, useRef, useState } from "react";
import * as api from "../api";
import type { FileEntry } from "../api";
import { noteFormat } from "../editor/formatting";
import { GraphSimulation, layoutGraph, type Place } from "./graphLayout";

type Props = {
  files: FileEntry[];
  /** The note last shown: it stands out. */
  activePath?: string;
  /** Opens a note (creating it first if it isn't created yet). */
  onOpen: (path: string) => void;
  /** Changes when notes are saved, to look at the links again. */
  version?: number;
};

const notesIn = (entries: FileEntry[]): string[] =>
  entries.flatMap((entry) => (entry.kind === "folder" ? notesIn(entry.children) : noteFormat(entry.path) ? [entry.path] : []));
const nameOf = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "");

/**
 * The graph, like Obsidian's: a dot for each note, a line for each link. Notes linked to but not
 * created yet are faded. Hovering a note brings out its links; clicking opens it. Drag to move
 * around, scroll to zoom.
 */
export function GraphView({ files, activePath, onOpen, version }: Props) {
  const [links, setLinks] = useState<api.NoteLink[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const svg = useRef<SVGSVGElement>(null);
  /** The pane's size, so a small graph is shown at its natural size, not blown up. */
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = svg.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [svg.current]);
  const previous = useRef<Map<string, Place>>(undefined);

  useEffect(() => {
    let current = true;
    api.noteLinks().then(
      // (The same links as before keep the same list, so the graph doesn't move.)
      (found) => current && setLinks((before) => (JSON.stringify(before) === JSON.stringify(found) ? before : found)),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [files, version]);

  const notes = useMemo(() => notesIn(files), [files]);
  const missing = useMemo(
    () => [...new Set(links.flatMap((link) => [link.from, link.to]))].filter((path) => !notes.includes(path)),
    [links, notes],
  );
  const ids = useMemo(() => [...notes, ...missing], [notes, missing]);
  const pairs = useMemo(() => links.map((link): [string, string] => [link.from, link.to]), [links]);
  const simulationRef = useRef<GraphSimulation>(undefined);
  /** Where the notes settle (from where they were, if the graph was shown already). */
  const places = useMemo(() => {
    const live = simulationRef.current;
    const was = live ? new Map(ids.map((id) => [id, live.has(id) ? live.placeOf(id) : undefined]).filter((e): e is [string, Place] => !!e[1])) : previous.current;
    const placed = layoutGraph(ids, pairs, was);
    previous.current = placed;
    return placed;
  }, [ids, pairs]);
  // The live graph, for moving notes around with the mouse.
  const simulation = useMemo(() => new GraphSimulation(ids, pairs, places), [places]);
  simulationRef.current = simulation;
  const placeOf = (id: string) => simulation.placeOf(id);
  const [, setFrame] = useState(0);
  const running = useRef(false);
  const layer = useRef<SVGGElement>(null);

  /** Moves the graph a step each frame until it comes to rest. */
  function animate() {
    if (running.current) return;
    running.current = true;
    const step = () => {
      if (simulationRef.current?.tick()) {
        setFrame((frame) => frame + 1);
        requestAnimationFrame(step);
      } else running.current = false;
    };
    requestAnimationFrame(step);
  }

  /** The mouse's place in the graph (where notes are). */
  function pointInGraph(event: { clientX: number; clientY: number }): Place {
    const matrix = layer.current?.getScreenCTM?.();
    if (!matrix) return { x: event.clientX, y: event.clientY };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: point.x, y: point.y };
  }

  /** Grabbing a note: it follows the mouse and the graph moves with it. Without moving, it's a click. */
  function grab(event: React.PointerEvent, id: string) {
    if (event.button !== 0) return;
    event.stopPropagation();
    const start = { x: event.clientX, y: event.clientY };
    let moved = false;
    const onMove = (move: PointerEvent) => {
      if (!moved && Math.hypot(move.clientX - start.x, move.clientY - start.y) < 3) return;
      moved = true;
      simulation.hold(id, pointInGraph(move));
      setHovered(id);
      animate();
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        simulation.release(id);
        animate();
      } else onOpen(id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const degree = (id: string) => links.filter((link) => link.from === id || link.to === id).length;
  const near = (id: string) =>
    hovered === null || id === hovered || links.some((l) => (l.from === hovered && l.to === id) || (l.to === hovered && l.from === id));

  // Fit everything, with room for the names.
  const all = [...places.values()];
  const pad = 60;
  const left = Math.min(...all.map((p) => p.x)) - pad;
  const right = Math.max(...all.map((p) => p.x)) + pad;
  const top = Math.min(...all.map((p) => p.y)) - pad;
  const bottom = Math.max(...all.map((p) => p.y)) + pad;
  // Never zoomed in past the window's own size: a small graph keeps its dots and names small.
  const width = Math.max(right - left, size.width);
  const height = Math.max(bottom - top, size.height);
  const minX = (left + right) / 2 - width / 2;
  const maxX = minX + width;
  const minY = (top + bottom) / 2 - height / 2;
  const maxY = minY + height;

  function startPan(event: React.PointerEvent) {
    if ((event.target as Element).closest("[role=button]")) return;
    const box = svg.current!.getBoundingClientRect();
    const scale = Math.max((maxX - minX) / (box.width || 1), (maxY - minY) / (box.height || 1));
    const start = { x: event.clientX, y: event.clientY, view };
    const onMove = (move: PointerEvent) =>
      setView({ ...start.view, x: start.view.x + ((move.clientX - start.x) * scale) / start.view.zoom, y: start.view.y + ((move.clientY - start.y) * scale) / start.view.zoom });
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (ids.length === 0) {
    return <p className="flex h-full items-center justify-center text-sm text-neutral-400">No notes to show yet.</p>;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return (
    <svg
      ref={svg}
      role="group"
      aria-label="Graph of notes and links"
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      preserveAspectRatio="xMidYMid meet"
      onPointerDown={startPan}
      onWheel={(event) => setView((v) => ({ ...v, zoom: Math.min(4, Math.max(0.25, v.zoom * Math.exp(-event.deltaY * 0.0015))) }))}
      className="h-full w-full cursor-grab touch-none select-none active:cursor-grabbing"
    >
      <g ref={layer} transform={`translate(${cx} ${cy}) scale(${view.zoom}) translate(${-cx + view.x} ${-cy + view.y})`}>
        {links.map((link) => {
          if (!simulation.has(link.from) || !simulation.has(link.to)) return null;
          const a = placeOf(link.from);
          const b = placeOf(link.to);
          const lit = hovered !== null && (link.from === hovered || link.to === hovered);
          return (
            <line
              key={`${link.from}→${link.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={lit ? "#737373" : "#d4d4d4"}
              strokeWidth={lit ? 1.5 : 1}
              opacity={hovered === null || lit ? 1 : 0.35}
            />
          );
        })}
        {ids.map((id) => {
          const place = placeOf(id);
          const exists = notes.includes(id);
          const radius = 4 + Math.sqrt(degree(id)) * 2.2;
          const current = id === activePath;
          const close = near(id);
          return (
            <g
              key={id}
              role="button"
              tabIndex={0}
              aria-label={exists ? nameOf(id) : `${nameOf(id)} (not created yet)`}
              aria-current={current ? "true" : undefined}
              data-near={hovered === null ? undefined : String(close)}
              transform={`translate(${place.x} ${place.y})`}
              onPointerDown={(event) => grab(event, id)}
              onKeyDown={(event) => event.key === "Enter" && onOpen(id)}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              opacity={close ? 1 : 0.3}
              className="cursor-pointer outline-none active:cursor-grabbing"
            >
              <title>{id}</title>
              <circle
                r={radius}
                fill={!exists ? "#ffffff" : current ? "#0b6e99" : id === hovered ? "#525252" : "#a3a3a3"}
                stroke={exists ? "none" : "#a3a3a3"}
                strokeDasharray={exists ? undefined : "2 2"}
              />
              <text y={radius + 12} textAnchor="middle" fontSize={11} fill={exists ? "#525252" : "#a3a3a3"}>
                {nameOf(id)}
              </text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

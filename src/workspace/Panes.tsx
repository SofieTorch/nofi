import { mdiClose, mdiCloseBoxMultipleOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { Fragment, type ReactNode, useRef, useState } from "react";
import { IconButton } from "../ui/IconButton";
import {
  closeGroup,
  type Drop,
  focusGroup,
  groups,
  type Group,
  type Layout,
  moveTab,
  type Pane,
  resize,
  placeTab,
  type Side,
  tabFor,
  showTab,
  type Split,
  type Tab,
  type TabPlace,
  closeTab,
} from "./layout";

type Props = {
  layout: Layout;
  onChange: (change: (layout: Layout) => Layout) => void;
  /** What a tab shows. */
  content: (tab: Tab, group: Group) => ReactNode;
  /** What a pane without tabs shows. */
  empty: ReactNode;
  /** A tab's name. */
  label: (tab: Tab) => string;
  /** A tab's tooltip, like a note's path. */
  title?: (tab: Tab) => string;
};

/** What's being dragged: a tab (from any pane), or a note (from the explorer). One at a time. */
let dragging: { tab: TabPlace } | { note: string } | null = null;

/** A note is dragged from the explorer: dropped on a pane, it opens there (at an edge: beside). */
export function startDraggingNote(path: string) {
  dragging = { note: path };
}

export function stopDragging() {
  dragging = null;
}

/** Where a tab dropped on a pane's content goes: its edges split it, its middle adds it there. */
function dropSide(element: HTMLElement, x: number, y: number): Side | "middle" {
  const box = element.getBoundingClientRect();
  if (!box.width || !box.height) return "middle";
  const across = (x - box.left) / box.width;
  const down = (y - box.top) / box.height;
  if (across < 0.25) return "left";
  if (across > 0.75) return "right";
  if (down < 0.25) return "up";
  if (down > 0.75) return "down";
  return "middle";
}

/**
 * The window's panes, like VS Code's: each has tabs (click to show, × or middle-click to close,
 * drag to reorder or into another pane), and the lines between panes can be dragged to resize
 * them. Panes are made by dragging: a tab, or a note from the explorer, dropped at a pane's edge
 * splits it. A pane goes with its last tab, or with its "Close pane" button.
 */
export function Panes(props: Props) {
  return <PaneView pane={props.layout.root} {...props} />;
}

function PaneView({ pane, ...props }: Props & { pane: Pane }) {
  return pane.kind === "group" ? <GroupView group={pane} {...props} /> : <SplitView split={pane} {...props} />;
}

function SplitView({ split: node, ...props }: Props & { split: Split }) {
  const box = useRef<HTMLDivElement>(null);
  const row = node.direction === "row";

  function startResize(event: React.PointerEvent, at: number) {
    event.preventDefault();
    const container = box.current!.getBoundingClientRect();
    const length = row ? container.width : container.height;
    const start = row ? event.clientX : event.clientY;
    const [before, after] = [node.sizes[at - 1], node.sizes[at]];
    const onMove = (move: PointerEvent) => {
      const moved = ((row ? move.clientX : move.clientY) - start) / (length || 1);
      // Each pane keeps at least a little room.
      const least = 0.1 * (before + after);
      const first = Math.min(before + after - least, Math.max(least, before + moved));
      const sizes = [...node.sizes];
      sizes[at - 1] = first;
      sizes[at] = before + after - first;
      props.onChange((layout) => resize(layout, node.id, sizes));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove(row ? "resizing-row" : "resizing-column");
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add(row ? "resizing-row" : "resizing-column");
  }

  return (
    <div ref={box} className={`flex h-full min-h-0 w-full min-w-0 ${row ? "flex-row" : "flex-col"}`}>
      {node.children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && (
            <div
              role="separator"
              aria-orientation={row ? "vertical" : "horizontal"}
              aria-label="Resize panes"
              onPointerDown={(event) => startResize(event, i)}
              className={`group/divider relative shrink-0 ${row ? "w-px cursor-col-resize" : "h-px cursor-row-resize"} bg-neutral-200`}
            >
              {/* A wider area to grab than the hairline. */}
              <span className={`absolute ${row ? "inset-y-0 -left-1 -right-1" : "inset-x-0 -top-1 -bottom-1"} group-hover/divider:bg-neutral-300/40`} />
            </div>
          )}
          <div style={{ flexGrow: node.sizes[i], flexShrink: 1, flexBasis: 0 }} className="flex min-h-0 min-w-0">
            <PaneView pane={child} {...props} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function GroupView({ group, layout, onChange, content, empty, label, title }: Props & { group: Group }) {
  const active = layout.active === group.id;
  const panel = useRef<HTMLDivElement>(null);
  /** Where a dragged tab would go: an edge of this pane, its middle, or before a tab. */
  const [dropAt, setDropAt] = useState<Side | "middle" | null>(null);
  const [beforeTab, setBeforeTab] = useState<number | null>(null);
  const tab = group.tabs[group.active];

  const drop = (to: Drop) => {
    const from = dragging;
    dragging = null;
    setDropAt(null);
    setBeforeTab(null);
    if (!from) return;
    if ("tab" in from) onChange((current) => moveTab(current, from.tab, to));
    else onChange((current) => placeTab(current, tabFor(from.note), to));
  };

  return (
    <section
      aria-label="Pane"
      data-active={active}
      onMouseDownCapture={() => !active && onChange((current) => focusGroup(current, group.id))}
      onFocusCapture={() => !active && onChange((current) => focusGroup(current, group.id))}
      className="flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      <div
        role="tablist"
        aria-label="Tabs"
        onDragOver={(event) => {
          if (!dragging) return;
          event.preventDefault();
          setBeforeTab(group.tabs.length);
        }}
        onDragEnter={(event) => dragging && event.preventDefault()}
        onDragLeave={() => setBeforeTab(null)}
        onDrop={(event) => {
          event.preventDefault();
          drop({ group: group.id, index: beforeTab ?? group.tabs.length });
        }}
        className={`flex h-9 shrink-0 items-center gap-0.5 border-b border-neutral-100 px-1.5 ${active ? "" : "opacity-80"}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {group.tabs.map((t, i) => {
            const name = label(t);
            const shown = i === group.active;
            return (
              <div
                key={"path" in t ? t.path : t.kind}
                role="tab"
                aria-label={name}
                aria-selected={shown}
                title={title?.(t) ?? name}
                draggable
                tabIndex={shown ? 0 : -1}
                onClick={() => onChange((current) => showTab(current, group.id, i))}
                onAuxClick={(event) => event.button === 1 && onChange((current) => closeTab(current, group.id, i))}
                onDragStart={(event) => {
                  dragging = { tab: { group: group.id, index: i } };
                  event.dataTransfer?.setData("text/plain", name);
                  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  dragging = null;
                  setDropAt(null);
                  setBeforeTab(null);
                }}
                onDragOver={(event) => {
                  if (!dragging) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const box = event.currentTarget.getBoundingClientRect();
                  setBeforeTab(box.width && event.clientX > box.left + box.width / 2 ? i + 1 : i);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  drop({ group: group.id, index: beforeTab ?? i });
                }}
                className={`group/tab relative flex h-7 max-w-48 shrink-0 cursor-default items-center gap-1 rounded-md pr-1 pl-2.5 text-[13px] select-none ${
                  shown ? "bg-neutral-100 text-neutral-800" : "text-neutral-500 hover:bg-neutral-50 hover:text-neutral-700"
                }`}
              >
                {beforeTab === i && <span className="absolute inset-y-1 -left-0.5 w-0.5 rounded bg-sky-500" />}
                {beforeTab === i + 1 && i === group.tabs.length - 1 && (
                  <span className="absolute inset-y-1 -right-0.5 w-0.5 rounded bg-sky-500" />
                )}
                <span className="truncate">{name}</span>
                <button
                  aria-label={`Close ${name}`}
                  title="Close"
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange((current) => closeTab(current, group.id, i));
                  }}
                  className={`flex size-4 shrink-0 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700 ${
                    shown ? "" : "opacity-0 group-hover/tab:opacity-100"
                  }`}
                >
                  <Icon path={mdiClose} size="12px" />
                </button>
              </div>
            );
          })}
        </div>
        {groups(layout).length > 1 && (
          <IconButton icon={mdiCloseBoxMultipleOutline} label="Close pane" onClick={() => onChange((current) => closeGroup(current, group.id))} />
        )}
      </div>
      <div
        ref={panel}
        role="tabpanel"
        aria-label={tab ? label(tab) : "Empty pane"}
        onDragOver={(event) => {
          if (!dragging) return;
          event.preventDefault();
          setDropAt(group.tabs.length ? dropSide(panel.current!, event.clientX, event.clientY) : "middle");
        }}
        // (Safari only lets a drop happen where the drag's arrival is accepted too.)
        onDragEnter={(event) => dragging && event.preventDefault()}
        onDragLeave={(event) => {
          if (!panel.current?.contains(event.relatedTarget as Node)) setDropAt(null);
        }}
        onDrop={(event) => {
          event.preventDefault();
          const side = dropSide(panel.current!, event.clientX, event.clientY);
          drop(side === "middle" ? { group: group.id, index: group.tabs.length } : { group: group.id, side });
        }}
        className="relative min-h-0 flex-1"
      >
        {tab ? content(tab, group) : empty}
        {dropAt && (
          <div
            className={`pointer-events-none absolute rounded-md bg-sky-500/10 ring-1 ring-sky-400/50 ${
              {
                middle: "inset-1",
                left: "inset-y-1 left-1 w-1/2",
                right: "inset-y-1 right-1 w-1/2",
                up: "inset-x-1 top-1 h-1/2",
                down: "inset-x-1 bottom-1 h-1/2",
              }[dropAt]
            }`}
          />
        )}
      </div>
    </section>
  );
}

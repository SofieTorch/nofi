// How the window's panes are arranged, like VS Code's editor groups. A pane ("group") has tabs:
// notes, or the graph. Panes sit side by side (a row) or one on top of the other (a column), and
// those can nest. Notes open in the active pane. A note is open in one pane at most: two editors
// of the same note would overwrite each other's changes. There are no empty panes (except the
// window's only one): a pane is made by putting a tab at another's edge, and goes with its last
// tab. Every change gives a new layout.

export type Tab = { kind: "note"; path: string } | { kind: "pdf"; path: string } | { kind: "graph" };

/** The tab a file opens in: a PDF in the reader, anything else as a note. */
export const tabFor = (path: string): Tab => (path.toLowerCase().endsWith(".pdf") ? { kind: "pdf", path } : { kind: "note", path });
export type Group = { kind: "group"; id: string; tabs: Tab[]; active: number };
export type Split = { kind: "split"; id: string; direction: "row" | "column"; children: Pane[]; sizes: number[] };
export type Pane = Group | Split;
export type Layout = { root: Pane; active: string };
export type Side = "left" | "right" | "up" | "down";

let lastId = 0;
const newId = (prefix: string) => `${prefix}-${++lastId}`;
const newGroup = (tabs: Tab[] = []): Group => ({ kind: "group", id: newId("pane"), tabs, active: 0 });

export const emptyLayout = (): Layout => {
  const group = newGroup();
  return { root: group, active: group.id };
};

const pathOf = (tab: Tab) => ("path" in tab ? tab.path : undefined);
const sameTab = (a: Tab, b: Tab) => a.kind === b.kind && pathOf(a) === pathOf(b);

/** Every pane, in reading order (left to right, top to bottom). */
export function groups(layout: Layout): Group[] {
  const all: Group[] = [];
  const walk = (pane: Pane) => (pane.kind === "group" ? all.push(pane) : pane.children.forEach(walk));
  walk(layout.root);
  return all;
}

export const activeGroup = (layout: Layout) => groups(layout).find((g) => g.id === layout.active) ?? groups(layout)[0];

/** The note shown in the active pane, if it shows one. */
export function activePath(layout: Layout): string | undefined {
  const group = activeGroup(layout);
  const tab = group.tabs[group.active];
  return tab?.kind === "note" ? tab.path : undefined;
}

/** Where a tab is open, if it is. */
export function findTab(layout: Layout, tab: Tab): { group: Group; index: number } | undefined {
  for (const group of groups(layout)) {
    const index = group.tabs.findIndex((t) => sameTab(t, tab));
    if (index !== -1) return { group, index };
  }
  return undefined;
}

function mapGroups(pane: Pane, change: (group: Group) => Group): Pane {
  return pane.kind === "group" ? change(pane) : { ...pane, children: pane.children.map((child) => mapGroups(child, change)) };
}

const changeGroup = (layout: Layout, id: string, change: (group: Group) => Group): Layout => ({
  ...layout,
  root: mapGroups(layout.root, (group) => (group.id === id ? change(group) : group)),
});

export const focusGroup = (layout: Layout, id: string): Layout => ({ ...layout, active: id });

/** Shows a pane's tab, and makes that pane the active one. */
export const showTab = (layout: Layout, id: string, index: number): Layout =>
  focusGroup(
    changeGroup(layout, id, (group) => ({ ...group, active: index })),
    id,
  );

/** Opens a tab in the active pane, after the shown one; if it's open somewhere, shows it there. */
export function openTab(layout: Layout, tab: Tab, into = layout.active): Layout {
  const found = findTab(layout, tab);
  if (found) return showTab(layout, found.group.id, found.index);
  const target = groups(layout).find((g) => g.id === into) ?? activeGroup(layout);
  return focusGroup(
    changeGroup(layout, target.id, (group) => {
      const at = group.tabs.length ? group.active + 1 : 0;
      return { ...group, tabs: [...group.tabs.slice(0, at), tab, ...group.tabs.slice(at)], active: at };
    }),
    target.id,
  );
}

/** Takes a pane out (when its last tab went), unless it's the only one; tidies the splits left. */
function removeGroup(layout: Layout, id: string): Layout {
  if (groups(layout).length === 1) return layout;
  const without = (pane: Pane): Pane | null => {
    if (pane.kind === "group") return pane.id === id ? null : pane;
    const kept = pane.children.map((child, i) => ({ child: without(child), size: pane.sizes[i] })).filter((k) => k.child);
    if (kept.length === 1) return kept[0].child;
    const total = kept.reduce((sum, k) => sum + k.size, 0);
    return { ...pane, children: kept.map((k) => k.child!), sizes: kept.map((k) => k.size / total) };
  };
  const root = without(layout.root)!;
  const next = { ...layout, root };
  return groups(next).some((g) => g.id === layout.active) ? next : { ...next, active: groups(next)[0].id };
}

/** Takes a tab out of its pane; the pane shows the tab next to it. */
function takeTab(layout: Layout, id: string, index: number): { layout: Layout; tab: Tab | undefined } {
  const group = groups(layout).find((g) => g.id === id);
  const tab = group?.tabs[index];
  if (!group || !tab) return { layout, tab: undefined };
  const tabs = group.tabs.filter((_, i) => i !== index);
  const active = index === group.active ? Math.max(0, Math.min(index, tabs.length - 1)) : index < group.active ? group.active - 1 : group.active;
  return { layout: changeGroup(layout, id, (g) => ({ ...g, tabs, active })), tab };
}

/** Closes a tab; a pane left without tabs closes too, unless it's the only one. */
export function closeTab(layout: Layout, id: string, index: number): Layout {
  const taken = takeTab(layout, id, index).layout;
  const group = groups(taken).find((g) => g.id === id);
  return group && group.tabs.length === 0 ? removeGroup(taken, id) : taken;
}

/**
 * Adds a pane with a tab beside another (`side` of it), and makes it the active one. In a row, a
 * pane split right or left joins the row (and the same for down and up in a column).
 */
export function split(layout: Layout, id: string, side: Side, tab: Tab): Layout {
  const added = newGroup([tab]);
  const direction = side === "left" || side === "right" ? "row" : "column";
  const before = side === "left" || side === "up";
  const place = (pane: Pane): Pane => {
    if (pane.kind === "group") {
      if (pane.id !== id) return pane;
      return { kind: "split", id: newId("split"), direction, children: before ? [added, pane] : [pane, added], sizes: [0.5, 0.5] };
    }
    const at = pane.children.findIndex((child) => child.kind === "group" && child.id === id);
    if (at !== -1 && pane.direction === direction) {
      const half = pane.sizes[at] / 2;
      const children = [...pane.children];
      const sizes = [...pane.sizes];
      children.splice(before ? at : at + 1, 0, added);
      sizes.splice(at, 1, half, half);
      return { ...pane, children, sizes };
    }
    return { ...pane, children: pane.children.map(place) };
  };
  return { root: place(layout.root), active: added.id };
}

export type TabPlace = { group: string; index: number };
export type Drop = TabPlace | { group: string; side: Side };

/** Moves a tab: to a place among a pane's tabs, or to a pane's edge (splitting it). */
export function moveTab(layout: Layout, from: TabPlace, to: Drop): Layout {
  const sameGroup = to.group === from.group;
  const { layout: taken, tab } = takeTab(layout, from.group, from.index);
  if (!tab) return layout;
  let moved: Layout;
  if ("side" in to) {
    moved = split(taken, to.group, to.side, tab);
  } else {
    const index = sameGroup && from.index < to.index ? to.index - 1 : to.index;
    moved = focusGroup(
      changeGroup(taken, to.group, (group) => {
        const at = Math.max(0, Math.min(index, group.tabs.length));
        return { ...group, tabs: [...group.tabs.slice(0, at), tab, ...group.tabs.slice(at)], active: at };
      }),
      to.group,
    );
  }
  const source = groups(moved).find((g) => g.id === from.group);
  return source && source.tabs.length === 0 ? removeGroup(moved, from.group) : moved;
}

/**
 * Puts a tab somewhere (like a note dragged from the explorer): if it's open already it moves
 * there, otherwise it opens there. Dropped at the edge of the window's only, empty pane, it just
 * opens in it (a split would leave an empty pane).
 */
export function placeTab(layout: Layout, tab: Tab, to: Drop): Layout {
  const target = groups(layout).find((g) => g.id === to.group);
  if (!target) return layout;
  const where: Drop = "side" in to && target.tabs.length === 0 ? { group: to.group, index: 0 } : to;
  const found = findTab(layout, tab);
  if (found) return moveTab(layout, { group: found.group.id, index: found.index }, where);
  if ("side" in where) return split(layout, where.group, where.side, tab);
  return focusGroup(
    changeGroup(layout, where.group, (group) => {
      const at = Math.max(0, Math.min(where.index, group.tabs.length));
      return { ...group, tabs: [...group.tabs.slice(0, at), tab, ...group.tabs.slice(at)], active: at };
    }),
    where.group,
  );
}

/** Closes a pane and its tabs (the window's only pane just loses its tabs). */
export function closeGroup(layout: Layout, id: string): Layout {
  if (groups(layout).length === 1) return changeGroup(layout, id, (group) => ({ ...group, tabs: [], active: 0 }));
  return removeGroup(layout, id);
}

/** Changes how much room each pane of a split takes (fractions adding up to 1). */
export function resize(layout: Layout, id: string, sizes: number[]): Layout {
  const change = (pane: Pane): Pane =>
    pane.kind === "group" ? pane : pane.id === id ? { ...pane, sizes } : { ...pane, children: pane.children.map(change) };
  return { ...layout, root: change(layout.root) };
}

/** A file was renamed: its tab follows it. */
export const renamePath = (layout: Layout, from: string, to: string): Layout => ({
  ...layout,
  root: mapGroups(layout.root, (group) => ({
    ...group,
    tabs: group.tabs.map((tab) => ("path" in tab && tab.path === from ? { ...tab, path: to } : tab)),
  })),
});

/** A file was deleted (or a new note's creation undone): its tab closes. */
export function removePath(layout: Layout, path: string): Layout {
  const found = findTab(layout, tabFor(path));
  return found ? closeTab(layout, found.group.id, found.index) : layout;
}

/** The file shown in the active pane (a note or a PDF), if it shows one. */
export function activeFile(layout: Layout): string | undefined {
  const group = activeGroup(layout);
  const tab = group.tabs[group.active];
  return tab && "path" in tab ? tab.path : undefined;
}

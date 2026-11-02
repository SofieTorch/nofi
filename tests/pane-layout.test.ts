// How the window's panes are arranged, like VS Code's editor groups: each pane has tabs (notes, or
// the graph); panes sit side by side or one on top of the other, and splits can nest. A note is
// open in one pane at most (two editors of the same note would overwrite each other's changes).
// There are no empty panes, except the window's only one: a pane is made by putting a tab at
// another's edge (dragging it there), and it goes when its last tab does.

import { describe, expect, it } from "vitest";
import {
  activeFile,
  activePath,
  closeGroup,
  closeTab,
  emptyLayout,
  focusGroup,
  groups,
  type Layout,
  moveTab,
  openTab,
  placeTab,
  removePath,
  renamePath,
  resize,
  type Side,
  split,
  type Tab,
  tabFor,
} from "../src/workspace/layout";

const note = (path: string): Tab => ({ kind: "note", path });
const graph: Tab = { kind: "graph" };

/** Each pane's tabs (note paths, or "graph"), with the shown one in [brackets]. */
const shape = (layout: Layout) =>
  groups(layout).map((group) =>
    group.tabs.map((tab, i) => {
      const name = "path" in tab ? tab.path : "graph";
      return i === group.active ? `[${name}]` : name;
    }),
  );

const open = (...paths: string[]) => paths.reduce((layout, path) => openTab(layout, note(path)), emptyLayout());
/** Puts a note at an edge of the first pane. */
const besideFirst = (layout: Layout, side: Side, path: string) => split(layout, groups(layout)[0].id, side, note(path));

describe("Tabs", () => {
  it("at first there's one pane, with nothing open", () => {
    expect(shape(emptyLayout())).toEqual([[]]);
    expect(activePath(emptyLayout())).toBeUndefined();
  });

  it("opening a note adds a tab after the shown one, and shows it", () => {
    expect(shape(open("A.typ", "B.typ"))).toEqual([["A.typ", "[B.typ]"]]);
    expect(activePath(open("A.typ", "B.typ"))).toBe("B.typ");
  });

  it("opening a note that has a tab already shows that tab", () => {
    expect(shape(open("A.typ", "B.typ", "A.typ"))).toEqual([["[A.typ]", "B.typ"]]);
  });

  it("closing the shown tab shows the one next to it", () => {
    const layout = open("A.typ", "B.typ", "C.typ");
    const group = groups(layout)[0];

    expect(shape(closeTab(layout, group.id, 2))).toEqual([["A.typ", "[B.typ]"]]);
    expect(shape(closeTab(openTab(layout, note("A.typ")), group.id, 0))).toEqual([["[B.typ]", "C.typ"]]);
  });

  it("the graph is a tab too", () => {
    expect(shape(openTab(open("A.typ"), graph))).toEqual([["A.typ", "[graph]"]]);
  });
});

describe("Splitting", () => {
  it("a note put at a pane's right edge gets a pane of its own beside it, which becomes the active one", () => {
    const layout = besideFirst(open("A.typ"), "right", "B.typ");

    expect(shape(layout)).toEqual([["[A.typ]"], ["[B.typ]"]]);
    expect(layout.root).toMatchObject({ kind: "split", direction: "row" });
    expect(activePath(layout)).toBe("B.typ");
  });

  it("at the bottom edge, the new pane goes underneath", () => {
    expect(besideFirst(open("A.typ"), "down", "B.typ").root).toMatchObject({ kind: "split", direction: "column" });
  });

  it("at the left or top edge, the new pane comes first", () => {
    expect(shape(besideFirst(open("A.typ"), "left", "B.typ"))).toEqual([["[B.typ]"], ["[A.typ]"]]);
  });

  it("notes open in the active pane", () => {
    let layout = besideFirst(open("A.typ"), "right", "B.typ");

    layout = openTab(layout, note("C.typ"));

    expect(shape(layout)).toEqual([["[A.typ]"], ["B.typ", "[C.typ]"]]);
  });

  it("a note open in another pane is shown there, not opened twice", () => {
    let layout = besideFirst(open("A.typ"), "right", "B.typ");

    layout = openTab(layout, note("A.typ"));

    expect(shape(layout)).toEqual([["[A.typ]"], ["[B.typ]"]]);
    expect(layout.active).toBe(groups(layout)[0].id);
  });

  it("splitting the same way again adds a pane to that row", () => {
    let layout = besideFirst(open("A.typ"), "right", "B.typ");
    layout = split(layout, groups(layout)[1].id, "right", note("C.typ"));

    expect(layout.root).toMatchObject({ kind: "split", direction: "row" });
    expect(groups(layout)).toHaveLength(3);
  });

  it("splits nest: a pane split down inside a row", () => {
    let layout = besideFirst(open("A.typ"), "right", "B.typ");
    layout = split(layout, groups(layout)[1].id, "down", note("C.typ"));

    expect(layout.root).toMatchObject({ kind: "split", direction: "row", children: [{ kind: "group" }, { kind: "split", direction: "column" }] });
  });

  it("closing a pane's last tab closes the pane (unless it's the only one)", () => {
    let layout = besideFirst(open("A.typ"), "right", "B.typ");

    layout = closeTab(layout, groups(layout)[1].id, 0);

    expect(shape(layout)).toEqual([["[A.typ]"]]);
    expect(layout.root.kind).toBe("group");
    expect(shape(closeTab(layout, groups(layout)[0].id, 0))).toEqual([[]]);
  });

  it("a pane can be closed with all its tabs", () => {
    let layout = besideFirst(open("A.typ"), "right", "B.typ");
    layout = openTab(layout, note("C.typ"));

    layout = closeGroup(layout, groups(layout)[1].id);

    expect(shape(layout)).toEqual([["[A.typ]"]]);
    expect(layout.active).toBe(groups(layout)[0].id);
  });

  it("closing the only pane closes its tabs", () => {
    const layout = open("A.typ", "B.typ");

    expect(shape(closeGroup(layout, groups(layout)[0].id))).toEqual([[]]);
  });

  it("panes can be resized", () => {
    let layout = besideFirst(open("A.typ"), "right", "B.typ");

    layout = resize(layout, layout.root.id, [0.3, 0.7]);

    expect(layout.root).toMatchObject({ sizes: [0.3, 0.7] });
  });

  it("focusing a pane makes it the active one", () => {
    let layout = besideFirst(open("A.typ"), "right", "B.typ");

    layout = focusGroup(layout, groups(layout)[0].id);

    expect(activePath(layout)).toBe("A.typ");
  });
});

describe("Moving tabs", () => {
  it("to another pane, at a place in its tabs", () => {
    let layout = besideFirst(open("A.typ", "B.typ"), "right", "C.typ");
    const [first, second] = groups(layout);

    layout = moveTab(layout, { group: first.id, index: 0 }, { group: second.id, index: 0 });

    expect(shape(layout)).toEqual([["[B.typ]"], ["[A.typ]", "C.typ"]]);
  });

  it("within its pane, to change the order", () => {
    const layout = open("A.typ", "B.typ", "C.typ");
    const group = groups(layout)[0];

    expect(shape(moveTab(layout, { group: group.id, index: 0 }, { group: group.id, index: 3 }))).toEqual([["B.typ", "C.typ", "[A.typ]"]]);
  });

  it("to a pane's edge: that pane splits, with the tab in the new pane", () => {
    const layout = open("A.typ", "B.typ");
    const group = groups(layout)[0];

    const moved = moveTab(layout, { group: group.id, index: 1 }, { group: group.id, side: "right" });

    expect(shape(moved)).toEqual([["[A.typ]"], ["[B.typ]"]]);
    expect(moved.root).toMatchObject({ direction: "row" });
    expect(moved.active).toBe(groups(moved)[1].id);
  });

  it("moving a pane's only tab away closes that pane", () => {
    let layout = besideFirst(open("A.typ"), "right", "B.typ");
    const [first, second] = groups(layout);

    layout = moveTab(layout, { group: second.id, index: 0 }, { group: first.id, index: 1 });

    expect(shape(layout)).toEqual([["A.typ", "[B.typ]"]]);
  });
});

describe("Putting a note somewhere (dragged from the explorer)", () => {
  it("at a pane's edge, splits it with the note", () => {
    const layout = open("A.typ");

    expect(shape(placeTab(layout, note("B.typ"), { group: groups(layout)[0].id, side: "right" }))).toEqual([["[A.typ]"], ["[B.typ]"]]);
  });

  it("among a pane's tabs, opens it there", () => {
    const layout = open("A.typ", "B.typ");

    expect(shape(placeTab(layout, note("C.typ"), { group: groups(layout)[0].id, index: 0 }))).toEqual([["[C.typ]", "A.typ", "B.typ"]]);
  });

  it("a note open already moves there instead of opening twice", () => {
    const layout = open("A.typ", "B.typ");

    expect(shape(placeTab(layout, note("A.typ"), { group: groups(layout)[0].id, side: "down" }))).toEqual([["[B.typ]"], ["[A.typ]"]]);
  });

  it("at the edge of the window's only pane while it's empty, just opens there", () => {
    const layout = emptyLayout();

    expect(shape(placeTab(layout, note("A.typ"), { group: groups(layout)[0].id, side: "left" }))).toEqual([["[A.typ]"]]);
  });
});

describe("Notes renamed or deleted", () => {
  it("a renamed note's tab follows it", () => {
    expect(shape(renamePath(open("A.typ", "B.typ"), "A.typ", "Draft.typ"))).toEqual([["Draft.typ", "[B.typ]"]]);
  });

  it("a deleted note's tab closes", () => {
    expect(shape(removePath(open("A.typ", "B.typ"), "B.typ"))).toEqual([["[A.typ]"]]);
  });
});

describe("PDFs", () => {
  it("open in a tab of their own kind", () => {
    expect(tabFor("Papers/attention.pdf")).toEqual({ kind: "pdf", path: "Papers/attention.pdf" });
    expect(tabFor("Paper.typ")).toEqual({ kind: "note", path: "Paper.typ" });
  });

  it("their tab follows a rename, and closes when deleted", () => {
    const layout = openTab(open("A.typ"), tabFor("a.pdf"));

    expect(shape(renamePath(layout, "a.pdf", "b.pdf"))).toEqual([["A.typ", "[b.pdf]"]]);
    expect(shape(removePath(layout, "a.pdf"))).toEqual([["[A.typ]"]]);
  });

  it("a shown PDF is the active file, though not a note", () => {
    const layout = openTab(open("A.typ"), tabFor("a.pdf"));

    expect(activeFile(layout)).toBe("a.pdf");
    expect(activePath(layout)).toBeUndefined();
  });
});

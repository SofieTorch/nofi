// Panes and tabs, like VS Code's: notes open as tabs in the active pane. Panes are made by
// dragging: a note from the explorer, or a tab, dropped at an open note's edge (left, right, top
// or bottom) splits its pane; dropped in the middle or on the tabs, it goes into that pane. There
// are no empty panes: a pane goes with its last tab, or with "Close pane". The line between panes
// can be dragged to resize them. A note is open in one pane at most. How panes are arranged is
// specified in pane-layout.test.ts. (Notes here are kept open, not previews: see preview-tabs.test.tsx.)
// A tab's right-click menu closes it, the pane's other tabs, those to its right or left, or all of
// them. ⌘W closes the shown tab, and with no tab open, the window.

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  vi.mocked(api.listFiles).mockResolvedValue(["Paper.typ", "Ideas.md", "Plan.typ"].map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => `Text of ${path}.`);
});

const explorer = () => within(screen.getByLabelText("File explorer", { selector: "aside" }));
const panes = () => screen.getAllByRole("region", { name: "Pane" });
const tabsOf = (pane: HTMLElement) =>
  within(pane)
    .queryAllByRole("tab")
    .map((tab) => (tab.getAttribute("aria-selected") === "true" ? `[${tab.getAttribute("aria-label")}]` : tab.getAttribute("aria-label")));
const shape = () => panes().map(tabsOf);

async function start() {
  render(<App />);
  await screen.findByText("Paper.typ");
}

/** Opens a note from the explorer, and keeps its tab (so the next note gets a tab of its own; see preview-tabs.test.tsx). */
async function open(name: string) {
  await userEvent.click(explorer().getByText(name));
  await screen.findByRole("textbox", { name });
  await userEvent.dblClick(screen.getByRole("tab", { name: name.replace(/\.[^.]+$/, "") }));
}

/** Drags a note from the explorer onto a pane's content (the first pane, unless told), at a spot. */
async function dragNote(name: string, at: "left" | "right" | "top" | "bottom" | "middle", pane = panes()[0]) {
  const content = within(pane).getByRole("tabpanel");
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);
  const spot = { left: [50, 300], right: [950, 300], top: [500, 30], bottom: [500, 570], middle: [500, 300] }[at];
  fireEvent.dragStart(explorer().getByText(name));
  fireEvent.dragOver(content, { clientX: spot[0], clientY: spot[1] });
  fireEvent.drop(content, { clientX: spot[0], clientY: spot[1] });
  await screen.findByRole("textbox", { name });
}

describe("Tabs", () => {
  it("each note opened gets a tab, and the shown one is selected", async () => {
    await start();

    await open("Paper.typ");
    await open("Ideas.md");

    expect(shape()).toEqual([["Paper", "[Ideas]"]]);
    expect(screen.getByRole("textbox", { name: "Ideas.md" })).toBeInTheDocument();
  });

  it("clicking a tab shows its note", async () => {
    await start();
    await open("Paper.typ");
    await open("Ideas.md");

    await userEvent.click(screen.getByRole("tab", { name: "Paper" }));

    expect(await screen.findByRole("textbox", { name: "Paper.typ" })).toBeInTheDocument();
    expect(shape()).toEqual([["[Paper]", "Ideas"]]);
  });

  it("× closes a tab, and the one next to it is shown", async () => {
    await start();
    await open("Paper.typ");
    await open("Ideas.md");

    await userEvent.click(screen.getByRole("button", { name: "Close Ideas" }));

    expect(shape()).toEqual([["[Paper]"]]);
    expect(await screen.findByRole("textbox", { name: "Paper.typ" })).toBeInTheDocument();
  });

  it("a middle click closes a tab too", async () => {
    await start();
    await open("Paper.typ");

    fireEvent(screen.getByRole("tab", { name: "Paper" }), new MouseEvent("auxclick", { bubbles: true, button: 1 }));

    expect(shape()).toEqual([[]]);
  });

  it("with every tab closed, the pane says how to open a note", async () => {
    await start();
    await open("Paper.typ");

    await userEvent.click(screen.getByRole("button", { name: "Close Paper" }));

    expect(screen.getByText(/Open a note from the explorer/)).toBeInTheDocument();
  });
});

describe("Splitting by dragging a note from the explorer", () => {
  it("dropped at an open note's right edge, it opens in a new pane beside it", async () => {
    await start();
    await open("Paper.typ");

    await dragNote("Ideas.md", "right");

    expect(shape()).toEqual([["[Paper]"], ["[Ideas]"]]);
    expect(screen.getByRole("textbox", { name: "Paper.typ" })).toBeInTheDocument();
    expect(screen.getByRole("separator", { name: "Resize panes" })).toHaveAttribute("aria-orientation", "vertical");
  });

  it("at the left edge, the new pane comes first", async () => {
    await start();
    await open("Paper.typ");

    await dragNote("Ideas.md", "left");

    expect(shape()).toEqual([["[Ideas]"], ["[Paper]"]]);
  });

  it("at the bottom edge, the new pane goes underneath", async () => {
    await start();
    await open("Paper.typ");

    await dragNote("Ideas.md", "bottom");

    expect(screen.getByRole("separator", { name: "Resize panes" })).toHaveAttribute("aria-orientation", "horizontal");
  });

  it("in the middle, it opens as a tab of that pane", async () => {
    await start();
    await open("Paper.typ");

    await dragNote("Ideas.md", "middle");

    expect(shape()).toEqual([["Paper", "[Ideas]"]]);
  });

  it("onto a pane with nothing open, it just opens there", async () => {
    await start();

    await dragNote("Ideas.md", "right");

    expect(shape()).toEqual([["[Ideas]"]]);
  });

  it("a note open already moves there, instead of opening twice", async () => {
    await start();
    await open("Paper.typ");
    await open("Ideas.md");

    await dragNote("Paper.typ", "right");

    expect(shape()).toEqual([["[Ideas]"], ["[Paper]"]]);
    expect(screen.getAllByRole("textbox", { name: "Paper.typ" })).toHaveLength(1);
  });

  it("there are no buttons making empty panes", async () => {
    await start();
    await open("Paper.typ");

    expect(screen.queryByRole("button", { name: /split/i })).not.toBeInTheDocument();
  });

  it("clicking in a pane makes it the one notes open in", async () => {
    await start();
    await open("Paper.typ");
    await dragNote("Ideas.md", "right");

    await userEvent.click(screen.getByRole("textbox", { name: "Paper.typ" }));
    await open("Plan.typ");

    expect(shape()).toEqual([["Paper", "[Plan]"], ["[Ideas]"]]);
  });

  it("a note open in another pane is shown there, not opened twice", async () => {
    await start();
    await open("Paper.typ");
    await dragNote("Ideas.md", "right");

    await userEvent.click(explorer().getByText("Paper.typ"));

    expect(shape()).toEqual([["[Paper]"], ["[Ideas]"]]);
    expect(screen.getAllByRole("textbox", { name: "Paper.typ" })).toHaveLength(1);
  });

  it("the line between panes can be dragged to resize them", async () => {
    await start();
    await open("Paper.typ");
    await dragNote("Ideas.md", "right");
    const separator = screen.getByRole("separator", { name: "Resize panes" });
    vi.spyOn(separator.parentElement!, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);

    fireEvent.pointerDown(separator, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 300 });
    fireEvent.pointerUp(window);

    const [first, second] = [...separator.parentElement!.children].filter((child) => child !== separator) as HTMLElement[];
    expect(Number(first.style.flexGrow)).toBeCloseTo(0.3);
    expect(Number(second.style.flexGrow)).toBeCloseTo(0.7);
  });
});

describe("Closing panes", () => {
  it("closing a pane's last tab closes the pane", async () => {
    await start();
    await open("Paper.typ");
    await dragNote("Ideas.md", "right");

    await userEvent.click(screen.getByRole("button", { name: "Close Ideas" }));

    expect(shape()).toEqual([["[Paper]"]]);
  });

  it("Close pane closes it with all its tabs", async () => {
    await start();
    await open("Paper.typ");
    await dragNote("Ideas.md", "right");
    await open("Plan.typ");

    await userEvent.click(within(panes()[1]).getByRole("button", { name: "Close pane" }));

    expect(shape()).toEqual([["[Paper]"]]);
  });

  it("with one pane, there's no Close pane", async () => {
    await start();
    await open("Paper.typ");

    expect(screen.queryByRole("button", { name: "Close pane" })).not.toBeInTheDocument();
  });

  it("View › Close Pane closes the active pane", async () => {
    await start();
    await open("Paper.typ");
    await dragNote("Ideas.md", "right");

    await chooseInMenu("View › Close Pane");

    expect(shape()).toEqual([["[Paper]"]]);
  });
});

describe("Dragging tabs", () => {
  it("into another pane's tabs moves the tab there", async () => {
    await start();
    await open("Paper.typ");
    await open("Plan.typ");
    await dragNote("Ideas.md", "right");

    const tab = screen.getByRole("tab", { name: "Plan" });
    fireEvent.dragStart(tab);
    const target = within(panes()[1]).getByRole("tablist");
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    expect(shape()).toEqual([["[Paper]"], ["Ideas", "[Plan]"]]);
  });

  it("onto another tab puts it before that tab", async () => {
    await start();
    await open("Paper.typ");
    await open("Ideas.md");
    await open("Plan.typ");

    fireEvent.dragStart(screen.getByRole("tab", { name: "Plan" }));
    fireEvent.dragOver(screen.getByRole("tab", { name: "Paper" }));
    fireEvent.drop(screen.getByRole("tab", { name: "Paper" }));

    expect(shape()).toEqual([["[Plan]", "Paper", "Ideas"]]);
  });

  it("to a pane's right edge splits it, with the tab in the new pane", async () => {
    await start();
    await open("Paper.typ");
    await open("Ideas.md");
    const content = screen.getByRole("tabpanel");
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);

    fireEvent.dragStart(screen.getByRole("tab", { name: "Paper" }));
    fireEvent.dragOver(content, { clientX: 950, clientY: 300 });
    fireEvent.drop(content, { clientX: 950, clientY: 300 });

    expect(shape()).toEqual([["[Ideas]"], ["[Paper]"]]);
  });

  it("to a pane's bottom edge puts the new pane underneath", async () => {
    await start();
    await open("Paper.typ");
    await open("Ideas.md");
    const content = screen.getByRole("tabpanel");
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);

    fireEvent.dragStart(screen.getByRole("tab", { name: "Paper" }));
    fireEvent.drop(content, { clientX: 500, clientY: 590 });

    expect(panes()).toHaveLength(2);
    expect(screen.getByRole("separator", { name: "Resize panes" })).toHaveAttribute("aria-orientation", "horizontal");
  });
});

describe("Renamed and deleted notes", () => {
  it("a renamed note's tab shows its new name", async () => {
    await start();
    await open("Paper.typ");

    await userEvent.dblClick(explorer().getByText("Paper.typ"));
    await userEvent.keyboard("Draft{Enter}");

    expect(await screen.findByRole("tab", { name: "Draft" })).toBeInTheDocument();
  });
});

describe("From the command palette", () => {
  it("View: Close Tab closes the shown tab", async () => {
    await start();
    await open("Paper.typ");
    await chooseInMenu("View › Command Palette…");

    await userEvent.keyboard("close tab{Enter}");

    expect(shape()).toEqual([[]]);
  });
});

describe("Closing tabs", () => {
  /** Right-clicks a tab, and chooses in its menu. */
  async function inTabMenu(tab: string, item: string) {
    fireEvent.contextMenu(screen.getByRole("tab", { name: tab }), { clientX: 120, clientY: 40 });
    await userEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: item }));
  }
  async function threeTabs() {
    await start();
    await open("Paper.typ");
    await open("Ideas.md");
    await open("Plan.typ");
  }

  it("a tab's right-click menu offers to close it, the others, those to its right or left, or all", async () => {
    await threeTabs();

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Ideas" }), { clientX: 120, clientY: 40 });

    const items = within(await screen.findByRole("menu")).getAllByRole("menuitem").map((item) => item.textContent);
    expect(items.slice(0, 5)).toEqual(["Close", "Close Others", "Close to the Right", "Close to the Left", "Close All"]);
  });

  it("Close closes that tab", async () => {
    await threeTabs();

    await inTabMenu("Paper", "Close");

    expect(shape()).toEqual([["Ideas", "[Plan]"]]);
  });

  it("Close Others leaves only that tab, shown", async () => {
    await threeTabs();

    await inTabMenu("Ideas", "Close Others");

    expect(shape()).toEqual([["[Ideas]"]]);
  });

  it("Close to the Right closes the tabs after it; it's shown if the shown one went", async () => {
    await threeTabs();

    await inTabMenu("Paper", "Close to the Right");

    expect(shape()).toEqual([["[Paper]"]]);
  });

  it("Close to the Left closes the tabs before it, the shown one staying shown", async () => {
    await threeTabs();

    await inTabMenu("Ideas", "Close to the Left");

    expect(shape()).toEqual([["Ideas", "[Plan]"]]);
  });

  it("Close All closes every tab in the pane", async () => {
    await threeTabs();

    await inTabMenu("Ideas", "Close All");

    expect(shape()).toEqual([[]]);
  });

  it("only that pane's tabs are closed; a pane left empty closes", async () => {
    await threeTabs();
    await dragNote("Paper.typ", "right");

    fireEvent.contextMenu(within(panes()[1]).getByRole("tab", { name: "Paper" }), { clientX: 120, clientY: 40 });
    await userEvent.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Close All" }));

    expect(shape()).toEqual([["Ideas", "[Plan]"]]);
  });

  it("what would close nothing can't be chosen", async () => {
    await start();
    await open("Paper.typ");

    fireEvent.contextMenu(screen.getByRole("tab", { name: "Paper" }), { clientX: 120, clientY: 40 });
    const menu = await screen.findByRole("menu");

    expect(within(menu).getByRole("menuitem", { name: "Close Others" })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: "Close to the Right" })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: "Close to the Left" })).toBeDisabled();
    expect(within(menu).getByRole("menuitem", { name: "Close" })).toBeEnabled();
  });

  it("⌘W (File › Close Tab) closes the shown tab", async () => {
    await threeTabs();

    await chooseInMenu("File › Close Tab");

    expect(shape()).toEqual([["Paper", "[Ideas]"]]);
    expect(api.closeWindow).not.toHaveBeenCalled();
  });

  it("⌘W with no tab open closes the window", async () => {
    await start();
    await open("Paper.typ");
    await chooseInMenu("File › Close Tab");
    expect(shape()).toEqual([[]]);

    await chooseInMenu("File › Close Tab");

    expect(api.closeWindow).toHaveBeenCalled();
  });
});

// The graph view, like Obsidian's: a dot for each note and a line for each link between notes.
// It opens as a tab (View › Graph View, ⌘⇧G), so it can sit beside notes. Notes that are linked
// to but not created yet are shown faded. Clicking a note opens it beside the graph. Notes can be
// grabbed and moved around: the graph moves with them, like Obsidian's.

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": "", "Ideas.md": "", "Lonely.typ": "" };
  vi.mocked(api.listFiles).mockImplementation(async () => Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  vi.mocked(api.noteLinks).mockResolvedValue([
    { from: "Paper.typ", to: "Ideas.md" },
    { from: "Paper.typ", to: "Methods.typ" },
  ]);
  vi.mocked(api.createNoteAt).mockImplementation(async (path) => {
    notes[path] = "";
    return path;
  });
});

async function openGraph() {
  render(<App />);
  await screen.findByText("Paper.typ");
  await chooseInMenu("View › Graph View");
  return screen.findByRole("group", { name: "Graph of notes and links" });
}

/** Drags a tab to the right edge of its pane: it gets a pane of its own beside. */
async function dragTabToRight(name: string) {
  const content = screen.getAllByRole("tabpanel")[0];
  vi.spyOn(content, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);
  fireEvent.dragStart(screen.getByRole("tab", { name }));
  fireEvent.drop(content, { clientX: 950, clientY: 300 });
  await vi.waitFor(() => expect(screen.getAllByRole("region", { name: "Pane" })).toHaveLength(2));
}

const dots = (graph: HTMLElement) => within(graph).getAllByRole("button").map((dot) => dot.getAttribute("aria-label"));

describe("The graph view", () => {
  it("opens as a tab", async () => {
    await openGraph();

    expect(screen.getByRole("tab", { name: "Graph", selected: true })).toBeInTheDocument();
  });

  it("shows a dot for each note, and for notes linked to but not created yet", async () => {
    const graph = await openGraph();

    await vi.waitFor(() => expect(dots(graph)).toHaveLength(4));
    expect(dots(graph)).toEqual(expect.arrayContaining(["Paper", "Ideas", "Lonely", "Methods (not created yet)"]));
  });

  it("shows a line for each link", async () => {
    const graph = await openGraph();

    await vi.waitFor(() => expect(graph.querySelectorAll("line")).toHaveLength(2));
  });

  it("clicking a note opens it beside the graph, which stays open", async () => {
    const graph = await openGraph();
    await vi.waitFor(() => expect(dots(graph)).toHaveLength(4));

    await userEvent.click(within(graph).getByRole("button", { name: "Ideas" }));

    expect(await screen.findByRole("textbox", { name: "Ideas.md" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Graph of notes and links" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Pane" })).toHaveLength(2);
  });

  it("clicking a note that isn't created yet creates it", async () => {
    const graph = await openGraph();
    await vi.waitFor(() => expect(dots(graph)).toHaveLength(4));

    await userEvent.click(within(graph).getByRole("button", { name: "Methods (not created yet)" }));

    expect(await screen.findByRole("textbox", { name: "Methods.typ" })).toBeInTheDocument();
    expect(api.createNoteAt).toHaveBeenCalledWith("Methods.typ");
  });

  it("with a pane beside it already, notes open there", async () => {
    render(<App />);
    await userEvent.click(await screen.findByText("Lonely.typ"));
    await chooseInMenu("View › Graph View");
    await dragTabToRight("Graph");
    const graph = await screen.findByRole("group", { name: "Graph of notes and links" });
    await vi.waitFor(() => expect(dots(graph)).toHaveLength(4));

    await userEvent.click(within(graph).getByRole("button", { name: "Ideas" }));

    expect(await screen.findByRole("textbox", { name: "Ideas.md" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Pane" })).toHaveLength(2);
  });

  it("the open note stands out", async () => {
    render(<App />);
    await userEvent.click(await screen.findByText("Ideas.md"));
    await chooseInMenu("View › Graph View");
    await dragTabToRight("Graph");
    const graph = await screen.findByRole("group", { name: "Graph of notes and links" });
    await vi.waitFor(() => expect(dots(graph)).toHaveLength(4));

    // (The graph's pane is the active one now; the note is the last one shown.)
    expect(within(graph).getByRole("button", { name: "Ideas" })).toHaveAttribute("aria-current", "true");
  });

  it("hovering a note brings out its links and the notes it's linked with", async () => {
    const graph = await openGraph();
    await vi.waitFor(() => expect(dots(graph)).toHaveLength(4));

    fireEvent.mouseEnter(within(graph).getByRole("button", { name: "Ideas" }));

    expect(within(graph).getByRole("button", { name: "Paper" })).toHaveAttribute("data-near", "true");
    expect(within(graph).getByRole("button", { name: "Lonely" })).toHaveAttribute("data-near", "false");
  });

  it("follows the links as notes change", async () => {
    render(<App />);
    await userEvent.click(await screen.findByText("Paper.typ"));
    await chooseInMenu("View › Graph View");
    await dragTabToRight("Graph");
    const graph = await screen.findByRole("group", { name: "Graph of notes and links" });
    await vi.waitFor(() => expect(graph.querySelectorAll("line")).toHaveLength(2));
    vi.mocked(api.noteLinks).mockResolvedValue([{ from: "Paper.typ", to: "Ideas.md" }]);

    // Writing in the note beside it: once saved, the graph looks at the links again.
    const editor = await screen.findByRole("textbox", { name: "Paper.typ" });
    const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
    act(() => view.dispatch({ changes: { from: 0, insert: "Edited. " } }));

    await vi.waitFor(() => expect(graph.querySelectorAll("line")).toHaveLength(1), { timeout: 3000 });
  });

  it("a note can be grabbed and moved; the notes linked to it follow, and it doesn't open", async () => {
    const graph = await openGraph();
    await vi.waitFor(() => expect(dots(graph)).toHaveLength(4));
    const where = (name: string) => within(graph).getByRole("button", { name }).getAttribute("transform");
    const paperBefore = where("Paper");

    fireEvent.pointerDown(within(graph).getByRole("button", { name: "Ideas" }), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 400 });
    await vi.waitFor(() => expect(where("Paper")).not.toBe(paperBefore));
    fireEvent.pointerUp(window);

    expect(where("Ideas")).toBe("translate(400 400)");
    expect(screen.queryByRole("textbox", { name: "Ideas.md" })).not.toBeInTheDocument();
  });

  it("the command palette can open it too", async () => {
    render(<App />);
    await screen.findByText("Paper.typ");
    await chooseInMenu("View › Command Palette…");

    await userEvent.keyboard("graph{Enter}");

    expect(await screen.findByRole("group", { name: "Graph of notes and links" })).toBeInTheDocument();
  });
});

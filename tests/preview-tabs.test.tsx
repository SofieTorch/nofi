// Preview tabs, like VS Code's: a file opened by a click (in the explorer, a link, the palette, the
// graph) opens in a preview tab, its name in italics. Opening another file replaces the preview
// instead of adding a tab, so tabs don't pile up. Typing in the note, or double-clicking its tab,
// keeps it: it becomes an ordinary tab. A new note is kept from the start. ⌘-click (Ctrl here) on
// a file in the explorer opens it in a new pane, beside the active one.

import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
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
/** Each pane's tabs: [shown], and (preview) for a preview tab. */
const shape = () =>
  panes().map((pane) =>
    within(pane)
      .queryAllByRole("tab")
      .map((tab) => {
        const name = tab.getAttribute("aria-label")!;
        const preview = tab.getAttribute("aria-description") === "Preview" ? ` (preview)` : "";
        return tab.getAttribute("aria-selected") === "true" ? `[${name}${preview}]` : `${name}${preview}`;
      }),
  );

async function start() {
  render(<App />);
  await screen.findByText("Paper.typ");
}

/** Clicks a file in the explorer (holding a key, maybe). */
async function open(name: string, holding?: string) {
  const user = userEvent.setup();
  if (holding) await user.keyboard(`{${holding}>}`);
  await user.click(explorer().getByText(name));
  if (holding) await user.keyboard(`{/${holding}}`);
  return screen.findByRole("textbox", { name });
}

describe("Preview tabs", () => {
  it("a file opened from the explorer opens in a preview tab, in italics", async () => {
    await start();

    await open("Paper.typ");

    expect(shape()).toEqual([["[Paper (preview)]"]]);
    expect(screen.getByRole("tab", { name: "Paper" }).querySelector(".italic")).not.toBeNull();
  });

  it("opening another file replaces the preview", async () => {
    await start();
    await open("Paper.typ");

    await open("Ideas.md");

    expect(shape()).toEqual([["[Ideas (preview)]"]]);
  });

  it("typing in it keeps it, so the next file opens in a new tab", async () => {
    await start();
    const editor = await open("Paper.typ");
    const view = EditorView.findFromDOM(editor)!;
    act(() => view.focus());
    await userEvent.keyboard("Hi ");

    await open("Ideas.md");

    expect(shape()).toEqual([["Paper", "[Ideas (preview)]"]]);
  });

  it("double-clicking its tab keeps it", async () => {
    await start();
    await open("Paper.typ");

    await userEvent.dblClick(screen.getByRole("tab", { name: "Paper" }));
    await open("Ideas.md");

    expect(shape()).toEqual([["Paper", "[Ideas (preview)]"]]);
  });

  it("a file open already is just shown, and the preview stays", async () => {
    await start();
    await open("Paper.typ");
    await userEvent.dblClick(screen.getByRole("tab", { name: "Paper" }));
    await open("Ideas.md");

    await open("Paper.typ");

    expect(shape()).toEqual([["[Paper]", "Ideas (preview)"]]);
  });

  it("a new note is kept from the start", async () => {
    vi.mocked(api.createNote).mockResolvedValue("Untitled.typ");
    vi.mocked(api.readNote).mockResolvedValue("");
    await start();

    await chooseInMenu("File › New Note");

    await screen.findByRole("textbox", { name: "Untitled.typ" });
    expect(shape()).toEqual([["[Untitled]"]]);
  });

  it("each pane has its own preview", async () => {
    await start();
    await open("Paper.typ");

    await open("Ideas.md", "Control");
    await open("Plan.typ");

    expect(shape()).toEqual([["[Paper (preview)]"], ["[Plan (preview)]"]]);
  });
});

describe("⌘-click in the explorer", () => {
  it("opens the file in a new pane, beside the active one", async () => {
    await start();
    await open("Paper.typ");

    await open("Ideas.md", "Control");

    expect(shape()).toEqual([["[Paper (preview)]"], ["[Ideas (preview)]"]]);
  });

  it("with nothing open, it just opens it", async () => {
    await start();

    await open("Ideas.md", "Control");

    expect(shape()).toEqual([["[Ideas (preview)]"]]);
  });
});

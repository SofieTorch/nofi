// Settings: a panel, opened from the app's menu (Marginalia › Settings…, ⌘,), for how the app
// behaves in every workspace: whether blocks show handles to drag them around, and what boards are
// drawn on (plain white, the default; or a grid, like Miro's).

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
  vi.mocked(api.listFiles).mockResolvedValue([file("Paper.typ")]);
  vi.mocked(api.readNote).mockResolvedValue("First.\n\nSecond.");
});

async function openSettings() {
  render(<App />);
  await screen.findByRole("heading", { name: "Research" });
  await chooseInMenu("Marginalia › Settings…");
  return screen.getByRole("dialog", { name: "Settings" });
}

async function openNote() {
  await userEvent.click(await screen.findByRole("button", { name: "Paper.typ" }));
  return screen.findByRole("textbox", { name: "Paper.typ" });
}

/** Whether hovering a line of the note shows its handle. */
function handleShownOnHover(editor: HTMLElement) {
  fireEvent.mouseMove(within(editor).getByText("Second."));
  return !!document.querySelector(".cm-block-handle-shown");
}

describe("The settings panel", () => {
  it("opens from the app's menu", async () => {
    const settings = await openSettings();

    expect(within(settings).getByRole("heading", { name: "Settings" })).toBeInTheDocument();
  });

  it("closes with Escape", async () => {
    await openSettings();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("closes with its close button", async () => {
    const settings = await openSettings();

    await userEvent.click(within(settings).getByRole("button", { name: "Close" }));

    expect(screen.queryByRole("dialog", { name: "Settings" })).not.toBeInTheDocument();
  });
});

describe("Block handles setting", () => {
  it("is on at first", async () => {
    const settings = await openSettings();

    expect(within(settings).getByRole("switch", { name: "Block handles" })).toBeChecked();
  });

  it("turned off, blocks don't show a handle", async () => {
    const settings = await openSettings();
    await userEvent.click(within(settings).getByRole("switch", { name: "Block handles" }));
    await userEvent.keyboard("{Escape}");

    const editor = await openNote();

    expect(handleShownOnHover(editor)).toBe(false);
  });

  it("turned on again, they do", async () => {
    vi.mocked(api.getEditorSettings).mockResolvedValue({ blockHandles: false, boardBackground: "plain" });
    const settings = await openSettings();
    await userEvent.click(within(settings).getByRole("switch", { name: "Block handles" }));
    await userEvent.keyboard("{Escape}");

    const editor = await openNote();

    expect(handleShownOnHover(editor)).toBe(true);
  });

  it("the choice is saved for next time", async () => {
    const settings = await openSettings();

    await userEvent.click(within(settings).getByRole("switch", { name: "Block handles" }));

    expect(api.saveEditorSettings).toHaveBeenCalledWith({ blockHandles: false, boardBackground: "plain" });
  });

  it("a choice saved before is used straight away", async () => {
    vi.mocked(api.getEditorSettings).mockResolvedValue({ blockHandles: false, boardBackground: "plain" });
    render(<App />);

    const editor = await openNote();

    await vi.waitFor(() => expect(handleShownOnHover(editor)).toBe(false));
  });
});

describe("Board background setting", () => {
  beforeEach(() => {
    vi.mocked(api.listFiles).mockResolvedValue([file("Paper.typ"), file("Ideas.canvas")]);
    vi.mocked(api.readNote).mockResolvedValue("");
  });

  const openBoard = async () => {
    await userEvent.click(await screen.findByRole("button", { name: "Ideas.canvas" }));
    return screen.findByRole("group", { name: "Board" });
  };

  it("is plain at first", async () => {
    const settings = await openSettings();

    expect(within(settings).getByRole("radio", { name: "Plain" })).toBeChecked();
    await userEvent.keyboard("{Escape}");
    expect(await openBoard()).toHaveAttribute("data-background", "plain");
  });

  it("can be a grid, and the choice is saved", async () => {
    const settings = await openSettings();

    await userEvent.click(within(settings).getByRole("radio", { name: "Grid" }));
    await userEvent.keyboard("{Escape}");

    expect(await openBoard()).toHaveAttribute("data-background", "grid");
    expect(api.saveEditorSettings).toHaveBeenCalledWith({ blockHandles: true, boardBackground: "grid" });
  });
});

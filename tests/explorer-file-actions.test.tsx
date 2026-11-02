// Renaming and deleting files from the explorer. Double-clicking a file's name, or right-click ›
// Rename, lets you type a new name (the extension stays). Right-click › Delete asks first, then
// sends the file to the system's Trash.

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

let files: string[];

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  files = ["Paper.typ", "Ideas.md", "attention.pdf"];
  // Like the real backend: the explorer lists what's on disk now.
  vi.mocked(api.listFiles).mockImplementation(async () => files.map(file));
  vi.mocked(api.readNote).mockResolvedValue("Some text.");
  vi.mocked(api.renameNote).mockImplementation(async (path, newName) => {
    const renamed = path.replace(/[^/]*?(\.[^./]+)?$/, `${newName}$1`);
    files = files.map((f) => (f === path ? renamed : f));
    return renamed;
  });
  vi.mocked(api.deleteFile).mockImplementation(async (path) => {
    files = files.filter((f) => f !== path);
  });
});

const explorer = () => within(screen.getByLabelText("File explorer", { selector: "aside" }));

async function openWorkspace() {
  render(<App />);
  await screen.findByText("Paper.typ");
}

function rightClick(name: string) {
  fireEvent.contextMenu(explorer().getByText(name), { clientX: 40, clientY: 80 });
  return screen.getByRole("menu");
}

describe("Renaming a file from the explorer", () => {
  it("double-clicking its name lets you type a new one", async () => {
    await openWorkspace();

    await userEvent.dblClick(explorer().getByText("Paper.typ"));

    const field = screen.getByRole("textbox", { name: "Note name" });
    expect(field).toHaveValue("Paper");
    expect(field).toHaveFocus();
  });

  it("Enter renames it", async () => {
    await openWorkspace();
    await userEvent.dblClick(explorer().getByText("Paper.typ"));

    await userEvent.keyboard("Draft{Enter}");

    expect(api.renameNote).toHaveBeenCalledWith("Paper.typ", "Draft");
    expect(await explorer().findByText("Draft.typ")).toBeInTheDocument();
  });

  it("right-click › Rename does the same", async () => {
    await openWorkspace();

    await userEvent.click(within(rightClick("Ideas.md")).getByRole("menuitem", { name: "Rename" }));
    await userEvent.keyboard("Plans{Enter}");

    expect(api.renameNote).toHaveBeenCalledWith("Ideas.md", "Plans");
    expect(await explorer().findByText("Plans.md")).toBeInTheDocument();
  });

  it("Escape keeps the old name", async () => {
    await openWorkspace();
    await userEvent.dblClick(explorer().getByText("Paper.typ"));

    await userEvent.keyboard("Draft{Escape}");

    expect(api.renameNote).not.toHaveBeenCalled();
    expect(explorer().getByText("Paper.typ")).toBeInTheDocument();
  });

  it("any file can be renamed, not only notes", async () => {
    await openWorkspace();

    await userEvent.dblClick(explorer().getByText("attention.pdf"));
    await userEvent.keyboard("Attention paper{Enter}");

    expect(api.renameNote).toHaveBeenCalledWith("attention.pdf", "Attention paper");
    expect(await explorer().findByText("Attention paper.pdf")).toBeInTheDocument();
  });

  it("the open note stays open under its new name", async () => {
    await openWorkspace();
    await userEvent.click(explorer().getByText("Paper.typ"));
    await screen.findByRole("textbox", { name: "Paper.typ" });

    await userEvent.dblClick(explorer().getByText("Paper.typ"));
    await userEvent.keyboard("Draft{Enter}");

    expect(await screen.findByRole("textbox", { name: "Draft.typ" })).toBeInTheDocument();
  });

  it("renaming another file doesn't open it", async () => {
    await openWorkspace();
    await userEvent.click(explorer().getByText("Paper.typ"));
    await screen.findByRole("textbox", { name: "Paper.typ" });

    await userEvent.click(within(rightClick("Ideas.md")).getByRole("menuitem", { name: "Rename" }));
    await userEvent.keyboard("Plans{Enter}");

    await explorer().findByText("Plans.md");
    expect(screen.getByRole("textbox", { name: "Paper.typ" })).toBeInTheDocument();
  });

  it("Edit › Undo gives it its old name back", async () => {
    await openWorkspace();
    await userEvent.dblClick(explorer().getByText("attention.pdf"));
    await userEvent.keyboard("Attention{Enter}");
    await explorer().findByText("Attention.pdf");

    await chooseInMenu("Edit › Undo");

    expect(await explorer().findByText("attention.pdf")).toBeInTheDocument();
  });
});

describe("Deleting a file from the explorer", () => {
  it("right-click › Delete asks first, saying it goes to the Trash", async () => {
    await openWorkspace();

    await userEvent.click(within(rightClick("Paper.typ")).getByRole("menuitem", { name: "Delete" }));

    const dialog = screen.getByRole("alertdialog", { name: "Delete “Paper.typ”?" });
    expect(dialog).toHaveTextContent("Trash");
    expect(api.deleteFile).not.toHaveBeenCalled();
  });

  it("Cancel keeps the file", async () => {
    await openWorkspace();
    await userEvent.click(within(rightClick("Paper.typ")).getByRole("menuitem", { name: "Delete" }));

    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.deleteFile).not.toHaveBeenCalled();
    expect(explorer().getByText("Paper.typ")).toBeInTheDocument();
  });

  it("Escape keeps the file too", async () => {
    await openWorkspace();
    await userEvent.click(within(rightClick("Paper.typ")).getByRole("menuitem", { name: "Delete" }));

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(api.deleteFile).not.toHaveBeenCalled();
  });

  it("confirming deletes it, and it leaves the explorer", async () => {
    await openWorkspace();
    await userEvent.click(within(rightClick("attention.pdf")).getByRole("menuitem", { name: "Delete" }));

    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    expect(api.deleteFile).toHaveBeenCalledWith("attention.pdf");
    await vi.waitFor(() => expect(explorer().queryByText("attention.pdf")).not.toBeInTheDocument());
  });

  it("deleting the open note closes it", async () => {
    await openWorkspace();
    await userEvent.click(explorer().getByText("Paper.typ"));
    await screen.findByRole("textbox", { name: "Paper.typ" });

    await userEvent.click(within(rightClick("Paper.typ")).getByRole("menuitem", { name: "Delete" }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    await vi.waitFor(() => expect(screen.queryByRole("textbox", { name: "Paper.typ" })).not.toBeInTheDocument());
  });

  it("when it can't be deleted, says why", async () => {
    vi.mocked(api.deleteFile).mockRejectedValueOnce("Permission denied.");
    await openWorkspace();
    await userEvent.click(within(rightClick("Paper.typ")).getByRole("menuitem", { name: "Delete" }));

    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete “Paper.typ”: Permission denied.");
    expect(explorer().getByText("Paper.typ")).toBeInTheDocument();
  });
});

describe("The right-click menu", () => {
  it("closes with Escape", async () => {
    await openWorkspace();
    rightClick("Paper.typ");

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes when clicking somewhere else", async () => {
    await openWorkspace();
    rightClick("Paper.typ");

    await userEvent.click(screen.getByRole("main"));

    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

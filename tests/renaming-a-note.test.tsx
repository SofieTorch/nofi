import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const researchNotes: api.Workspace = { name: "Research Notes", path: "/Users/me/Research Notes" };

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue(researchNotes);
  // Like the real backend: creating lists the new note, renaming lists it under its new name.
  vi.mocked(api.createNote).mockImplementation(async () => {
    vi.mocked(api.listFiles).mockResolvedValue([file("Untitled.typ")]);
    return "Untitled.typ";
  });
  vi.mocked(api.renameNote).mockImplementation(async (_path, newName) => {
    vi.mocked(api.listFiles).mockResolvedValue([file(`${newName}.typ`)]);
    return `${newName}.typ`;
  });
});

async function createANote() {
  render(<App />);
  await screen.findByRole("heading", { name: "Research Notes", hidden: true });
  await chooseInMenu("File › New Note");
  return nameField();
}

const explorer = () => screen.getByLabelText("File explorer", { selector: "aside" });
const nameField = () => screen.findByRole<HTMLInputElement>("textbox", { name: "Note name" });

describe("Naming a note right after creating it", () => {
  it("shows the new note's name as a field you can type into straight away", async () => {
    const field = await createANote();

    expect(field).toHaveValue("Untitled");
    expect(field).toHaveFocus();
  });

  it("selects the whole name, so typing replaces 'Untitled'", async () => {
    const field = await createANote();

    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe("Untitled".length);
  });

  it("shows the note's format next to the field, but you don't have to type it", async () => {
    const field = await createANote();

    expect(field.parentElement).toHaveTextContent(".typ");
    expect(field).not.toHaveValue(expect.stringContaining(".typ"));
  });

  it("Enter gives the note the typed name", async () => {
    await createANote();

    await userEvent.keyboard("Reading list{Enter}");

    expect(api.renameNote).toHaveBeenCalledWith("Untitled.typ", "Reading list");
    expect(await screen.findByText("Reading list.typ")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Note name" })).not.toBeInTheDocument();
  });

  it("keeps the renamed note highlighted", async () => {
    await createANote();

    await userEvent.keyboard("Ideas{Enter}");

    await vi.waitFor(() =>
      expect(screen.getByRole("listitem", { current: true })).toHaveTextContent("Ideas.typ"),
    );
  });

  it("clicking somewhere else also gives the note the typed name", async () => {
    await createANote();

    await userEvent.keyboard("Ideas");
    await userEvent.click(screen.getByRole("main"));

    expect(api.renameNote).toHaveBeenCalledWith("Untitled.typ", "Ideas");
    expect(await screen.findByText("Ideas.typ")).toBeInTheDocument();
  });

  it("Escape keeps the name 'Untitled'", async () => {
    await createANote();

    await userEvent.keyboard("Ideas{Escape}");

    expect(api.renameNote).not.toHaveBeenCalled();
    expect(screen.getByText("Untitled.typ")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Note name" })).not.toBeInTheDocument();
  });

  it("leaving the name as it is doesn't rename anything", async () => {
    await createANote();

    await userEvent.keyboard("{Enter}");

    expect(api.renameNote).not.toHaveBeenCalled();
    expect(screen.getByText("Untitled.typ")).toBeInTheDocument();
  });

  it("when the name can't be used, explains why and lets you fix it", async () => {
    vi.mocked(api.renameNote).mockRejectedValueOnce('There\'s already a note called "Ideas".');
    const field = await createANote();

    await userEvent.keyboard("Ideas{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      'There\'s already a note called "Ideas".',
    );
    expect(field).toHaveFocus();
    expect(field).toHaveValue("Ideas");

    await userEvent.keyboard(" 2{Enter}");

    expect(await screen.findByText("Ideas 2.typ")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("the auto-hidden explorer stays open until the note is named", async () => {
    vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "left", mode: "auto-hide" });
    await createANote();

    expect(explorer()).toHaveAttribute("aria-hidden", "false");

    await userEvent.keyboard("Ideas{Enter}");

    await vi.waitFor(() => expect(explorer()).toHaveAttribute("aria-hidden", "true"));
  });
});

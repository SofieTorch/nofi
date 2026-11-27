import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const researchNotes: api.Workspace = { name: "Research Notes", path: "/Users/me/Research Notes" };

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue(researchNotes);
});

async function renderOpenWorkspace() {
  render(<App />);
  await screen.findByRole("heading", { name: "Research Notes", hidden: true });
}

/** After a note is created, the backend lists it along with what was there before. */
function backendCreates(path: string, before: api.FileEntry[] = []) {
  vi.mocked(api.createNote).mockImplementation(async () => {
    vi.mocked(api.listFiles).mockResolvedValue([...before, file(path)]);
    return path;
  });
}

/** A new note's name starts as a field to type over (see renaming-a-note); Escape keeps "Untitled". */
async function keepItsName() {
  await screen.findByRole("textbox", { name: "Note name" });
  await userEvent.keyboard("{Escape}");
}

const newNoteButton = () => screen.getByRole("button", { name: /new note/i });
const highlightedNote = () => screen.queryByRole("listitem", { current: true });

describe("Creating a new note", () => {
  it("File › New Note creates a note in the default format (Typst)", async () => {
    await renderOpenWorkspace();

    await chooseInMenu("File › New Note");

    expect(api.createNote).toHaveBeenCalledWith();
  });

  it("File › New Markdown Note creates a Markdown note", async () => {
    await renderOpenWorkspace();

    await chooseInMenu("File › New Markdown Note");

    expect(api.createNote).toHaveBeenCalledWith("markdown");
  });

  it("the explorer's 'new note' button creates a note in the default format", async () => {
    await renderOpenWorkspace();

    await userEvent.click(newNoteButton());

    expect(api.createNote).toHaveBeenCalledWith();
  });

  it("shows the new note in the explorer, next to the files already there", async () => {
    vi.mocked(api.listFiles).mockResolvedValue([folder("Papers")]);
    backendCreates("Untitled.typ", [folder("Papers")]);
    await renderOpenWorkspace();

    await chooseInMenu("File › New Note");
    await keepItsName();

    expect(await screen.findByText("Untitled.typ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Papers" })).toBeInTheDocument();
  });

  it("highlights the new note in the explorer", async () => {
    backendCreates("Untitled.typ");
    await renderOpenWorkspace();

    await chooseInMenu("File › New Note");
    await keepItsName();

    await vi.waitFor(() => expect(highlightedNote()).toHaveTextContent("Untitled.typ"));
  });

  it("highlights only the newest note when several are created", async () => {
    backendCreates("Untitled.typ");
    await renderOpenWorkspace();
    await chooseInMenu("File › New Note");
    await keepItsName();
    backendCreates("Untitled 2.typ", [file("Untitled.typ")]);

    await chooseInMenu("File › New Note");
    await keepItsName();

    await vi.waitFor(() => expect(highlightedNote()).toHaveTextContent("Untitled 2.typ"));
    expect(screen.getAllByRole("listitem", { current: true })).toHaveLength(1);
  });

  it("explains when the note can't be created", async () => {
    vi.mocked(api.createNote).mockRejectedValue("Permission denied");
    await renderOpenWorkspace();

    await chooseInMenu("File › New Note");

    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
  });
});

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const researchNotes: api.Workspace = { name: "Research Notes", path: "/Users/me/Research Notes" };

beforeEach(setUpFakeBackend);

const thesis: api.Workspace = { name: "Thesis", path: "/Users/me/Thesis" };

const chooseFolderButton = () => screen.findByRole("button", { name: /choose a folder/i });

describe("Choosing a workspace folder", () => {
  it("asks the user to choose a folder for their notes on first launch", async () => {
    render(<App />);

    expect(await chooseFolderButton()).toBeInTheDocument();
  });

  it("opens the last used workspace directly, without asking again", async () => {
    vi.mocked(api.getLastWorkspace).mockResolvedValue(researchNotes);

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Research Notes", hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /choose a folder/i })).not.toBeInTheDocument();
  });

  it("does not flash the folder prompt while checking for a previous workspace", () => {
    vi.mocked(api.getLastWorkspace).mockReturnValue(new Promise(() => {}));

    render(<App />);

    expect(screen.queryByRole("button", { name: /choose a folder/i })).not.toBeInTheDocument();
  });

  it("opens the folder the user picks as their workspace", async () => {
    vi.mocked(api.pickFolder).mockResolvedValue(researchNotes.path);
    vi.mocked(api.openWorkspace).mockResolvedValue(researchNotes);
    render(<App />);

    await userEvent.click(await chooseFolderButton());

    expect(api.openWorkspace).toHaveBeenCalledWith(researchNotes.path);
    expect(await screen.findByRole("heading", { name: "Research Notes", hidden: true })).toBeInTheDocument();
  });

  it("keeps asking for a folder if the user cancels the folder picker", async () => {
    vi.mocked(api.pickFolder).mockResolvedValue(null);
    render(<App />);

    await userEvent.click(await chooseFolderButton());

    expect(api.openWorkspace).not.toHaveBeenCalled();
    expect(await chooseFolderButton()).toBeInTheDocument();
  });

  it("explains why a folder can't be used and lets the user pick another one", async () => {
    vi.mocked(api.pickFolder).mockResolvedValue("/Users/me/gone");
    vi.mocked(api.openWorkspace).mockRejectedValue("This folder doesn't exist anymore.");
    render(<App />);

    await userEvent.click(await chooseFolderButton());

    expect(await screen.findByRole("alert")).toHaveTextContent("This folder doesn't exist anymore.");
    expect(await chooseFolderButton()).toBeEnabled();
  });
});

describe("Recent workspaces in the picker", () => {
  it("shows no recent workspaces list when no workspace was opened before", async () => {
    render(<App />);
    await chooseFolderButton();

    expect(screen.queryByRole("list", { name: /recent workspaces/i })).not.toBeInTheDocument();
  });

  it("lists recent workspaces in the order the backend gives (most recent first)", async () => {
    vi.mocked(api.getRecentWorkspaces).mockResolvedValue([thesis, researchNotes]);
    render(<App />);

    const list = await screen.findByRole("list", { name: /recent workspaces/i });

    const items = within(list).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Thesis");
    expect(items[1]).toHaveTextContent("Research Notes");
  });

  /** Two workspaces can share a folder name, so the location tells them apart. */
  it("shows where each recent workspace is located", async () => {
    vi.mocked(api.getRecentWorkspaces).mockResolvedValue([researchNotes]);
    render(<App />);

    const list = await screen.findByRole("list", { name: /recent workspaces/i });

    expect(list).toHaveTextContent("/Users/me/Research Notes");
  });

  it("opens a recent workspace when the user clicks it, without the folder picker", async () => {
    vi.mocked(api.getRecentWorkspaces).mockResolvedValue([researchNotes]);
    vi.mocked(api.openWorkspace).mockResolvedValue(researchNotes);
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /research notes/i }));

    expect(api.pickFolder).not.toHaveBeenCalled();
    expect(api.openWorkspace).toHaveBeenCalledWith(researchNotes.path);
    expect(await screen.findByRole("heading", { name: "Research Notes", hidden: true })).toBeInTheDocument();
  });

  it("explains why a recent workspace can't be opened, e.g. if it was moved meanwhile", async () => {
    vi.mocked(api.getRecentWorkspaces).mockResolvedValue([researchNotes]);
    vi.mocked(api.openWorkspace).mockRejectedValue("This folder doesn't exist anymore.");
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /research notes/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This folder doesn't exist anymore.");
  });
});

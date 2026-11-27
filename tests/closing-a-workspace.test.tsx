import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, setUpFakeBackend } from "./support/fake-backend";

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

describe("Closing the workspace from the File menu", () => {
  it("File › Close Workspace brings back the workspace picker", async () => {
    await renderOpenWorkspace();

    await chooseInMenu("File › Close Workspace");

    expect(await screen.findByRole("button", { name: /choose a folder/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Research Notes" })).not.toBeInTheDocument();
  });

  it("File › Close Workspace tells the backend, so the workspace isn't reopened on next launch", async () => {
    await renderOpenWorkspace();

    await chooseInMenu("File › Close Workspace");

    expect(api.closeWorkspace).toHaveBeenCalled();
  });

  it("offers the workspace just closed in the recent workspaces list", async () => {
    await renderOpenWorkspace();
    vi.mocked(api.getRecentWorkspaces).mockResolvedValue([researchNotes]);

    await chooseInMenu("File › Close Workspace");

    const list = await screen.findByRole("list", { name: /recent workspaces/i });
    expect(list).toHaveTextContent("Research Notes");
  });

  /** Like other editors, closing lives in the File menu rather than taking space in the workspace. */
  it("the workspace screen has no close button of its own", async () => {
    await renderOpenWorkspace();

    expect(screen.queryByRole("button", { name: /close workspace/i })).not.toBeInTheDocument();
  });
});

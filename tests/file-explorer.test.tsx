import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { chooseInMenu, file, filesChangedOnDisk, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const researchNotes: api.Workspace = { name: "Research Notes", path: "/Users/me/Research Notes" };

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue(researchNotes);
});

async function renderOpenWorkspace() {
  render(<App />);
  await screen.findByRole("heading", { name: "Research Notes" });
}

const explorer = () => screen.queryByRole("complementary", { name: "File explorer" });
const hoverEdge = () => screen.getByLabelText("Show file explorer");
const pinButton = () => screen.getByRole("button", { name: /pin file explorer/i });
const topBar = () => screen.getByRole("banner");
const sideOf = (element: HTMLElement | null) => element?.getAttribute("data-side");

describe("Top bar", () => {
  it("shows the name of the open workspace", async () => {
    await renderOpenWorkspace();

    expect(within(topBar()).getByRole("heading", { name: "Research Notes" })).toBeInTheDocument();
  });
});

describe("File explorer: what it shows", () => {
  it("shows the files and folders of the open workspace", async () => {
    vi.mocked(api.listFiles).mockResolvedValue([folder("Papers"), file("ideas.md")]);

    await renderOpenWorkspace();

    expect(await screen.findByRole("button", { name: "Papers" })).toBeInTheDocument();
    expect(screen.getByText("ideas.md")).toBeInTheDocument();
  });

  it("shows folders collapsed at first, hiding what's inside", async () => {
    vi.mocked(api.listFiles).mockResolvedValue([
      folder("Papers", [file("Papers/attention.pdf")]),
    ]);

    await renderOpenWorkspace();

    const papers = await screen.findByRole("button", { name: "Papers" });
    expect(papers).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("attention.pdf")).not.toBeInTheDocument();
  });

  it("expands a folder when clicked, showing what's inside", async () => {
    vi.mocked(api.listFiles).mockResolvedValue([
      folder("Papers", [file("Papers/attention.pdf")]),
    ]);
    await renderOpenWorkspace();

    await userEvent.click(await screen.findByRole("button", { name: "Papers" }));

    expect(screen.getByRole("button", { name: "Papers" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("attention.pdf")).toBeInTheDocument();
  });

  it("collapses an expanded folder when clicked again", async () => {
    vi.mocked(api.listFiles).mockResolvedValue([
      folder("Papers", [file("Papers/attention.pdf")]),
    ]);
    await renderOpenWorkspace();
    const papers = await screen.findByRole("button", { name: "Papers" });

    await userEvent.click(papers);
    await userEvent.click(papers);

    expect(screen.queryByText("attention.pdf")).not.toBeInTheDocument();
  });

  it("can open folders inside folders", async () => {
    vi.mocked(api.listFiles).mockResolvedValue([
      folder("Papers", [folder("Papers/2024", [file("Papers/2024/attention.pdf")])]),
    ]);
    await renderOpenWorkspace();

    await userEvent.click(await screen.findByRole("button", { name: "Papers" }));
    await userEvent.click(screen.getByRole("button", { name: "2024" }));

    expect(screen.getByText("attention.pdf")).toBeInTheDocument();
  });

  it("tells the user when the workspace has no files yet", async () => {
    await renderOpenWorkspace();

    expect(await screen.findByText(/this workspace is empty/i)).toBeInTheDocument();
  });

  it("explains when the files can't be listed", async () => {
    vi.mocked(api.listFiles).mockRejectedValue("Permission denied");

    await renderOpenWorkspace();

    expect(await screen.findByRole("alert")).toHaveTextContent("Permission denied");
  });
});

describe("File explorer: left or right side", () => {
  it("is on the left in a new workspace", async () => {
    await renderOpenWorkspace();

    expect(sideOf(explorer())).toBe("left");
  });

  it("opens on the side that was saved for this workspace", async () => {
    vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "right", mode: "pinned" });

    await renderOpenWorkspace();

    expect(sideOf(explorer())).toBe("right");
  });

  it("moves to the right with the top bar's 'explorer on the right' button", async () => {
    await renderOpenWorkspace();

    await userEvent.click(within(topBar()).getByRole("button", { name: /explorer on the right/i }));

    expect(sideOf(explorer())).toBe("right");
  });

  it("moves back to the left with the top bar's 'explorer on the left' button", async () => {
    vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "right", mode: "pinned" });
    await renderOpenWorkspace();

    await userEvent.click(within(topBar()).getByRole("button", { name: /explorer on the left/i }));

    expect(sideOf(explorer())).toBe("left");
  });

  it("the top bar shows which side the explorer is on", async () => {
    await renderOpenWorkspace();

    const left = within(topBar()).getByRole("button", { name: /explorer on the left/i });
    const right = within(topBar()).getByRole("button", { name: /explorer on the right/i });
    expect(left).toHaveAttribute("aria-pressed", "true");
    expect(right).toHaveAttribute("aria-pressed", "false");
  });

  /** Layout controls live in the top bar, like in VS Code, not inside the explorer itself. */
  it("the explorer itself has no buttons to move it", async () => {
    await renderOpenWorkspace();

    expect(within(explorer()!).queryByRole("button", { name: /move|explorer on the/i })).not.toBeInTheDocument();
  });

  it("moves to the other side with View › Move File Explorer to Other Side", async () => {
    await renderOpenWorkspace();

    await chooseInMenu("View › Move File Explorer to Other Side");

    expect(sideOf(explorer())).toBe("right");
  });

  it("remembers the new side for this workspace", async () => {
    await renderOpenWorkspace();

    await chooseInMenu("View › Move File Explorer to Other Side");

    expect(api.saveExplorerLayout).toHaveBeenCalledWith({ side: "right", mode: "pinned" });
  });
});

describe("File explorer: pinned or auto-hidden", () => {
  it("is pinned, always visible, in a new workspace", async () => {
    await renderOpenWorkspace();

    expect(explorer()).toBeInTheDocument();
    expect(pinButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("hides when unpinned", async () => {
    await renderOpenWorkspace();

    await userEvent.click(pinButton());

    expect(explorer()).not.toBeInTheDocument();
  });

  it("when hidden, shows up while the mouse is over its edge of the window", async () => {
    await renderOpenWorkspace();
    await userEvent.click(pinButton());

    await userEvent.hover(hoverEdge());

    expect(explorer()).toBeInTheDocument();
  });

  it("when hidden, hides again once the mouse leaves it", async () => {
    await renderOpenWorkspace();
    await userEvent.click(pinButton());
    await userEvent.hover(hoverEdge());

    await userEvent.unhover(hoverEdge());

    expect(explorer()).not.toBeInTheDocument();
  });

  it("when hidden, its hover edge is on the explorer's side of the window", async () => {
    vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "right", mode: "auto-hide" });

    await renderOpenWorkspace();

    expect(sideOf(hoverEdge())).toBe("right");
  });

  it("when hidden, keeps open folders open between hovers", async () => {
    vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "left", mode: "auto-hide" });
    vi.mocked(api.listFiles).mockResolvedValue([
      folder("Papers", [file("Papers/attention.pdf")]),
    ]);
    await renderOpenWorkspace();
    await userEvent.hover(hoverEdge());
    await userEvent.click(await screen.findByRole("button", { name: "Papers" }));

    await userEvent.unhover(hoverEdge());
    await userEvent.hover(hoverEdge());

    expect(screen.getByRole("button", { name: "Papers" })).toHaveAttribute("aria-expanded", "true");
  });

  it("stays visible when pinned again while it's shown by hovering", async () => {
    await renderOpenWorkspace();
    await userEvent.click(pinButton());
    await userEvent.hover(hoverEdge());

    await userEvent.click(pinButton());
    await userEvent.unhover(explorer()!);

    expect(explorer()).toBeInTheDocument();
    expect(pinButton()).toHaveAttribute("aria-pressed", "true");
  });

  it("can be unpinned and pinned again with View › Pin File Explorer", async () => {
    await renderOpenWorkspace();

    await chooseInMenu("View › Pin File Explorer");
    expect(explorer()).not.toBeInTheDocument();

    await chooseInMenu("View › Pin File Explorer");
    expect(explorer()).toBeInTheDocument();
  });

  it("opens hidden if that's how it was left in this workspace", async () => {
    vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "left", mode: "auto-hide" });

    await renderOpenWorkspace();

    expect(explorer()).not.toBeInTheDocument();
    expect(hoverEdge()).toBeInTheDocument();
  });

  it("remembers whether it's pinned for this workspace", async () => {
    await renderOpenWorkspace();

    await userEvent.click(pinButton());

    expect(api.saveExplorerLayout).toHaveBeenCalledWith({ side: "left", mode: "auto-hide" });
  });
});

describe("File explorer: keeping up with the folder", () => {
  it("a file made outside the app (in Finder, another app, a sync) shows up by itself", async () => {
    vi.mocked(api.listFiles).mockResolvedValue([file("ideas.md")]);
    await renderOpenWorkspace();
    await screen.findByText("ideas.md");

    vi.mocked(api.listFiles).mockResolvedValue([file("ideas.md"), file("Downloaded.pdf")]);
    await filesChangedOnDisk();

    expect(await screen.findByText("Downloaded.pdf")).toBeInTheDocument();
  });

  it("a file deleted outside the app goes away", async () => {
    vi.mocked(api.listFiles).mockResolvedValue([file("ideas.md"), file("old.typ")]);
    await renderOpenWorkspace();
    await screen.findByText("old.typ");

    vi.mocked(api.listFiles).mockResolvedValue([file("ideas.md")]);
    await filesChangedOnDisk();

    await vi.waitFor(() => expect(screen.queryByText("old.typ")).not.toBeInTheDocument());
  });
});

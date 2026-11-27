// Resizing the sidebar: dragging its inner edge changes its width, and dragging between its
// sections (Files and Library) shares its height differently. Both are the same in every
// workspace (kept in the app's settings). The edges can be moved with the keyboard too.

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const researchNotes: api.Workspace = { name: "Research Notes", path: "/Users/me/Research Notes" };

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue(researchNotes);
  vi.mocked(api.listFiles).mockResolvedValue([file("Ideas.typ")]);
});

async function renderOpenWorkspace() {
  render(<App />);
  await screen.findByRole("button", { name: "Ideas.typ" });
}

const sidebar = () => screen.getByRole("complementary", { name: "File explorer" });
const edge = () => screen.getByRole("separator", { name: "Resize the sidebar" });
const between = () => screen.queryByRole("separator", { name: "Resize the sections" });
const widthOf = (element: HTMLElement) => Number.parseFloat(element.style.width);

function drag(handle: HTMLElement, from: { x?: number; y?: number }, to: { x?: number; y?: number }) {
  fireEvent.pointerDown(handle, { clientX: from.x ?? 0, clientY: from.y ?? 0, button: 0, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: to.x ?? 0, clientY: to.y ?? 0, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: to.x ?? 0, clientY: to.y ?? 0, pointerId: 1 });
}

describe("The sidebar's width", () => {
  it("is 256 pixels at first", async () => {
    await renderOpenWorkspace();

    expect(widthOf(sidebar())).toBe(256);
    expect(edge()).toHaveAttribute("aria-valuenow", "256");
  });

  it("is as wide as it was left, in any workspace", async () => {
    vi.mocked(api.getSidebarSizes).mockResolvedValue({ width: 320, filesShare: 0.5 });

    await renderOpenWorkspace();

    await vi.waitFor(() => expect(widthOf(sidebar())).toBe(320));
  });

  it("dragging its edge makes it wider or narrower, and the width is remembered", async () => {
    await renderOpenWorkspace();

    drag(edge(), { x: 256 }, { x: 356 });
    expect(widthOf(sidebar())).toBe(356);

    drag(edge(), { x: 356 }, { x: 306 });
    expect(widthOf(sidebar())).toBe(306);
    expect(api.saveSidebarSizes).toHaveBeenLastCalledWith({ width: 306, filesShare: 0.5 });
  });

  it("on the right of the window, dragging its edge to the left makes it wider", async () => {
    vi.mocked(api.getExplorerLayout).mockResolvedValue({ side: "right", mode: "pinned" });
    await renderOpenWorkspace();

    drag(edge(), { x: 900 }, { x: 800 });

    expect(widthOf(sidebar())).toBe(356);
  });

  it("can't be narrower than 180 pixels or wider than 600", async () => {
    await renderOpenWorkspace();

    drag(edge(), { x: 256 }, { x: 0 });
    expect(widthOf(sidebar())).toBe(180);

    drag(edge(), { x: 180 }, { x: 2000 });
    expect(widthOf(sidebar())).toBe(600);
  });

  it("is saved once, when the drag ends", async () => {
    await renderOpenWorkspace();
    const handle = edge();

    fireEvent.pointerDown(handle, { clientX: 256, button: 0, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 280, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 300, pointerId: 1 });
    expect(api.saveSidebarSizes).not.toHaveBeenCalled();

    fireEvent.pointerUp(window, { clientX: 300, pointerId: 1 });
    expect(api.saveSidebarSizes).toHaveBeenCalledTimes(1);
  });

  it("the arrow keys resize it from its edge", async () => {
    await renderOpenWorkspace();

    edge().focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(widthOf(sidebar())).toBe(288);

    await userEvent.keyboard("{ArrowLeft}");
    expect(widthOf(sidebar())).toBe(272);
    expect(api.saveSidebarSizes).toHaveBeenLastCalledWith({ width: 272, filesShare: 0.5 });
  });

  it("double-clicking its edge puts it back to 256 pixels", async () => {
    vi.mocked(api.getSidebarSizes).mockResolvedValue({ width: 420, filesShare: 0.5 });
    await renderOpenWorkspace();
    await vi.waitFor(() => expect(widthOf(sidebar())).toBe(420));

    await userEvent.dblClick(edge());

    expect(widthOf(sidebar())).toBe(256);
    expect(api.saveSidebarSizes).toHaveBeenLastCalledWith({ width: 256, filesShare: 0.5 });
  });
});

describe("The sections' heights", () => {
  const files = () => screen.getByRole("region", { name: "Files" }).parentElement!;
  const libraryPart = () => screen.getByRole("region", { name: "Library" }).parentElement!;
  const share = (element: HTMLElement) => Number(element.style.flexGrow);

  it("are even at first", async () => {
    await renderOpenWorkspace();

    expect(share(files())).toBe(0.5);
    expect(share(libraryPart())).toBe(0.5);
    expect(between()).toHaveAttribute("aria-valuenow", "50");
  });

  it("are as they were left", async () => {
    vi.mocked(api.getSidebarSizes).mockResolvedValue({ width: 256, filesShare: 0.3 });

    await renderOpenWorkspace();

    await vi.waitFor(() => expect(share(files())).toBe(0.3));
    expect(share(libraryPart())).toBeCloseTo(0.7);
  });

  it("dragging between the sections gives one more and the other less, and is remembered", async () => {
    await renderOpenWorkspace();
    // (The sections share 400 pixels, from the top of the window.)
    between()!.parentElement!.getBoundingClientRect = () => ({ top: 0, height: 400, bottom: 400 }) as DOMRect;

    drag(between()!, { y: 200 }, { y: 100 });

    expect(share(files())).toBeCloseTo(0.25);
    expect(share(libraryPart())).toBeCloseTo(0.75);
    expect(api.saveSidebarSizes).toHaveBeenLastCalledWith({ width: 256, filesShare: 0.25 });
  });

  it("neither section can be squeezed shut by dragging", async () => {
    await renderOpenWorkspace();
    between()!.parentElement!.getBoundingClientRect = () => ({ top: 0, height: 400, bottom: 400 }) as DOMRect;

    drag(between()!, { y: 200 }, { y: -500 });
    expect(share(files())).toBeCloseTo(0.1);

    drag(between()!, { y: 40 }, { y: 2000 });
    expect(share(files())).toBeCloseTo(0.9);
  });

  it("the arrow keys move what's between them", async () => {
    await renderOpenWorkspace();

    between()!.focus();
    await userEvent.keyboard("{ArrowDown}");

    expect(share(files())).toBeCloseTo(0.55);
    expect(api.saveSidebarSizes).toHaveBeenLastCalledWith({ width: 256, filesShare: 0.55 });
  });

  it("can only be changed while both sections are open", async () => {
    await renderOpenWorkspace();
    expect(between()).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Library" }));

    expect(between()).not.toBeInTheDocument();
  });
});

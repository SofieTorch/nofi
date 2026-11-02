// The PDF reader: clicking a PDF in the explorer opens it in a tab, like a note, so it can sit in
// a pane beside notes (dragged there like any tab or file). It shows the pages one after another,
// fitting the pane's width at first; it zooms in and out. (pdf.js draws the pages; here a
// stand-in does, as the test browser can't draw.)

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import * as pdf from "../src/workspace/pdf";
import { file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");
vi.mock("../src/workspace/pdf");

const drawn: { page: number; scale: number }[] = [];

beforeEach(() => {
  setUpFakeBackend();
  drawn.length = 0;
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  vi.mocked(api.listFiles).mockResolvedValue([folder("Papers", [file("Papers/attention.pdf")]), file("Paper.typ")]);
  vi.mocked(api.readNote).mockResolvedValue("Some text.");
  vi.mocked(api.readWorkspaceFile).mockResolvedValue(new ArrayBuffer(4));
  vi.mocked(pdf.openPdf).mockResolvedValue({
    pages: 3,
    close: () => {},
    page: async (number) => ({
      width: 600,
      height: 800,
      draw: async (_canvas, scale) => void drawn.push({ page: number, scale }),
      text: async () => {},
    }),
  });
});

async function openPdf() {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name: "Papers" }));
  await userEvent.click(screen.getByRole("button", { name: "attention.pdf" }));
  return screen.findByRole("toolbar", { name: "PDF" });
}

describe("The PDF reader", () => {
  it("opens a PDF from the explorer in a tab", async () => {
    await openPdf();

    expect(screen.getByRole("tab", { name: "attention.pdf", selected: true })).toBeInTheDocument();
    expect(api.readWorkspaceFile).toHaveBeenCalledWith("Papers/attention.pdf");
  });

  it("shows every page, and how many there are", async () => {
    const toolbar = await openPdf();

    expect(await within(toolbar).findByText("3 pages")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /^Page \d$/ })).toHaveLength(3);
    await vi.waitFor(() => expect(drawn.map((d) => d.page).sort()).toEqual([1, 2, 3]));
  });

  it("zooms in and out", async () => {
    const toolbar = await openPdf();
    await within(toolbar).findByText("3 pages");

    await userEvent.click(within(toolbar).getByRole("button", { name: "Zoom in" }));
    expect(within(toolbar).getByText("125%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Page 1" })).toHaveStyle({ width: "750px" });

    await userEvent.click(within(toolbar).getByRole("button", { name: "Zoom out" }));
    await userEvent.click(within(toolbar).getByRole("button", { name: "Zoom out" }));
    expect(within(toolbar).getByText("75%")).toBeInTheDocument();
  });

  it("fit width goes back to fitting the pane", async () => {
    const toolbar = await openPdf();
    await within(toolbar).findByText("3 pages");
    await userEvent.click(within(toolbar).getByRole("button", { name: "Zoom in" }));

    await userEvent.click(within(toolbar).getByRole("button", { name: "Fit width" }));

    expect(within(toolbar).getByRole("button", { name: "Fit width" })).toHaveAttribute("aria-pressed", "true");
  });

  it("says why when the PDF can't be opened", async () => {
    vi.mocked(pdf.openPdf).mockRejectedValue("Invalid PDF structure.");

    await openPdf();

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't open the PDF: Invalid PDF structure.");
  });

  it("is a tab like any other: it can go beside a note", async () => {
    await openPdf();
    await userEvent.click(screen.getByRole("button", { name: "Paper.typ" }));
    await screen.findByRole("textbox", { name: "Paper.typ" });
    const content = screen.getByRole("tabpanel");
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);

    fireEvent.dragStart(screen.getByRole("tab", { name: "attention.pdf" }));
    fireEvent.drop(content, { clientX: 950, clientY: 300 });

    expect(await screen.findByRole("toolbar", { name: "PDF" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Paper.typ" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Pane" })).toHaveLength(2);
  });

  it("a PDF dragged from the explorer to a note's edge opens beside it", async () => {
    render(<App />);
    await userEvent.click(await screen.findByRole("button", { name: "Paper.typ" }));
    await screen.findByRole("textbox", { name: "Paper.typ" });
    await userEvent.click(screen.getByRole("button", { name: "Papers" }));
    const content = screen.getByRole("tabpanel");
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 1000, height: 600 } as DOMRect);

    fireEvent.dragStart(screen.getByRole("button", { name: "attention.pdf" }));
    fireEvent.drop(content, { clientX: 950, clientY: 300 });

    expect(await screen.findByRole("toolbar", { name: "PDF" })).toBeInTheDocument();
    expect(screen.getAllByRole("region", { name: "Pane" })).toHaveLength(2);
  });
});

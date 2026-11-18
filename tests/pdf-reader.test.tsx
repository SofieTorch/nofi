// The PDF reader: clicking a PDF in the explorer opens it in a tab, like a note, so it can sit in
// a pane beside notes (dragged there like any tab or file). It shows the pages one after another,
// fitting the pane's width at first; it zooms in and out. Its toolbar says which page you're on,
// out of how many, and a page number typed there goes to it, like in a browser's PDF reader. A
// PDF's contents (its outline, if it has one) open beside the pages. (pdf.js draws the pages;
// here a stand-in does, as the test browser can't draw.)

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

    expect(await within(toolbar).findByText("/ 3")).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /^Page \d$/ })).toHaveLength(3);
    await vi.waitFor(() => expect(drawn.map((d) => d.page).sort()).toEqual([1, 2, 3]));
  });

  it("zooms in and out", async () => {
    const toolbar = await openPdf();
    await within(toolbar).findByText("/ 3");

    await userEvent.click(within(toolbar).getByRole("button", { name: "Zoom in" }));
    expect(within(toolbar).getByText("125%")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Page 1" })).toHaveStyle({ width: "750px" });

    await userEvent.click(within(toolbar).getByRole("button", { name: "Zoom out" }));
    await userEvent.click(within(toolbar).getByRole("button", { name: "Zoom out" }));
    expect(within(toolbar).getByText("75%")).toBeInTheDocument();
  });

  it("fit width goes back to fitting the pane", async () => {
    const toolbar = await openPdf();
    await within(toolbar).findByText("/ 3");
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
    await userEvent.dblClick(screen.getByRole("tab", { name: "attention.pdf" }));
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

/** Where the reader scrolled each page to (as the test browser can't scroll). */
function watchScrolling() {
  const scrolled: number[] = [];
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    const page = (this as HTMLElement).dataset?.page;
    if (page) scrolled.push(Number(page));
  });
  return scrolled;
}

describe("Going to a page", () => {
  it("the toolbar says which page you're on, out of how many", async () => {
    const toolbar = await openPdf();

    expect(await within(toolbar).findByRole("textbox", { name: "Page" })).toHaveValue("1");
    expect(within(toolbar).getByText("/ 3")).toBeInTheDocument();
  });

  it("typing a page number there goes to it", async () => {
    const scrolled = watchScrolling();
    const toolbar = await openPdf();
    const box = await within(toolbar).findByRole("textbox", { name: "Page" });

    await userEvent.click(box);
    await userEvent.keyboard("{Control>}a{/Control}3{Enter}");

    expect(scrolled[scrolled.length - 1]).toBe(3);
    expect(box).toHaveValue("3");
  });

  it("a number that isn't a page goes back to the page you're on", async () => {
    const scrolled = watchScrolling();
    const toolbar = await openPdf();
    const box = await within(toolbar).findByRole("textbox", { name: "Page" });

    await userEvent.click(box);
    await userEvent.keyboard("{Control>}a{/Control}9{Enter}");

    expect(scrolled).toEqual([]);
    expect(box).toHaveValue("1");
  });

  it("the page shown follows scrolling", async () => {
    const toolbar = await openPdf();
    const page = await screen.findByRole("img", { name: "Page 1" });
    const scroller = page.parentElement!.parentElement!;
    // (Pages a thousand pixels apart; the pane shows from the top of where it's scrolled to.)
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const number = Number((this as HTMLElement).dataset?.page ?? 0);
      const top = number ? (number - 1) * 1000 - scroller.scrollTop : 0;
      return { top, bottom: number ? top + 990 : 600, left: 0, right: 600, width: 600, height: number ? 990 : 600 } as DOMRect;
    });
    try {
      scroller.scrollTop = 2100;
      fireEvent.scroll(scroller);

      expect(await within(toolbar).findByRole("textbox", { name: "Page" })).toHaveValue("3");
    } finally {
      vi.mocked(Element.prototype.getBoundingClientRect).mockRestore();
    }
  });
});

describe("Drawing only what's near", () => {
  /** Says which pages are near the view, as the browser does while scrolling. */
  let near: (pages: number[]) => void;
  let stopped: number[];

  beforeEach(() => {
    const watched = new Map<Element, (isNear: boolean) => void>();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(private report: (entries: { isIntersecting: boolean; target: Element }[]) => void) {}
        observe(element: Element) {
          watched.set(element, (isNear) => this.report([{ isIntersecting: isNear, target: element }]));
        }
        disconnect() {}
        unobserve() {}
      },
    );
    near = (pages) => act(() => watched.forEach((report, element) => report(pages.includes(Number((element as HTMLElement).dataset.page)))));
    stopped = [];
    vi.mocked(pdf.openPdf).mockResolvedValue({
      pages: 3,
      close: () => {},
      page: async (number) => ({
        width: 600,
        height: 800,
        draw: async (canvas, scale) => {
          canvas.width = 600 * scale;
          drawn.push({ page: number, scale });
        },
        text: async () => {},
        stop: () => void stopped.push(number),
      }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("only the pages near the view are drawn", async () => {
    await openPdf();
    await screen.findByRole("img", { name: "Page 3" });

    near([1, 2]);

    await vi.waitFor(() => expect(drawn.map((d) => d.page).sort()).toEqual([1, 2]));
  });

  it("a page far from the view is let go, and drawn again when it's back", async () => {
    await openPdf();
    const first = await screen.findByRole("img", { name: "Page 1" });
    near([1]);
    await vi.waitFor(() => expect(drawn.map((d) => d.page)).toEqual([1]));

    near([3]);
    await vi.waitFor(() => expect(first.querySelector("canvas")!.width).toBe(0));
    expect(stopped).toContain(1);

    near([1]);
    await vi.waitFor(() => expect(drawn.filter((d) => d.page === 1)).toHaveLength(2));
  });

  it("zooming draws again only the pages near the view", async () => {
    const toolbar = await openPdf();
    await screen.findByRole("img", { name: "Page 2" });
    near([2]);
    await vi.waitFor(() => expect(drawn).toHaveLength(1));

    await userEvent.click(within(toolbar).getByRole("button", { name: "Zoom in" }));

    await vi.waitFor(() => expect(drawn).toEqual([{ page: 2, scale: 1 }, { page: 2, scale: 1.25 }]));
  });
});

describe("Keeping your place", () => {
  it("zooming (or the pane getting narrower, as the contents open) keeps the place you're reading at the top", async () => {
    const toolbar = await openPdf();
    const first = await screen.findByRole("img", { name: "Page 1" });
    const scroller = first.parentElement!.parentElement!;
    // (Pages one after another, as tall as they're drawn.)
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const number = Number((this as HTMLElement).dataset?.page ?? 0);
      if (!number || this.getAttribute("role") !== "img") return { top: 0, bottom: 600, left: 0, right: 600, width: 600, height: 600 } as DOMRect;
      const pages = [...scroller.querySelectorAll<HTMLElement>('[role="img"][data-page]')];
      const height = (page: HTMLElement) => parseFloat(page.style.height);
      const top = pages.slice(0, number - 1).reduce((sum, page) => sum + height(page), 0) - scroller.scrollTop;
      return { top, bottom: top + height(pages[number - 1]), left: 0, right: 600, width: 600, height: height(pages[number - 1]) } as DOMRect;
    });
    try {
      await within(toolbar).findByText("/ 3");
      // (The reader remembers a PDF's zoom: back to 100%.)
      await userEvent.click(within(toolbar).getByRole("button", { name: "Fit width" }));
      // At 100%: halfway down page 2 (pages are 800 tall).
      scroller.scrollTop = 1200;
      fireEvent.scroll(scroller);

      await userEvent.click(within(toolbar).getByRole("button", { name: "Zoom in" }));

      // At 125%: still halfway down page 2.
      expect(scroller.scrollTop).toBe(1500);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("Contents", () => {
  beforeEach(() => {
    const opened = vi.mocked(pdf.openPdf).getMockImplementation();
    vi.mocked(pdf.openPdf).mockImplementation(async (bytes) => ({
      ...(await opened!(bytes)),
      outline: async () => [
        { title: "Introduction", page: 1, items: [] },
        { title: "Methods", page: 2, items: [{ title: "Attention", page: 3, items: [] }] },
      ],
    }));
  });

  it("a PDF's contents open beside its pages, its sections inside their chapter", async () => {
    const toolbar = await openPdf();

    await userEvent.click(await within(toolbar).findByRole("button", { name: "Contents" }));

    const contents = screen.getByRole("navigation", { name: "Contents" });
    const methods = within(contents).getByRole("button", { name: "Methods" }).closest("li")!;
    expect(within(methods).getByRole("button", { name: "Attention" })).toBeInTheDocument();
    expect(within(contents).getByRole("button", { name: "Introduction" })).toBeInTheDocument();
  });

  it("choosing one goes to its page", async () => {
    const scrolled = watchScrolling();
    const toolbar = await openPdf();
    await userEvent.click(await within(toolbar).findByRole("button", { name: "Contents" }));

    await userEvent.click(within(screen.getByRole("navigation", { name: "Contents" })).getByRole("button", { name: "Attention" }));

    expect(scrolled[scrolled.length - 1]).toBe(3);
    expect(within(toolbar).getByRole("textbox", { name: "Page" })).toHaveValue("3");
  });

  it("the one chosen is the one marked, even when others start on the same page", async () => {
    const opened = vi.mocked(pdf.openPdf).getMockImplementation();
    vi.mocked(pdf.openPdf).mockImplementation(async (bytes) => ({
      ...(await opened!(bytes)),
      outline: async () => [
        { title: "Methods", page: 2, top: 100, items: [] },
        { title: "Data", page: 2, top: 400, items: [] },
      ],
    }));
    const toolbar = await openPdf();
    await userEvent.click(await within(toolbar).findByRole("button", { name: "Contents" }));
    const contents = screen.getByRole("navigation", { name: "Contents" });

    await userEvent.click(within(contents).getByRole("button", { name: "Methods" }));

    expect(within(contents).getByRole("button", { name: "Methods" })).toHaveAttribute("aria-current", "true");
    expect(within(contents).getByRole("button", { name: "Data" })).not.toHaveAttribute("aria-current");
  });

  it("choosing one goes to where it starts on its page", async () => {
    const opened = vi.mocked(pdf.openPdf).getMockImplementation();
    vi.mocked(pdf.openPdf).mockImplementation(async (bytes) => ({
      ...(await opened!(bytes)),
      outline: async () => [{ title: "Data", page: 2, top: 400, items: [] }],
    }));
    const toolbar = await openPdf();
    const page = await screen.findByRole("img", { name: "Page 2" });
    const scroller = page.parentElement!.parentElement!;
    // (Page 2 is 1000 pixels down; the reader is at 100%.)
    vi.spyOn(page, "getBoundingClientRect").mockImplementation(() => ({ top: 1000 - scroller.scrollTop }) as DOMRect);
    await userEvent.click(within(toolbar).getByRole("button", { name: "Fit width" }));
    await userEvent.click(await within(toolbar).findByRole("button", { name: "Contents" }));

    await userEvent.click(within(screen.getByRole("navigation", { name: "Contents" })).getByRole("button", { name: "Data" }));

    // (A little room above it.)
    expect(scroller.scrollTop).toBe(1000 + 400 - 12);
  });

  it("the button closes them again", async () => {
    const toolbar = await openPdf();
    const button = await within(toolbar).findByRole("button", { name: "Contents" });

    await userEvent.click(button);
    await userEvent.click(button);

    expect(screen.queryByRole("navigation", { name: "Contents" })).not.toBeInTheDocument();
  });

  it("a PDF without contents has no Contents button", async () => {
    vi.mocked(pdf.openPdf).mockResolvedValue({ pages: 3, close: () => {}, outline: async () => [], page: async () => ({ width: 600, height: 800, draw: async () => {}, text: async () => {} }) });
    const toolbar = await openPdf();
    await within(toolbar).findByText("/ 3");

    expect(within(toolbar).queryByRole("button", { name: "Contents" })).not.toBeInTheDocument();
  });
});

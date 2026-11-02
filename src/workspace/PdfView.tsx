import { mdiMagnifyMinusOutline, mdiMagnifyPlusOutline, mdiArrowExpandHorizontal, mdiLinkVariant } from "@mdi/js";
import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { copyAddress } from "../editor/noteLinks";
import { IconButton } from "../ui/IconButton";
import { Menu } from "../ui/Menu";
import { openPdf, type PdfDocument, type PdfPage } from "./pdf";

type Zoom = "fit" | number;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/**
 * A PDF from the workspace, page after page, like a reader: zoom in and out, or fit the pane's
 * width (the default). Its text can be selected and copied. Pages are drawn as they come into view.
 * A link to a page (`#page=5`) opens it there; a page's right-click menu (or the toolbar) copies
 * a link to it, to paste into a note.
 */
export function PdfView({ path, goTo }: { path: string; goTo?: { part: string } }) {
  const [document, setDocument] = useState<PdfDocument>();
  const [first, setFirst] = useState<PdfPage>();
  const [problem, setProblem] = useState<string>();
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [width, setWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const pageBoxes = useRef(new Map<number, HTMLDivElement>());
  const [menu, setMenu] = useState<{ x: number; y: number; page: number }>();
  const copyLink = (page: number) => copyAddress(`${path}#page=${page}`);

  // A link to a page: it's scrolled to, once the pages are there.
  useEffect(() => {
    const page = goTo && /^page=(\d+)$/.exec(goTo.part);
    if (!page || !document) return;
    const frame = requestAnimationFrame(() => pageBoxes.current.get(Number(page[1]))?.scrollIntoView?.({ block: "start" }));
    return () => cancelAnimationFrame(frame);
  }, [goTo, document]);

  /** The page at the top of the pane. */
  function pageInView() {
    const top = scroller.current?.getBoundingClientRect().top ?? 0;
    for (const [number, box] of [...pageBoxes.current].sort((a, b) => a[0] - b[0])) {
      if (box.getBoundingClientRect().bottom > top + 8) return number;
    }
    return 1;
  }

  useEffect(() => {
    let current = true;
    let opened: PdfDocument | undefined;
    setDocument(undefined);
    setProblem(undefined);
    api
      .readWorkspaceFile(path)
      .then(openPdf)
      .then(async (pdf) => {
        opened = pdf;
        const page = await pdf.page(1);
        if (!current) return pdf.close();
        setFirst(page);
        setDocument(pdf);
      })
      .catch((reason) => current && setProblem(String(reason)));
    return () => {
      current = false;
      opened?.close();
    };
  }, [path]);

  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Fitting the width: the first page's width, with a little room on both sides.
  const fit = first && width ? Math.max(0.25, (width - 48) / first.width) : 1;
  const scale = zoom === "fit" ? fit : zoom;
  const step = (direction: 1 | -1) => {
    const next = direction > 0 ? ZOOMS.find((z) => z > scale + 0.01) : [...ZOOMS].reverse().find((z) => z < scale - 0.01);
    if (next) setZoom(next);
  };

  return (
    <div className="flex h-full flex-col">
      <div role="toolbar" aria-label="PDF" className="flex h-8 shrink-0 items-center gap-1 border-b border-neutral-100 px-3 text-xs text-neutral-500">
        <span>{document ? `${document.pages} ${document.pages === 1 ? "page" : "pages"}` : ""}</span>
        <span className="ml-auto" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <IconButton icon={mdiMagnifyMinusOutline} label="Zoom out" onClick={() => step(-1)} />
        <IconButton icon={mdiMagnifyPlusOutline} label="Zoom in" onClick={() => step(1)} />
        <IconButton icon={mdiArrowExpandHorizontal} label="Fit width" pressed={zoom === "fit"} onClick={() => setZoom("fit")} />
        <IconButton icon={mdiLinkVariant} label="Copy link to this page" onClick={() => copyLink(pageInView())} />
      </div>
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto bg-neutral-100">
        {problem ? (
          <p role="alert" className="p-6 text-sm text-red-600">
            Couldn't open the PDF: {problem}
          </p>
        ) : (
          document && (
            <div className="flex flex-col items-center gap-3 py-4">
              {Array.from({ length: document.pages }, (_, i) => (
                <Page
                  key={i}
                  document={document}
                  number={i + 1}
                  scale={scale}
                  guess={first!}
                  root={scroller}
                  boxes={pageBoxes.current}
                  onMenu={(x, y) => setMenu({ x, y, page: i + 1 })}
                />
              ))}
            </div>
          )
        )}
      </div>
      {menu && (
        <Menu
          label="Page"
          at={menu}
          onClose={() => setMenu(undefined)}
          items={[{ label: `Copy link to page ${menu.page}`, icon: mdiLinkVariant, run: () => copyLink(menu.page) }]}
        />
      )}
    </div>
  );
}

/** One page: its room is kept (from the first page's size) until it's drawn, once in view. */
function Page({
  document,
  number,
  scale,
  guess,
  root,
  boxes,
  onMenu,
}: {
  document: PdfDocument;
  number: number;
  scale: number;
  guess: PdfPage;
  root: React.RefObject<HTMLDivElement | null>;
  /** Where each page is, by number (for going to one). */
  boxes: Map<number, HTMLDivElement>;
  /** Right-click: the page's menu, at the mouse. */
  onMenu: (x: number, y: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PdfPage>();
  const [visible, setVisible] = useState(typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (visible || !box.current) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), {
      root: root.current,
      rootMargin: "600px 0px",
    });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [visible, root]);

  useEffect(() => {
    if (!visible) return;
    let current = true;
    document.page(number).then((loaded) => current && setPage(loaded));
    return () => {
      current = false;
    };
  }, [visible, document, number]);

  useEffect(() => {
    if (!page || !canvas.current || !text.current) return;
    page.draw(canvas.current, scale).catch(() => {});
    page.text(text.current, scale).catch(() => {});
  }, [page, scale]);

  const size = page ?? guess;
  return (
    <div
      ref={(element) => {
        box.current = element;
        if (element) boxes.set(number, element);
        else boxes.delete(number);
      }}
      onContextMenu={(event) => {
        // (With text selected, the usual menu, to copy it.)
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
      role="img"
      aria-label={`Page ${number}`}
      className="relative shrink-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)]"
      style={{ width: size.width * scale, height: size.height * scale }}
    >
      <canvas ref={canvas} className="block" />
      <div ref={text} className="textLayer" />
    </div>
  );
}

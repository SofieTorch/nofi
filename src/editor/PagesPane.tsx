import { mdiArrowExpandHorizontal, mdiArrowUpDown, mdiExportVariant, mdiMagnifyMinusOutline, mdiMagnifyPlusOutline, mdiTuneVariant } from "@mdi/js";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { stopScaling, usePinchZoom } from "../ui/pinchZoom";
import * as api from "../api";
import { IconButton } from "../ui/IconButton";
import { PageSettingsPopover } from "./PageSettingsPopover";

/** The zoom buttons' steps, and how far pinching goes. */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const SMALLEST = 0.25;
const BIGGEST = 4;

/** How long typing has to pause before the pages are drawn again. */
const REDRAW_DELAY_MS = 200;

type Props = {
  /** The note's current text (Typst). */
  text: string;
  /** The note's path in the workspace: it can use the workspace's files, like images. */
  path?: string;
  /** Called with a position in the text when a page is clicked. */
  onJump: (position: number) => void;
  /** Replaces the note's text, e.g. after a page setting changed. */
  onChangeText: (text: string) => void;
  /** Exports the note as a PDF. */
  onExport?: () => void;
  /** Called each time the pages are drawn: the pages, and where the note's text is on them. */
  onDrawn?: (pages: api.PagePicture[], places: api.PagePlace[]) => void;
  /** Its scrolling area, for scrolling it with the editor. */
  scrollerRef?: (element: HTMLElement | null) => void;
  /** Whether it scrolls with the editor (the toolbar's switch). */
  syncing?: boolean;
  onSyncing?: (syncing: boolean) => void;
};

/**
 * The note drawn as real pages by Typst, like the PDF it would become. Redrawn as you type; if
 * the note has a mistake, the last good pages stay up with the mistake explained above them.
 */
export function PagesPane({ text, path, onJump, onChangeText, onExport, onDrawn, scrollerRef, syncing, onSyncing }: Props) {
  const onDrawnRef = useRef(onDrawn);
  onDrawnRef.current = onDrawn;
  const [pages, setPages] = useState<api.PagePicture[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [mistake, setMistake] = useState<string>();
  // Only the newest drawing counts, even if an older one finishes later.
  const latest = useRef(0);
  const firstDraw = useRef(true);

  useEffect(() => {
    const draw = () => {
      const drawing = ++latest.current;
      (path ? api.renderPages(text, path) : api.renderPages(text)).then(
        (drawn) => {
          if (drawing !== latest.current) return;
          setPages(drawn);
          setMistake(undefined);
          // (Where the text is on them, asked for right away: it's of this drawing.)
          api
            .pagePlaces()
            .then((places) => drawing === latest.current && onDrawnRef.current?.(drawn, places ?? []))
            .catch(() => {});
        },
        (reason) => drawing === latest.current && setMistake(String(reason)),
      );
    };
    // Draw the first time straight away; after that, wait until typing pauses.
    if (firstDraw.current) {
      firstDraw.current = false;
      draw();
      return;
    }
    const timer = setTimeout(draw, REDRAW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, path]);

  // Zooming: fitting the pane's width (never bigger than the page's own size), or a zoom of the
  // page's own size, with the buttons or by pinching. The point pinched (or the pane's top, for the
  // buttons) stays where it is.
  const scroller = useRef<HTMLElement | null>(null);
  const setScroller = useCallback(
    (element: HTMLElement | null) => {
      scroller.current = element;
      scrollerRef?.(element);
    },
    [scrollerRef],
  );
  const content = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState<"fit" | number>("fit");
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const ownWidth = pages.length ? (pages[0].width * 4) / 3 : 0;
  const fit = width && ownWidth ? Math.min(1, Math.max(SMALLEST, (width - 48) / ownWidth)) : 1;
  const scale = zoom === "fit" ? fit : zoom;

  /** The point to keep in place as the zoom changes: on a page (as a share of it), and where it is in the window. */
  const keep = useRef<{ page: number; x: number; y: number; clientX: number; clientY: number } | null>(null);
  const keepPointAt = (clientX: number, clientY: number) => {
    const images = [...(content.current?.querySelectorAll("img") ?? [])];
    let best: { page: number; rect: DOMRect; off: number } | null = null;
    images.forEach((image, page) => {
      const rect = image.getBoundingClientRect();
      const off = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      if (!best || off < best.off) best = { page, rect, off };
    });
    const found = best as { page: number; rect: DOMRect } | null;
    keep.current =
      found && found.rect.width && found.rect.height
        ? { page: found.page, x: (clientX - found.rect.left) / found.rect.width, y: (clientY - found.rect.top) / found.rect.height, clientX, clientY }
        : null;
  };
  const shownScale = useRef(scale);
  useLayoutEffect(() => {
    if (shownScale.current === scale) return;
    shownScale.current = scale;
    stopScaling(content.current);
    const at = keep.current;
    keep.current = null;
    const box = scroller.current;
    const image = at && content.current?.querySelectorAll("img")[at.page];
    if (!box || !at || !image) return;
    const rect = image.getBoundingClientRect();
    box.scrollTop += rect.top + at.y * rect.height - at.clientY;
    box.scrollLeft += rect.left + at.x * rect.width - at.clientX;
  }, [scale]);
  usePinchZoom({
    scroller,
    content,
    scale,
    smallest: SMALLEST,
    biggest: BIGGEST,
    onStart: keepPointAt,
    onZoom: setZoom,
    onCancel: () => {
      keep.current = null;
    },
  });
  const step = (direction: 1 | -1) => {
    const next = direction > 0 ? ZOOMS.find((z) => z > scale + 0.01) : [...ZOOMS].reverse().find((z) => z < scale - 0.01);
    if (!next) return;
    const box = scroller.current?.getBoundingClientRect();
    if (box) keepPointAt(box.left + box.width / 2, box.top + 48);
    setZoom(next);
  };

  async function jumpFromClick(index: number, event: React.MouseEvent<HTMLImageElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const page = pages[index];
    // The picture may be shown smaller or bigger than the page: convert pixels to points.
    const x = ((event.clientX - box.left) / box.width) * page.width;
    const y = ((event.clientY - box.top) / box.height) * page.height;
    const position = await api.pagePosition(index, x, y);
    if (position !== null) onJump(position);
  }

  return (
    // The toolbar in a row of its own, above the pages (not over them, nor scrolled or zoomed with them).
    <section aria-label="Pages" className="flex h-full flex-col bg-neutral-100">
      <div className="relative z-10 shrink-0 border-b-[0.5px] border-neutral-200 bg-white">
        <div className="flex h-7 items-center justify-end gap-px px-1.5 text-[11px] text-neutral-500" data-page-settings-button>
          <span aria-live="polite" className="mr-1 tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <IconButton small icon={mdiMagnifyMinusOutline} label="Zoom out" onClick={() => step(-1)} />
          <IconButton small icon={mdiMagnifyPlusOutline} label="Zoom in" onClick={() => step(1)} />
          <IconButton small icon={mdiArrowExpandHorizontal} label="Fit width" pressed={zoom === "fit"} onClick={() => setZoom("fit")} />
          <span className="mx-1 h-3.5 w-px bg-neutral-200" />
          {onSyncing && (
            <IconButton small icon={mdiArrowUpDown} label="Sync scrolling" pressed={!!syncing} onClick={() => onSyncing(!syncing)} />
          )}
          {onExport && <IconButton small icon={mdiExportVariant} label="Export as PDF" onClick={onExport} />}
          <IconButton small
            icon={mdiTuneVariant}
            label="Page settings"
            pressed={showSettings}
            onClick={() => setShowSettings(!showSettings)}
          />
        </div>
        {showSettings && (
          <PageSettingsPopover
            text={text}
            onChangeText={onChangeText}
            onClose={() => setShowSettings(false)}
          />
        )}
        {mistake && (
          <p role="alert" className="mx-3 mb-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {mistake}
          </p>
        )}
      </div>
      <div ref={setScroller} data-pages-scroller className="min-h-0 flex-1 overflow-auto">
      <div ref={content} className="flex w-fit min-w-full flex-col items-center gap-6 p-6">
        {pages.map((page, index) => (
          <img
            key={index}
            alt={`Page ${index + 1}`}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.svg)}`}
            onClick={(event) => jumpFromClick(index, event)}
            // Points to CSS pixels (96 / 72), zoomed; fitting, never wider than the pane.
            style={{ width: zoom === "fit" && !width ? `min(100%, ${(page.width * 4) / 3}px)` : `${((page.width * 4) / 3) * scale}px` }}
            // (Not held to the pane's width, as images are by default: zoomed in, a page is wider.)
            className="max-w-none cursor-text bg-white shadow-[0_1px_6px_rgba(0,0,0,0.08)]"
          />
        ))}
      </div>
      </div>
    </section>
  );
}

/** Shown instead of pages for notes Typst can't draw. */
export function NoPages() {
  return (
    <section
      aria-label="Pages"
      className="flex h-full items-center justify-center bg-neutral-100 p-6 text-sm text-neutral-400"
    >
      Pages are only for Typst notes.
    </section>
  );
}

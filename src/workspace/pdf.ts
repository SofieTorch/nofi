// Reading PDFs with pdf.js: what the PDF reader needs, kept apart so the rest doesn't depend on it.

import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

import { joinTextItems, readTextItems } from "./pdfText";

GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfPage = {
  /** Its size at 100%, in CSS pixels. */
  width: number;
  height: number;
  /** Draws it on a canvas at a scale, sharp on high-resolution screens. */
  draw: (canvas: HTMLCanvasElement, scale: number) => Promise<void>;
  /** Lays its text over it, so it can be selected and copied. */
  text: (container: HTMLElement, scale: number) => Promise<void>;
  /** Its text, read as the text laid over it reads (see pdfText.ts), for finding words in it. */
  plainText?: () => Promise<string>;
  /** The links on it, if any. */
  links?: () => Promise<PdfLink[]>;
  /** Stops drawing it, and laying out its text, there (no longer wanted: zoomed again, or far from view). */
  stop?: (canvas: HTMLCanvasElement, container: HTMLElement) => void;
};

/** What's being drawn on each canvas, and laid out in each text layer, so it can be stopped. */
const drawing = new WeakMap<HTMLCanvasElement, { cancel: () => void }>();
const layingOut = new WeakMap<HTMLElement, { cancel: () => void }>();

/** What a PDF says about itself (often missing or wrong: the user can fix it in the note). */
export type PdfInfo = { title?: string; authors?: string[]; year?: number };

/**
 * A chapter or section in a PDF's contents (its outline): the page it starts on if known, and how
 * far down that page (in its points from the top) if the PDF says.
 */
export type OutlineItem = { title: string; page?: number; top?: number; items: OutlineItem[] };

/**
 * A link on a page: where it is (in the page's points at 100%, from its top left), and where it
 * goes: a website (or email address), a place in the same PDF (a page, and how far down it if the
 * PDF says), or another file (its address, from the PDF's folder).
 */
export type PdfLink = { x: number; y: number; width: number; height: number } & (
  | { url: string }
  | { page: number; top?: number }
  | { file: string }
);

export type PdfDocument = {
  pages: number;
  page: (number: number) => Promise<PdfPage>;
  close: () => void;
  info?: () => Promise<PdfInfo>;
  /** Its contents, if it has them (empty if not). */
  outline?: () => Promise<OutlineItem[]>;
};

export async function openPdf(bytes: ArrayBuffer): Promise<PdfDocument> {
  const loading = getDocument({ data: new Uint8Array(bytes) });
  const document = await loading.promise;
  /** Where a link in the PDF (in its contents, or on a page) goes (named, or written out): its page, and how far down it, if they can be found. */
  const placeOf = async (destination: unknown): Promise<{ page?: number; top?: number }> => {
    try {
      const written = typeof destination === "string" ? await document.getDestination(destination) : destination;
      if (!Array.isArray(written) || written[0] === undefined || written[0] === null) return {};
      const target = written[0];
      const page = typeof target === "number" ? target + 1 : (await document.getPageIndex(target)) + 1;
      // The height it goes to, in the PDF's own way (from the page's bottom), for the ways that say one.
      const kind = (written[1] as { name?: string } | undefined)?.name;
      const y = kind === "XYZ" ? written[3] : kind === "FitH" || kind === "FitBH" ? written[2] : kind === "FitR" ? written[5] : null;
      if (typeof y !== "number") return { page };
      const viewport = (await document.getPage(page)).getViewport({ scale: 1 });
      const top = viewport.convertToViewportPoint(0, y)[1];
      return { page, top: Math.max(0, Math.min(viewport.height, top)) };
    } catch {
      return {};
    }
  };
  return {
    pages: document.numPages,
    close: () => void loading.destroy(),
    info: async () => {
      const { info } = (await document.getMetadata()) as { info: Record<string, unknown> };
      const text = (key: string) => (typeof info[key] === "string" && (info[key] as string).trim()) || undefined;
      const authors = text("Author")
        ?.split(/\s*(?:;|,| and )\s*/)
        .filter(Boolean);
      const year = /^D:(\d{4})/.exec(text("CreationDate") ?? "")?.[1];
      return { title: text("Title"), authors, year: year ? Number(year) : undefined };
    },
    outline: async () => {
      type Item = { title: string; dest: unknown; items?: Item[] };
      const read = (items: Item[]): Promise<OutlineItem[]> =>
        Promise.all(items.map(async (item) => ({ title: item.title.trim(), ...(await placeOf(item.dest)), items: await read(item.items ?? []) })));
      return read(((await document.getOutline()) ?? []) as Item[]);
    },
    page: async (number) => {
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      return {
        width: base.width,
        height: base.height,
        plainText: async () => joinTextItems(await readTextItems(page.streamTextContent() as ReadableStream<{ items: unknown[] }>)),
        links: async () => {
          type Annotation = { subtype?: string; rect?: number[]; url?: string; unsafeUrl?: string; dest?: unknown; action?: string };
          const annotations = (await page.getAnnotations({ intent: "display" })) as Annotation[];
          const links = await Promise.all(
            annotations.map(async (a): Promise<PdfLink | null> => {
              if (a.subtype !== "Link" || !a.rect) return null;
              const [x1, y1] = base.convertToViewportPoint(a.rect[0], a.rect[1]) as number[];
              const [x2, y2] = base.convertToViewportPoint(a.rect[2], a.rect[3]) as number[];
              const where = { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
              if (a.url) return { ...where, url: a.url };
              // (A file: an address without a scheme, like "appendix.pdf".)
              if (a.unsafeUrl && !/^[a-z][a-z0-9+.-]*:/i.test(a.unsafeUrl)) return { ...where, file: a.unsafeUrl };
              if (a.dest) {
                const place = await placeOf(a.dest);
                return place.page ? { ...where, page: place.page, ...(place.top === undefined ? {} : { top: place.top }) } : null;
              }
              const named: Record<string, number> = { FirstPage: 1, LastPage: document.numPages, NextPage: number + 1, PrevPage: number - 1 };
              const to = a.action ? named[a.action] : undefined;
              return to && to >= 1 && to <= document.numPages ? { ...where, page: to } : null;
            }),
          );
          return links.filter((link): link is PdfLink => link !== null);
        },
        draw: async (canvas, scale) => {
          drawing.get(canvas)?.cancel();
          const viewport = page.getViewport({ scale });
          const ratio = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          const task = page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
          drawing.set(canvas, task);
          try {
            await task.promise;
          } catch (error) {
            // (Stopped on purpose: not a problem.)
            if ((error as Error)?.name !== "RenderingCancelledException") throw error;
          } finally {
            if (drawing.get(canvas) === task) drawing.delete(canvas);
          }
        },
        text: async (container, scale) => {
          layingOut.get(container)?.cancel();
          container.replaceChildren();
          container.style.setProperty("--total-scale-factor", String(scale));
          const layer = new TextLayer({ textContentSource: page.streamTextContent(), container, viewport: page.getViewport({ scale }) });
          layingOut.set(container, layer);
          try {
            await layer.render();
          } finally {
            if (layingOut.get(container) === layer) layingOut.delete(container);
          }
        },
        stop: (canvas, container) => {
          drawing.get(canvas)?.cancel();
          drawing.delete(canvas);
          layingOut.get(container)?.cancel();
          layingOut.delete(container);
        },
      };
    },
  };
}

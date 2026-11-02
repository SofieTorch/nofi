// Reading PDFs with pdf.js: what the PDF reader needs, kept apart so the rest doesn't depend on it.

import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export type PdfPage = {
  /** Its size at 100%, in CSS pixels. */
  width: number;
  height: number;
  /** Draws it on a canvas at a scale, sharp on high-resolution screens. */
  draw: (canvas: HTMLCanvasElement, scale: number) => Promise<void>;
  /** Lays its text over it, so it can be selected and copied. */
  text: (container: HTMLElement, scale: number) => Promise<void>;
};

export type PdfDocument = { pages: number; page: (number: number) => Promise<PdfPage>; close: () => void };

export async function openPdf(bytes: ArrayBuffer): Promise<PdfDocument> {
  const loading = getDocument({ data: new Uint8Array(bytes) });
  const document = await loading.promise;
  return {
    pages: document.numPages,
    close: () => void loading.destroy(),
    page: async (number) => {
      const page = await document.getPage(number);
      const base = page.getViewport({ scale: 1 });
      return {
        width: base.width,
        height: base.height,
        draw: async (canvas, scale) => {
          const viewport = page.getViewport({ scale });
          const ratio = window.devicePixelRatio || 1;
          canvas.width = Math.floor(viewport.width * ratio);
          canvas.height = Math.floor(viewport.height * ratio);
          canvas.style.width = `${viewport.width}px`;
          canvas.style.height = `${viewport.height}px`;
          await page.render({ canvas, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }).promise;
        },
        text: async (container, scale) => {
          container.replaceChildren();
          container.style.setProperty("--total-scale-factor", String(scale));
          await new TextLayer({ textContentSource: page.streamTextContent(), container, viewport: page.getViewport({ scale }) }).render();
        },
      };
    },
  };
}

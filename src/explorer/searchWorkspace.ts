// Searching the whole workspace (⌘⇧F, see tests/find.test.tsx › Searching the workspace): every
// note's text, and every PDF's (read with pdf.js, kept while the app is open). Each file's matches
// are reported as soon as it's searched.

import * as api from "../api";
import { noteFormat } from "../editor/formatting";
import { matchesIn } from "../ui/FindBar";
import { openPdf } from "../workspace/pdf";

/**
 * A match: a bit of the text around it, to show (`before` it, the match `text`, `after` it); its
 * `page` in a PDF; and the how-manyth it is in the note, or on its page.
 */
export type Match = { nth: number; page?: number; before: string; text: string; after: string };
export type FileMatches = { path: string; kind: "note" | "pdf"; matches: Match[] };

/** Each PDF's pages' text, by path (PDFs rarely change; a changed one is read again next time the app opens). */
const pdfTexts = new Map<string, Promise<string[]>>();

function pdfText(path: string) {
  let text = pdfTexts.get(path);
  if (!text) {
    text = (async () => {
      const document = await openPdf(await api.readWorkspaceFile(path));
      try {
        const pages: string[] = [];
        for (let number = 1; number <= document.pages; number++) {
          pages.push((await (await document.page(number)).plainText?.()) ?? "");
        }
        return pages;
      } finally {
        document.close();
      }
    })();
    // (One that couldn't be read is tried again next time.)
    text.catch(() => pdfTexts.delete(path));
    pdfTexts.set(path, text);
  }
  return text;
}

/** The matches in some text, each with a bit of its line around it. */
function matchesWithContext(text: string, query: string, page?: number): Match[] {
  // (In a PDF, words broken over lines are found too.)
  return matchesIn(text, query, page !== undefined).map(({ from, to }, nth) => {
    const lineStart = text.lastIndexOf("\n", from - 1) + 1;
    const lineEnd = text.indexOf("\n", to);
    const before = text.slice(Math.max(lineStart, from - 40), from);
    const after = text.slice(to, Math.min(lineEnd < 0 ? text.length : lineEnd, to + 100));
    return {
      nth,
      ...(page === undefined ? {} : { page }),
      before: (from - 40 > lineStart ? "…" : "") + before.trimStart(),
      text: text.slice(from, to),
      after: after.replace(/\s+/g, " "),
    };
  });
}

/**
 * Searches the files (notes and PDFs) for a text, saying each file's matches as it's searched
 * (`onFile`, only files with matches). Stops when `stopped()` says so.
 */
export async function searchWorkspace(paths: string[], query: string, onFile: (found: FileMatches) => void, stopped: () => boolean) {
  const notes = paths.filter((path) => noteFormat(path));
  const pdfs = paths.filter((path) => /\.pdf$/i.test(path));
  for (const path of notes) {
    const text = await api.readNote(path).catch(() => "");
    if (stopped()) return;
    const matches = matchesWithContext(text, query);
    if (matches.length) onFile({ path, kind: "note", matches });
  }
  for (const path of pdfs) {
    const pages = await pdfText(path).catch(() => [] as string[]);
    if (stopped()) return;
    const matches = pages.flatMap((text, i) => matchesWithContext(text, query, i + 1));
    if (matches.length) onFile({ path, kind: "pdf", matches });
  }
}

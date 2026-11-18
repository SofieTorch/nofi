// Annotating a PDF (see tests/pdf-annotations.test.tsx), like in Zotero.
//
// Annotations are marks on the PDF's pages: highlighted text, a note at a spot, an area. They're
// kept in a file beside the PDF, `attention.annotations.json` (renamed and deleted with it).
//
// Notes about a part of the PDF are paragraphs in notes citing that part with a link
// (`attention.pdf#page=3&quote=…`, `&point=x,y`, `&area=x,y,w,h`), usually in a footnote. Those
// are its citations. New ones go in the PDF's source note: the note whose `source` property names
// the PDF (that property is its link to the PDF), made beside it the first time. Once there are
// notes about the PDF, the user chooses which one a new note goes in (see NotePicker.tsx).

import * as api from "../api";
import { newId, type Part, readPart, writePart } from "../board/board";
import { findBlocks } from "../editor/blocks";
import { findFormatting, type Format, noteFormat } from "../editor/formatting";
import { appendToNote, isOpenInEditor, partOf, quotedAddress, relativePath, resolvePath, textOf, typstText } from "../editor/noteLinks";
import { findPropertiesBlock } from "../editor/properties";
import type { PdfInfo } from "../workspace/pdf";
import type { Choice } from "./NotePicker";

// ——— Annotations: marks on the pages ———

export const COLOURS = ["yellow", "green", "blue", "pink", "purple"] as const;
export type Colour = (typeof COLOURS)[number];

type Mark = { id: string; page: number; colour: Colour; created?: string };
export type Annotation =
  | (Mark & { type: "highlight"; quote: string })
  /** A note at a spot on a page, in the page's points from its top left. */
  | (Mark & { type: "note"; x: number; y: number })
  | (Mark & { type: "area"; x: number; y: number; width: number; height: number });
export type NewAnnotation = Annotation extends infer A ? (A extends Annotation ? Omit<A, "id" | "colour"> & { colour?: Colour } : never) : never;

/** The file keeping a PDF's annotations, beside it. */
export const annotationsFile = (pdf: string) => `${pdf.replace(/\.pdf$/i, "")}.annotations.json`;

type File = { pdf: string; annotations: Annotation[] } & Record<string, unknown>;

async function readFile(pdf: string): Promise<File> {
  const empty = { pdf: pdf.split("/").pop()!, annotations: [] };
  const text = await api.readNote(annotationsFile(pdf)).catch(() => null);
  if (!text?.trim()) return empty;
  try {
    const file = JSON.parse(text);
    return { ...empty, ...file, annotations: Array.isArray(file.annotations) ? file.annotations : [] };
  } catch {
    // (Not readable: better left untouched than overwritten.)
    throw new Error(`${annotationsFile(pdf).split("/").pop()} can't be read, so it wasn't changed.`);
  }
}

/** A PDF's annotations. */
export async function readAnnotations(pdf: string): Promise<Annotation[]> {
  return (await readFile(pdf).catch(() => ({ annotations: [] }))).annotations;
}

/** Changes a PDF's annotations; anything else in their file (another app's) is kept as it was. */
async function changeAnnotations(pdf: string, change: (annotations: Annotation[]) => Annotation[]) {
  const file = await readFile(pdf);
  await api.saveNote(annotationsFile(pdf), `${JSON.stringify({ ...file, annotations: change(file.annotations) }, null, 2)}\n`);
}

/** Adds an annotation (yellow unless said); returns it. */
export async function addAnnotation(pdf: string, annotation: NewAnnotation): Promise<Annotation> {
  const added = { id: newId(), colour: "yellow", created: new Date().toISOString(), ...annotation } as Annotation;
  await changeAnnotations(pdf, (all) => [...all, added]);
  return added;
}

export const recolourAnnotation = (pdf: string, id: string, colour: Colour) =>
  changeAnnotations(pdf, (all) => all.map((a) => (a.id === id ? { ...a, colour } : a)));

export const removeAnnotation = (pdf: string, id: string) => changeAnnotations(pdf, (all) => all.filter((a) => a.id !== id));

/** The part of the PDF an annotation marks, as a link's part says it. */
export function partOfAnnotation(annotation: Annotation | NewAnnotation): Part {
  const { page } = annotation;
  if (annotation.type === "highlight") return { page, quote: annotation.quote };
  if (annotation.type === "note") return { page, point: { x: annotation.x, y: annotation.y } };
  return { page, area: { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height } };
}

// ——— Citations: notes about parts of the PDF ———

export type Citation = {
  /** The note it's in, and whether that's the PDF's source note. */
  note: string;
  source: boolean;
  page: number;
  /** The part cited: a passage, a spot or an area. */
  quote?: string;
  point?: { x: number; y: number };
  area?: { x: number; y: number; width: number; height: number };
  /** What the note says about it: the paragraph the link is in, without its markup or footnotes. */
  text: string;
  /** Where it is in its note, to open it there (a part, like a link's). */
  at: string;
};

type Note = { path: string; text: string; source: boolean };

/** A link's address, if a formatting span is a link. */
const addressOf = (args: string | undefined, format: Format) => (format === "markdown" ? (args ?? null) : quotedAddress(args));

/** Text without its markup: links show their text, quotes their words in quotation marks; footnotes and comments are left out. */
function plain(text: string, format: Format) {
  if (format === "typst") {
    const spans = findFormatting(text, "typst");
    const changes: { from: number; to: number; insert: string }[] = [];
    for (const span of spans) {
      if (span.kind === "footnote" || span.kind === "comment") changes.push({ from: span.from, to: span.to, insert: "" });
      else span.markers.forEach((m, n) => changes.push({ ...m, insert: span.kind === "quotation" ? (n ? "”" : "“") : "" }));
    }
    let result = "";
    let at = 0;
    for (const change of changes.sort((a, b) => a.from - b.from)) {
      if (change.from < at) continue; // (Inside a footnote that's left out.)
      result += text.slice(at, change.from) + change.insert;
      at = change.to;
    }
    return (result + text.slice(at))
      .replace(/<[\p{L}\p{N}_:.-]+>/gu, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^>\s?/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The citations of a PDF (its path) in some notes: links to a passage, a spot or an area of it. */
export function findCitations(pdf: string, notes: Note[]): Citation[] {
  const found: Citation[] = [];
  for (const note of notes) {
    const format = noteFormat(note.path);
    if (!format) continue;
    const blocks = findBlocks(note.text, format);
    for (const span of findFormatting(note.text, format)) {
      if (span.kind !== "link") continue;
      const address = addressOf(span.args, format);
      if (!address || resolvePath(note.path, address, format === "markdown") !== pdf) continue;
      const fragment = partOf(address, format === "markdown");
      const part = readPart(fragment ? `#${fragment}` : "");
      if (!part.page || (part.quote === undefined && !part.point && !part.area)) continue;
      const block = blocks.find((b) => b.from <= span.from && span.from <= b.to);
      if (!block) continue;
      const lineEnd = note.text.indexOf("\n", block.from);
      const firstLine = note.text.slice(block.from, lineEnd === -1 ? note.text.length : lineEnd);
      found.push({
        note: note.path,
        source: note.source,
        page: part.page,
        ...(part.quote !== undefined && { quote: part.quote }),
        ...(part.point && { point: part.point }),
        ...(part.area && { area: part.area }),
        text: plain(note.text.slice(block.from, block.to), format),
        at: `before=${encodeURIComponent(firstLine)}`,
      });
    }
  }
  return found;
}

/** Whether a note is a PDF's source note: its `source` property names the PDF. */
async function isSourceOf(pdf: string, path: string, text: string) {
  const format = noteFormat(path);
  const block = format && findPropertiesBlock(text, format);
  if (!format || !block) return false;
  try {
    const properties = await api.parseProperties(format, text.slice(block.from, block.to));
    const source = properties.find((p) => p.key === "source")?.value;
    return source?.type === "text" && resolvePath(path, source.value, format === "markdown") === pdf;
  } catch {
    return false;
  }
}

/**
 * A PDF's citations, from every note linking to it; its source notes (one open first, then by
 * name), and the other notes citing it.
 */
export async function loadCitations(pdf: string): Promise<{ sources: string[]; citing: string[]; citations: Citation[] }> {
  const paths = await api.notesLinkingTo(pdf).catch(() => [] as string[]);
  const notes: Note[] = [];
  for (const path of paths) {
    const text = await textOf(path).catch(() => null);
    if (text !== null) notes.push({ path, text, source: await isSourceOf(pdf, path, text) });
  }
  const sources = notes
    .filter((n) => n.source)
    .map((n) => n.path)
    .sort((a, b) => Number(isOpenInEditor(b)) - Number(isOpenInEditor(a)) || a.localeCompare(b));
  const citations = findCitations(pdf, notes);
  const citing = [...new Set(citations.map((c) => c.note))].filter((n) => !sources.includes(n)).sort((a, b) => a.localeCompare(b));
  return { sources, citing, citations };
}

/** How a PDF is called in citations: its name, with spaces for underscores (like links). */
const nameOf = (path: string) => stemOf(path).replace(/_+/g, " ").trim() || stemOf(path);
const stemOf = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "");
const folderOf = (path: string) => path.split("/").slice(0, -1);

/**
 * Makes a PDF's source note beside it (`attention notes.typ`, or with a number if that's taken),
 * with the paper's details as properties (its `source` property links it to the PDF). Returns its path.
 */
async function makeSourceNote(pdf: string, info: PdfInfo, taken: (path: string) => Promise<boolean>) {
  let path = [...folderOf(pdf), `${stemOf(pdf)} notes.typ`].join("/");
  for (let n = 2; await taken(path); n++) path = [...folderOf(pdf), `${stemOf(pdf)} notes ${n}.typ`].join("/");
  await api.createNoteAt(path);
  const address = relativePath(path, pdf);
  const properties: api.Property[] = [{ key: "source", value: { type: "text", value: address }, raw: null }];
  if (info.title) properties.push({ key: "title", value: { type: "text", value: info.title }, raw: null });
  if (info.authors?.length) properties.push({ key: "authors", value: { type: "list", value: info.authors }, raw: null });
  if (info.year) properties.push({ key: "year", value: { type: "number", value: info.year }, raw: null });
  const block = await api.writeProperties("typst", properties);
  await api.saveNote(path, `${block}\n`);
  return path;
}

/**
 * Adds a note about a part of a PDF: a paragraph of its own with only a footnote citing the part,
 * `#footnote[#link(…)[attention, p. 3]]`, to write before. It goes in the note chosen, or else
 * the PDF's source note (made first if there's none, or if a new one is chosen). Returns the note
 * and where that paragraph is (a part, to open the note there).
 */
export async function addNote(pdf: string, part: Part, info: () => Promise<PdfInfo>, taken: (path: string) => Promise<boolean>, into?: Choice) {
  const source =
    into && "note" in into
      ? into.note
      : ((!into && (await loadCitations(pdf)).sources[0]) || (await makeSourceNote(pdf, await info().catch(() => ({})), taken)));
  const format = noteFormat(source) ?? "typst";
  const address = `${relativePath(source, pdf)}${writePart(part)}`;
  const line =
    format === "markdown"
      ? `[${nameOf(pdf)}, p. ${part.page}](${address.split("#")[0].split("/").map(encodeURIComponent).join("/")}${address.includes("#") ? `#${address.split("#").slice(1).join("#")}` : ""})`
      : `#footnote[#link("${address.replace(/[\\"]/g, (c) => `\\${c}`)}")[${typstText(nameOf(pdf))}, p. ${part.page}]]`;
  await appendToNote(source, (text) => `${text.trim() ? (text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n") : ""}${line}\n`);
  return { note: source, at: `before=${encodeURIComponent(line)}` };
}

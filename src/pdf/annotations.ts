// Annotating a PDF (see tests/pdf-annotations.test.tsx), like in Zotero.
//
// Annotations are marks on the PDF's pages: highlighted text, a note at a spot, an area. They're
// kept in a file beside the PDF, `attention.annotations.json` (renamed and deleted with it).
// A Zotero paper's (`zotero:<paper id>`) are kept in the workspace's hidden folder instead (see
// tests/zotero-notes.test.tsx).
//
// Notes about a part of the PDF are paragraphs in notes citing that part with a link
// (`attention.pdf#page=3&quote=…`, `&point=x,y`, `&area=x,y,w,h`), usually in a footnote. Those
// are its citations. New ones go in the PDF's source note: the note whose `source` property names
// the PDF (that property is its link to the PDF), made beside it the first time. Once there are
// notes about the PDF, the user chooses which one a new note goes in (see NotePicker.tsx).
//
// A PDF has links of its own too, like a note (see tests/pdf-links.test.tsx): words on a page
// linking to a note, kept with its annotations (`{"type": "link", "page", "quote", "to"}`, the
// note's path from the PDF's folder). The note isn't changed.

import * as api from "../api";
import { newId, type Part, readPart, writePart } from "../board/board";
import { findBlocks } from "../editor/blocks";
import { findFormatting, type Format, noteFormat } from "../editor/formatting";
import { appendToNote, editNote, isOpenInEditor, partOf, quotedAddress, relativePath, resolvePath, textOf, typstText } from "../editor/noteLinks";
import { findPropertiesBlock } from "../editor/properties";
import type { PdfInfo } from "../workspace/pdf";
import type { Choice } from "./NotePicker";

// ——— Annotations: marks on the pages ———

export const COLOURS = ["yellow", "green", "blue", "pink", "purple"] as const;
export type Colour = (typeof COLOURS)[number];

type Mark = { id: string; page: number; colour: Colour; created?: string };
export type Annotation =
  /** (`nth`: which time its words are on the page, when it's not the first.) */
  | (Mark & { type: "highlight"; quote: string; nth?: number })
  /** A note at a spot on a page, in the page's points from its top left. */
  | (Mark & { type: "note"; x: number; y: number })
  | (Mark & { type: "area"; x: number; y: number; width: number; height: number });
/**
 * Words on a page linking to a note or another PDF (its path from the PDF's folder, like a note's
 * links; a Zotero paper's `zotero:<id>`), with a PDF's title, to name the link by.
 */
export type PageLink = { id: string; type: "link"; page: number; quote: string; nth?: number; to: string; title?: string; created?: string };
/** What the annotations file keeps: the marks, and the PDF's links. */
type Kept = Annotation | PageLink;
export type NewAnnotation = Annotation extends infer A ? (A extends Annotation ? Omit<A, "id" | "colour"> & { colour?: Colour } : never) : never;

/** A Zotero paper's PDF (`zotero:<paper id>`), read from Zotero. */
export const isZoteroPaper = (pdf: string) => pdf.startsWith("zotero:");

/**
 * The file keeping a PDF's annotations: beside it, or for a Zotero paper in the workspace's
 * hidden folder (`.marginalia/zotero/<paper id>.annotations.json`).
 */
export const annotationsFile = (pdf: string) =>
  isZoteroPaper(pdf) ? `.marginalia/zotero/${pdf.slice("zotero:".length)}.annotations.json` : `${pdf.replace(/\.pdf$/i, "")}.annotations.json`;

type File = { pdf: string; annotations: Kept[] } & Record<string, unknown>;

async function readFile(pdf: string): Promise<File> {
  const empty = { pdf: isZoteroPaper(pdf) ? pdf : pdf.split("/").pop()!, annotations: [] };
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

const kept = async (pdf: string): Promise<Kept[]> => (await readFile(pdf).catch(() => ({ annotations: [] as Kept[] }))).annotations;

/** A PDF's annotations (its marks). */
export async function readAnnotations(pdf: string): Promise<Annotation[]> {
  return (await kept(pdf)).filter((a): a is Annotation => a.type !== "link");
}

/** A PDF's links to notes. */
export async function readPageLinks(pdf: string): Promise<PageLink[]> {
  return (await kept(pdf)).filter((a): a is PageLink => a.type === "link" && typeof a.to === "string" && typeof a.quote === "string");
}

/** Links words on a page to a note or a PDF (at `target`, a path in the workspace, or a Zotero paper's); returns the link. */
export async function addPageLink(pdf: string, page: number, quote: string, target: string, title?: string, nth?: number): Promise<PageLink> {
  const added: PageLink = {
    id: newId(),
    type: "link",
    page,
    quote,
    ...(nth && nth > 1 && { nth }),
    to: relativePath(pdf, target),
    ...(title && { title }),
    created: new Date().toISOString(),
  };
  await changeAnnotations(pdf, (all) => [...all, added]);
  return added;
}

/** The note or PDF a page's link goes to (its path in the workspace, or a Zotero paper's). */
export const targetOfLink = (pdf: string, link: PageLink) => resolvePath(pdf, link.to, false);

/**
 * After files moved: a PDF's links point to where their notes are now (`where` says where a path
 * went, if it moved), written from where the PDF is now (`was`: where it was, its links written
 * from there). Its file is only changed if a link changed.
 */
export async function relinkPageLinks(pdf: string, was: string, where: (path: string) => string | undefined) {
  const file = await readFile(pdf).catch(() => null);
  if (!file) return;
  let changed = false;
  const annotations = file.annotations.map((a) => {
    if (a.type !== "link" || typeof a.to !== "string") return a;
    const target = resolvePath(was, a.to, false);
    if (!target) return a;
    const to = relativePath(pdf, where(target) ?? target);
    if (to === a.to) return a;
    changed = true;
    return { ...a, to };
  });
  if (changed) await api.saveNote(annotationsFile(pdf), `${JSON.stringify({ ...file, annotations }, null, 2)}\n`);
}

/** Changes a PDF's annotations; anything else in their file (another app's) is kept as it was. */
async function changeAnnotations(pdf: string, change: (annotations: Kept[]) => Kept[]) {
  const file = await readFile(pdf);
  await api.saveNote(annotationsFile(pdf), `${JSON.stringify({ ...file, annotations: change(file.annotations) }, null, 2)}\n`);
}

/** A new annotation, ready to add (yellow unless said). */
export const newAnnotation = (annotation: NewAnnotation): Annotation =>
  ({ id: newId(), colour: "yellow", created: new Date().toISOString(), ...annotation }) as Annotation;

/** Adds an annotation (yellow unless said); returns it. */
export async function addAnnotation(pdf: string, annotation: NewAnnotation): Promise<Annotation> {
  const added = newAnnotation(annotation);
  await changeAnnotations(pdf, (all) => [...all, added]);
  return added;
}

/**
 * Takes some annotations (or links) away, by their ids, and puts others in as they are (one
 * already there isn't put in twice): to undo, and redo, changes to them.
 */
export const swapAnnotations = (pdf: string, remove: string[], add: (Annotation | PageLink)[]) =>
  changeAnnotations(pdf, (all) => {
    const kept = all.filter((a) => !remove.includes(a.id));
    return [...kept, ...add.filter((a) => !kept.some((k) => k.id === a.id))];
  });

export const recolourAnnotation = (pdf: string, id: string, colour: Colour) =>
  changeAnnotations(pdf, (all) => all.map((a) => (a.id === id && a.type !== "link" ? { ...a, colour } : a)));

export const removeAnnotation = (pdf: string, id: string) => changeAnnotations(pdf, (all) => all.filter((a) => a.id !== id));

/** Moves an annotation (a note at a spot, or an area) to a new place on its page. */
export const moveAnnotation = (pdf: string, id: string, to: { x: number; y: number }) =>
  changeAnnotations(pdf, (all) => all.map((a) => (a.id === id && (a.type === "note" || a.type === "area") ? { ...a, ...to } : a)));

/**
 * Makes the links citing a spot of a PDF (its page and point) cite another spot instead, in every
 * note linking to the PDF (open notes are changed in their editor). Other links are left alone.
 */
export async function moveCitedSpot(pdf: string, page: number, from: { x: number; y: number }, to: { x: number; y: number }) {
  const paths = await api.notesLinkingTo(pdf).catch(() => [] as string[]);
  const point = `point=${Math.round(to.x)},${Math.round(to.y)}`;
  for (const path of paths) {
    const format = noteFormat(path);
    if (!format) continue;
    await editNote(path, (text) => {
      const edits: { from: number; to: number; insert: string }[] = [];
      for (const span of findFormatting(text, format)) {
        if (span.kind !== "link") continue;
        const address = addressOf(span.args, format);
        if (!address || resolvePath(path, address, format === "markdown") !== pdf) continue;
        const fragment = partOf(address, format === "markdown");
        const part = readPart(fragment ? `#${fragment}` : "");
        if (part.page !== page || part.point?.x !== from.x || part.point?.y !== from.y) continue;
        // (The point as written in the link: replaced where it is.)
        const written = /point=(-?[\d.]+),(-?[\d.]+)/.exec(text.slice(span.from, span.to));
        if (!written) continue;
        const at = span.from + written.index;
        edits.push({ from: at, to: at + written[0].length, insert: point });
      }
      return edits;
    });
  }
}

/** The part of the PDF an annotation marks, as a link's part says it. */
export function partOfAnnotation(annotation: Annotation | NewAnnotation): Part {
  const { page } = annotation;
  if (annotation.type === "highlight") return { page, quote: annotation.quote, ...(annotation.nth && annotation.nth > 1 && { nth: annotation.nth }) };
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
  /** Which time the passage's words are on the page, when it's not the first. */
  nth?: number;
  /** The paragraph citing it as it's written in the note (to show it as the note does). */
  written?: string;
  /** In a list: what the bullet it's in says (a hint of what it's about). */
  context?: string;
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

/**
 * The start of a note as plain text, for a preview (without its properties, and headings without
 * their marks); null if there's no such note.
 */
export async function startOfNote(path: string, length = 280): Promise<string | null> {
  const text = await textOf(path).catch(() => null);
  if (typeof text !== "string") return null;
  const format = noteFormat(path);
  if (!format) return text.slice(0, length);
  const block = findPropertiesBlock(text, format);
  const body = (block ? text.slice(block.to) : text).replace(/^[ \t]*(=+|#+)[ \t]+/gm, "");
  const shown = plain(body, format);
  return shown.length > length ? `${shown.slice(0, length).trimEnd()}…` : shown;
}

/** A list's bullet, as it starts a line (Typst's and Markdown's: `-`, `+`, `*`, `1.`, `/` for terms). */
const LIST_ITEM = /^([ \t]*)([-+*]|\d+[.)]|\/)[ \t]/;
/** Lines without their list bullets. */
const withoutMarkers = (text: string) => text.replace(new RegExp(LIST_ITEM.source, "gm"), "$1");

/**
 * What a citation at `at` is in: in a list, the bullet it's in (its lines, not the bullets nested
 * in it), and the first line of the bullet that one's in (the context it's about); otherwise its
 * paragraph (`paragraph`).
 */
function citingPart(text: string, paragraph: { from: number; to: number }, at: number): { from: number; to: number; context?: string } {
  const lines: { from: number; to: number; text: string }[] = [];
  for (let from = paragraph.from; from <= paragraph.to; ) {
    const end = text.indexOf("\n", from);
    const to = end === -1 || end > paragraph.to ? paragraph.to : end;
    lines.push({ from, to, text: text.slice(from, to) });
    from = to + 1;
  }
  const citing = lines.findIndex((line) => line.from <= at && at <= line.to);
  let item = citing;
  while (item >= 0 && !LIST_ITEM.test(lines[item].text)) item = lines[item].text.trim() ? item - 1 : -1;
  if (item < 0) return paragraph;
  const indentOf = (line: string) => /^[ \t]*/.exec(line)![0].length;
  const indent = indentOf(lines[item].text);
  let last = item;
  while (last + 1 < lines.length && lines[last + 1].text.trim() && !LIST_ITEM.test(lines[last + 1].text) && indentOf(lines[last + 1].text) > indent) last++;
  // (A citation on a line after the bullet's own lines: the paragraph it's in, as before.)
  if (citing > last) return paragraph;
  let parent = item - 1;
  while (parent >= 0 && !(LIST_ITEM.test(lines[parent].text) && indentOf(lines[parent].text) < indent)) parent--;
  return { from: lines[item].from, to: lines[last].to, ...(parent >= 0 && { context: lines[parent].text }) };
}

/** Text without its markup: links show their text, quotes their words in quotation marks; footnotes and comments are left out. */
export function plain(text: string, format: Format) {
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
      const paragraph = blocks.find((b) => b.from <= span.from && span.from <= b.to);
      if (!paragraph) continue;
      // (In a list: the bullet citing it, and the bullet it's in.)
      const { from, to, context } = citingPart(note.text, paragraph, span.from);
      const block = { from, to };
      const lineEnd = note.text.indexOf("\n", block.from);
      const firstLine = note.text.slice(block.from, lineEnd === -1 || lineEnd > block.to ? block.to : lineEnd);
      found.push({
        note: note.path,
        source: note.source,
        page: part.page,
        ...(part.quote !== undefined && { quote: part.quote }),
        ...(part.nth && { nth: part.nth }),
        ...(part.point && { point: part.point }),
        ...(part.area && { area: part.area }),
        text: plain(withoutMarkers(note.text.slice(block.from, block.to)), format),
        ...(context !== undefined && { context: plain(withoutMarkers(context), format) }),
        written: note.text.slice(block.from, block.to),
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

/** Its authors, short: "Devlin", "Burns and Oppenheimer", "Vaswani et al.". */
export function shortAuthors(authors: string[]) {
  if (authors.length > 2) return `${authors[0]} et al.`;
  return authors.join(" and ");
}

/** How a PDF is called in citations: a Zotero paper by its authors and year, others by their name. */
const citedAs = (pdf: string, info: PdfInfo) =>
  (isZoteroPaper(pdf) && [shortAuthors(info.authors ?? []), info.year].filter(Boolean).join(", ")) || nameOf(pdf);

/** How a part of a PDF is cited: `attention, p. 3` (a Zotero paper by its authors and year). */
export const citationLabel = (pdf: string, info: PdfInfo, page: number) => `${citedAs(pdf, info)}, p. ${page}`;

/** How a part of a PDF can be cited: a footnote, a link, or the words quoted with a footnote. */
export type CiteAs = "footnote" | "link" | "quote";

/**
 * The code citing a part of a PDF (`label`: what the link says), for a note at `note` (its address
 * from the note's folder; "" for the top of the workspace) in its format. Typst: `#link(…)[…]`, in
 * a `#footnote[…]`, or after the words in `#quote[…]`. Markdown has no footnotes of its own here: a
 * footnote is the link, and a quote is the words in quotation marks with the link after them.
 */
export function citationCode(pdf: string, part: Part, label: string, note: string, format: Format, as: CiteAs, words = "") {
  const path = relativePath(note, pdf);
  const fragment = writePart(part);
  const quoted = words.replace(/\s+/g, " ").trim();
  if (format === "markdown") {
    const address = `${isZoteroPaper(pdf) ? path : path.split("/").map(encodeURIComponent).join("/")}${fragment}`;
    const link = `[${label}](${address})`;
    return as === "quote" ? `“${quoted}” (${link})` : link;
  }
  const link = `#link("${`${path}${fragment}`.replace(/[\\"]/g, (c) => `\\${c}`)}")[${typstText(label)}]`;
  if (as === "link") return link;
  return as === "quote" ? `#quote[${typstText(quoted)}]#footnote[${link}]` : `#footnote[${link}]`;
}

/**
 * Makes a PDF's source note (at `at`, else beside it: `attention notes.typ`, or with a number if
 * that's taken), with the paper's details as properties (its `source` property links it to the
 * PDF). Returns its path.
 */
export async function makeSourceNote(pdf: string, info: PdfInfo, taken: (path: string) => Promise<boolean>, at?: string) {
  let path = at ?? [...folderOf(pdf), `${stemOf(pdf)} notes.typ`].join("/");
  if (!at) for (let n = 2; await taken(path); n++) path = [...folderOf(pdf), `${stemOf(pdf)} notes ${n}.typ`].join("/");
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
 * Makes a note that's there a PDF's source note: its `source` property names the PDF (written
 * from the note's folder), and the paper's details it doesn't have yet are added (what it has is
 * kept). Its text stays as it is; a note open in an editor is changed there.
 */
export async function makeIntoSourceNote(pdf: string, info: PdfInfo, note: string) {
  const format = noteFormat(note) ?? "typst";
  const text = await textOf(note);
  const block = findPropertiesBlock(text, format);
  const properties = block ? await api.parseProperties(format, text.slice(block.from, block.to)) : [];
  const has = (key: string) => properties.some((p) => p.key === key);
  const source: api.Property = { key: "source", value: { type: "text", value: relativePath(note, pdf) }, raw: null };
  const withSource = has("source") ? properties.map((p) => (p.key === "source" ? source : p)) : [source, ...properties];
  if (info.title && !has("title")) withSource.push({ key: "title", value: { type: "text", value: info.title }, raw: null });
  if (info.authors?.length && !has("authors")) withSource.push({ key: "authors", value: { type: "list", value: info.authors }, raw: null });
  if (info.year && !has("year")) withSource.push({ key: "year", value: { type: "number", value: info.year }, raw: null });
  const written = await api.writeProperties(format, withSource);
  await editNote(note, (now) => {
    const at = findPropertiesBlock(now, format);
    if (at) return [{ from: at.from, to: at.to, insert: written }];
    return [{ from: 0, to: 0, insert: now.trim() ? `${written}\n\n` : `${written}\n` }];
  });
}

/**
 * Adds a note about a part of a PDF: a paragraph of its own with only a footnote citing the part,
 * `#footnote[#link(…)[attention, p. 3]]`, to write before. It goes in the note chosen, or else
 * the PDF's source note (made first if there's none, or if a new one is chosen). Returns the note
 * and where that paragraph is (a part, to open the note there).
 */
export async function addNote(pdf: string, part: Part, info: () => Promise<PdfInfo>, taken: (path: string) => Promise<boolean>, into?: Choice) {
  const details = await info().catch((): PdfInfo => ({}));
  const source =
    into && "note" in into
      ? into.note
      : ((!into && (await loadCitations(pdf)).sources[0]) || (await makeSourceNote(pdf, details, taken, into && "at" in into ? into.at : undefined)));
  const format = noteFormat(source) ?? "typst";
  const line = citationCode(pdf, part, citationLabel(pdf, details, part.page!), source, format, "footnote");
  await appendToNote(source, (text) => `${text.trim() ? (text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n") : ""}${line}\n`);
  return { note: source, at: `before=${encodeURIComponent(line)}` };
}

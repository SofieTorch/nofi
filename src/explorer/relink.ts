// Keeping links right when files move (see tests/explorer-folders.test.tsx › Links to what moved).
//
// After files or folders move (dragged, or a folder renamed), links to them in every note point
// to their new place, and a moved note's own links still point to the same files. A copied note's
// links are made to work from where the copy is. Links, images and a note's `source` property are
// changed; websites, Zotero papers, places in the same note and anything in code aren't. A PDF's
// links to notes (kept with its annotations) are changed the same way.

import { findFormatting, type Format, noteFormat } from "../editor/formatting";
import { editNote, relativePath, resolvePath } from "../editor/noteLinks";
import type { FileEntry } from "../api";
import { relinkPageLinks } from "../pdf/annotations";

/** A file or folder that moved, or was copied: where it was, and where it is now (or the copy). */
export type Moved = { from: string; to: string };

/** Where a path is after some moves (a moved folder takes what's in it); undefined if it didn't move. */
function moved(path: string, moves: Moved[]) {
  for (const { from, to } of moves) {
    if (path === from) return to;
    if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
  }
  return undefined;
}

type Address = { from: number; to: number; address: string };

const TYPST_ADDRESS = /#(?:link|image)\(\s*"((?:[^"\\\n]|\\.)*)"/g;
const MARKDOWN_ADDRESS = /\]\(([^)\s]+)\)/g;
const SOURCE = /^([ \t]*source:[ \t]*)(?:"((?:[^"\\\n]|\\.)*)"|([^\s",)][^\n,)]*?))[ \t]*,?[ \t]*$/gm;

/** The file addresses written in a note: links, images and its `source` property. */
function addressesIn(text: string, format: Format): Address[] {
  const code = findFormatting(text, format).filter((s) => s.kind === "code" || s.kind === "codeblock");
  const inCode = (at: number) => code.some((span) => span.from <= at && at < span.to);
  const found: Address[] = [];
  const add = (from: number, written: string, address: string) => {
    if (!inCode(from)) found.push({ from, to: from + written.length, address });
  };
  if (format === "typst") {
    for (const match of text.matchAll(TYPST_ADDRESS)) {
      const at = match.index + match[0].length - 1 - match[1].length;
      add(at, match[1], match[1].replace(/\\(.)/g, "$1"));
    }
  } else {
    for (const match of text.matchAll(MARKDOWN_ADDRESS)) add(match.index + 2, match[1], match[1]);
  }
  for (const match of text.matchAll(SOURCE)) {
    const written = match[2] ?? match[3];
    const at = match.index + match[1].length + (match[2] !== undefined ? 1 : 0);
    add(at, written, match[2] !== undefined ? written.replace(/\\(.)/g, "$1") : written);
  }
  return found;
}

/** An address for a file from a note, written as the note's format writes it, keeping its part. */
function write(note: string, target: string, old: string, format: Format, quoted: boolean) {
  const hash = old.indexOf("#");
  const part = hash < 0 ? "" : old.slice(hash);
  const path = relativePath(note, target);
  if (format === "markdown") return path.split("/").map(encodeURIComponent).join("/") + part;
  const address = path + part;
  return quoted ? address.replace(/[\\"]/g, (c) => `\\${c}`) : address;
}

/**
 * Changes the links in notes (`notes`: every note's path now) after files moved (`moves`), or
 * were copied (`copies`).
 */
export async function relink(notes: string[], moves: Moved[], copies: Moved[] = []) {
  const back = moves.map(({ from, to }) => ({ from: to, to: from }));
  const copiedBack = copies.map(({ from, to }) => ({ from: to, to: from }));
  for (const note of notes) {
    const format = noteFormat(note);
    if (!format) continue;
    // Where the note's addresses were written from; in a copy, links to what was copied with it
    // go to the copies.
    const copyOf = moved(note, copiedBack);
    const was = copyOf ?? moved(note, back) ?? note;
    const targets = copyOf ? copies : moves;
    await editNote(note, (text) => {
      const edits: { from: number; to: number; insert: string }[] = [];
      for (const { from, to, address } of addressesIn(text, format)) {
        if (address.startsWith("zotero:")) continue;
        const target = resolvePath(was, address, format === "markdown");
        if (!target) continue;
        const now = moved(target, targets);
        if (was === note && !now) continue;
        const quoted = text[from - 1] === '"';
        const insert = write(note, now ?? target, text.slice(from, to), format, quoted);
        if (insert !== text.slice(from, to)) edits.push({ from, to, insert });
      }
      return edits;
    }).catch(() => {});
  }
}

/** The PDFs among files (in folders too). */
export const pdfsIn = (entries: FileEntry[]): string[] =>
  entries.flatMap((entry) => (entry.kind === "folder" ? pdfsIn(entry.children) : entry.path.toLowerCase().endsWith(".pdf") ? [entry.path] : []));

/**
 * Changes PDFs' links to notes (`pdfs`: every PDF's path now, Zotero papers' too) after files moved
 * (`moves`), or were copied (`copies`): like notes' links, see `relink`.
 */
export async function relinkPdfs(pdfs: string[], moves: Moved[], copies: Moved[] = []) {
  const back = moves.map(({ from, to }) => ({ from: to, to: from }));
  const copiedBack = copies.map(({ from, to }) => ({ from: to, to: from }));
  for (const pdf of pdfs) {
    const copyOf = moved(pdf, copiedBack);
    const was = copyOf ?? moved(pdf, back) ?? pdf;
    const targets = copyOf ? copies : moves;
    await relinkPageLinks(pdf, was, (path) => moved(path, targets)).catch(() => {});
  }
}

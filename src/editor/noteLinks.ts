// Links, like Obsidian's. Typing [[ lists the workspace's files at the cursor (notes, PDFs, any
// file); choosing one writes a plain link to it, showing its name: `#link("Ideas.md")[Ideas]` in
// Typst, `[Ideas](Ideas.md)` in Markdown, the path starting from the note's own folder (so the
// links work in other apps too). A name no file has yet links to a new note. Clicking a link
// follows it (⌘-click: in a new pane): a note opens (created first if it doesn't exist yet), and
// the app decides what the rest do (see `LinkTarget`). Links show a hand cursor.
// A link can point to a part of a file after a # (see linkParts.ts): [[Paper.typ# lists the note's
// headings (and, as you type, its paragraphs), [[attention.pdf# the PDF's pages; # right after
// choosing a file from the list does the same. Pasting a copied
// link (`Paper.typ#methods`, see `copyLinkTo`) writes the link. Hovering a link says where it goes.

import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import { completionStatus, selectedCompletion, startCompletion } from "@codemirror/autocomplete";
import { isolateHistory } from "@codemirror/commands";
import { Facet, Prec, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import * as api from "../api";
import type { FileEntry } from "../api";
import { fuzzyScore } from "../ui/fuzzy";
import { openPdf } from "../workspace/pdf";
import { findFormatting, type Format, noteFormat, type Range } from "./formatting";
import { CARD_TYPE, type Dragged, writePart } from "../board/board";
import { anchorFor, findPart, type Part, partMarks, partsOf } from "./linkParts";

/** The note an editor shows (its path in the workspace): links start from its folder. */
export const notePath = Facet.define<string, string>({ combine: (paths) => paths[0] ?? "" });

/** The workspace's files (paths, notes first), for the [[ list. */
let workspaceFiles: string[] = [];

/** Where a link goes: a file in the workspace, or an address outside it (a website, an email). */
/** A file's `part`: what follows the # in the address (a note's heading or paragraph, `page=5`). */
export type LinkTarget = { path: string; part?: string } | { url: string };
/** Follows a link (in a new pane, for ⌘-click). */
let openLink: ((target: LinkTarget, newPane: boolean) => void) | null = null;

export function setWorkspaceNotes(entries: FileEntry[]) {
  const files: string[] = [];
  const walk = (list: FileEntry[]) => list.forEach((entry) => (entry.kind === "folder" ? walk(entry.children) : files.push(entry.path)));
  walk(entries);
  workspaceFiles = [...files.filter((path) => noteFormat(path)), ...files.filter((path) => !noteFormat(path))];
}

export function setNoteLinkOpener(open: ((target: LinkTarget, newPane: boolean) => void) | null) {
  openLink = open;
}

/** Says a link was copied (the app shows it). */
let reportCopied: ((message: string) => void) | null = null;
export function setLinkCopiedReporter(report: ((message: string) => void) | null) {
  reportCopied = report;
}

/** The notes open in an editor, by path: a label for a link goes in through the editor. */
const openEditors = new Map<string, EditorView>();
export function registerNoteEditor(path: string, view: EditorView) {
  openEditors.set(path, view);
  return () => {
    if (openEditors.get(path) === view) openEditors.delete(path);
  };
}

/** The workspace's notes (their paths). */
export const workspaceNotes = () => workspaceFiles.filter((path) => noteFormat(path));

/** Whether a note is open in an editor. */
export const isOpenInEditor = (path: string) => openEditors.has(path);

/** A note's text: as it is in its editor, if it's open. */
export const textOf = async (path: string) => openEditors.get(path)?.state.doc.toString() ?? (await api.readNote(path));

/** A PDF's number of pages (each PDF is opened once). */
const pageCounts = new Map<string, Promise<number>>();
function pagesOf(path: string) {
  let count = pageCounts.get(path);
  if (!count) {
    count = api
      .readWorkspaceFile(path)
      .then(openPdf)
      .then((pdf) => {
        const pages = pdf.pages;
        pdf.close();
        return pages;
      });
    count.catch(() => pageCounts.delete(path));
    pageCounts.set(path, count);
  }
  return count;
}

/**
 * Adds text at the end of a note: through its editor if it's open (so nothing typed is lost),
 * otherwise to its file. `make` gets the note's text and says what to add.
 */
export async function appendToNote(path: string, make: (text: string) => string) {
  const editor = openEditors.get(path);
  if (editor) {
    const end = editor.state.doc.length;
    editor.dispatch({ changes: { from: end, insert: make(editor.state.doc.toString()) } });
    return;
  }
  const text = await api.readNote(path);
  await api.saveNote(path, text + make(text));
}

/** Copies a link to a part of a note (labelling it first if needed); it's pasted as a link. */
export function copyLinkTo(view: EditorView, format: Format, part: Range & { kind: Part["kind"] }) {
  const { anchor, change } = anchorFor(view.state.doc.toString(), format, part);
  if (change) view.dispatch({ changes: { from: change.from, insert: change.insert }, userEvent: "input" });
  copyAddress(`${view.state.facet(notePath)}#${anchor}`);
}

/** Copies a file's address (with its part); it's pasted into a note as a link. */
export function copyAddress(address: string) {
  navigator.clipboard?.writeText(address).then(
    () => reportCopied?.("Link copied"),
    () => reportCopied?.("Couldn't copy the link."),
  );
}

const folderOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")).split("/") : []);
const nameOf = (path: string) => path.split("/").pop()!;
const stemOf = (path: string) => nameOf(path).replace(/\.[^.]+$/, "");

/** The path from one note's folder to another note, like "../Ideas.md". */
export function relativePath(from: string, to: string) {
  const here = folderOf(from);
  const there = to.split("/");
  let same = 0;
  while (same < here.length && same < there.length - 1 && here[same] === there[same]) same++;
  return [...here.slice(same).map(() => ".."), ...there.slice(same)].join("/");
}

/**
 * A file an address in a note points to, as a path in the workspace (from the note's folder);
 * null for a website, a place in the same note, or somewhere outside the workspace. Markdown
 * addresses have %20 for spaces (`decode`).
 */
export function resolvePath(from: string, address: string, decode: boolean): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(address) || address.startsWith("#") || address.startsWith("/")) return null;
  let target = address.split("#")[0];
  if (decode) {
    try {
      target = decodeURIComponent(target);
    } catch {
      return null;
    }
  }
  const parts = [...folderOf(from)];
  for (const part of target.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

/** Characters that mean something in Typst's [text], written as text. */
export const typstText = (text: string) => text.replace(/[\\[\]*_#$@<>`~]/g, (char) => `\\${char}`);
const markdownText = (text: string) => text.replace(/[\\[\]*_`]/g, (char) => `\\${char}`);

/** A link to a file (`target`, a workspace path; maybe a `part` of it) from a note, showing the file's name. */
export function linkCode(from: string, target: string, format: Format, part?: string) {
  const address = relativePath(from, target);
  // (Underscores, common in file names, show as spaces.)
  const name = stemOf(target).replace(/_+/g, " ").trim() || stemOf(target);
  if (format === "markdown") {
    const fragment = part ? `#${encodeURIComponent(part).replace(/%5E/gi, "^").replace(/%3D/gi, "=")}` : "";
    return `[${markdownText(name)}](${address.split("/").map(encodeURIComponent).join("/")}${fragment})`;
  }
  const quoted = (part ? `${address}#${part}` : address).replace(/[\\"]/g, (char) => `\\${char}`);
  return `#link("${quoted}")[${typstText(name)}]`;
}

/** The part of a file an address names (after the #), if any. */
export function partOf(address: string, decode: boolean) {
  const at = address.indexOf("#");
  if (at < 0 || at === address.length - 1) return undefined;
  const part = address.slice(at + 1);
  try {
    return decode ? decodeURIComponent(part) : part;
  } catch {
    return part;
  }
}

/** A file in the workspace with that name ("attention", "attention.pdf") or path, if there's one. */
function fileNamed(from: string, name: string) {
  if (workspaceFiles.includes(name)) return name;
  const wanted = name.toLowerCase();
  const named = workspaceFiles.filter((path) => stemOf(path).toLowerCase() === wanted || nameOf(path).toLowerCase() === wanted);
  const here = folderOf(from).join("/");
  return named.find((path) => folderOf(path).join("/") === here) ?? named[0];
}

/**
 * The file a name typed after [[ means: one with that name ("attention" or "attention.pdf"; notes
 * first, then in this folder first), or a new note here.
 */
function noteNamed(from: string, name: string, format: Format) {
  return fileNamed(from, name) ?? [...folderOf(from), `${name}.${format === "typst" ? "typ" : "md"}`].join("/");
}

/** The [[ was turned into a link (or left as it was): it's forgotten. */
const forgetPending = StateEffect.define<null>();

/** Where [[ was just typed: what follows it becomes a link once the cursor leaves it. */
const pendingLink = StateField.define<number | null>({
  create: () => null,
  update(start, transaction) {
    if (transaction.effects.some((effect) => effect.is(forgetPending))) return null;
    const { state } = transaction;
    const head = state.selection.main.head;
    if (transaction.docChanged && transaction.isUserEvent("input.type")) {
      // A [[ before the cursor on its line, with no ] since, that was part of what was typed
      // (one key at a time, or all at once).
      const line = state.doc.lineAt(head);
      const typed = /\[\[[^[\]\n]*$/.exec(state.sliceDoc(line.from, head));
      let insertedFrom = Infinity;
      transaction.changes.iterChangedRanges((_fromA, _toA, fromB) => (insertedFrom = Math.min(insertedFrom, fromB)));
      if (typed) {
        const at = line.from + typed.index;
        if (at + 2 > insertedFrom) return at;
      }
    }
    if (start === null || !transaction.docChanged) return start;
    const mapped = transaction.changes.mapPos(start, 1);
    return state.sliceDoc(mapped, mapped + 2) === "[[" ? mapped : null;
  },
});

/** What follows a [[: the name typed, and where it all ends (after the ]] if there is one). */
function placeholderAt(text: string, start: number) {
  const found = /^\[\[([^[\]\n]*)(\]\])?/.exec(text.slice(start));
  return found ? { name: found[1], nameEnd: start + 2 + found[1].length, end: start + found[0].length } : null;
}

/**
 * [[ is a shortcut for a link: choosing from the list isn't needed. Once the cursor leaves the
 * name typed after it (a click elsewhere, moving away, leaving the note), it becomes a link to the
 * note with that name, or to a new note (created when the link is first clicked).
 */
function placeholderLinks(format: Format) {
  return ViewPlugin.fromClass(
    class {
      update(update: ViewUpdate) {
        const start = update.state.field(pendingLink);
        if (start === null) return;
        const view = update.view;
        const found = placeholderAt(update.state.doc.toString(), start);
        const { head } = update.state.selection.main;
        const inside = found && head >= start + 2 && head <= found.nameEnd;
        if (inside && view.hasFocus) return;
        // (After this update: an editor can't be changed while it's being updated.)
        queueMicrotask(() => {
          if (view.state.field(pendingLink) !== start) return;
          const now = placeholderAt(view.state.doc.toString(), start);
          // (What follows a # is the part of the file.)
          const [name, part] = (now?.name ?? "").split(/#(.*)/s).map((piece) => piece?.trim());
          const from = view.state.facet(notePath);
          const code = now && name ? linkCode(from, noteNamed(from, name, format), format, part || undefined) : null;
          view.dispatch({
            ...(code && now ? { changes: { from: start, to: now.end, insert: code } } : {}),
            effects: forgetPending.of(null),
            annotations: [isolateHistory.of("full")],
            userEvent: "input.complete",
            // (Forgets the [[ either way.)
            selection: code && now && head > start ? { anchor: head >= now.end ? head - (now.end - start) + code.length : start + code.length } : undefined,
          });
        });
      }
    },
  );
}

/** A link just made by choosing a file in the [[ list: typing # right after it goes on to the file's parts. */
const linked = StateEffect.define<{ from: number; to: number; path: string }>();
const justLinked = StateField.define<{ from: number; to: number; path: string } | null>({
  create: () => null,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(linked)) return effect.value;
    return transaction.docChanged || transaction.selection ? null : value;
  },
});

/** A [[ option for a file: going on with # lists the file's parts. */
type FileOption = Completion & { path: string };

/** The [[ list: the workspace's files, best matches first, and a new note for a new name. After a #, the file's parts. */
export function noteLinkSource(format: Format): CompletionSource {
  return (context: CompletionContext): CompletionResult | null | Promise<CompletionResult | null> => {
    const typed = context.matchBefore(/\[\[[^[\]\n]*$/);
    if (!typed) return null;
    const from = context.state.facet(notePath);
    const query = typed.text.slice(2);
    if (query.includes("#")) return partOptions(context, format, typed.from, query);
    const apply = (target: string) => (view: EditorView, _completion: Completion, start: number, end: number) => {
      // Brackets closed for the [[ as they were typed go too.
      const closing = /^\]{0,2}/.exec(view.state.sliceDoc(end, end + 2))![0].length;
      const code = linkCode(from, target, format);
      view.dispatch({
        changes: { from: start - 2, to: end + closing, insert: code },
        selection: { anchor: start - 2 + code.length },
        effects: linked.of({ from: start - 2, to: start - 2 + code.length, path: target }),
        userEvent: "input.complete",
      });
    };
    const options: Completion[] = workspaceFiles
      .map((path) => ({ path, score: fuzzyScore(nameOf(path), query) ?? (fuzzyScore(path, query) === null ? null : 1000) }))
      .filter((match): match is { path: string; score: number } => match.score !== null)
      // Best matches first; notes before other files; then by name.
      .sort((a, b) => a.score - b.score || Number(!noteFormat(a.path)) - Number(!noteFormat(b.path)) || nameOf(a.path).localeCompare(nameOf(b.path)))
      .map(({ path }, i): FileOption => ({
        label: nameOf(path),
        detail: folderOf(path).join("/") || undefined,
        type: noteFormat(path) ? "note" : "file",
        boost: -i,
        apply: apply(path),
        path,
      }));
    const name = query.trim();
    const known = workspaceFiles.some(
      (path) => stemOf(path).toLowerCase() === name.toLowerCase() || nameOf(path).toLowerCase() === name.toLowerCase(),
    );
    if (name && !known && !/[/\\]/.test(name)) {
      const folder = folderOf(from);
      const target = [...folder, `${name}.${format === "typst" ? "typ" : "md"}`].join("/");
      options.push({ label: `New note “${name}”`, type: "note-new", boost: -options.length - 1, apply: apply(target) });
    }
    return { from: typed.from + 2, filter: false, options };
  };
}

/**
 * After [[file#: a note's headings (and, once words are typed, its paragraphs that have them), or
 * a PDF's pages. Choosing one links to it; a heading or paragraph gets its label if it needs one.
 */
async function partOptions(context: CompletionContext, format: Format, start: number, query: string): Promise<CompletionResult | null> {
  const from = context.state.facet(notePath);
  const hash = query.indexOf("#");
  const target = fileNamed(from, query.slice(0, hash).trim());
  if (!target) return null;
  const wanted = query.slice(hash + 1);
  const partFrom = start + 2 + hash + 1;
  const write = (view: EditorView, end: number, part: string, extra?: { from: number; insert: string }) => {
    const closing = /^\]{0,2}/.exec(view.state.sliceDoc(end, end + 2))![0].length;
    const code = linkCode(from, target, format, part);
    const changes = view.state.changes([{ from: start, to: end + closing, insert: code }, ...(extra ? [extra] : [])]);
    view.dispatch({ changes, selection: { anchor: changes.mapPos(end + closing, 1) }, userEvent: "input.complete" });
  };

  if (target.toLowerCase().endsWith(".pdf")) {
    const pages = await pagesOf(target).catch(() => 0);
    const options = Array.from({ length: pages }, (_, i) => i + 1)
      .filter((page) => String(page).startsWith(wanted.trim()))
      .map((page, i) => ({
        label: `Page ${page}`,
        type: "page",
        boost: -i,
        apply: (view: EditorView, _c: Completion, _from: number, end: number) => write(view, end, `page=${page}`),
      }));
    return { from: partFrom, filter: false, options };
  }

  const targetFormat = noteFormat(target);
  if (!targetFormat) return null;
  const text = await textOf(target).catch(() => null);
  if (text === null) return null;
  const words = wanted.trim().toLowerCase();
  const parts = partsOf(text, targetFormat);
  const headings = parts.filter((part) => part.kind === "heading" && (!words || fuzzyScore(part.shown, words) !== null));
  const paragraphs = words ? parts.filter((part) => part.kind !== "heading" && text.slice(part.from, part.to).toLowerCase().includes(words)) : [];
  const options = [...headings, ...paragraphs].map((part, i) => ({
    label: part.shown,
    type: part.kind === "heading" ? "heading" : "paragraph",
    boost: -i,
    apply: (view: EditorView, _c: Completion, _from: number, end: number) => linkToPart(view, end, target, targetFormat, text, part, write),
  }));
  return { from: partFrom, filter: false, options };
}

/** Writes a link to a part of a note, and the label it needs: in this note, in its editor if it's open, or in the file. */
function linkToPart(
  view: EditorView,
  end: number,
  target: string,
  format: Format,
  seen: string,
  part: Part,
  write: (view: EditorView, end: number, part: string, extra?: { from: number; insert: string }) => void,
) {
  if (view.state.facet(notePath) === target) {
    // The note being written: the part is found again in its text as it is now.
    const now = view.state.doc.toString();
    const same = partsOf(now, format).filter((p) => p.kind === part.kind && p.shown === part.shown);
    const nth = partsOf(seen, format)
      .filter((p) => p.kind === part.kind && p.shown === part.shown)
      .findIndex((p) => p.from === part.from);
    const here = same[nth] ?? same[0];
    if (!here) return;
    const { anchor, change } = anchorFor(now, format, here);
    return write(view, end, anchor, change);
  }
  const { anchor, change } = anchorFor(seen, format, part);
  write(view, end, anchor);
  if (change) addMark(target, seen, part, change);
}

/** Adds a part's label to another note: through its editor if it's open, or to the file. */
async function addMark(path: string, seen: string, part: Part, change: { from: number; insert: string }) {
  const editor = openEditors.get(path);
  const text = editor ? editor.state.doc.toString() : await api.readNote(path);
  // Where the part is now (the note may have changed since it was listed).
  let at = change.from;
  if (text !== seen) {
    const found = text.indexOf(seen.slice(part.from, part.to));
    if (found < 0) return;
    at = found + (change.from - part.from);
  }
  if (editor) editor.dispatch({ changes: { from: at, insert: change.insert } });
  else await api.saveNote(path, text.slice(0, at) + change.insert + text.slice(at));
}

/** How a file is named after [[: its name, or its path when another file has the same name. */
function nameFor(path: string) {
  const name = nameOf(path);
  return workspaceFiles.filter((other) => nameOf(other) === name).length === 1 ? name : path;
}

/**
 * # while the [[ list shows files goes on with the highlighted file, to list its parts. (Its name;
 * its path when another file has the same name.)
 */
const continueWithFile = Prec.highest(
  keymap.of([
    {
      key: "#",
      run(view) {
        // Right after a link just chosen from the list: back to [[file#, listing its parts.
        const just = view.state.field(justLinked, false);
        if (just && view.state.selection.main.empty && view.state.selection.main.head === just.to) {
          const insert = `[[${nameFor(just.path)}#`;
          view.dispatch({
            changes: { from: just.from, to: just.to, insert },
            selection: { anchor: just.from + insert.length },
            userEvent: "input.type",
          });
          startCompletion(view);
          return true;
        }
        if (completionStatus(view.state) !== "active") return false;
        const option = selectedCompletion(view.state) as FileOption | null;
        if (!option?.path) return false;
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        const typed = /\[\[([^[\]\n#]*)$/.exec(view.state.sliceDoc(line.from, head));
        if (!typed) return false;
        const insert = `${nameFor(option.path)}#`;
        const queryFrom = line.from + typed.index + 2;
        view.dispatch({
          changes: { from: queryFrom, to: head, insert },
          selection: { anchor: queryFrom + insert.length },
          userEvent: "input.type",
        });
        startCompletion(view);
        return true;
      },
    },
  ]),
);

/** A Typst link's address: the quoted text in its settings, like `"Ideas.md"`. */
export const quotedAddress = (args = "") => /^\s*"((?:[^"\\]|\\.)*)"/.exec(args)?.[1].replace(/\\(.)/g, "$1") ?? null;

/**
 * Clicking a link follows it (not while editing that link: then it moves the cursor); with ⌘
 * (Ctrl elsewhere), in a new pane. A Typst link to a label (`#link(<intro>)[…]`) goes there in
 * the note. Links show a hand cursor, and say where they go when hovered.
 */
export function followNoteLinks(format: Format) {
  return [
    pendingLink,
    placeholderLinks(format),
    justLinked,
    continueWithFile,
    followClicks(format),
    hiddenMarks(format),
    flashField,
    EditorView.theme({
      ".cm-link": { cursor: "pointer" },
      ".cm-flash": { backgroundColor: "rgb(254 240 138 / 0.6)", transition: "background-color 0.6s" },
    }),
  ];
}

/** The link shown by an element in the note: its span, and its address (null for a label link). */
function linkAt(view: EditorView, element: EventTarget | null, format: Format) {
  const link = element instanceof Element ? element.closest<HTMLElement>(".cm-link") : null;
  if (!link || !view.contentDOM.contains(link) || link.closest(".cm-editor") !== view.dom) return null;
  const pos = view.posAtDOM(link);
  const span = findFormatting(view.state.doc.toString(), format).find((s) => s.kind === "link" && s.from <= pos && pos <= s.to);
  if (!span) return null;
  const label = format === "typst" ? /^\s*<([\w:.-]+)>/.exec(span.args ?? "")?.[1] : undefined;
  const address = format === "markdown" ? (span.args ?? null) : quotedAddress(span.args);
  return { element: link, span, label, address };
}

/** Where an address in a note goes. */
function targetOf(view: EditorView, address: string, format: Format): LinkTarget | null {
  if (/^(https?:|mailto:)/i.test(address)) return { url: address };
  const decode = format === "markdown";
  const path = resolvePath(view.state.facet(notePath), address, decode);
  if (!path) return null;
  const part = partOf(address, decode);
  return part ? { path, part } : { path };
}

/**
 * A link's tooltip: a small card under it, outside the editor's text (changing the link's own
 * element, like giving it a title, would make the editor draw it again, under the mouse).
 */
let hovered: HTMLElement | null = null;
let tooltip: HTMLElement | null = null;

function showTooltip(link: HTMLElement, text: string) {
  if (!link.isConnected) return;
  tooltip ??= document.createElement("div");
  tooltip.setAttribute("role", "tooltip");
  tooltip.className = "pointer-events-none fixed z-50 max-w-80 truncate rounded-md bg-neutral-800 px-2 py-1 text-xs text-white shadow";
  tooltip.textContent = text;
  const box = link.getBoundingClientRect();
  tooltip.style.left = `${box.left}px`;
  tooltip.style.top = `${box.bottom + 6}px`;
  document.body.append(tooltip);
}

function hideTooltip() {
  hovered = null;
  tooltip?.remove();
}

/** What a link's tooltip says: the file, and the part (a heading's text, a paragraph's first words, a page). */
async function describe(target: LinkTarget) {
  if ("url" in target) return target.url;
  const { path, part } = target;
  if (!part) return path;
  const page = /^page=(\d+)$/.exec(part);
  if (page) return `${path} › page ${page[1]}`;
  const format = noteFormat(path);
  const text = format ? await textOf(path).catch(() => null) : null;
  const found = format && text !== null ? findPart(text, format, part) : null;
  const shown = found && format && text !== null ? partsOf(text, format).find((p) => p.from === found.from)?.shown : undefined;
  return `${path} › ${shown ?? part}`;
}

/** Follows an address written in a note (in a new pane, for ⌘-click); false if it goes nowhere. */
export function followAddress(view: EditorView, address: string, format: Format, newPane: boolean) {
  const target = openLink && targetOf(view, address, format);
  if (!target) return false;
  openLink!(target, newPane);
  return true;
}

function followClicks(format: Format) {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      hideTooltip();
      if (event.button !== 0 || event.shiftKey || event.altKey) return false;
      const link = linkAt(view, event.target, format);
      if (!link) return false;
      const { span } = link;
      // (Right at its start or end, as just after making it, isn't editing it.)
      const { head } = view.state.selection.main;
      if (view.hasFocus && head > span.from && head < span.to) return false;
      const newPane = event.metaKey || event.ctrlKey;

      // A label in this note: the cursor goes there.
      if (link.label) {
        // Where the label is put (not a link to it, like this one: those come after a "(").
        const text = view.state.doc.toString();
        const found = [...text.matchAll(new RegExp(`<${link.label.replace(/[.]/g, "\\.")}>`, "g"))].find(
          (m) => !/\(\s*$/.test(text.slice(0, m.index)),
        );
        if (!found) return false;
        const at = found.index;
        event.preventDefault();
        view.focus();
        view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: "center" }) });
        return true;
      }

      if (!link.address || !openLink) return false;
      const target = targetOf(view, link.address, format);
      if (!target) return false;
      event.preventDefault();
      openLink(target, newPane);
      return true;
    },
    mouseover(event, view) {
      const link = linkAt(view, event.target, format);
      if (!link?.address || link.element === hovered) return false;
      const target = targetOf(view, link.address, format);
      if (!target) return false;
      const element = link.element;
      hovered = element;
      describe(target).then((text) => hovered === element && showTooltip(element, text));
      return false;
    },
    mouseout(event) {
      if (!hovered) return false;
      const into = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (into && hovered.contains(into)) return false;
      hideTooltip();
      return false;
    },
    // Selected text dragged out (to a board) carries the note and the text.
    dragstart(event, view) {
      const { from, to } = view.state.selection.main;
      if (from === to || !event.dataTransfer) return false;
      const dragged: Dragged = { file: view.state.facet(notePath), subpath: writePart({ quote: view.state.sliceDoc(from, to) }) };
      event.dataTransfer.setData(CARD_TYPE, JSON.stringify(dragged));
      return false;
    },
    // A copied link (a workspace file's address with a part, like `Paper.typ#methods`) is pasted as a link.
    paste(event, view) {
      const pasted = event.clipboardData?.getData("text/plain")?.trim();
      const found = pasted ? /^([^\s#][^#\n]*)#([^\s#]+)$/.exec(pasted) : null;
      if (!found || !workspaceFiles.includes(found[1])) return false;
      event.preventDefault();
      const code = linkCode(view.state.facet(notePath), found[1], format, found[2]);
      view.dispatch(view.state.replaceSelection(code), { userEvent: "input.paste" });
      return true;
    },
  });
}

/** Labels (and Markdown's ^ marks) at the end of headings and paragraphs are hidden, unless the cursor is at them. */
function hiddenMarks(format: Format) {
  const build = (view: EditorView): DecorationSet => {
    const { state } = view;
    const { head } = state.selection.main;
    const hide = Decoration.replace({});
    const ranges = partMarks(state.doc.toString(), format)
      .filter((mark) => head < mark.from || head > mark.to)
      .map((mark) => hide.range(mark.from, mark.to));
    return Decoration.set(ranges, true);
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet) this.decorations = build(update.view);
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/** Highlights a part of the note for a moment (where a link just went). */
const flash = StateEffect.define<Range | null>();
const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(lines, transaction) {
    for (const effect of transaction.effects) {
      if (!effect.is(flash)) continue;
      if (!effect.value) return Decoration.none;
      const { doc } = transaction.state;
      const ranges = [];
      for (let n = doc.lineAt(effect.value.from).number; n <= doc.lineAt(effect.value.to).number; n++) {
        ranges.push(Decoration.line({ class: "cm-flash" }).range(doc.line(n).from));
      }
      return Decoration.set(ranges);
    }
    return lines.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Goes to the part of the note an anchor names (from a link): the cursor at its start, in view,
 * highlighted for a moment. False if the note has no such part.
 */
export function goToPart(view: EditorView, format: Format, anchor: string) {
  // "end": the cursor at the end, to write there (under a new annotation).
  if (anchor === "end") {
    const end = view.state.doc.length;
    view.dispatch({ selection: { anchor: end }, effects: EditorView.scrollIntoView(end, { y: "center" }) });
    view.focus();
    return true;
  }
  // "before=…": the cursor just before that text (the last time it's there), to write there.
  if (anchor.startsWith("before=")) {
    let wanted = anchor.slice(7);
    try {
      wanted = decodeURIComponent(wanted);
    } catch {
      // (Written as it is.)
    }
    const at = view.state.doc.toString().lastIndexOf(wanted);
    if (at < 0 || !wanted) return false;
    const line = view.state.doc.lineAt(at);
    view.dispatch({
      selection: { anchor: at },
      effects: [EditorView.scrollIntoView(at, { y: "center" }), flash.of({ from: line.from, to: line.to })],
    });
    view.focus();
    setTimeout(() => view.dom.isConnected && view.dispatch({ effects: flash.of(null) }), 1200);
    return true;
  }
  const found = findPart(view.state.doc.toString(), format, anchor);
  if (!found) return false;
  view.dispatch({
    // (Text from the note is selected; a heading or paragraph, the cursor goes to its start.)
    selection: anchor.startsWith("quote=") ? { anchor: found.from, head: found.to } : { anchor: found.from },
    effects: [EditorView.scrollIntoView(found.from, { y: "center" }), flash.of(found)],
  });
  view.focus();
  setTimeout(() => view.dom.isConnected && view.dispatch({ effects: flash.of(null) }), 1200);
  return true;
}

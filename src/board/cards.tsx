// What a board's cards show: text written on the board (edited in place), or a file shown live —
// a note (or a part of it, or text from it), a PDF page, a passage or an area of a PDF, a picture.

import { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import RULE from "../editor/checklistRule.typ?raw";
import { editorFeatures } from "../editor/features";
import { type Format, noteFormat } from "../editor/formatting";
import { findPart, partsOf } from "../editor/linkParts";
import { notePath, textOf } from "../editor/noteLinks";
import { findPropertiesBlock } from "../editor/properties";
import type { PdfDocument } from "../workspace/pdf";
import { openPdf } from "../workspace/pdf";
import { type FileCard, type Part, readPart } from "./board";

const nameOf = (path: string) => path.split("/").pop()!;
const isPdf = (path: string) => path.toLowerCase().endsWith(".pdf");
const isPicture = (path: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(path);
const shorten = (text: string, length = 40) => (text.length > length ? `${text.slice(0, length).trimEnd()}…` : text);

/** What a file card is called: its file, and the part it shows. */
export function cardName(card: FileCard, shownPart?: string) {
  const name = nameOf(card.file);
  const part = readPart(card.subpath);
  if (isPdf(card.file)) {
    const page = part.page ?? 1;
    if (part.area) return `${name} › area of page ${page}`;
    if (part.quote !== undefined) return `${name} › passage on page ${page}`;
    return `${name} › page ${page}`;
  }
  if (part.quote !== undefined) return `${name} › “${shorten(part.quote)}”`;
  if (part.anchor) return `${name} › ${shownPart ?? part.anchor}`;
  return name;
}

/** PDFs opened for a board's cards, each once; closed with the board. */
export class PdfCache {
  private opened = new Map<string, Promise<PdfDocument>>();
  get(path: string) {
    let document = this.opened.get(path);
    if (!document) {
      document = api.readWorkspaceFile(path).then(openPdf);
      document.catch(() => this.opened.delete(path));
      this.opened.set(path, document);
    }
    return document;
  }
  close() {
    for (const document of this.opened.values()) document.then((d) => d.close(), () => {});
    this.opened.clear();
  }
}

type FileProps = {
  card: FileCard;
  /** The board's file (links in cards start from its folder). */
  boardPath: string;
  pdfs: PdfCache;
  /** Changes when notes are saved: note cards read their note again. */
  version: number;
  /** Says what the card is called, once its part is known (a heading's text). */
  onName: (name: string) => void;
};

/** A file shown on a card. */
export function FileContent(props: FileProps) {
  const { card } = props;
  if (isPdf(card.file)) return <PdfContent {...props} />;
  if (isPicture(card.file)) return <PictureContent {...props} />;
  const format = noteFormat(card.file);
  if (format) return <NoteContent {...props} format={format} />;
  return <p className="p-3 text-sm text-neutral-500">{nameOf(card.file)}</p>;
}

const Missing = ({ file }: { file: string }) => (
  <p className="p-3 text-sm text-neutral-400">{nameOf(file)} isn't in the workspace anymore.</p>
);

/** The part of a note a card shows: the whole note (without its properties), a heading's section, a paragraph, or some text. */
function shownText(text: string, format: Format, part: Part) {
  if (part.quote !== undefined) return { text: part.quote };
  if (part.anchor) {
    const found = findPart(text, format, part.anchor);
    if (!found) return null;
    const parts = partsOf(text, format);
    const first = parts.find((p) => p.from === found.from);
    let to = found.to;
    // A heading shows its section: what follows it, up to the next heading as big or bigger.
    if (first?.kind === "heading") {
      const level = headingLevel(text, format, found.from);
      const next = parts.find((p) => p.from > found.from && p.kind === "heading" && headingLevel(text, format, p.from) <= level);
      to = next ? next.from : text.length;
    }
    return { text: text.slice(found.from, to).trimEnd(), shown: first?.shown };
  }
  let whole = text.replace(RULE, "");
  const properties = findPropertiesBlock(whole, format);
  if (properties) whole = whole.slice(properties.to);
  return { text: whole.trim() };
}

const headingLevel = (text: string, _format: Format, at: number) => /^(=+|#+)/.exec(text.slice(at))?.[1].length ?? 1;

function NoteContent({ card, format, version, onName }: FileProps & { format: Format }) {
  const [state, setState] = useState<{ text: string } | "missing" | "loading">("loading");
  const part = readPart(card.subpath);
  useEffect(() => {
    let current = true;
    textOf(card.file).then(
      (text) => {
        if (!current) return;
        const shown = shownText(text, format, part);
        if (!shown) return setState({ text: "" });
        if ("shown" in shown && shown.shown) onName(shown.shown);
        setState({ text: shown.text });
      },
      () => current && setState("missing"),
    );
    return () => {
      current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.file, card.subpath, version, format]);
  if (state === "missing") return <Missing file={card.file} />;
  if (state === "loading") return null;
  return <NotePreview text={state.text} format={format} path={card.file} />;
}

/** A note's text shown on a card, styled as in the editor, but not editable there. */
function NotePreview({ text, format, path }: { text: string; format: Format; path: string }) {
  const parent = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  useEffect(() => {
    view.current = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.contentAttributes.of({ "aria-label": `Shown from ${nameOf(path)}` }),
          notePath.of(path),
          editorFeatures(format, { inCard: true, readOnly: true }),
        ],
      }),
    });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, format]);
  useEffect(() => {
    const editor = view.current;
    if (editor && editor.state.doc.toString() !== text) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: text } });
  }, [text]);
  return <div ref={parent} className="card-note px-3 py-2" />;
}

function PdfContent({ card, pdfs }: FileProps) {
  const part = readPart(card.subpath);
  const page = part.page ?? 1;
  const [missing, setMissing] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = part.quote === undefined;

  useEffect(() => {
    if (!drawing) return;
    let current = true;
    pdfs
      .get(card.file)
      .then((document) => document.page(Math.min(page, document.pages)))
      .then(async (shown) => {
        if (!current || !canvas.current) return;
        const area = part.area;
        if (!area) return shown.draw(canvas.current, card.width / shown.width);
        // An area: the page drawn so the area fills the card's width, and that piece of it kept.
        const scale = card.width / area.width;
        const whole = document.createElement("canvas");
        await shown.draw(whole, scale);
        const target = canvas.current;
        const ratio = window.devicePixelRatio || 1;
        target.width = Math.round(card.width * ratio);
        target.height = Math.round(area.height * scale * ratio);
        target.style.width = "100%";
        target.getContext("2d")?.drawImage(whole, area.x * scale * ratio, area.y * scale * ratio, area.width * scale * ratio, area.height * scale * ratio, 0, 0, target.width, target.height);
      })
      .catch(() => current && setMissing(true));
    return () => {
      current = false;
    };
  }, [card.file, card.subpath, card.width, drawing, page, pdfs, part.area]);

  if (missing) return <Missing file={card.file} />;
  if (!drawing) {
    return (
      <p className="px-3 py-2 text-[15px] leading-relaxed text-neutral-800" style={{ whiteSpace: "pre-line" }}>
        {part.quote}
      </p>
    );
  }
  return <canvas ref={canvas} className="block w-full" />;
}

function PictureContent({ card }: FileProps) {
  const [url, setUrl] = useState<string>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let current = true;
    let made: string | undefined;
    api.readWorkspaceFile(card.file).then(
      (bytes) => {
        if (!current) return;
        made = URL.createObjectURL(new Blob([bytes]));
        setUrl(made);
      },
      () => current && setMissing(true),
    );
    return () => {
      current = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [card.file]);
  if (missing) return <Missing file={card.file} />;
  return url ? <img src={url} alt={nameOf(card.file)} className="block w-full" draggable={false} /> : null;
}

/** A text card's editor: Typst, like a note's (links start from the board's folder). */
export function CardEditor({ text, boardPath, onChange, onDone }: { text: string; boardPath: string; onChange: (text: string) => void; onDone: () => void }) {
  const parent = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    const view = new EditorView({
      parent: parent.current!,
      state: EditorState.create({
        doc: text,
        extensions: [
          history(),
          keymap.of([
            { key: "Escape", run: () => (onDoneRef.current(), true) },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          EditorView.contentAttributes.of({ "aria-label": "Text card", spellcheck: "true" }),
          notePath.of(boardPath),
          editorFeatures("typst", { inCard: true }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            if (update.focusChanged && !update.view.hasFocus) {
              // (Focus can move to the editor's own toolbar or menus for a moment.)
              setTimeout(() => {
                const active = document.activeElement;
                if (!update.view.hasFocus && !active?.closest(".cm-tooltip, [role=toolbar]")) onDoneRef.current();
              }, 0);
            }
          }),
        ],
      }),
    });
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
    return () => view.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div ref={parent} className="card-text px-3 py-2" />;
}

/** A text card while it isn't being edited: its text, styled. */
export function CardText({ text, boardPath }: { text: string; boardPath: string }) {
  return <NotePreview text={text} format="typst" path={boardPath} />;
}

/** Tells the height of what's around it as it changes (plain text's height follows its text). */
export function MeasureHeight({ onHeight }: { onHeight: (height: number) => void }) {
  const marker = useRef<HTMLSpanElement>(null);
  const onHeightRef = useRef(onHeight);
  onHeightRef.current = onHeight;
  useEffect(() => {
    const element = marker.current?.parentElement;
    if (!element || typeof ResizeObserver === "undefined") return;
    // (The size before the board's zoom.)
    const observer = new ResizeObserver(() => onHeightRef.current(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <span ref={marker} hidden />;
}

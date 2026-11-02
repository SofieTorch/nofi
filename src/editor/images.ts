// Images in notes. Pasting an image, or dropping an image file on the note, saves it in the
// workspace's `assets` folder and adds it on a line of its own, with the path from the note's
// folder: `#image("assets/…")` in Typst, `![](assets/…)` in Markdown. The picture is shown in place
// of that line (the code shows while the cursor is on it), and dragging its left or right edge
// resizes it: `width: 60%` of the note's width in Typst, `![|300](…)` in pixels in Markdown (like
// Obsidian).

import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import * as api from "../api";
import type { Format } from "./formatting";
import { notePath, relativePath, resolvePath } from "./noteLinks";

const TYPST_IMAGE = /^#image\(\s*"((?:[^"\\]|\\.)*)"\s*(?:,\s*width:\s*([\d.]+)%\s*)?\)\s*$/;
const MARKDOWN_IMAGE = /^!\[([^\]|]*)(?:\|(\d+))?\]\(([^)\s]+)\)\s*$/;
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

/** Says why an image couldn't be added (shown by the app). */
let report: (message: string) => void = () => {};
export function setImageProblemReporter(reporter: (message: string) => void) {
  report = reporter;
}

/** An image written on a line of its own. */
type LineImage = {
  from: number;
  to: number;
  /** The address as written, the file in the workspace, and its width (% in Typst, px in Markdown). */
  address: string;
  path: string | null;
  width: number | null;
  alt: string;
};

function imageOn(text: string, from: number, note: string, format: Format): LineImage | null {
  if (format === "typst") {
    const found = TYPST_IMAGE.exec(text);
    if (!found) return null;
    const address = found[1].replace(/\\(.)/g, "$1");
    return { from, to: from + text.length, address, path: resolvePath(note, address, false), width: found[2] ? Number(found[2]) : null, alt: "" };
  }
  const found = MARKDOWN_IMAGE.exec(text);
  if (!found) return null;
  return { from, to: from + text.length, address: found[3], path: resolvePath(note, found[3], true), width: found[2] ? Number(found[2]) : null, alt: found[1] };
}

/** The code for an image with a new width. */
function imageCode(image: LineImage, format: Format, width: number | null) {
  if (format === "typst") {
    const quoted = `"${image.address.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
    return width === null ? `#image(${quoted})` : `#image(${quoted}, width: ${width}%)`;
  }
  return `![${image.alt}${width === null ? "" : `|${width}`}](${image.address})`;
}

// Pictures read once per file while the app runs.
const pictures = new Map<string, Promise<string>>();
function pictureUrl(path: string) {
  if (!pictures.has(path)) {
    const type = IMAGE_TYPES[path.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
    const loading = api.readWorkspaceFile(path).then((bytes) => URL.createObjectURL(new Blob([bytes], { type })));
    // (Not found now may be there later: it's asked again next time.)
    loading.catch(() => pictures.delete(path));
    pictures.set(path, loading);
  }
  return pictures.get(path)!;
}

/** Forgets pictures read (for tests, and when a file changes). */
export function forgetPictures() {
  pictures.clear();
}

class ImageWidget extends WidgetType {
  constructor(
    readonly image: LineImage,
    readonly format: Format,
  ) {
    super();
  }

  eq(other: ImageWidget) {
    return other.image.path === this.image.path && other.image.width === this.image.width && other.image.alt === this.image.alt;
  }

  toDOM(view: EditorView) {
    const box = document.createElement("div");
    box.className = "cm-image";
    const frame = document.createElement("div");
    frame.className = "cm-image-frame";
    const img = document.createElement("img");
    img.alt = this.image.alt;
    img.draggable = false;
    // The width is the frame's: a part of the note's width (Typst) or pixels (Markdown).
    const { width } = this.image;
    if (width !== null) frame.style.width = this.format === "typst" ? `${width}%` : `${width}px`;
    frame.append(img);
    for (const edge of ["left", "right"] as const) {
      const handle = document.createElement("div");
      handle.className = `cm-image-handle cm-image-handle-${edge}`;
      handle.title = "Drag to resize";
      handle.addEventListener("pointerdown", (event) => this.resize(view, frame, edge, event));
      frame.append(handle);
    }
    box.append(frame);
    const path = this.image.path;
    const missing = () => {
      box.replaceChildren(Object.assign(document.createElement("span"), { className: "cm-image-missing", textContent: `Image not found: ${this.image.address}` }));
    };
    if (!path) missing();
    else pictureUrl(path).then((url) => (img.src = url), missing);
    return box;
  }

  /** Dragging an edge: the picture follows the mouse, and the new width is written when let go. */
  private resize(view: EditorView, frame: HTMLElement, edge: "left" | "right", event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const start = event.clientX;
    const startWidth = frame.getBoundingClientRect().width;
    const noteWidth = view.contentDOM.getBoundingClientRect().width || 1;
    const widthAt = (x: number) => {
      const moved = edge === "right" ? x - start : start - x;
      return Math.min(noteWidth, Math.max(24, startWidth + moved));
    };
    const onMove = (move: PointerEvent) => (frame.style.width = `${widthAt(move.clientX)}px`);
    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.classList.remove("resizing-row");
      const pixels = widthAt(up.clientX);
      const width = this.format === "typst" ? Math.max(5, Math.min(100, Math.round((pixels / noteWidth) * 100))) : Math.round(pixels);
      // Where the image is now (the note may have changed meanwhile).
      const line = view.state.doc.lineAt(Math.min(this.image.from, view.state.doc.length));
      const current = imageOn(line.text, line.from, view.state.facet(notePath), this.format);
      if (!current) return;
      view.dispatch({ changes: { from: current.from, to: current.to, insert: imageCode(current, this.format, width) }, userEvent: "input" });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.classList.add("resizing-row");
  }

  ignoreEvent() {
    return true;
  }
}

function findImages(state: EditorState, format: Format): DecorationSet {
  const note = state.facet(notePath);
  const head = state.selection.main.head;
  const found: Range<Decoration>[] = [];
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!line.text.startsWith(format === "typst" ? "#image(" : "![")) continue;
    const image = imageOn(line.text, line.from, note, format);
    // While the cursor is on its line, the code shows (to change it by hand).
    if (!image || (head >= line.from && head <= line.to)) continue;
    found.push(Decoration.replace({ widget: new ImageWidget(image, format), block: true }).range(line.from, line.to));
  }
  return Decoration.set(found);
}

/** A name for a pasted image, like Obsidian's: "Pasted image 20261102153012.png". */
function pastedName(type: string) {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  const extension = Object.entries(IMAGE_TYPES).find(([, mime]) => mime === type)?.[0] ?? "png";
  return `Pasted image ${stamp}.${extension}`;
}

async function bytesOf(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") return new Uint8Array(await file.arrayBuffer());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

/** Saves images and adds them to the note at a place, each on a line of its own. */
async function addImages(view: EditorView, files: File[], at: number, format: Format, pasted: boolean) {
  for (const file of files) {
    let saved: string;
    try {
      saved = await api.saveAsset(pasted ? pastedName(file.type) : file.name, await bytesOf(file));
    } catch (reason) {
      report(`Couldn't add the image: ${reason}`);
      return;
    }
    const address = relativePath(view.state.facet(notePath), saved);
    const code =
      format === "typst"
        ? `#image("${address.replace(/[\\"]/g, (c) => `\\${c}`)}")`
        : `![](${address.split("/").map(encodeURIComponent).join("/")})`;
    const { state } = view;
    const pos = Math.min(at, state.doc.length);
    const line = state.doc.lineAt(pos);
    const before = state.sliceDoc(line.from, pos).trim() ? "\n\n" : "";
    const after = state.sliceDoc(pos, line.to);
    // After it, a new paragraph (or the rest of the line), with the cursor there.
    const insert = `${before}${code}\n\n`;
    view.dispatch({
      changes: { from: pos, to: pos + (after.length - after.trimStart().length), insert },
      selection: { anchor: pos + insert.length },
      scrollIntoView: true,
      userEvent: "input.paste",
    });
    at = pos + insert.length;
  }
}

const imageFiles = (files: FileList | File[] | undefined | null) =>
  [...(files ?? [])].filter((file) => file.type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name));

export function images(format: Format) {
  const field = StateField.define<DecorationSet>({
    create: (state) => findImages(state, format),
    update: (value, transaction) =>
      transaction.docChanged || transaction.selection ? findImages(transaction.state, format) : value,
    provide: (f) => EditorView.decorations.from(f),
  });
  return [
    field,
    EditorView.domEventHandlers({
      paste(event, view) {
        const files = imageFiles(event.clipboardData?.files);
        if (!files.length) return false;
        event.preventDefault();
        addImages(view, files, view.state.selection.main.head, format, true);
        return true;
      },
      drop(event, view) {
        const files = imageFiles(event.dataTransfer?.files);
        if (!files.length) return false;
        event.preventDefault();
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        addImages(view, files, at, format, false);
        return true;
      },
    }),
    EditorView.theme({
      ".cm-image": { padding: "6px 0" },
      ".cm-image-frame": { position: "relative", width: "fit-content", maxWidth: "100%", lineHeight: "0" },
      ".cm-image img": { display: "block", width: "100%", borderRadius: "4px" },
      ".cm-image-handle": {
        position: "absolute",
        top: "50%",
        width: "6px",
        height: "40px",
        maxHeight: "50%",
        transform: "translateY(-50%)",
        borderRadius: "3px",
        background: "rgba(0,0,0,0.45)",
        border: "1px solid rgba(255,255,255,0.8)",
        cursor: "col-resize",
        opacity: "0",
        transition: "opacity 120ms",
      },
      ".cm-image-handle-left": { left: "6px" },
      ".cm-image-handle-right": { right: "6px" },
      ".cm-image-frame:hover .cm-image-handle": { opacity: "1" },
      ".cm-image-missing": { fontSize: "13px", color: "#a3a3a3", lineHeight: "1.6" },
    }),
  ];
}

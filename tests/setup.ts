import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { loadTypstParser } from "../src/editor/typstSyntax";

// Typst's parser, built by `npm run parser` (as the app loads it when it starts).
// @ts-expect-error (no types for Node's modules here)
const { readFileSync } = await import("node:fs");
await loadTypstParser(readFileSync("src/editor/typst-parser.wasm"));

afterEach(() => cleanup());

// Newer Node versions have a localStorage of their own that takes jsdom's place and stores
// nothing: a working one in its place (in memory), emptied after each test.
if (typeof globalThis.localStorage?.setItem !== "function") {
  const items = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
  Object.defineProperty(window, "localStorage", { value: storage, configurable: true });
}
afterEach(() => localStorage.clear());

// jsdom doesn't lay anything out, but the CodeMirror editor asks where text is on screen.
const emptyRect = { x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON() {} };
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => emptyRect as DOMRect;

// jsdom has no pointer or drag events: stand-ins that keep the mouse's position (clientX/Y).
if (!("PointerEvent" in window)) {
  class PointerEvent extends MouseEvent {}
  Object.assign(window, { PointerEvent });
}
if (!("DragEvent" in window)) {
  class DragEvent extends MouseEvent {
    dataTransfer = null;
  }
  Object.assign(window, { DragEvent });
}

// jsdom can't make URLs for files (pictures shown in notes).
if (!URL.createObjectURL) {
  let made = 0;
  URL.createObjectURL = () => `blob:test/${++made}`;
  URL.revokeObjectURL = () => {};
}

// Scrolling a Typst note and its pages together (see tests/scroll-sync.test.ts and
// page-view.test.tsx › Scrolling together). The backend says where pieces of the note's text are on
// the pages ("places", in the note's order); between two of them, a spot in the text is that far
// between them on the pages, and the other way round. Heights down the pages are in points, the
// pages counted one after another. In columns, the pages go to the editor's text exactly, and going
// down such a page goes through all of its text. The side that follows glides to where it goes, so
// it's smooth however fast you scroll.

import type { EditorView } from "@codemirror/view";
import { useEffect, useRef } from "react";
import type { PagePicture, PagePlace } from "../api";

/** Where each page starts, down all the pages (points). */
export function pageStarts(pages: { height: number }[]): number[] {
  const starts: number[] = [];
  let at = 0;
  for (const page of pages) {
    starts.push(at);
    at += page.height;
  }
  return starts;
}

/** A spot on the pages: its page (from 0), and how far down and across it (points). */
export type Spot = { page: number; y: number; x: number };

/** The places, starting from the note's start at the top of the first page. */
function withStart(places: PagePlace[]): PagePlace[] {
  return places.length && places[0].offset > 0 ? [{ offset: 0, page: 0, y: 0, x: places[0].x ?? 0 }, ...places] : places;
}

const lerp = (at: number, from: number, to: number, fromValue: number, toValue: number) =>
  to === from ? fromValue : fromValue + ((at - from) / (to - from)) * (toValue - fromValue);

/** Where on the pages a page's height down all the pages is. */
function onPage(pages: { height: number }[], down: number): { page: number; y: number } {
  const starts = pageStarts(pages);
  let page = 0;
  while (page + 1 < starts.length && starts[page + 1] <= down) page++;
  return { page, y: down - (starts[page] ?? 0) };
}

/**
 * Where a spot in the text is on the pages: between two places, that far between them. Not back
 * up a page, though: between the end of a column and the next one's start, it's at the column's end.
 */
export function spotAt(places: PagePlace[], offset: number, pages?: { height: number }[]): Spot | null {
  const line = withStart(places);
  if (!line.length) return null;
  const after = line.findIndex((p) => p.offset > offset);
  const spot = (p: PagePlace): Spot => ({ page: p.page, y: p.y, x: p.x ?? 0 });
  if (after === -1) return spot(line[line.length - 1]);
  if (after === 0) return spot(line[0]);
  const [a, b] = [line[after - 1], line[after]];
  if (a.page === b.page) {
    if (b.y < a.y) return spot(a);
    return { page: a.page, y: lerp(offset, a.offset, b.offset, a.y, b.y), x: lerp(offset, a.offset, b.offset, a.x ?? 0, b.x ?? 0) };
  }
  // Onto the next page: that far down from the one to the other.
  if (!pages) return spot(a);
  const starts = pageStarts(pages);
  const down = lerp(offset, a.offset, b.offset, starts[a.page] + a.y, starts[b.page] + b.y);
  return { ...onPage(pages, down), x: a.x ?? 0 };
}

/** How far down the pages a spot in the text is (points). */
export function downPagesAt(places: PagePlace[], pages: { height: number }[], offset: number): number {
  const spot = spotAt(places, offset, pages);
  return spot ? (pageStarts(pages)[spot.page] ?? 0) + spot.y : 0;
}

/** Whether a page's text goes back up somewhere (it's in columns). */
const inColumns = (on: PagePlace[]) => on.some((p, i) => i > 0 && p.y < on[i - 1].y - 2);

/**
 * The spot in the text that's a height down the pages (points). On a page in columns, going down
 * it goes through all of its text: that far down the page is that far through its text.
 */
export function textAt(places: PagePlace[], pages: { height: number }[], down: number): number {
  const line = withStart(places);
  if (!line.length) return 0;
  const starts = pageStarts(pages);
  const { page, y } = onPage(pages, down);
  const on = line.filter((p) => p.page === page);
  // (The page's own places: not the note's start, which may be above them.)
  const placed = places.filter((p) => p.page === page);
  if (placed.length && inColumns(placed)) {
    const next = places.find((p) => p.page > page);
    const end = next ? next.offset : placed[placed.length - 1].offset;
    return Math.round(lerp(Math.min(1, y / pages[page].height), 0, 1, placed[0].offset, end));
  }
  const downOf = (p: PagePlace) => (starts[p.page] ?? 0) + p.y;
  for (let i = 0; i + 1 < line.length; i++) {
    const [a, b] = [line[i], line[i + 1]];
    if ((a.page === page || b.page === page) && downOf(a) <= down && down < downOf(b)) {
      return Math.round(lerp(down, downOf(a), downOf(b), a.offset, b.offset));
    }
  }
  if (!on.length) return line.filter((p) => p.page < page).pop()?.offset ?? line[0].offset;
  // Above the page's first place, or below its last: the nearest.
  return down < downOf(on[0]) ? on[0].offset : on[on.length - 1].offset;
}

// --- The two scrolling areas ----------------------------------------------------------------------

/** The editor: the spot in the text at the top of its area (its scroll), and the scroll for a spot. */
function editorSpot(view: EditorView, scroller: HTMLElement) {
  const height = Math.max(0, scroller.scrollTop);
  const block = view.lineBlockAtHeight(height);
  const fraction = block.height > 0 ? Math.min(1, Math.max(0, (height - block.top) / block.height)) : 0;
  return Math.round(block.from + fraction * (block.to - block.from));
}
function editorScrollFor(view: EditorView, offset: number) {
  const block = view.lineBlockAt(Math.min(offset, view.state.doc.length));
  const fraction = block.to > block.from ? (offset - block.from) / (block.to - block.from) : 0;
  return block.top + fraction * block.height;
}

/** The pages: each page's top and its pixels per point, in the scrolled area. */
function pageBoxes(scroller: HTMLElement, pages: PagePicture[]) {
  const images = [...scroller.querySelectorAll<HTMLElement>("img")];
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  return images.slice(0, pages.length).map((image, i) => {
    const box = image.getBoundingClientRect();
    return { top: box.top - origin, scale: box.height / pages[i].height };
  });
}
/** The height down the pages (points) at the pages' top (their scroll). */
function pagesSpot(scroller: HTMLElement, pages: PagePicture[], starts: number[]) {
  const boxes = pageBoxes(scroller, pages);
  if (!boxes.length) return 0;
  const at = scroller.scrollTop + boxes[0].top;
  let i = 0;
  while (i + 1 < boxes.length && boxes[i + 1].top <= at) i++;
  const into = Math.min(pages[i].height, Math.max(0, (at - boxes[i].top) / boxes[i].scale));
  return starts[i] + into;
}
function pagesScrollFor(scroller: HTMLElement, pages: PagePicture[], starts: number[], down: number) {
  const boxes = pageBoxes(scroller, pages);
  if (!boxes.length) return 0;
  let i = 0;
  while (i + 1 < boxes.length && starts[i + 1] <= down) i++;
  return boxes[i].top + (down - starts[i]) * boxes[i].scale - boxes[0].top;
}

/**
 * How quickly the side that follows catches up (ms): each moment, it goes the part of the way left
 * that this much time takes, so it's close behind when scrolling slowly, and quick (never a jump)
 * when far behind, as after scrolling fast or past a page or a column.
 */
const CATCH_UP_MS = 70;

/**
 * Keeps the editor and the pages scrolled to the same place while `on`: the one being scrolled
 * leads, the other glides after it (its scrolling, done here, isn't followed back). Scrolling the
 * one that's gliding stops it there: it leads then.
 */
export function useScrollSync({
  on,
  view,
  editorScroller,
  pagesScroller,
  pages,
  places,
}: {
  on: boolean;
  view: React.RefObject<EditorView | null>;
  editorScroller: React.RefObject<HTMLElement | null>;
  pagesScroller: HTMLElement | null;
  pages: PagePicture[];
  places: PagePlace[];
}) {
  /** Where each area was last scrolled to here: its scroll events then aren't followed back. */
  const setHere = useRef(new WeakMap<HTMLElement, number>());
  /** The glides under way: where to, the frame asked for, and when the last frame was. */
  const glides = useRef(new Map<HTMLElement, { target: number; frame: number; last: number }>());
  const latest = useRef({ pages, places });
  latest.current = { pages, places };

  const stop = (element: HTMLElement) => {
    const glide = glides.current.get(element);
    if (glide) cancelAnimationFrame(glide.frame);
    glides.current.delete(element);
  };
  const glideTo = (element: HTMLElement, top: number) => {
    const target = Math.max(0, Math.round(top));
    const under = glides.current.get(element);
    if (under) {
      under.target = target;
      return;
    }
    if (Math.abs(element.scrollTop - target) < 1) return;
    const glide = { target, frame: 0, last: performance.now() };
    glides.current.set(element, glide);
    const frame = (now: number) => {
      const elapsed = Math.min(64, Math.max(0, now - glide.last));
      glide.last = now;
      const before = element.scrollTop;
      const left = glide.target - before;
      // (At least a pixel, so it gets there; the rest at once when it's that close.)
      const step = Math.abs(left) <= 1 ? left : Math.sign(left) * Math.max(1, Math.abs(left) * (1 - Math.exp(-elapsed / CATCH_UP_MS)));
      const next = before + step;
      element.scrollTop = Math.abs(glide.target - next) < 1 ? glide.target : next;
      setHere.current.set(element, element.scrollTop);
      // There, or as far as it goes (the top or bottom).
      if (Math.abs(glide.target - element.scrollTop) < 1 || element.scrollTop === before) {
        glides.current.delete(element);
        return;
      }
      glide.frame = requestAnimationFrame(frame);
    };
    glide.frame = requestAnimationFrame(frame);
  };
  /** Was this scroll done here? (Then it's not followed back.) */
  const fromHere = (element: HTMLElement) => {
    const expected = setHere.current.get(element);
    return expected !== undefined && Math.abs(element.scrollTop - expected) < 2;
  };

  const followEditor = () => {
    const editor = view.current;
    const from = editorScroller.current;
    if (!editor || !from || !pagesScroller) return;
    const { pages, places } = latest.current;
    const starts = pageStarts(pages);
    const offset = editorSpot(editor, from);
    glideTo(pagesScroller, pagesScrollFor(pagesScroller, pages, starts, downPagesAt(places, pages, offset)));
  };
  const followPages = () => {
    const editor = view.current;
    const to = editorScroller.current;
    if (!editor || !to || !pagesScroller) return;
    const { pages, places } = latest.current;
    const starts = pageStarts(pages);
    glideTo(to, editorScrollFor(editor, textAt(places, pages, pagesSpot(pagesScroller, pages, starts))));
  };

  useEffect(() => {
    const editorArea = editorScroller.current;
    if (!on || !editorArea || !pagesScroller) return;
    // Scrolled by you (not here): it leads, and stops gliding if it was.
    const onEditor = () => {
      if (fromHere(editorArea)) return;
      stop(editorArea);
      followEditor();
    };
    const onPages = () => {
      if (fromHere(pagesScroller)) return;
      stop(pagesScroller);
      followPages();
    };
    editorArea.addEventListener("scroll", onEditor);
    pagesScroller.addEventListener("scroll", onPages);
    return () => {
      editorArea.removeEventListener("scroll", onEditor);
      pagesScroller.removeEventListener("scroll", onPages);
      stop(editorArea);
      stop(pagesScroller);
    };
  }, [on, pagesScroller]); // eslint-disable-line react-hooks/exhaustive-deps

  // Turned on, or the pages drawn again (as you type): the pages go to where the editor is.
  useEffect(() => {
    if (on) followEditor();
  }, [on, pages, places, pagesScroller]); // eslint-disable-line react-hooks/exhaustive-deps
}

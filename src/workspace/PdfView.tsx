import {
  mdiMagnifyMinusOutline,
  mdiMagnifyPlusOutline,
  mdiArrowExpandHorizontal,
  mdiLinkVariant,
  mdiSelectDrag,
  mdiCommentMultipleOutline,
  mdiDeleteOutline,
  mdiNotePlusOutline,
  mdiNoteText,
  mdiTableOfContents,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addAnnotation,
  addNote,
  type Annotation,
  type Citation,
  COLOURS,
  type Colour,
  loadCitations,
  type NewAnnotation,
  partOfAnnotation,
  readAnnotations,
  recolourAnnotation,
  removeAnnotation,
} from "../pdf/annotations";
import * as api from "../api";
import { CARD_TYPE, type Dragged, readPart, writePart } from "../board/board";
import { copyAddress, workspaceNotes } from "../editor/noteLinks";
import { type Choice, NotePicker } from "../pdf/NotePicker";
import { IconButton } from "../ui/IconButton";
import { Menu } from "../ui/Menu";
import { type OutlineItem, openPdf, type PdfDocument, type PdfPage } from "./pdf";

type Zoom = "fit" | number;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

/** Where each PDF was read up to, and its zoom: drawn again (as a pane splits), it stays there. */
const places = new Map<string, { top: number; left: number; zoom: Zoom }>();

/**
 * A PDF from the workspace, page after page, like a reader: zoom in and out, or fit the pane's
 * width (the default). Its text can be selected and copied. Pages are drawn as they come into view.
 * A link to a page (`#page=5`) opens it there; a page's right-click menu (or the toolbar) copies
 * a link to it, to paste into a note. Selected text, or an area of a page chosen with "Select an
 * area", can be dragged to a board. It can be annotated like in Zotero (see
 * tests/pdf-annotations.test.tsx): text highlighted, notes at a spot or about an area or a
 * passage; the notes citing the PDF show in its margin, next to what they're about.
 */
export function PdfView({
  path,
  goTo,
  version = 0,
  onOpenNote,
}: {
  path: string;
  goTo?: { part: string };
  /** Changes when notes are saved: the margin reads them again. */
  version?: number;
  /** Opens a note beside the PDF, at a part (an annotation, or "end"). */
  onOpenNote?: (note: string, part: string) => void;
}) {
  const [document, setDocument] = useState<PdfDocument>();
  const [first, setFirst] = useState<PdfPage>();
  const [problem, setProblem] = useState<string>();
  const [zoom, setZoom] = useState<Zoom>(() => places.get(path)?.zoom ?? "fit");
  const [width, setWidth] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const pageBoxes = useRef(new Map<number, HTMLDivElement>());
  const [menu, setMenu] = useState<{ x: number; y: number; page: number }>();
  const copyLink = (page: number) => copyAddress(`${path}#page=${page}`);
  /** Choosing an area of a page (to drag to a board), and the area chosen, in the page's points. */
  const [choosingArea, setChoosingArea] = useState(false);
  const [area, setArea] = useState<Area | null>(null);
  /** An area shown for a moment (where a board's card for it was opened from). */
  const [flash, setFlash] = useState<Area | null>(null);
  /** The notes citing parts of the PDF (other notes' can be hidden), and the marks on its pages. */
  const [citations, setCitations] = useState<Citation[]>([]);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  /** The page at the top of the pane (as you scroll, or go to one). */
  const [current, setCurrent] = useState(1);
  /** The PDF's contents (empty if it has none), and whether they're open beside the pages. */
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [showContents, setShowContents] = useState(false);
  /** How far the pages are scrolled, and the part of the contents last gone to (and from where). */
  const [scrolled, setScrolled] = useState(0);
  const [chosen, setChosen] = useState<{ item: OutlineItem; at: number } | null>(null);
  /** The notes about the PDF: its source notes, and the others citing it (where a new note can go). */
  const [about, setAbout] = useState<{ sources: string[]; citing: string[] }>({ sources: [], citing: [] });
  /** Choosing which note a new note goes in (for a part of the PDF, marked or about to be), where it was asked. */
  const [picker, setPicker] = useState<{ annotation: Annotation | NewAnnotation; x: number; y: number } | null>(null);
  /** Placing a note: the next click on a page puts it there. */
  const [placingNote, setPlacingNote] = useState(false);
  /** A clicked annotation's bar (its colours, Add note, Remove), where it was clicked (in the scrolled content). */
  const [markBar, setMarkBar] = useState<{ x: number; y: number; annotation: Annotation } | null>(null);
  /** An annotation's right-click menu. */
  const [markMenu, setMarkMenu] = useState<{ x: number; y: number; annotation: Annotation }>();
  /** Something that went wrong annotating (shown under the toolbar). */
  const [failure, setFailure] = useState<string>();
  const [showMentions, setShowMentions] = useState(true);
  const [reread, setReread] = useState(0);
  /** Selected text, with where to offer Highlight and Comment (in the scrolled content). */
  const [selection, setSelection] = useState<{ page: number; quote: string; x: number; y: number } | null>(null);
  /** Where each annotation's passage is on its page (its top, in the page's pixels). */
  const [marks, setMarks] = useState<Record<string, number>>({});

  useEffect(() => {
    let current = true;
    loadCitations(path).then(
      (found) => {
        if (!current) return;
        setCitations(found.citations);
        setAbout({ sources: found.sources, citing: found.citing });
      },
      () => {},
    );
    readAnnotations(path).then((found) => current && setAnnotations(found));
    return () => {
      current = false;
    };
  }, [path, version, reread]);

  const shown = citations.filter((c) => c.source || showMentions);
  // (In a narrow pane, the pages keep the room: the passages are still highlighted.)
  const hasMargin = shown.length > 0 && (width === 0 || width >= 640);

  /** The text selected on a page, its lines kept, spaces within a line tidied. */
  function selectedText() {
    const chosen = window.getSelection();
    const text = chosen
      ?.toString()
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
    const node = chosen?.anchorNode;
    const page = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>("[data-page]");
    return text && page && scroller.current?.contains(page) ? { text, page: Number(page.dataset.page), range: chosen!.getRangeAt(0) } : null;
  }

  /** Letting go of the mouse after selecting text: Highlight and Comment are offered above it. */
  function offerActions() {
    setTimeout(() => {
      const chosen = selectedText();
      const box = scroller.current;
      if (!chosen || !box || choosingArea) return setSelection(null);
      const rect = chosen.range.getClientRects?.()[0];
      const outer = box.getBoundingClientRect();
      setSelection({
        page: chosen.page,
        quote: chosen.text,
        x: (rect?.left ?? outer.left) - outer.left + box.scrollLeft,
        y: (rect?.top ?? outer.top) - outer.top + box.scrollTop,
      });
    }, 0);
  }

  const clearSelection = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  /** A point of the screen, in the scrolled content (where bars over the pages go). */
  const inContent = (clientX: number, clientY: number) => {
    const box = scroller.current!;
    const outer = box.getBoundingClientRect();
    return { x: clientX - outer.left + box.scrollLeft, y: clientY - outer.top + box.scrollTop };
  };

  /** The highlights the selected text is in (or that are in it). */
  const highlightsIn = (page: number, quote: string) => {
    const tidy = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
    const selected = tidy(quote);
    return annotations.filter((a) => a.type === "highlight" && a.page === page && (tidy(a.quote).includes(selected) || selected.includes(tidy(a.quote))));
  };

  /** Changes the annotations or notes; then they're read again. */
  async function run(action: () => Promise<unknown>) {
    setFailure(undefined);
    try {
      await action();
    } catch (reason) {
      setFailure(`Couldn't change the annotations: ${reason instanceof Error ? reason.message : reason}`);
    }
    setReread((n) => n + 1);
  }

  /** Highlights the selected text. */
  function highlight(colour: Colour) {
    if (!selection) return;
    const { page, quote } = selection;
    clearSelection();
    // Highlights never overlap: one it overlaps is joined with it (the same one just changes colour).
    const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
    const layer = pageBoxes.current.get(page)?.querySelector<HTMLElement>(".textLayer");
    let joined = quote;
    const overlapping: Extract<Annotation, { type: "highlight" }>[] = [];
    for (const a of annotations) {
      if (a.type !== "highlight" || a.page !== page) continue;
      const together = layer ? joinedQuote(layer, joined, a.quote) : tidy(a.quote) === tidy(joined) ? joined : null;
      if (together === null) continue;
      joined = together;
      overlapping.push(a);
    }
    const same = overlapping.length === 1 && tidy(overlapping[0].quote) === tidy(joined) ? overlapping[0] : null;
    run(async () => {
      if (same) return recolourAnnotation(path, same.id, colour);
      for (const a of overlapping) await removeAnnotation(path, a.id);
      await addAnnotation(path, { type: "highlight", page, quote: joined, colour });
    });
  }

  /** A point of a page (in its points), in the scrolled content. */
  function pagePoint(page: number, x: number, y: number) {
    const box = pageBoxes.current.get(page)?.getBoundingClientRect();
    return inContent((box?.left ?? 0) + x * scale, (box?.top ?? 0) + y * scale);
  }

  /**
   * Adds a note about a part of the PDF. Once there are notes about the PDF, it asks which one it
   * goes in (at `at`, in the scrolled content); before that, the PDF's source note is made for it.
   */
  function noteAbout(annotation: Annotation | NewAnnotation, at?: { x: number; y: number }) {
    if (about.sources.length + about.citing.length === 0) return writeNote(annotation);
    const where =
      at ?? (annotation.type === "highlight" ? pagePoint(annotation.page, 40, 40) : pagePoint(annotation.page, annotation.x, annotation.y));
    setPicker({ annotation, ...where });
  }

  /** Writes a note about a part of the PDF: it's marked (unless it is already), and the note opens beside, to write. */
  function writeNote(annotation: Annotation | NewAnnotation, into?: Choice) {
    run(async () => {
      if (!("id" in annotation)) await addAnnotation(path, annotation);
      const { note, at } = await addNote(
        path,
        partOfAnnotation(annotation),
        async () => (document?.info ? document.info() : {}),
        (candidate) => api.readNote(candidate).then((text) => typeof text === "string", () => false),
        into,
      );
      onOpenNote?.(note, at);
    });
  }

  /** The note citing an annotation, if there's one. */
  const citationOf = (annotation: Annotation) => {
    const part = partOfAnnotation(annotation);
    return citations.find(
      (c) =>
        c.page === annotation.page &&
        c.quote === part.quote &&
        JSON.stringify(c.point) === JSON.stringify(part.point) &&
        JSON.stringify(c.area) === JSON.stringify(part.area),
    );
  };

  /** Keeps the area chosen as an annotation, maybe with a note about it. */
  function keepArea(withNote: boolean) {
    if (!area) return;
    const kept: NewAnnotation = {
      type: "area",
      page: area.page,
      x: Math.round(area.x),
      y: Math.round(area.y),
      width: Math.round(area.width),
      height: Math.round(area.height),
    };
    setArea(null);
    setChoosingArea(false);
    if (withNote) noteAbout(kept, pagePoint(area.page, area.x, area.y + area.height + 8));
    else run(() => addAnnotation(path, kept));
  }

  const onMarks = useCallback((page: number, found: Record<string, number>) => {
    setMarks((current) => {
      const next = { ...current };
      for (const key of Object.keys(next)) if (key.startsWith(`${page}|`)) delete next[key];
      Object.assign(next, found);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, []);

  // A link to a page: it's scrolled to, once the pages are there (an area is shown for a moment).
  useEffect(() => {
    if (!goTo || !document) return;
    const part = readPart(`#${goTo.part}`);
    if (!part.page) return;
    const page = part.page;
    const frame = requestAnimationFrame(() => pageBoxes.current.get(page)?.scrollIntoView?.({ block: "start" }));
    if (part.area) setFlash({ page, ...part.area });
    const timer = setTimeout(() => setFlash(null), 1500);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [goTo, document]);

  useEffect(() => {
    if (!choosingArea && !placingNote) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setChoosingArea(false);
      setPlacingNote(false);
      setArea(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choosingArea, placingNote]);

  /** Pressing a page while choosing an area: dragging draws it. */
  function startArea(event: React.PointerEvent, page: number, element: HTMLElement) {
    if (event.button !== 0) return;
    event.preventDefault();
    const box = element.getBoundingClientRect();
    const at = (x: number, y: number) => ({ x: (x - box.left) / scale, y: (y - box.top) / scale });
    const start = at(event.clientX, event.clientY);
    setArea(null);
    const onMove = (move: PointerEvent) => {
      const end = at(move.clientX, move.clientY);
      setArea({ page, x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) });
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      onMove(up);
      setArea((current) => (current && current.width > 4 && current.height > 4 ? current : null));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /** Selected text dragged out (to a board) carries the PDF, its page and the text. */
  function dragSelection(event: React.DragEvent) {
    // (Its lines kept, so a list stays a list; spaces within a line tidied.)
    const text = window
      .getSelection()
      ?.toString()
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n");
    const page = (event.target instanceof Element ? event.target : (event.target as Node).parentElement)?.closest<HTMLElement>("[data-page]");
    if (!text || !page || !event.dataTransfer) return;
    const dragged: Dragged = { file: path, subpath: writePart({ page: Number(page.dataset.page), quote: text }) };
    event.dataTransfer.setData(CARD_TYPE, JSON.stringify(dragged));
  }

  /** Goes to a page: its top at the top of the pane. */
  function goToPage(page: number) {
    pageBoxes.current.get(page)?.scrollIntoView?.({ block: "start" });
    setCurrent(page);
  }

  /** How far down the pages a part of the contents starts (in the scrolled pages' pixels). */
  function offsetOf(item: OutlineItem) {
    const box = scroller.current;
    const page = item.page !== undefined ? pageBoxes.current.get(item.page) : undefined;
    if (!box || !page) return null;
    return page.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop + (item.top ?? 0) * scale;
  }

  /** Goes to a part of the contents: where it starts on its page (with a little room above), or its page's top. */
  function goToItem(item: OutlineItem) {
    const box = scroller.current;
    const offset = offsetOf(item);
    if (item.page === undefined) return;
    if (item.top === undefined || !box || offset === null) {
      goToPage(item.page);
      setChosen({ item, at: box?.scrollTop ?? 0 });
      return;
    }
    box.scrollTop = Math.max(0, offset - 12);
    setCurrent(item.page);
    setChosen({ item, at: box.scrollTop });
  }

  /** The part of the contents being read: the one gone to (until the pages are scrolled), or the last to start above the pane's top. */
  function reading(): OutlineItem | undefined {
    const box = scroller.current;
    if (chosen && box && Math.abs(box.scrollTop - chosen.at) < 2) return chosen.item;
    const all: OutlineItem[] = [];
    const walk = (items: OutlineItem[]) => items.forEach((item) => (all.push(item), walk(item.items)));
    walk(outline);
    let found: OutlineItem | undefined;
    for (const item of all) {
      if (item.page === undefined) continue;
      const offset = item.page <= current ? offsetOf(item) : null;
      if (offset !== null && offset <= scrolled + 16) found = item;
    }
    return found;
  }

  // The page you're on also changes as pages are drawn (and take their real size), or zoomed.
  useEffect(() => {
    const content = pageBoxes.current.get(1)?.parentElement;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setCurrent(pageInView()));
    observer.observe(content);
    return () => observer.disconnect();
  }, [document]); // eslint-disable-line react-hooks/exhaustive-deps

  // The PDF's contents, if it has them.
  useEffect(() => {
    let current = true;
    setOutline([]);
    document?.outline?.().then((found) => current && setOutline(found), () => {});
    return () => {
      current = false;
    };
  }, [document]);

  /** The page at the top of the pane. */
  function pageInView() {
    const top = scroller.current?.getBoundingClientRect().top ?? 0;
    for (const [number, box] of [...pageBoxes.current].sort((a, b) => a[0] - b[0])) {
      if (box.getBoundingClientRect().bottom > top + 8) return number;
    }
    return 1;
  }

  useEffect(() => {
    let current = true;
    let opened: PdfDocument | undefined;
    setDocument(undefined);
    setProblem(undefined);
    api
      .readWorkspaceFile(path)
      .then(openPdf)
      .then(async (pdf) => {
        opened = pdf;
        const page = await pdf.page(1);
        if (!current) return pdf.close();
        setFirst(page);
        setDocument(pdf);
      })
      .catch((reason) => current && setProblem(String(reason)));
    return () => {
      current = false;
      opened?.close();
    };
  }, [path]);

  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Fitting the width: the first page's width, with a little room on both sides.
  const fit = first && width ? Math.max(0.25, (width - 48 - (hasMargin ? MARGIN : 0)) / first.width) : 1;
  const scale = zoom === "fit" ? fit : zoom;

  /**
   * Where you're reading: the page at the pane's top, and how far into it (in the page's points).
   * When the zoom changes (also when the pane gets narrower or wider, fitting its width, as the
   * contents open), that stays at the top.
   */
  const place = useRef<{ page: number; into: number } | null>(null);
  const shownScale = useRef(scale);
  function notePlace() {
    const box = scroller.current;
    const page = pageInView();
    const element = pageBoxes.current.get(page);
    if (!box || !element) return;
    place.current = { page, into: (box.getBoundingClientRect().top - element.getBoundingClientRect().top) / shownScale.current };
  }
  useLayoutEffect(() => {
    if (shownScale.current === scale) return;
    shownScale.current = scale;
    const box = scroller.current;
    const at = place.current;
    const element = at && pageBoxes.current.get(at.page);
    if (!box || !at || !element) return;
    box.scrollTop = element.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop + at.into * scale;
  }, [scale]);

  const remember = () => {
    const box = scroller.current;
    // (Not before its pages are there: it would be at the top.)
    if (box && document) places.set(path, { top: box.scrollTop, left: box.scrollLeft, zoom });
  };
  useEffect(remember, [zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  // Back where it was, once its pages are there.
  useLayoutEffect(() => {
    const place = places.get(path);
    const box = scroller.current;
    if (!document || !place || !box) return;
    box.scrollTop = place.top;
    box.scrollLeft = place.left;
  }, [document]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = (direction: 1 | -1) => {
    const next = direction > 0 ? ZOOMS.find((z) => z > scale + 0.01) : [...ZOOMS].reverse().find((z) => z < scale - 0.01);
    if (next) setZoom(next);
  };

  // Each page's marks and citations, grouped once (a page given the same ones isn't drawn again).
  // (A note's mark is there for its note: once no note cites it, it's gone too.)
  const annotationsOn = useMemo(
    () => byPage(annotations.filter((a) => a.type !== "note" || citationOf(a))),
    [annotations, citations], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const citationsOn = useMemo(() => byPage(shown), [citations, showMentions]); // eslint-disable-line react-hooks/exhaustive-deps

  // What pages can do, the same functions every time (they run the reader's latest).
  const latest = useRef({
    onMenu: (page: number, x: number, y: number) => setMenu({ x, y, page }),
    onPressArea: startArea,
    onPlaceNote: (page: number, x: number, y: number) => {
      setPlacingNote(false);
      noteAbout({ type: "note", page, x: Math.round(x), y: Math.round(y) }, pagePoint(page, x + 24, y));
    },
    onMarkMenu: (annotation: Annotation, x: number, y: number) => setMarkMenu({ annotation, x, y }),
    onMarkClick: (annotation: Annotation, x: number, y: number) =>
      !window.getSelection()?.toString() && setMarkBar({ annotation, ...inContent(x, y) }),
    onOpenMark: (annotation: Annotation) => {
      const citation = citationOf(annotation);
      if (citation) onOpenNote?.(citation.note, citation.at);
      else noteAbout(annotation);
    },
    onKeepArea: keepArea,
    onDragArea: (event: React.DragEvent, chosen: Area) => {
      event.stopPropagation();
      const dragged: Dragged = { file: path, subpath: writePart({ page: chosen.page, area: chosen }) };
      event.dataTransfer?.setData(CARD_TYPE, JSON.stringify(dragged));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    },
  });
  latest.current = {
    ...latest.current,
    onPressArea: startArea,
    onPlaceNote: (page, x, y) => {
      setPlacingNote(false);
      noteAbout({ type: "note", page, x: Math.round(x), y: Math.round(y) }, pagePoint(page, x + 24, y));
    },
    onMarkClick: (annotation, x, y) => !window.getSelection()?.toString() && setMarkBar({ annotation, ...inContent(x, y) }),
    onOpenMark: (annotation) => {
      const citation = citationOf(annotation);
      if (citation) onOpenNote?.(citation.note, citation.at);
      else noteAbout(annotation);
    },
    onKeepArea: keepArea,
    onDragArea: (event, chosen) => {
      event.stopPropagation();
      const dragged: Dragged = { file: path, subpath: writePart({ page: chosen.page, area: chosen }) };
      event.dataTransfer?.setData(CARD_TYPE, JSON.stringify(dragged));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";
    },
  };
  const pageActions = useMemo(() => {
    type Actions = typeof latest.current;
    const call =
      <K extends keyof Actions>(name: K) =>
      (...args: Parameters<Actions[K]>) =>
        (latest.current[name] as (...a: Parameters<Actions[K]>) => unknown)(...args);
    return {
      onMenu: call("onMenu"),
      onPressArea: call("onPressArea"),
      onPlaceNote: call("onPlaceNote"),
      onMarkMenu: call("onMarkMenu"),
      onMarkClick: call("onMarkClick"),
      onOpenMark: call("onOpenMark"),
      onKeepArea: call("onKeepArea"),
      onDragArea: call("onDragArea"),
    };
  }, []);

  return (
    <div className="flex h-full flex-col">
      <div role="toolbar" aria-label="PDF" className="flex h-8 shrink-0 items-center gap-1 border-b border-neutral-100 px-3 text-xs text-neutral-500">
        {outline.length > 0 && (
          <IconButton
            icon={mdiTableOfContents}
            label="Contents"
            pressed={showContents}
            onClick={() => {
              setScrolled(scroller.current?.scrollTop ?? 0);
              setShowContents(!showContents);
            }}
          />
        )}
        {document && <PageBox page={current} pages={document.pages} onGo={goToPage} />}
        <span className="ml-auto" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <IconButton icon={mdiMagnifyMinusOutline} label="Zoom out" onClick={() => step(-1)} />
        <IconButton icon={mdiMagnifyPlusOutline} label="Zoom in" onClick={() => step(1)} />
        <IconButton icon={mdiArrowExpandHorizontal} label="Fit width" pressed={zoom === "fit"} onClick={() => setZoom("fit")} />
        <IconButton icon={mdiLinkVariant} label="Copy link to this page" onClick={() => copyLink(pageInView())} />
        {citations.some((c) => !c.source) && (
          <IconButton
            icon={mdiCommentMultipleOutline}
            label="Show mentions from other notes"
            pressed={showMentions}
            onClick={() => setShowMentions(!showMentions)}
          />
        )}
        <IconButton
          icon={mdiNotePlusOutline}
          label="Add a note on the page"
          pressed={placingNote}
          onClick={() => {
            setPlacingNote(!placingNote);
            setChoosingArea(false);
            setArea(null);
          }}
        />
        <IconButton
          icon={mdiSelectDrag}
          label="Select an area"
          pressed={choosingArea}
          onClick={() => {
            setChoosingArea(!choosingArea);
            setPlacingNote(false);
            setArea(null);
          }}
        />
      </div>
      {failure && (
        <p role="alert" className="border-b border-red-100 bg-red-50 px-3 py-1.5 text-xs text-red-700">
          {failure}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
      {showContents && outline.length > 0 && <Contents outline={outline} reading={reading()} onGo={goToItem} />}
      <div
        ref={scroller}
        onDragStart={dragSelection}
        onScroll={() => {
          remember();
          notePlace();
          setCurrent(pageInView());
          // (Only the contents need it: otherwise the reader isn't drawn again for every bit of scrolling.)
          if (showContents) setScrolled(scroller.current?.scrollTop ?? 0);
        }}
        onMouseUp={offerActions}
        onMouseDown={(event) => {
          if ((event.target as Element).closest("[data-selection-actions]")) return;
          setSelection(null);
          setMarkBar(null);
        }}
        className="relative min-h-0 flex-1 overflow-auto bg-neutral-100"
      >
        {problem ? (
          <p role="alert" className="p-6 text-sm text-red-600">
            Couldn't open the PDF: {problem}
          </p>
        ) : (
          document && (
            <div className="relative mx-auto flex w-fit flex-col gap-3 py-4" style={{ paddingRight: hasMargin ? MARGIN : 0 }}>
              {Array.from({ length: document.pages }, (_, i) => (
                <Page
                  key={i}
                  document={document}
                  number={i + 1}
                  scale={scale}
                  guess={first!}
                  root={scroller}
                  boxes={pageBoxes.current}
                  choosingArea={choosingArea}
                  area={area?.page === i + 1 ? area : undefined}
                  flash={flash?.page === i + 1 ? flash : undefined}
                  citations={citationsOn.get(i + 1) ?? NONE}
                  annotations={annotationsOn.get(i + 1) ?? NONE}
                  onMarks={onMarks}
                  placingNote={placingNote}
                  {...pageActions}
                />
              ))}
              {hasMargin && (
                <Margin
                  citations={shown}
                  pages={pageBoxes.current}
                  // (A passage's top is found in the page's text; a spot's or an area's is known.)
                  marks={Object.fromEntries(
                    shown.map((c) => [keyOf(c), c.point ? c.point.y * scale : c.area ? c.area.y * scale : (marks[keyOf(c)] ?? 0)]),
                  )}
                  onOpen={(c) => onOpenNote?.(c.note, c.at)}
                />
              )}
            </div>
          )
        )}
        {selection && (
          <div
            role="toolbar"
            aria-label="Selected text"
            data-selection-actions
            className="absolute z-10 flex -translate-y-full gap-0.5 rounded-lg bg-white p-0.5 text-xs shadow-[0_2px_12px_rgba(0,0,0,0.12)]"
            style={{ left: selection.x, top: selection.y - 6 }}
          >
            {COLOURS.map((colour) => (
              <button
                key={colour}
                aria-label={`Highlight in ${colour}`}
                title={`Highlight in ${colour}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => highlight(colour)}
                className="flex size-7 items-center justify-center rounded-md hover:bg-neutral-100"
              >
                <span className={`size-3.5 rounded-full ${SWATCHES[colour]}`} />
              </button>
            ))}
            <span className="mx-0.5 my-1 w-px bg-neutral-200" />
            {highlightsIn(selection.page, selection.quote).length > 0 && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const marked = highlightsIn(selection.page, selection.quote);
                  clearSelection();
                  run(async () => {
                    for (const a of marked) await removeAnnotation(path, a.id);
                  });
                }}
                className="rounded-md px-2 py-1 text-neutral-700 hover:bg-neutral-100"
              >
                Remove highlight
              </button>
            )}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const { page, quote } = selection;
                clearSelection();
                const marked = annotations.find((a) => a.type === "highlight" && a.page === page && a.quote === quote);
                noteAbout(marked ?? { type: "highlight", page, quote }, { x: selection.x, y: selection.y + 24 });
              }}
              className="rounded-md px-2 py-1 text-neutral-700 hover:bg-neutral-100"
            >
              Add note
            </button>
          </div>
        )}
        {picker && (
          <NotePicker
            at={picker}
            sources={about.sources}
            citing={about.citing}
            notes={workspaceNotes()}
            onPick={(choice) => {
              setPicker(null);
              writeNote(picker.annotation, choice);
            }}
            onClose={() => setPicker(null)}
          />
        )}
        {markBar && (
          <div
            role="toolbar"
            aria-label="Annotation"
            data-selection-actions
            className="absolute z-10 flex -translate-y-full gap-0.5 rounded-lg bg-white p-0.5 text-xs shadow-[0_2px_12px_rgba(0,0,0,0.12)]"
            style={{ left: markBar.x, top: markBar.y - 10 }}
          >
            {COLOURS.map((colour) => (
              <button
                key={colour}
                aria-label={colour[0].toUpperCase() + colour.slice(1)}
                aria-pressed={markBar.annotation.colour === colour}
                title={colour[0].toUpperCase() + colour.slice(1)}
                onClick={() => {
                  setMarkBar(null);
                  run(() => recolourAnnotation(path, markBar.annotation.id, colour));
                }}
                className={`flex size-7 items-center justify-center rounded-md hover:bg-neutral-100 ${markBar.annotation.colour === colour ? "bg-neutral-100" : ""}`}
              >
                <span className={`size-3.5 rounded-full ${SWATCHES[colour]} ${markBar.annotation.colour === colour ? "ring-2 ring-neutral-400 ring-offset-1" : ""}`} />
              </button>
            ))}
            <span className="mx-0.5 my-1 w-px bg-neutral-200" />
            <button
              onClick={() => {
                setMarkBar(null);
                noteAbout(markBar.annotation, { x: markBar.x, y: markBar.y });
              }}
              className="rounded-md px-2 py-1 text-neutral-700 hover:bg-neutral-100"
            >
              Add note
            </button>
            <button
              onClick={() => {
                setMarkBar(null);
                run(() => removeAnnotation(path, markBar.annotation.id));
              }}
              className="rounded-md px-2 py-1 text-red-600 hover:bg-red-50"
            >
              {markBar.annotation.type === "highlight" ? "Remove highlight" : markBar.annotation.type === "area" ? "Remove area" : "Remove note mark"}
            </button>
          </div>
        )}
      </div>
      </div>
      {menu && (
        <Menu
          label="Page"
          at={menu}
          onClose={() => setMenu(undefined)}
          items={[{ label: `Copy link to page ${menu.page}`, icon: mdiLinkVariant, run: () => copyLink(menu.page) }]}
        />
      )}
      {markMenu && (
        <Menu
          label="Annotation"
          at={markMenu}
          onClose={() => setMarkMenu(undefined)}
          items={[
            { label: "Add note", icon: mdiNotePlusOutline, run: () => noteAbout(markMenu.annotation, inContent(markMenu.x, markMenu.y)) },
            ...COLOURS.filter((colour) => colour !== markMenu.annotation.colour).map((colour) => ({
              label: colour[0].toUpperCase() + colour.slice(1),
              run: () => run(() => recolourAnnotation(path, markMenu.annotation.id, colour)),
            })),
            { label: "Remove", icon: mdiDeleteOutline, danger: true, run: () => run(() => removeAnnotation(path, markMenu.annotation.id)) },
          ]}
        />
      )}
    </div>
  );
}

/** The page you're on, out of how many: typing a page's number (and Enter) goes there. */
function PageBox({ page, pages, onGo }: { page: number; pages: number; onGo: (page: number) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const go = () => {
    const wanted = Number(typed);
    if (Number.isInteger(wanted) && wanted >= 1 && wanted <= pages) onGo(wanted);
    setTyped(null);
  };
  return (
    <span className="flex items-center gap-1 tabular-nums">
      <input
        aria-label="Page"
        inputMode="numeric"
        value={typed ?? String(page)}
        // (Selected after the click, which would otherwise undo it: typing replaces the number.)
        onFocus={(event) => {
          const input = event.target;
          setTimeout(() => input.select(), 0);
        }}
        onChange={(event) => setTyped(event.target.value.replace(/\D/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Enter") go();
          if (event.key === "Escape") {
            setTyped(null);
            event.currentTarget.blur();
          }
        }}
        onBlur={() => setTyped(null)}
        className="w-9 rounded border border-transparent bg-transparent px-1 py-0.5 text-right text-neutral-700 hover:border-neutral-200 focus:border-sky-400 focus:bg-white focus:outline-none"
        style={{ width: `${Math.max(2, String(pages).length) + 1.5}ch` }}
      />
      <span>/ {pages}</span>
    </span>
  );
}

/**
 * A PDF's contents, beside its pages: its chapters, and their sections under them. Choosing one
 * goes to where it starts; the one you're reading is marked.
 */
function Contents({ outline, reading, onGo }: { outline: OutlineItem[]; reading?: OutlineItem; onGo: (item: OutlineItem) => void }) {
  const panel = useRef<HTMLElement>(null);
  // The one being read stays in view as you read on.
  useEffect(() => {
    panel.current?.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [reading]);

  const list = (items: OutlineItem[], depth: number) => (
    <ul>
      {items.map((item, i) => (
        <li key={i}>
          <button
            disabled={item.page === undefined}
            aria-current={item === reading ? "true" : undefined}
            onClick={() => onGo(item)}
            className={`flex w-full items-baseline gap-2 rounded-md py-1 pr-2 text-left leading-snug hover:bg-neutral-100 disabled:text-neutral-400 disabled:hover:bg-transparent ${
              item === reading ? "bg-neutral-100 font-medium text-neutral-900" : "text-neutral-700"
            } ${depth === 0 ? "text-[13px]" : "text-xs"}`}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            <span className="min-w-0 flex-1">{item.title}</span>
            {item.page !== undefined && (
              <span aria-hidden className="shrink-0 text-[11px] text-neutral-400 tabular-nums">
                {item.page}
              </span>
            )}
          </button>
          {item.items.length > 0 && list(item.items, depth + 1)}
        </li>
      ))}
    </ul>
  );
  return (
    <nav ref={panel} aria-label="Contents" className="w-60 shrink-0 overflow-y-auto border-r border-neutral-100 bg-white p-2">
      {list(outline, 0)}
    </nav>
  );
}

/** An area of a page, in the page's points from its top left. */
type Area = { page: number; x: number; y: number; width: number; height: number };

/** One page: its room is kept (from the first page's size) until it's drawn, once in view. */
/** One page (drawn again only when what it shows changes, not each time the reader is). */
const Page = memo(function Page({
  document,
  number,
  scale,
  guess,
  root,
  boxes,
  onMenu,
  choosingArea,
  onPressArea,
  area,
  flash,
  onDragArea,
  citations,
  annotations,
  onMarks,
  placingNote,
  onPlaceNote,
  onMarkMenu,
  onMarkClick,
  onOpenMark,
  onKeepArea,
}: {
  document: PdfDocument;
  number: number;
  scale: number;
  guess: PdfPage;
  root: React.RefObject<HTMLDivElement | null>;
  /** Where each page is, by number (for going to one). */
  boxes: Map<number, HTMLDivElement>;
  /** Right-click: the page's menu, at the mouse. */
  onMenu: (page: number, x: number, y: number) => void;
  /** While choosing an area: pressing the page starts drawing one. */
  choosingArea: boolean;
  onPressArea: (event: React.PointerEvent, page: number, element: HTMLElement) => void;
  /** The area chosen on this page, if it's here; one shown for a moment. */
  area?: Area;
  flash?: Area;
  onDragArea: (event: React.DragEvent, area: Area) => void;
  /** The notes citing this page's parts: their passages are highlighted. */
  citations: Citation[];
  /** This page's annotations: highlights, notes at a spot, areas. */
  annotations: Annotation[];
  /** Says where each cited passage is on the page (its top), once the page's text is there. */
  onMarks: (page: number, tops: Record<string, number>) => void;
  /** While placing a note: clicking the page puts it there (in the page's points). */
  placingNote: boolean;
  onPlaceNote: (page: number, x: number, y: number) => void;
  /** Right-clicking an annotation: its menu, at the mouse. */
  onMarkMenu: (annotation: Annotation, x: number, y: number) => void;
  /** Clicking a highlight or an area: its bar, at the mouse. */
  onMarkClick: (annotation: Annotation, x: number, y: number) => void;
  /** Clicking a note's mark: its note opens. */
  onOpenMark: (annotation: Annotation) => void;
  /** The area chosen: kept as an annotation, maybe with a note. */
  onKeepArea: (withNote: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<PdfPage>();
  /** Whether the page is near the view: only then is it drawn (a long PDF drawn whole would take gigabytes). */
  const [near, setNear] = useState(typeof IntersectionObserver === "undefined");

  useEffect(() => {
    if (!box.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root: root.current,
      rootMargin: "1200px 0px",
    });
    observer.observe(box.current);
    return () => observer.disconnect();
  }, [root]);

  // (Once read, the page is kept: it's small, and it has the page's own size.)
  useEffect(() => {
    if (!near || page) return;
    let current = true;
    document.page(number).then((loaded) => current && setPage(loaded));
    return () => {
      current = false;
    };
  }, [near, page, document, number]);

  /** Counts the times the page's text was laid out (passages are found in it). */
  const [laidOut, setLaidOut] = useState(0);
  const [highlights, setHighlights] = useState<{ key: string; rects: Rect[]; annotation?: Annotation }[]>([]);

  useEffect(() => {
    const drawnOn = canvas.current;
    const textLayer = text.current;
    if (!page || !drawnOn || !textLayer) return;
    if (!near) {
      // Far from the view: let go of its drawing and its text (drawn again when it's back).
      page.stop?.(drawnOn, textLayer);
      drawnOn.width = 0;
      drawnOn.height = 0;
      textLayer.replaceChildren();
      setHighlights((current) => (current.length ? [] : current));
      return;
    }
    let current = true;
    page.draw(drawnOn, scale).catch(() => {});
    page
      .text(textLayer, scale)
      .then(() => current && setLaidOut((n) => n + 1))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [page, scale, near]);

  useEffect(() => {
    const layer = text.current;
    const pageBox = box.current;
    if (!laidOut || !layer || !pageBox) return;
    const origin = pageBox.getBoundingClientRect();
    const highlighted = annotations.flatMap((a) => (a.type === "highlight" ? [{ key: `a:${a.id}`, rects: quoteRects(layer, a.quote, origin), annotation: a }] : []));
    // (A passage cited without a highlight of its own is highlighted too.)
    // (Passages notes cite are underlined, highlighted or not.)
    const cited = citations.flatMap((c) => (c.quote === undefined ? [] : [{ key: keyOf(c), rects: quoteRects(layer, c.quote, origin) }]));
    const next = [...highlighted, ...cited];
    // (Unchanged: the page isn't drawn again.)
    setHighlights((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    onMarks(number, Object.fromEntries(cited.map((c) => [c.key, c.rects[0]?.top ?? 0])));
  }, [laidOut, annotations, citations, number, onMarks]);

  /** The annotation at a point of the screen, if there's one there. */
  function annotationAt(clientX: number, clientY: number) {
    const origin = box.current?.getBoundingClientRect();
    if (!origin) return undefined;
    const x = clientX - origin.left;
    const y = clientY - origin.top;
    const inside = (r: Rect) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
    for (const a of annotations) {
      if (a.type === "note" && inside({ left: a.x * scale, top: a.y * scale, width: NOTE_SIZE, height: NOTE_SIZE })) return a;
    }
    const highlight = highlights.find((h) => h.annotation && h.rects.some(inside));
    if (highlight) return highlight.annotation;
    return annotations.find((a) => a.type === "area" && inside({ left: a.x * scale, top: a.y * scale, width: a.width * scale, height: a.height * scale }));
  }

  const size = page ?? guess;
  return (
    <div
      ref={(element) => {
        box.current = element;
        if (element) boxes.set(number, element);
        else boxes.delete(number);
      }}
      onContextMenu={(event) => {
        // (With text selected, the usual menu, to copy it.)
        if (window.getSelection()?.toString()) return;
        event.preventDefault();
        const annotation = annotationAt(event.clientX, event.clientY);
        if (annotation) onMarkMenu(annotation, event.clientX, event.clientY);
        else onMenu(number, event.clientX, event.clientY);
      }}
      onClick={(event) => {
        if (placingNote || choosingArea) return;
        const annotation = annotationAt(event.clientX, event.clientY);
        if (annotation && annotation.type !== "note") onMarkClick(annotation, event.clientX, event.clientY);
      }}
      onPointerDown={(event) => {
        if (placingNote && box.current && event.button === 0) {
          event.preventDefault();
          const origin = box.current.getBoundingClientRect();
          onPlaceNote(number, (event.clientX - origin.left) / scale, (event.clientY - origin.top) / scale);
        } else if (choosingArea && box.current) onPressArea(event, number, box.current);
      }}
      role="img"
      aria-label={`Page ${number}`}
      data-page={number}
      className={`relative shrink-0 bg-white shadow-[0_1px_4px_rgba(0,0,0,0.12)] ${choosingArea || placingNote ? "cursor-crosshair select-none" : ""}`}
      style={{ width: size.width * scale, height: size.height * scale }}
    >
      <canvas ref={canvas} className="block" />
      <div ref={text} className={`textLayer ${choosingArea || placingNote ? "pointer-events-none" : ""}`} />
      {highlights.flatMap((h) =>
        h.rects.map((r, i) =>
          h.annotation ? (
            <div
              key={`${h.key}-${i}`}
              data-highlight
              data-colour={h.annotation.colour}
              className={`pointer-events-none absolute rounded-[2px] mix-blend-multiply ${HIGHLIGHTS[h.annotation.colour]}`}
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            />
          ) : (
            // (Cited by a note: underlined, to see what the note is about.)
            <div
              key={`${h.key}-${i}`}
              data-cited
              className="pointer-events-none absolute border-b-[1.5px] border-amber-500/80"
              style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
            />
          ),
        ),
      )}
      {annotations.map((a) =>
        a.type === "area" ? (
          <div key={a.id} data-area className={`pointer-events-none absolute rounded-sm ring-2 ${AREAS[a.colour]}`} style={areaStyle(a, scale)} />
        ) : a.type === "note" ? (
          <button
            key={a.id}
            aria-label={`Note on page ${number}`}
            title="Open its note"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onOpenMark(a)}
            className={`absolute flex items-center justify-center rounded-[4px] text-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] ${SWATCHES[a.colour]}`}
            style={{ left: a.x * scale, top: a.y * scale, width: NOTE_SIZE, height: NOTE_SIZE }}
          >
            <Icon path={mdiNoteText} size="14px" />
          </button>
        ) : null,
      )}
      {flash && <div className="pointer-events-none absolute rounded-sm bg-amber-300/30 ring-2 ring-amber-400" style={areaStyle(flash, scale)} />}
      {area && (
        <div
          role="button"
          aria-label="Selected area: drag it to a board"
          title="Drag it to a board"
          draggable
          onPointerDown={(event) => event.stopPropagation()}
          onDragStart={(event) => onDragArea(event, area)}
          className="absolute cursor-grab rounded-sm bg-sky-400/15 ring-2 ring-sky-500"
          style={areaStyle(area, scale)}
        />
      )}
      {area && (
        <div
          role="toolbar"
          aria-label="Selected area"
          onPointerDown={(event) => event.stopPropagation()}
          className="absolute z-10 flex gap-0.5 rounded-lg bg-white p-0.5 text-xs shadow-[0_2px_12px_rgba(0,0,0,0.12)]"
          style={{ left: area.x * scale, top: (area.y + area.height) * scale + 6 }}
        >
          <button onClick={() => onKeepArea(true)} className="rounded-md px-2 py-1 text-neutral-700 hover:bg-neutral-100">
            Add note
          </button>
          <button onClick={() => onKeepArea(false)} className="rounded-md px-2 py-1 text-neutral-700 hover:bg-neutral-100">
            Keep area
          </button>
        </div>
      )}
    </div>
  );
});

/** Things on pages, by page. */
function byPage<T extends { page: number }>(things: T[]) {
  const pages = new Map<number, T[]>();
  for (const thing of things) pages.set(thing.page, [...(pages.get(thing.page) ?? []), thing]);
  return pages;
}
/** Nothing (always the same empty list, so a page with nothing isn't drawn again). */
const NONE: never[] = [];

/** The colours of annotations: a swatch (and a note's mark), a highlight, an area's outline. */
const SWATCHES: Record<Colour, string> = { yellow: "bg-yellow-400", green: "bg-green-500", blue: "bg-sky-500", pink: "bg-pink-400", purple: "bg-violet-500" };
const HIGHLIGHTS: Record<Colour, string> = {
  yellow: "bg-yellow-300/45",
  green: "bg-green-300/45",
  blue: "bg-sky-300/45",
  pink: "bg-pink-300/45",
  purple: "bg-violet-300/45",
};
const AREAS: Record<Colour, string> = {
  yellow: "bg-yellow-300/10 ring-yellow-400",
  green: "bg-green-300/10 ring-green-500",
  blue: "bg-sky-300/10 ring-sky-500",
  pink: "bg-pink-300/10 ring-pink-400",
  purple: "bg-violet-300/10 ring-violet-500",
};
/** A note's mark on a page, in pixels. */
const NOTE_SIZE = 20;

const areaStyle = (area: { x: number; y: number; width: number; height: number }, scale: number) => ({ left: area.x * scale, top: area.y * scale, width: area.width * scale, height: area.height * scale });

/** Room for the margin's notes, at the right of the pages. */
const MARGIN = 248;

type Rect = { left: number; top: number; width: number; height: number };

/** A citation's key: its page first (the page's passages are found together). */
const keyOf = (c: Citation) =>
  `${c.page}|${c.note}|${c.quote ?? ""}|${c.point ? `${c.point.x},${c.point.y}` : ""}|${c.area ? Object.values(c.area).join(",") : ""}|${c.at}`;

/**
 * A page's text layer as one text (spaces and line breaks as one space, pieces apart), with where
 * each of its characters is.
 */
function layerText(layer: HTMLElement) {
  const chars: { node: Text; offset: number }[] = [];
  let text = "";
  const walker = layer.ownerDocument.createTreeWalker(layer, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    // (Each piece of text is apart from the one before.)
    if (text && !text.endsWith(" ")) {
      text += " ";
      chars.push({ node, offset: 0 });
    }
    for (let i = 0; i < node.data.length; i++) {
      const space = /\s/.test(node.data[i]);
      if (space && text.endsWith(" ")) continue;
      text += space ? " " : node.data[i];
      chars.push({ node, offset: i });
    }
  }
  return { text, chars };
}

/** Where a passage is in a page's text (from, to), if it's there; the case only matters if it's found as written. */
function findQuote(text: string, quote: string) {
  const wanted = quote.replace(/\s+/g, " ").trim();
  if (!wanted) return null;
  let at = text.indexOf(wanted);
  if (at < 0) at = text.toLowerCase().indexOf(wanted.toLowerCase());
  return at < 0 ? null : { from: at, to: at + wanted.length };
}

/**
 * The passage made of two that overlap (or touch), as the page's text has it; null if they don't,
 * or aren't both found.
 */
export function joinedQuote(layer: HTMLElement, a: string, b: string) {
  const { text } = layerText(layer);
  const first = findQuote(text, a);
  const second = findQuote(text, b);
  if (!first || !second || first.to < second.from || second.to < first.from) return null;
  return text.slice(Math.min(first.from, second.from), Math.max(first.to, second.to));
}

/**
 * Where a passage is in a page's text layer, from the page's top left: a box per line (the text's
 * pieces on a line, which can overlap, made one).
 */
function quoteRects(layer: HTMLElement, quote: string, origin: DOMRect): Rect[] {
  const { text, chars } = layerText(layer);
  const found = findQuote(text, quote);
  if (!found) return [];
  const start = chars[found.from];
  const end = chars[found.to - 1];
  const range = layer.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  const rects = [...(range.getClientRects?.() ?? [])].filter((r) => r.width > 0 && r.height > 0);
  return byLine(rects.map((r) => ({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height })));
}

/** Boxes on the same line (their middles level), made one box each. */
function byLine(rects: Rect[]): Rect[] {
  const lines: Rect[] = [];
  for (const r of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find((l) => Math.abs(l.top + l.height / 2 - (r.top + r.height / 2)) < Math.min(l.height, r.height) / 2);
    if (!line) {
      lines.push({ ...r });
      continue;
    }
    const right = Math.max(line.left + line.width, r.left + r.width);
    const bottom = Math.max(line.top + line.height, r.top + r.height);
    line.left = Math.min(line.left, r.left);
    line.top = Math.min(line.top, r.top);
    line.width = right - line.left;
    line.height = bottom - line.top;
  }
  return lines;
}

/**
 * The margin: next to each passage, the paragraph that cites it (pushed down when they'd overlap).
 * Other notes' paragraphs say which note they're from. Placed once the pages are laid out, and again
 * whenever they change size (as they're drawn, or zoomed).
 */
function Margin({
  citations,
  pages,
  marks,
  onOpen,
}: {
  citations: Citation[];
  /** The pages' boxes, by number. */
  pages: Map<number, HTMLElement>;
  /** Where each cited part is on its page. */
  marks: Record<string, number>;
  onOpen: (c: Citation) => void;
}) {
  const column = useRef<HTMLElement>(null);
  const ordered = [...citations].sort((a, b) => a.page - b.page || (marks[keyOf(a)] ?? 0) - (marks[keyOf(b)] ?? 0));

  const arrange = useCallback(() => {
    let below = 0;
    for (const card of column.current?.querySelectorAll<HTMLElement>("[data-mark]") ?? []) {
      const wanted = (pages.get(Number(card.dataset.page))?.offsetTop ?? 0) + Number(card.dataset.mark);
      const at = Math.max(wanted, below);
      card.style.top = `${at}px`;
      below = at + card.offsetHeight + 8;
    }
  }, [pages]);
  useLayoutEffect(arrange);
  useEffect(() => {
    const content = column.current?.parentElement;
    if (!content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(arrange);
    observer.observe(content);
    return () => observer.disconnect();
  }, [arrange]);

  return (
    <aside ref={column} aria-label="Notes on this PDF" className="absolute top-0 right-0 bottom-0" style={{ width: MARGIN - 24 }}>
      {ordered.map((a) => (
        <button
          key={keyOf(a)}
          data-page={a.page}
          data-mark={marks[keyOf(a)] ?? 0}
          onClick={() => onOpen(a)}
          className={`absolute top-0 left-0 w-full rounded-lg bg-white text-left shadow-[0_1px_3px_rgba(15,23,42,0.1)] ring-1 ring-slate-200/80 hover:ring-slate-300 ${
            a.source ? "p-2.5" : "p-2 opacity-90"
          }`}
        >
          {!a.source && (
            <span className="mb-0.5 block text-[10px] tracking-wide text-slate-400 uppercase">From {a.note.split("/").pop()!.replace(/\.[^.]+$/, "")}</span>
          )}
          {a.text ? (
            <span className={`block leading-snug ${a.source ? "line-clamp-8 text-[13px] text-neutral-800" : "line-clamp-4 text-xs text-neutral-700"}`}>
              {a.text}
            </span>
          ) : (
            // (Nothing written yet: what it's about.)
            <span className="line-clamp-3 block text-xs leading-snug text-neutral-400 italic">
              {a.quote !== undefined ? `“${a.quote}”` : `A note on page ${a.page}`}
            </span>
          )}
        </button>
      ))}
    </aside>
  );
}

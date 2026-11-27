import {
  mdiArrowLeft,
  mdiMagnifyMinusOutline,
  mdiMagnifyPlusOutline,
  mdiArrowExpandHorizontal,
  mdiLinkOff,
  mdiLinkVariant,
  mdiNoteTextOutline,
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
  addPageLink,
  targetOfLink,
  type PageLink,
  readPageLinks,
  startOfNote,
  type Annotation,
  type Citation,
  COLOURS,
  type Colour,
  loadCitations,
  makeIntoSourceNote,
  citationCode,
  citationLabel,
  type CiteAs,
  makeSourceNote,
  moveAnnotation,
  moveCitedSpot,
  type NewAnnotation,
  isZoteroPaper,
  partOfAnnotation,
  readAnnotations,
  newAnnotation,
  recolourAnnotation,
  swapAnnotations,
} from "../pdf/annotations";
import * as api from "../api";
import { CARD_TYPE, type Dragged, readPart, writePart } from "../board/board";
import { copyAddress, copyCode, followLinkTarget, textOf, resolvePath, workspaceNotes, workspacePdfs } from "../editor/noteLinks";
import { type Format, noteFormat } from "../editor/formatting";
import { NotePreview, shownText } from "../board/cards";
import { NoteNameDialog, suggestedName } from "../pdf/NoteNameDialog";
import { type Choice, type FileOption, fileScore, NotePicker } from "../pdf/NotePicker";
import { FindBar, matchesIn } from "../ui/FindBar";
import { stopScaling, usePinchZoom } from "../ui/pinchZoom";
import { IconButton } from "../ui/IconButton";
import { sidebarRight } from "../ui/icons";
import { Menu } from "../ui/Menu";
import { findPaper, zoteroPath } from "../explorer/Library";
import { layerFindText, type Region } from "./pdfText";
import { type OutlineItem, openPdf, type PdfDocument, type PdfInfo, type PdfLink, type PdfPage } from "./pdf";

type Zoom = "fit" | number;
/** Text to find, on its `nth` match on a page (a match the workspace's search found). */
export type FindAt = { query: string; page?: number; nth?: number };
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** How far pinching can zoom out and in. */
const SMALLEST = 0.25;
const BIGGEST = 4;

/** Where each PDF was read up to, and its zoom: drawn again (as a pane splits), it stays there. */
const places = new Map<string, { top: number; left: number; zoom: Zoom }>();
/** Whether the margin's notes are shown (the toolbar's switch): for every PDF, while the app is open. */
let marginShown = true;

/**
 * A PDF from the workspace, page after page, like a reader: zoom in and out, or fit the pane's
 * width (the default). Its text can be selected and copied. Pages are drawn as they come into view.
 * A link to a page (`#page=5`) opens it there; a page's right-click menu (or the toolbar) copies
 * a link to it, to paste into a note. Selected text, or an area of a page chosen with "Select an
 * area", can be dragged to a board. It can be annotated like in Zotero (see
 * tests/pdf-annotations.test.tsx): text highlighted, notes at a spot or about an area or a
 * passage; the notes citing the PDF show in its margin, next to what they're about. Like a note, it
 * has links of its own: words on its pages linking to notes (see tests/pdf-links.test.tsx).
 */
export function PdfView({
  path,
  goTo,
  version = 0,
  onOpenNote,
}: {
  path: string;
  goTo?: { part?: string; find?: FindAt };
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
  /** The note in the margin the mouse is over: what it's about lights up on its page. */
  const [pointedAt, setPointedAt] = useState<Citation | null>(null);
  /** The passages the mouse is over on a page (their citations' keys): their notes in the margin light up, and they do. */
  const [pointedKeys, setPointedKeys] = useState<string[]>(NONE);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  /** The PDF's links: words on its pages linking to notes. */
  const [pageLinks, setPageLinks] = useState<PageLink[]>([]);
  /** Choosing the note selected words link to, where it was asked. */
  const [linkPicker, setLinkPicker] = useState<{ page: number; quote: string; nth: number; x: number; y: number } | null>(null);
  /** Copying selected words to cite them: as what, asked where the button is (in the window). */
  const [copyMenu, setCopyMenu] = useState<{ x: number; y: number; page: number; quote: string; nth: number }>();
  /** A link's right-click menu. */
  const [linkMenu, setLinkMenu] = useState<{ x: number; y: number; link: PageLink }>();
  /** The page at the top of the pane (as you scroll, or go to one). */
  const [current, setCurrent] = useState(1);
  /**
   * Finding (⌘F): what's found, on which page and the how-manyth there (null while finding), and
   * the match you're on. `seek` counts the times a match was gone to: its page then shows it.
   */
  const [finding, setFinding] = useState<{ query: string; focus: number } | null>(null);
  const [found, setFound] = useState<{ page: number; nth: number }[] | null>(null);
  const [foundAt, setFoundAt] = useState(0);
  const [seek, setSeek] = useState(0);
  /** A match to go to once they're found (from the workspace's search). */
  const findTarget = useRef<{ page?: number; nth?: number } | null>(null);
  /** Each page's text, read once. */
  const pageTexts = useRef(new Map<number, string>());
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
  const [showMargin, setShowMargin] = useState(marginShown);
  const [reread, setReread] = useState(0);
  /** Selected text, with where to offer Highlight and Comment (in the scrolled content). */
  /** (`nth`: which time its words are on the page: what's marked, cited or linked is this one.) */
  const [selection, setSelection] = useState<{ page: number; quote: string; nth: number; x: number; y: number } | null>(null);
  /** Where each annotation's passage is on its page (its top, in the page's pixels). */
  const [marks, setMarks] = useState<Record<string, number>>({});
  /** A Zotero paper's PDF (`zotero:<id>`): read from Zotero; its details are Zotero's. */
  const fromZotero = isZoteroPaper(path);
  /** A Zotero paper's source note being named (the first note on it), and what the note's about. */
  /** (Without a part of the PDF: the note's only being made, to open it from the toolbar.) */
  const [naming, setNaming] = useState<{ annotation?: Annotation | NewAnnotation; suggested: string } | null>(null);
  /** The PDF's source notes to choose from (it has several), where the toolbar's button is. */
  const [noteMenu, setNoteMenu] = useState<{ x: number; y: number; notes: string[] }>();

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
    readPageLinks(path).then((found) => current && setPageLinks(found));
    return () => {
      current = false;
    };
  }, [path, version, reread]);

  const shown = citations.filter((c) => c.source || showMentions);
  // (In a narrow pane, the pages keep the room: the passages are still highlighted.)
  const hasMargin = showMargin && shown.length > 0 && (width === 0 || width >= 640);

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
      const layer = pageBoxes.current.get(chosen.page)?.querySelector<HTMLElement>(".textLayer");
      setSelection({
        page: chosen.page,
        quote: chosen.text,
        nth: layer ? nthAt(layer, chosen.text, chosen.range.startContainer, chosen.range.startOffset) : 1,
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

  /** The highlights the selected text is in (or that are in it): there on the page, not the same words elsewhere. */
  const highlightsIn = (page: number, quote: string, nth: number) => {
    const tidy = (text: string) => text.replace(/\s+/g, " ").trim().toLowerCase();
    const selected = tidy(quote);
    const layer = pageBoxes.current.get(page)?.querySelector<HTMLElement>(".textLayer");
    return annotations.filter(
      (a) =>
        a.type === "highlight" &&
        a.page === page &&
        (tidy(a.quote).includes(selected) || selected.includes(tidy(a.quote))) &&
        (!layer || overlapping(layer, { quote, nth }, { quote: a.quote, nth: a.nth ?? 1 })),
    );
  };

  /** Changes the annotations or notes; then they're read again. */
  /**
   * Moves a note's mark to another spot of its page: saved with the annotations, and the notes
   * citing its old spot are changed to cite the new one. (Shown there straight away.)
   */
  function moveMark(annotation: Annotation, to: { x: number; y: number }) {
    if (annotation.type !== "note") return;
    const spot = { x: Math.round(to.x), y: Math.round(to.y) };
    if (spot.x === annotation.x && spot.y === annotation.y) return;
    setAnnotations((all) => all.map((a) => (a.id === annotation.id ? { ...a, ...spot } : a)));
    setCitations((all) =>
      all.map((c) => (c.page === annotation.page && c.point?.x === annotation.x && c.point?.y === annotation.y ? { ...c, point: spot } : c)),
    );
    run(async () => {
      await moveAnnotation(path, annotation.id, spot);
      await moveCitedSpot(path, annotation.page, { x: annotation.x, y: annotation.y }, spot);
    });
  }

  async function run(action: () => Promise<unknown>) {
    setFailure(undefined);
    try {
      await action();
    } catch (reason) {
      setFailure(`Couldn't change the annotations: ${reason instanceof Error ? reason.message : reason}`);
    }
    setReread((n) => n + 1);
  }

  /**
   * The changes made to the annotations here, to undo (⌘Z, while the reader has the focus) and
   * redo: each is done again, or undone, in the annotations' file.
   */
  const history = useRef<{ done: Step[]; undone: Step[] }>({ done: [], undone: [] });
  const stepping = useRef<Promise<unknown>>(Promise.resolve());
  /** Makes a change that can be undone. */
  function change(step: Step) {
    history.current.done.push(step);
    history.current.undone = [];
    stepping.current = stepping.current.then(() => run(step.redo));
  }
  const removeMarks = (marks: (Annotation | PageLink)[]) =>
    change({ redo: () => swapAnnotations(path, marks.map((a) => a.id), []), undo: () => swapAnnotations(path, [], marks) });
  const recolour = (annotation: Annotation, colour: Colour) =>
    change({ redo: () => recolourAnnotation(path, annotation.id, colour), undo: () => recolourAnnotation(path, annotation.id, annotation.colour) });

  // Edit › Undo and Redo, asked of the reader (see `UNDO_IN_READER`): taken if there's a change to step through.
  const reader = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = reader.current;
    if (!element) return;
    const onAsked = (event: Event) => {
      const kind = (event as CustomEvent<"undo" | "redo">).detail;
      const { done, undone } = history.current;
      const step = (kind === "undo" ? done : undone).pop();
      if (!step) return;
      event.preventDefault();
      (kind === "undo" ? undone : done).push(step);
      stepping.current = stepping.current.then(() => run(kind === "undo" ? step.undo : step.redo));
    };
    element.addEventListener(UNDO_IN_READER, onAsked);
    return () => element.removeEventListener(UNDO_IN_READER, onAsked);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Highlights the selected text. */
  function highlight(colour: Colour) {
    if (!selection) return;
    const { page, quote, nth } = selection;
    clearSelection();
    // Highlights never overlap: one it overlaps is joined with it (the same one just changes colour).
    const tidy = (text: string) => text.replace(/\s+/g, " ").trim();
    const layer = pageBoxes.current.get(page)?.querySelector<HTMLElement>(".textLayer");
    let joined = { quote, nth };
    const overlaps: Extract<Annotation, { type: "highlight" }>[] = [];
    for (const a of annotations) {
      if (a.type !== "highlight" || a.page !== page) continue;
      const other = { quote: a.quote, nth: a.nth ?? 1 };
      const together = layer ? joinedQuote(layer, joined, other) : tidy(a.quote) === tidy(joined.quote) && other.nth === joined.nth ? joined : null;
      if (together === null) continue;
      joined = together;
      overlaps.push(a);
    }
    const same =
      overlaps.length === 1 && tidy(overlaps[0].quote) === tidy(joined.quote) && (overlaps[0].nth ?? 1) === joined.nth ? overlaps[0] : null;
    if (same) return recolour(same, colour);
    const added = newAnnotation({ type: "highlight", page, quote: joined.quote, ...(joined.nth > 1 && { nth: joined.nth }), colour });
    change({
      redo: () => swapAnnotations(path, overlaps.map((a) => a.id), [added]),
      undo: () => swapAnnotations(path, [added.id], overlaps),
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

  /** The paper's details: Zotero's for a Zotero paper, else what the PDF says. */
  async function info(): Promise<PdfInfo> {
    if (fromZotero) {
      const paper = await findPaper(path.slice("zotero:".length));
      if (paper) return { title: paper.title, authors: paper.authors, ...(paper.year && { year: paper.year }) };
    }
    return document?.info ? document.info() : {};
  }

  const taken = (candidate: string) => api.readNote(candidate).then((text) => typeof text === "string", () => false);

  /**
   * Writes a note about a part of the PDF: it's marked (unless it is already), and the note opens
   * beside, to write. A Zotero paper's new source note is named first (it goes at the top of the
   * workspace, not beside the PDF in Zotero).
   */
  function writeNote(annotation: Annotation | NewAnnotation, into?: Choice) {
    const newSource = into ? "newNote" in into && !into.at : about.sources.length === 0;
    if (fromZotero && newSource) {
      run(async () => setNaming({ annotation, suggested: suggestedName((await info()).title ?? "Paper") }));
      return;
    }
    run(async () => {
      if (!("id" in annotation)) await addAnnotation(path, annotation);
      const { note, at } = await addNote(path, partOfAnnotation(annotation), info, taken, into);
      onOpenNote?.(note, at);
    });
  }

  /**
   * The toolbar's "the paper's note": opens the PDF's source note beside it, or asks which one when
   * it has several. With none yet, it's made (with the paper's details; a Zotero paper's is named
   * first), then opened.
   */
  function openPaperNote(at: { x: number; y: number }) {
    run(async () => {
      const { sources } = await loadCitations(path);
      if (sources.length === 1) return onOpenNote?.(sources[0], "");
      if (sources.length > 1) return setNoteMenu({ ...at, notes: sources });
      if (fromZotero) return setNaming({ suggested: suggestedName((await info()).title ?? "Paper") });
      onOpenNote?.(await makeSourceNote(path, await info(), taken), "");
    });
  }

  /**
   * Copies selected words to cite them, as a footnote, a link or a quote: to paste in any note
   * (written there for that note). Nothing's written or highlighted. Copied straight away, in the
   * click (the app's webview only lets a click write to the clipboard then): the paper's details
   * are read beforehand, when it opens.
   */
  function copyCitation(words: { page: number; quote: string; nth: number }, as: CiteAs) {
    const part = { page: words.page, quote: words.quote, ...(words.nth > 1 && { nth: words.nth }) };
    // A link is only its address: to link text in a note with the style menu's Link (or pasted in a
    // note's text, it's a link there, like any file's address).
    if (as === "link") return copyAddress(`${path}${writePart(part)}`);
    const label = citationLabel(path, details.current, words.page);
    copyCode(
      citationCode(path, part, label, "", "typst", as, words.quote),
      (note, format) => citationCode(path, part, label, note, format, as, words.quote),
      `Copied as a ${as}`,
    );
  }

  /** The paper's details (to cite it by), read when it opens. */
  const details = useRef<PdfInfo>({});
  useEffect(() => {
    let current = true;
    details.current = {};
    if (document || fromZotero) info().then((found) => current && (details.current = found), () => {});
    return () => {
      current = false;
    };
  }, [document, path]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Zotero's papers, read once (for references hovered), and the one a reference is to, if it's there. */
  const zoteroPapers = useRef<Promise<api.ZoteroItem[]>>(undefined);
  // (Read again after Zotero changes, as when a paper is added there.)
  useEffect(() => {
    const unlisten = api.onZoteroChanged(() => {
      zoteroPapers.current = undefined;
    });
    return () => {
      unlisten.then((stop) => stop(), () => {});
    };
  }, []);
  async function paperFor(reference: string) {
    zoteroPapers.current ??= api.zoteroLibrary().then(
      (library) => library?.libraries.flatMap((l) => l.items) ?? [],
      () => [],
    );
    let best: { paper: api.ZoteroItem; score: number } | null = null;
    for (const paper of await zoteroPapers.current) {
      const score = fileScore(
        { path: paper.id, label: paper.title, title: paper.title, words: `${paper.title} ${paper.authors.join(" ")} ${paper.year ?? ""}`, authors: paper.authors, year: paper.year },
        reference,
      );
      if (score !== null && (!best || score < best.score)) best = { paper, score };
    }
    return best?.paper ?? null;
  }

  /** The note citing an annotation, if there's one. */
  const citationOf = (annotation: Annotation) => {
    const part = partOfAnnotation(annotation);
    return citations.find(
      (c) =>
        c.page === annotation.page &&
        c.quote === part.quote &&
        (c.nth ?? 1) === (part.nth ?? 1) &&
        JSON.stringify(c.point) === JSON.stringify(part.point) &&
        JSON.stringify(c.area) === JSON.stringify(part.area),
    );
  };

  /**
   * Links words on a page to the note or PDF chosen, or to a new note named after what was typed (at
   * the workspace's top, or in the folders written before its name): it opens beside the PDF, to write.
   */
  function linkTo(words: { page: number; quote: string; nth: number }, choice: Choice, typed: string) {
    run(async () => {
      if ("note" in choice) return addPageLink(path, words.page, words.quote, choice.note, undefined, words.nth);
      if ("file" in choice) return addPageLink(path, words.page, words.quote, choice.file, choice.title, words.nth);
      const at = newNotePath(typed);
      if (!at) return;
      const note = `${at}.typ`;
      if (!(await taken(note))) await api.createNoteAt(note);
      await addPageLink(path, words.page, words.quote, note, undefined, words.nth);
      onOpenNote?.(note, "");
    });
  }

  /** Follows a link: its note or PDF opens beside the PDF (a note made first, if it isn't there anymore). */
  function openPageLink(link: PageLink) {
    const target = targetOfLink(path, link);
    if (!target) return;
    run(async () => {
      if (noteFormat(target) && !(await taken(target))) await api.createNoteAt(target);
      onOpenNote?.(target, "");
    });
  }

  /** What else a link can go to: the workspace's PDFs, and Zotero's papers with a PDF (read when choosing). */
  const [papers, setPapers] = useState<api.ZoteroItem[]>([]);
  useEffect(() => {
    if (!linkPicker) return;
    let current = true;
    api.zoteroLibrary().then(
      (library) => current && setPapers(library?.libraries.flatMap((l) => l.items).filter((paper) => paper.pdf) ?? []),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [!!linkPicker]); // eslint-disable-line react-hooks/exhaustive-deps
  const linkableFiles = (): FileOption[] => [
    ...workspacePdfs()
      .filter((pdf) => pdf !== path)
      .map((pdf) => ({ path: pdf, label: pdf.split("/").pop()!, detail: pdf.includes("/") ? pdf.slice(0, pdf.lastIndexOf("/")) : "PDF", words: pdf })),
    ...[...new Map(papers.map((paper) => [paper.id, paper])).values()]
      .filter((paper) => zoteroPath(paper.id) !== path)
      .map((paper) => ({
        path: zoteroPath(paper.id),
        label: paper.title,
        title: paper.title,
        detail: [paper.authors.join(", "), paper.year].filter(Boolean).join(" "),
        words: `${paper.title} ${paper.authors.join(" ")} ${paper.year ?? ""}`,
        authors: paper.authors,
        year: paper.year,
      })),
  ];

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
    else {
      const added = newAnnotation(kept);
      change({ redo: () => swapAnnotations(path, [], [added]), undo: () => swapAnnotations(path, [added.id], []) });
    }
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
    if (!goTo?.part || !document) return;
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
    const range = window.getSelection()?.rangeCount ? window.getSelection()!.getRangeAt(0) : null;
    const layer = page.querySelector<HTMLElement>(".textLayer");
    const nth = range && layer ? nthAt(layer, text, range.startContainer, range.startOffset) : 1;
    const dragged: Dragged = { file: path, subpath: writePart({ page: Number(page.dataset.page), quote: text, ...(nth > 1 && { nth }) }) };
    event.dataTransfer.setData(CARD_TYPE, JSON.stringify(dragged));
  }

  /**
   * Where you were before each time you went somewhere (by a link, the contents or a page
   * number): a page, and how far into it (in its points, so it's the same place at any zoom).
   */
  const [trail, setTrail] = useState<{ page: number; into: number }[]>([]);
  /** Notes where you are, before going somewhere. */
  function leaving() {
    const box = scroller.current;
    const page = pageInView();
    const element = pageBoxes.current.get(page);
    if (!box || !element) return;
    const into = (box.getBoundingClientRect().top - element.getBoundingClientRect().top) / scale;
    setTrail((current) => [...current, { page, into }]);
  }
  /** Back to where you were before the last place you went to. */
  function goBack() {
    const spot = trail[trail.length - 1];
    const box = scroller.current;
    const element = spot && pageBoxes.current.get(spot.page);
    if (!spot || !box || !element) return;
    setTrail((current) => current.slice(0, -1));
    box.scrollTop = element.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop + spot.into * scale;
    setCurrent(spot.page);
  }

  /** Opens the find bar, with the text selected on the pages (or what was found last). */
  function openFind(query?: string) {
    const selectedText = window.getSelection()?.toString().replace(/\s+/g, " ").trim();
    const wanted = query ?? (selectedText && scroller.current?.contains(window.getSelection()?.anchorNode ?? null) ? selectedText : finding?.query ?? "");
    setFinding((current) => ({ query: wanted, focus: (current?.focus ?? 0) + 1 }));
  }

  function closeFind() {
    setFinding(null);
    setFound(null);
    scroller.current?.focus();
  }

  /** Goes to a match: its page comes into view (if it isn't), and then the match. */
  function goToMatch(matches: { page: number; nth: number }[], index: number) {
    if (!matches.length) return;
    const at = ((index % matches.length) + matches.length) % matches.length;
    setFoundAt(at);
    setSeek((n) => n + 1);
    const box = scroller.current;
    const element = pageBoxes.current.get(matches[at].page);
    if (!box || !element) return;
    const page = element.getBoundingClientRect();
    const view = box.getBoundingClientRect();
    if (!(page.bottom > view.top && page.top < view.bottom)) goToPage(matches[at].page);
  }

  // Finding the text on every page.
  const findQuery = finding?.query ?? "";
  useEffect(() => {
    pageTexts.current.clear();
  }, [document]);
  useEffect(() => {
    if (!document || !findQuery.trim()) {
      setFound(findQuery.trim() ? null : []);
      return;
    }
    let current = true;
    setFound(null);
    (async () => {
      const matches: { page: number; nth: number }[] = [];
      for (let number = 1; number <= document.pages; number++) {
        let text = pageTexts.current.get(number);
        if (text === undefined) {
          text = (await (await document.page(number)).plainText?.().catch(() => "")) ?? "";
          pageTexts.current.set(number, text);
        }
        if (!current) return;
        matchesIn(text, findQuery, true).forEach((_, nth) => matches.push({ page: number, nth }));
      }
      setFound(matches);
      // The match asked for, or the first from the page you're on.
      const target = findTarget.current;
      findTarget.current = null;
      const asked = target ? matches.findIndex((m) => m.page === target.page && m.nth === (target.nth ?? 0)) : -1;
      const fromHere = matches.findIndex((m) => m.page >= pageInView());
      goToMatch(matches, asked >= 0 ? asked : Math.max(0, fromHere));
    })();
    return () => {
      current = false;
    };
  }, [document, findQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  // A match from the workspace's search: found here.
  useEffect(() => {
    if (!goTo?.find) return;
    findTarget.current = { page: goTo.find.page, nth: goTo.find.nth };
    if (goTo.find.query === findQuery && found) {
      const index = found.findIndex((m) => m.page === goTo.find!.page && m.nth === (goTo.find!.nth ?? 0));
      findTarget.current = null;
      goToMatch(found, Math.max(0, index));
    }
    openFind(goTo.find.query);
  }, [goTo]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A match shown on its page: scrolled into view if it isn't (a third of the way down). */
  function showFound(page: number, top: number, bottom: number) {
    const box = scroller.current;
    const element = pageBoxes.current.get(page);
    if (!box || !element) return;
    const pageTop = element.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    const from = pageTop + top;
    const to = pageTop + bottom;
    if (from >= box.scrollTop && to <= box.scrollTop + box.clientHeight) return;
    box.scrollTop = Math.max(0, from - box.clientHeight / 3);
  }

  /** Goes to a page: its top at the top of the pane. */
  function goToPage(page: number) {
    pageBoxes.current.get(page)?.scrollIntoView?.({ block: "start" });
    setCurrent(page);
  }

  /** How far down the pages a part of the contents starts (in the scrolled pages' pixels). */
  function offsetOf(item: { page?: number; top?: number }) {
    const box = scroller.current;
    const page = item.page !== undefined ? pageBoxes.current.get(item.page) : undefined;
    if (!box || !page) return null;
    return page.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop + (item.top ?? 0) * scale;
  }

  /** Goes to a part of the contents: where it starts on its page (with a little room above), or its page's top. */
  function goToItem(item: OutlineItem) {
    leaving();
    goToPlace(item, (at) => setChosen({ item, at }));
  }

  /** Goes to a place in the PDF: where it is on its page (with a little room above), or its page's top. */
  function goToPlace(item: { page?: number; top?: number }, gone: (at: number) => void = () => {}) {
    const box = scroller.current;
    const offset = offsetOf(item);
    if (item.page === undefined) return;
    if (item.top === undefined || !box || offset === null) {
      goToPage(item.page);
      gone(box?.scrollTop ?? 0);
      return;
    }
    box.scrollTop = Math.max(0, offset - 12);
    setCurrent(item.page);
    gone(box.scrollTop);
  }

  /** Follows a link on a page: a website opens in the browser, a file in the workspace (or its app), a place here is gone to. */
  function followPdfLink(link: PdfLink, newPane: boolean) {
    if ("url" in link) return followLinkTarget({ url: link.url }, newPane);
    if ("file" in link) {
      const [address, part] = link.file.split("#");
      const file = resolvePath(path, address, true);
      if (file) followLinkTarget(part ? { path: file, part } : { path: file }, newPane);
      return;
    }
    leaving();
    goToPlace(link);
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
    (path.startsWith("zotero:") ? api.readZoteroPdf(path.slice("zotero:".length)) : api.readWorkspaceFile(path))
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
    // Zoomed by pinching: the point that was under the pointer stays under it.
    const pinched = pinchedAt.current;
    pinchedAt.current = null;
    stopScaling(pagesBox.current);
    const pinchedPage = pinched && pageBoxes.current.get(pinched.page);
    if (box && pinched && pinchedPage) {
      const now = pinchedPage.getBoundingClientRect();
      box.scrollTop += now.top + pinched.y * scale - pinched.clientY;
      box.scrollLeft += now.left + pinched.x * scale - pinched.clientX;
      return;
    }
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
  /**
   * Pinching (or ⌘/Ctrl and scrolling): while it lasts, the pages are scaled as they are, at once;
   * when it ends, they're drawn again at that zoom. The point under the pointer stays under it.
   */
  const pagesBox = useRef<HTMLDivElement>(null);
  /** Where the pinch started: a page, the point on it (in its points), and where that is in the window. */
  const pinchedAt = useRef<{ page: number; x: number; y: number; clientX: number; clientY: number } | null>(null);
  usePinchZoom({
    scroller,
    content: pagesBox,
    scale,
    smallest: SMALLEST,
    biggest: BIGGEST,
    onStart: (clientX, clientY) => {
      // The page under the pointer (or the closest one).
      let closest: { page: number; rect: DOMRect; off: number } | null = null;
      for (const [page, element] of pageBoxes.current) {
        const rect = element.getBoundingClientRect();
        const off = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
        if (!closest || off < closest.off) closest = { page, rect, off };
      }
      pinchedAt.current = closest && {
        page: closest.page,
        x: (clientX - closest.rect.left) / scale,
        y: (clientY - closest.rect.top) / scale,
        clientX,
        clientY,
      };
    },
    onZoom: setZoom,
    onCancel: () => {
      pinchedAt.current = null;
    },
  });

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
  const linksOn = useMemo(() => byPage(pageLinks), [pageLinks]);

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
    onMoveMark: (annotation: Annotation, to: { x: number; y: number }) => moveMark(annotation, to),
    onLink: (link: PdfLink, newPane: boolean) => followPdfLink(link, newPane),
    onOpenPageLink: (link: PageLink) => openPageLink(link),
    onPageLinkMenu: (link: PageLink, x: number, y: number) => setLinkMenu({ link, x, y }),
    paperFor: (reference: string) => paperFor(reference),
    onOpenPaper: (paper: api.ZoteroItem) => onOpenNote?.(zoteroPath(paper.id), ""),
    onOpenCitation: (citation: Citation) => onOpenNote?.(citation.note, citation.at),
    onPointPassages: (keys: string[]) => setPointedKeys(keys.length ? keys : NONE),
    onFoundAt: (page: number, top: number, bottom: number) => showFound(page, top, bottom),
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
    onMoveMark: (annotation, to) => moveMark(annotation, to),
    onLink: (link, newPane) => followPdfLink(link, newPane),
    onOpenPageLink: (link) => openPageLink(link),
    onPageLinkMenu: (link, x, y) => setLinkMenu({ link, x, y }),
    paperFor: (reference) => paperFor(reference),
    onOpenPaper: (paper) => onOpenNote?.(zoteroPath(paper.id), ""),
    onOpenCitation: (citation) => onOpenNote?.(citation.note, citation.at),
    onPointPassages: (keys) => setPointedKeys(keys.length ? keys : NONE),
    onFoundAt: (page, top, bottom) => showFound(page, top, bottom),
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
      onMoveMark: call("onMoveMark"),
      onLink: call("onLink"),
      onOpenPageLink: call("onOpenPageLink"),
      paperFor: call("paperFor") as (reference: string) => Promise<api.ZoteroItem | null>,
      onOpenPaper: call("onOpenPaper"),
      onOpenCitation: call("onOpenCitation"),
      onPointPassages: call("onPointPassages"),
      onPageLinkMenu: call("onPageLinkMenu"),
      onFoundAt: call("onFoundAt"),
      onKeepArea: call("onKeepArea"),
      onDragArea: call("onDragArea"),
    };
  }, []);

  return (
    <div
      ref={reader}
      data-pdf-reader
      className="flex h-full flex-col"
      // ⌘[ (Alt+← elsewhere) or the mouse's back button: back to where you were.
      onKeyDown={(event) => {
        // ⌘F (Ctrl+F elsewhere): find in the PDF; Esc closes it.
        if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "f" && !event.shiftKey) {
          event.preventDefault();
          openFind();
          return;
        }
        if (event.key === "Escape" && finding) {
          event.preventDefault();
          closeFind();
          return;
        }
        const back = ((event.metaKey || event.ctrlKey) && event.key === "[") || (event.altKey && event.key === "ArrowLeft");
        if (!back || !trail.length || (event.target as Element).closest?.("input, textarea, [contenteditable]")) return;
        event.preventDefault();
        goBack();
      }}
      onMouseUp={(event) => {
        if (event.button === 3 && trail.length) goBack();
      }}
    >
      <div role="toolbar" aria-label="PDF" className="flex h-7 shrink-0 items-center gap-px border-b border-neutral-100 px-2 text-[11px] text-neutral-500">
        {outline.length > 0 && (
          <IconButton small
            icon={mdiTableOfContents}
            label="Contents"
            pressed={showContents}
            onClick={() => {
              setScrolled(scroller.current?.scrollTop ?? 0);
              setShowContents(!showContents);
            }}
          />
        )}
        {trail.length > 0 && (
          <IconButton small icon={mdiArrowLeft} label={`Back to page ${trail[trail.length - 1].page}`} onClick={goBack} />
        )}
        {document && (
          <PageBox
            page={current}
            pages={document.pages}
            onGo={(page) => {
              leaving();
              goToPage(page);
            }}
          />
        )}
        <span className="ml-auto" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <IconButton small icon={mdiMagnifyMinusOutline} label="Zoom out" onClick={() => step(-1)} />
        <IconButton small icon={mdiMagnifyPlusOutline} label="Zoom in" onClick={() => step(1)} />
        <IconButton small icon={mdiArrowExpandHorizontal} label="Fit width" pressed={zoom === "fit"} onClick={() => setZoom("fit")} />
        <IconButton small icon={mdiLinkVariant} label="Copy link to this page" onClick={() => copyLink(pageInView())} />
        <IconButton
          small
          icon={mdiNoteTextOutline}
          label="Open the paper's note"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            openPaperNote({ x: box.left, y: box.bottom + 4 });
          }}
        />
        {citations.length > 0 && (
          <IconButton small
            icon={sidebarRight}
            label="Show notes in the margin"
            pressed={showMargin}
            onClick={() => {
              marginShown = !showMargin;
              setShowMargin(marginShown);
            }}
          />
        )}
        {showMargin && citations.some((c) => !c.source) && (
          <IconButton small
            icon={mdiCommentMultipleOutline}
            label="Show mentions from other notes"
            pressed={showMentions}
            onClick={() => setShowMentions(!showMentions)}
          />
        )}
        <IconButton small
          icon={mdiNotePlusOutline}
          label="Add a note on the page"
          pressed={placingNote}
          onClick={() => {
            setPlacingNote(!placingNote);
            setChoosingArea(false);
            setArea(null);
          }}
        />
        <IconButton small
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
      <div className="relative flex min-h-0 flex-1">
      {finding && (
        <div className="pointer-events-none absolute top-2 right-4 z-30 flex justify-end">
          <FindBar
            query={finding.query}
            onQuery={(query) => setFinding((current) => current && { ...current, query })}
            count={found ? found.length : null}
            current={found?.length ? foundAt : null}
            onNext={() => found && goToMatch(found, foundAt + 1)}
            onPrevious={() => found && goToMatch(found, foundAt - 1)}
            onClose={closeFind}
            focusSignal={finding.focus}
          />
        </div>
      )}
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
        // (Focusable, so its keys, like ⌘[ and ⌘F, work after clicking the pages.)
        tabIndex={-1}
        data-pdf-scroller
        className="relative min-h-0 flex-1 overflow-auto bg-neutral-100 outline-none"
      >
        {problem ? (
          <p role="alert" className="p-6 text-sm text-red-600">
            Couldn't open the PDF: {problem}
          </p>
        ) : (
          document && (
            <div ref={pagesBox} className="relative mx-auto flex w-fit flex-col gap-3 py-4" style={{ paddingRight: hasMargin ? MARGIN : 0 }}>
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
                  pdf={path}
                  pageLinks={linksOn.get(i + 1) ?? NONE}
                  citedPopup={!hasMargin}
                  pointed={hasMargin && pointedAt?.page === i + 1 ? pointedAt : undefined}
                  pointedKeys={hasMargin && pointedKeys.some((key) => key.startsWith(`${i + 1}|`)) ? pointedKeys : NONE}
                  onMarks={onMarks}
                  placingNote={placingNote}
                  findQuery={found?.length ? findQuery : undefined}
                  foundCurrent={found?.[foundAt]?.page === i + 1 ? found[foundAt].nth : undefined}
                  seek={found?.[foundAt]?.page === i + 1 ? seek : 0}
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
                  onPoint={setPointedAt}
                  pointedKeys={pointedKeys}
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
            className="absolute z-10 flex -translate-y-full gap-0.5 rounded-lg bg-white p-0.5 text-xs whitespace-nowrap shadow-[0_2px_12px_rgba(0,0,0,0.12)]"
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
            {highlightsIn(selection.page, selection.quote, selection.nth).length > 0 && (
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const marked = highlightsIn(selection.page, selection.quote, selection.nth);
                  clearSelection();
                  removeMarks(marked);
                }}
                className="rounded-md px-2 py-1 text-neutral-700 hover:bg-neutral-100"
              >
                Remove highlight
              </button>
            )}
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={(event) => {
                const box = event.currentTarget.getBoundingClientRect();
                const { page, quote, nth } = selection;
                clearSelection();
                setCopyMenu({ x: box.left, y: box.bottom + 4, page, quote, nth });
              }}
              className="rounded-md px-2 py-1 text-neutral-700 hover:bg-neutral-100"
            >
              Copy as
            </button>
            <button
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const { page, quote, nth, x, y } = selection;
                clearSelection();
                setLinkPicker({ page, quote, nth, x, y: y + 24 });
              }}
              className="rounded-md px-2 py-1 text-neutral-700 hover:bg-neutral-100"
            >
              Link
            </button>
          </div>
        )}
        {naming && (
          <NoteNameDialog
            suggested={naming.suggested}
            taken={taken}
            onCreate={(at) => {
              setNaming(null);
              if (naming.annotation) writeNote(naming.annotation, { newNote: true, at });
              else run(async () => onOpenNote?.(await makeSourceNote(path, await info(), taken, at), ""));
            }}
            onUse={(note) => {
              setNaming(null);
              run(async () => {
                await makeIntoSourceNote(path, await info(), note);
                if (naming.annotation) writeNote(naming.annotation, { note });
                else onOpenNote?.(note, "");
              });
            }}
            onCancel={() => setNaming(null)}
          />
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
        {linkPicker && (
          <NotePicker
            title="Link to a note or paper"
            at={linkPicker}
            sources={[]}
            citing={[]}
            notes={workspaceNotes()}
            files={linkableFiles()}
            startWith={linkPicker.quote.replace(/\s+/g, " ")}
            newNote={(typed) => {
              const at = newNotePath(typed);
              if (!at) return null;
              const folder = at.includes("/") ? at.slice(0, at.lastIndexOf("/")) : "";
              return { label: `New note “${at}”`, detail: folder ? `in ${folder}` : "at the top" };
            }}
            onPick={(choice, typed) => {
              setLinkPicker(null);
              linkTo(linkPicker, choice, typed);
            }}
            onClose={() => setLinkPicker(null)}
          />
        )}
        {markBar && (
          <div
            role="toolbar"
            aria-label="Annotation"
            data-selection-actions
            className="absolute z-10 flex -translate-y-full gap-0.5 rounded-lg bg-white p-0.5 text-xs whitespace-nowrap shadow-[0_2px_12px_rgba(0,0,0,0.12)]"
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
                  recolour(markBar.annotation, colour);
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
                removeMarks([markBar.annotation]);
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
      {copyMenu && (
        <Menu
          label="Copy as"
          at={copyMenu}
          onClose={() => setCopyMenu(undefined)}
          items={(["footnote", "link", "quote"] as CiteAs[]).map((as) => ({
            label: as[0].toUpperCase() + as.slice(1),
            run: () => copyCitation(copyMenu, as),
          }))}
        />
      )}
      {noteMenu && (
        <Menu
          label="The paper's notes"
          at={noteMenu}
          onClose={() => setNoteMenu(undefined)}
          items={noteMenu.notes.map((note) => ({
            label: note.split("/").pop()!.replace(/\.[^.]+$/, ""),
            icon: mdiNoteTextOutline,
            run: () => onOpenNote?.(note, ""),
          }))}
        />
      )}
      {linkMenu && (
        <Menu
          label="Link"
          at={linkMenu}
          onClose={() => setLinkMenu(undefined)}
          items={[
            { label: "Open note", icon: mdiNoteTextOutline, run: () => openPageLink(linkMenu.link) },
            { label: "Remove link", icon: mdiLinkOff, danger: true, run: () => removeMarks([linkMenu.link]) },
          ]}
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
              run: () => recolour(markMenu.annotation, colour),
            })),
            { label: "Remove", icon: mdiDeleteOutline, danger: true, run: () => removeMarks([markMenu.annotation]) },
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
  onMoveMark,
  onLink,
  citedPopup,
  pointed,
  pointedKeys,
  onPointPassages,
  onOpenCitation,
  paperFor,
  onOpenPaper,
  pdf,
  pageLinks,
  onOpenPageLink,
  onPageLinkMenu,
  onFoundAt,
  findQuery,
  foundCurrent,
  seek,
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
  /** Dragging a note's mark: it moves there (in the page's points). */
  onMoveMark: (annotation: Annotation, to: { x: number; y: number }) => void;
  /** Clicking a link on the page (with ⌘ or Ctrl: in a new pane). */
  onLink: (link: PdfLink, newPane: boolean) => void;
  /** Whether hovering a passage a note cites shows what the note says (while the margin, which shows it, isn't there); opening it. */
  citedPopup: boolean;
  /** A note in the margin the mouse is over, about this page: what it's about lights up. */
  pointed?: Citation;
  /** Passages the mouse is over (their citations' keys): they light up. Saying which (while the margin's there, so their notes light up). */
  pointedKeys: string[];
  onPointPassages: (keys: string[]) => void;
  onOpenCitation: (citation: Citation) => void;
  /** The paper in Zotero a reference is to, if it's there; opening it (beside). */
  paperFor: (reference: string) => Promise<api.ZoteroItem | null>;
  onOpenPaper: (paper: api.ZoteroItem) => void;
  /** The PDF (its links' notes are found from its folder), and its links on this page: words linking to notes. */
  pdf: string;
  pageLinks: PageLink[];
  /** Clicking one of them: its note opens. Right-clicking: its menu, at the mouse. */
  onOpenPageLink: (link: PageLink) => void;
  onPageLinkMenu: (link: PageLink, x: number, y: number) => void;
  /** Says where the match you're on is on the page (its top and bottom), each time it's gone to. */
  onFoundAt: (page: number, top: number, bottom: number) => void;
  /** Text being found (its matches are highlighted), and which of them on this page you're on. */
  findQuery?: string;
  foundCurrent?: number;
  /** Counts the times the match here was gone to. */
  seek: number;
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

  // Its links, once it's near the view.
  const [links, setLinks] = useState<PdfLink[]>([]);
  useEffect(() => {
    if (!near || !page?.links) return;
    let current = true;
    page
      .links()
      .then((found) => current && setLinks(found))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [near, page]);

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
    const highlighted = annotations.flatMap((a) => (a.type === "highlight" ? [{ key: `a:${a.id}`, rects: quoteRects(layer, a.quote, origin, a.nth), annotation: a }] : []));
    // (A passage cited without a highlight of its own is highlighted too.)
    // (Passages notes cite are underlined, highlighted or not.)
    const cited = citations.flatMap((c) => (c.quote === undefined ? [] : [{ key: keyOf(c), rects: quoteRects(layer, c.quote, origin, c.nth) }]));
    const next = [...highlighted, ...cited];
    // (Unchanged: the page isn't drawn again.)
    setHighlights((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
    onMarks(number, Object.fromEntries(cited.map((c) => [c.key, c.rects[0]?.top ?? 0])));
  }, [laidOut, annotations, citations, number, onMarks]);

  // Where the words linking to notes are, once the page's text is there.
  const [linkBoxes, setLinkBoxes] = useState<{ link: PageLink; rects: Rect[] }[]>([]);
  useEffect(() => {
    const layer = text.current;
    const pageBox = box.current;
    if (!laidOut || !layer || !pageBox) return;
    const origin = pageBox.getBoundingClientRect();
    const next = pageLinks.map((link) => ({ link, rects: quoteRects(layer, link.quote, origin, link.nth) })).filter((l) => l.rects.length);
    setLinkBoxes((current) => (JSON.stringify(current) === JSON.stringify(next) ? current : next));
  }, [laidOut, pageLinks]);

  // The text being found: each match's boxes, once the page's text is there.
  const [foundBoxes, setFoundBoxes] = useState<{ rects: Rect[]; current: boolean }[]>([]);
  const shownSeek = useRef(0);
  useEffect(() => {
    const layer = text.current;
    const pageBox = box.current;
    if (!findQuery || !laidOut || !layer || !pageBox) {
      setFoundBoxes((current) => (current.length ? [] : current));
      return;
    }
    const origin = pageBox.getBoundingClientRect();
    const { text: pageText, chars } = layerFindText(layer);
    const boxes = matchesIn(pageText, findQuery, true).map((match, nth) => {
      const range = layer.ownerDocument.createRange();
      const start = chars[match.from];
      const end = chars[match.to - 1];
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset + 1);
      const rects = [...(range.getClientRects?.() ?? [])].filter((r) => r.width > 0 && r.height > 0);
      return {
        rects: byLine(rects.map((r) => ({ left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height }))),
        current: nth === foundCurrent,
      };
    });
    setFoundBoxes(boxes);
    const shown = boxes.find((b) => b.current)?.rects;
    if (shown?.length && seek !== shownSeek.current) {
      shownSeek.current = seek;
      onFoundAt(number, Math.min(...shown.map((r) => r.top)), Math.max(...shown.map((r) => r.top + r.height)));
    }
  }, [laidOut, findQuery, foundCurrent, seek, number, onFoundAt]);

  // Hovering a passage a note cites, while the margin isn't there: what the notes citing it say,
  // below it. It stays while the mouse is over it (to open a note), and goes once it's off both.
  const [citedHover, setCitedHover] = useState<{ keys: string[]; rect: Rect } | null>(null);
  const citedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const overPopup = useRef(false);
  /**
   * What it's waiting to do: show these passages' notes, or go ("": the mouse left them). Moving
   * the mouse meanwhile doesn't start the wait again, so it comes, or goes, in its time.
   */
  const pendingKeys = useRef<string | null>(null);
  useEffect(() => () => clearTimeout(citedTimer.current), []);
  useEffect(() => {
    if (!citedPopup) setCitedHover(null);
  }, [citedPopup]);
  /** The passages last said to be under the mouse (to say so only when it changes). */
  const saidPointed = useRef("");
  const pointPassages = (keys: string[]) => {
    if (keys.join() === saidPointed.current) return;
    saidPointed.current = keys.join();
    onPointPassages(keys);
  };
  /** The mouse over the page (`overLink`: over a link in the PDF, or its preview, which win over the notes' pop-up). */
  function hoverCited(clientX: number, clientY: number, overLink = false) {
    const origin = box.current?.getBoundingClientRect();
    if (!origin) return;
    const x = clientX - origin.left;
    const y = clientY - origin.top;
    const inside = (r: Rect) => x >= r.left && x <= r.left + r.width && y >= r.top && y <= r.top + r.height;
    const under = highlights.filter((h) => !h.annotation && h.rects.some(inside));
    let keys = under.map((h) => h.key);
    // With the margin there: its notes about these passages light up, at once.
    if (!citedPopup) return pointPassages(keys);
    if (overPopup.current) return;
    if (overLink) keys = [];
    const wanted = keys.join();
    if (citedHover && wanted === citedHover.keys.join()) {
      // (Over what it shows, or back over it before it went: it stays.)
      clearTimeout(citedTimer.current);
      pendingKeys.current = null;
      return;
    }
    if (pendingKeys.current === wanted) return;
    clearTimeout(citedTimer.current);
    if (!keys.length) {
      pendingKeys.current = citedHover ? "" : null;
      if (citedHover) citedTimer.current = setTimeout(() => !overPopup.current && setCitedHover(null), 150);
      return;
    }
    pendingKeys.current = wanted;
    const rect = under[0].rects.find(inside)!;
    citedTimer.current = setTimeout(
      () => {
        pendingKeys.current = null;
        setCitedHover({ keys, rect });
      },
      citedHover ? 0 : 200,
    );
  }
  const citedPopupBox = useRef<HTMLDivElement>(null);
  useInView(citedPopupBox, citedHover, { height: citedHover?.rect.height ?? 0, gap: 4 });
  const hoveredCitations = citedHover ? citations.filter((c) => citedHover.keys.includes(keyOf(c))) : [];

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
      onMouseMove={(event) => hoverCited(event.clientX, event.clientY, !!(event.target as Element).closest?.("[data-link-preview]"))}
      onMouseLeave={() => {
        pointPassages([]);
        clearTimeout(citedTimer.current);
        pendingKeys.current = null;
        citedTimer.current = setTimeout(() => !overPopup.current && setCitedHover(null), 150);
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
          <NoteMark
            key={a.id}
            annotation={a}
            page={number}
            scale={scale}
            citations={citations.filter((c) => c.point?.x === a.x && c.point?.y === a.y)}
            onOpen={() => onOpenMark(a)}
            onMove={(to) => onMoveMark(a, to)}
          />
        ) : null,
      )}
      {foundBoxes.flatMap((b, i) =>
        b.rects.map((r, j) => (
          <div
            key={`found-${i}-${j}`}
            data-found={b.current ? "current" : ""}
            className={`pointer-events-none absolute rounded-[2px] mix-blend-multiply ${b.current ? "bg-orange-400/60" : "bg-yellow-300/50"}`}
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
          />
        )),
      )}
      {links.map((link, i) => {
        const label = "url" in link ? link.url : "file" in link ? link.file : `Page ${link.page}`;
        if ("page" in link)
          return (
            <PlaceLink
              key={i}
              link={link}
              label={label}
              scale={scale}
              document={document}
              inactive={choosingArea || placingNote}
              onFollow={(newPane) => onLink(link, newPane)}
              paperFor={paperFor}
              onOpenPaper={onOpenPaper}
            />
          );
        return (
          <a
            key={i}
            href={"url" in link ? link.url : "#"}
            aria-label={label}
            title={label}
            draggable={false}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onLink(link, event.metaKey || event.ctrlKey);
            }}
            className={`absolute rounded-[2px] hover:bg-sky-400/10 ${choosingArea || placingNote ? "pointer-events-none" : "cursor-pointer"}`}
            style={areaStyle(link, scale)}
          />
        );
      })}
      {linkBoxes.map(({ link, rects }) => (
        <NoteLinkMark
          key={link.id}
          note={targetOfLink(pdf, link)}
          to={link.to}
          title={link.title}
          rects={rects}
          inactive={choosingArea || placingNote}
          onOpen={() => onOpenPageLink(link)}
          onMenu={(x, y) => onPageLinkMenu(link, x, y)}
        />
      ))}
      {[
        // (Each spot once, though several notes cite it: it isn't lit up darker.)
        ...new Map(
          highlights
            .filter((h) => !h.annotation && pointedKeys.includes(h.key) && (!pointed || h.key !== keyOf(pointed)))
            .flatMap((h) => h.rects)
            .map((r) => [`${r.left},${r.top},${r.width},${r.height}`, r] as const),
        ),
      ].map(([at, r]) => (
        <div key={`pointed-${at}`} data-pointed className={POINTED} style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
      ))}
      {pointed &&
        // (A colour of its own, not one highlights can have: it stands out from them.)
        (pointed.quote !== undefined
          ? (highlights.find((h) => h.key === keyOf(pointed))?.rects ?? []).map((r, i) => (
              <div key={`pointed-${i}`} data-pointed className={POINTED} style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
            ))
          : pointed.area
            ? [<div key="pointed" data-pointed className={POINTED} style={areaStyle(pointed.area, scale)} />]
            : pointed.point
              ? [
                  <div
                    key="pointed"
                    data-pointed
                    className={`${POINTED} rounded-full`}
                    style={{ left: pointed.point.x * scale - 6, top: pointed.point.y * scale - 6, width: NOTE_SIZE + 12, height: NOTE_SIZE + 12 }}
                  />,
                ]
              : null)}
      {citedHover && hoveredCitations.length > 0 && (
        <div
          ref={citedPopupBox}
          role="tooltip"
          onMouseMove={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={() => {
            overPopup.current = true;
            clearTimeout(citedTimer.current);
          }}
          onPointerLeave={() => {
            overPopup.current = false;
            citedTimer.current = setTimeout(() => setCitedHover(null), 150);
          }}
          className="absolute z-30 flex max-h-80 w-96 flex-col gap-1 overflow-y-auto overscroll-contain rounded-lg bg-white p-1.5 text-xs text-neutral-700 shadow-[0_4px_24px_rgba(0,0,0,0.16)] ring-1 ring-neutral-200"
          style={{ left: citedHover.rect.left, top: citedHover.rect.top + citedHover.rect.height + 4 }}
        >
          {hoveredCitations.map((c) => {
            const format = noteFormat(c.note);
            const open = () => {
              overPopup.current = false;
              setCitedHover(null);
              onOpenCitation(c);
            };
            return (
              // (The paragraph as the note shows it; clicking it opens the note there.)
              <div
                key={keyOf(c)}
                role="button"
                tabIndex={0}
                aria-label={`${nameOf(c.note)}: ${c.text}`}
                onClick={open}
                onKeyDown={(event) => event.key === "Enter" && open()}
                className="cursor-pointer rounded-md py-1.5 text-left hover:bg-neutral-50"
              >
                <span title={nameOf(c.note)} className="mb-0.5 block truncate px-2 text-[10px] tracking-wide text-slate-400 uppercase">
                  {nameOf(c.note)}
                </span>
                {c.text && c.written && format ? (
                  <CitationPreview citation={c} format={format} />
                ) : (
                  <span className={`block px-2 leading-snug ${c.text ? "line-clamp-6 text-neutral-800" : "text-neutral-400 italic"}`}>
                    {c.text || "Nothing written yet."}
                  </span>
                )}
              </div>
            );
          })}
        </div>
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
          className="absolute z-10 flex gap-0.5 rounded-lg bg-white p-0.5 text-xs whitespace-nowrap shadow-[0_2px_12px_rgba(0,0,0,0.12)]"
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

/**
 * Where a new note named by what's typed goes (its path, without its extension): at the
 * workspace's top, or in the folders written before its name with / ("Concepts/batch inference").
 * Each name is one line, without what a file's name can't have; nothing leads out of the workspace
 * (`.` and `..` are left out, like a / at the start). Null when there's no name.
 */
const newNotePath = (typed: string) => {
  const names = typed
    .split(/[/\\]/)
    .map((name) => name.replace(/:/g, " ").replace(/\s+/g, " ").trim().replace(/^\.+/, "").trim())
    .filter(Boolean);
  return names.length ? names.join("/") : null;
};

/** Things on pages, by page. */
function byPage<T extends { page: number }>(things: T[]) {
  const pages = new Map<number, T[]>();
  for (const thing of things) pages.set(thing.page, [...(pages.get(thing.page) ?? []), thing]);
  return pages;
}
/** Nothing (always the same empty list, so a page with nothing isn't drawn again). */
const NONE: never[] = [];

/**
 * Asks a PDF reader to undo or redo (its detail: "undo" or "redo") a change to its annotations,
 * sent to it while it has the focus: it cancels the event if it did.
 */
export const UNDO_IN_READER = "marginalia:undo-in-reader";

/** A change to the annotations, to do again or undo. */
type Step = { redo: () => Promise<unknown>; undo: () => Promise<unknown> };

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
/** What a note in the margin is about, while the mouse is over it: lit up in a colour no highlight has. */
const POINTED = "pointer-events-none absolute z-[5] rounded-[3px] bg-orange-400/30";

/** A note's mark on a page, in pixels. */
const NOTE_SIZE = 20;

const areaStyle = (area: { x: number; y: number; width: number; height: number }, scale: number) => ({ left: area.x * scale, top: area.y * scale, width: area.width * scale, height: area.height * scale });

/** Room for the margin's notes, at the right of the pages. */
const MARGIN = 248;
/** Room between the margin's notes and the reader's edge. */
const EDGE = 16;
/** A note's name: its file's, without the folder or extension. */
const nameOf = (path: string) => path.split("/").pop()!.replace(/\.[^.]+$/, "");

type Rect = { left: number; top: number; width: number; height: number };

/** A citation's key: its page first (the page's passages are found together). */
const keyOf = (c: Citation) =>
  `${c.page}|${c.note}|${c.quote ?? ""}|${c.nth ?? 1}|${c.point ? `${c.point.x},${c.point.y}` : ""}|${c.area ? Object.values(c.area).join(",") : ""}|${c.at}`;

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
/** Each time a passage's words are in a page's text (as written, else in any case). */
function quoteSpots(text: string, quote: string) {
  // Compared without their spaces: a PDF often writes a reference's number or a sign ("[44]",
  // "12×") in pieces of their own, which the page's text has apart, and the passage doesn't.
  const wanted = quote.replace(/\s+/g, "");
  if (!wanted) return [];
  const at: number[] = [];
  let letters = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === " ") continue;
    letters += text[i];
    at.push(i);
  }
  const all = (inText: string, words: string) => {
    const spots: { from: number; to: number }[] = [];
    for (let i = inText.indexOf(words); i >= 0; i = inText.indexOf(words, i + 1)) spots.push({ from: at[i], to: at[i + words.length - 1] + 1 });
    return spots;
  };
  const exact = all(letters, wanted);
  // (In any case, letter for letter: lower case is as long, so the places still hold.)
  const lower = (s: string) => [...s].map((c) => (c.toLowerCase().length === 1 ? c.toLowerCase() : c)).join("");
  return exact.length ? exact : all(lower(letters), lower(wanted));
}

/** Where a passage is in a page's text: the `nth` time its words are (the first, if they aren't there that often). */
function findQuote(text: string, quote: string, nth = 1) {
  const spots = quoteSpots(text, quote);
  return spots[nth - 1] ?? spots[0] ?? null;
}

/**
 * Which time (from 1) a passage's words are on a page, for the ones starting at a point of its
 * text (a selection's start). The point is compared by where it is, not which piece of text it's
 * in: browsers say it in different ways (Safari often at the end of the piece before, or at the
 * edge of the one it's in).
 */
export function nthAt(layer: HTMLElement, quote: string, node: Node, offset: number) {
  const { text, chars } = layerText(layer);
  const point = layer.ownerDocument.createRange();
  let start = -1;
  try {
    point.setStart(node, offset);
    // (The first character at the point, or after it.)
    start = chars.findIndex((c) => point.comparePoint(c.node, c.offset) >= 0);
  } catch {
    // (A point that isn't in the page's text: the first time, as before.)
  }
  const spots = quoteSpots(text, quote);
  if (start < 0 || spots.length < 2) return 1;
  let best = 0;
  spots.forEach((spot, i) => {
    if (Math.abs(spot.from - start) < Math.abs(spots[best].from - start)) best = i;
  });
  return best + 1;
}

/** Which time (from 1) a passage's words are in a page's text, for the ones at `from`. */
const nthOf = (text: string, quote: string, from: number) => Math.max(1, quoteSpots(text, quote).findIndex((spot) => spot.from === from) + 1);

/**
 * The passage made of two that overlap (or touch), as the page's text has it; null if they don't,
 * or aren't both found.
 */
export function joinedQuote(layer: HTMLElement, a: { quote: string; nth: number }, b: { quote: string; nth: number }) {
  const { text } = layerText(layer);
  const first = findQuote(text, a.quote, a.nth);
  const second = findQuote(text, b.quote, b.nth);
  if (!first || !second || first.to < second.from || second.to < first.from) return null;
  const from = Math.min(first.from, second.from);
  const quote = text.slice(from, Math.max(first.to, second.to));
  return { quote, nth: nthOf(text, quote, from) };
}

/** Whether two passages on a page overlap (or touch). */
function overlapping(layer: HTMLElement, a: { quote: string; nth: number }, b: { quote: string; nth: number }) {
  return joinedQuote(layer, a, b) !== null;
}

/**
 * Where a passage is in a page's text layer, from the page's top left: a box per line (the text's
 * pieces on a line, which can overlap, made one).
 */
function quoteRects(layer: HTMLElement, quote: string, origin: DOMRect, nth = 1): Rect[] {
  const { text, chars } = layerText(layer);
  const found = findQuote(text, quote, nth);
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
  // (Each line as high as its widest piece, its words: a piece of another font, like a sign or a
  // reference's number, can be much taller, and would put the line's underline in the line below.)
  const lines: (Rect & { widest: Rect })[] = [];
  for (const r of [...rects].sort((a, b) => a.top - b.top || a.left - b.left)) {
    const line = lines.find((l) => Math.abs(l.top + l.height / 2 - (r.top + r.height / 2)) < Math.min(l.height, r.height) / 2);
    if (!line) {
      lines.push({ ...r, widest: r });
      continue;
    }
    const right = Math.max(line.left + line.width, r.left + r.width);
    line.left = Math.min(line.left, r.left);
    line.width = right - line.left;
    if (r.width > line.widest.width) {
      line.widest = r;
      line.top = r.top;
      line.height = r.height;
    }
  }
  return lines.map(({ widest: _, ...line }) => line);
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
  onPoint,
  pointedKeys,
}: {
  citations: Citation[];
  /** The pages' boxes, by number. */
  pages: Map<number, HTMLElement>;
  /** Where each cited part is on its page. */
  marks: Record<string, number>;
  onOpen: (c: Citation) => void;
  /** The mouse is over a note (or no longer is, null): what it's about lights up. */
  onPoint: (c: Citation | null) => void;
  /** The passages the mouse is over on the pages: their notes light up. */
  pointedKeys: string[];
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
    // (A little room from the reader's edge on the right, as from the pages on the left.)
    <aside ref={column} aria-label="Notes on this PDF" className="absolute top-0 bottom-0" style={{ right: EDGE, width: MARGIN - 24 - EDGE }}>
      {ordered.map((a) => (
        <button
          key={keyOf(a)}
          data-page={a.page}
          data-mark={marks[keyOf(a)] ?? 0}
          // (The note it's in, on hovering it: not on the card, to keep it short.)
          title={nameOf(a.note)}
          data-pointed={pointedKeys.includes(keyOf(a)) ? "true" : undefined}
          onMouseEnter={() => onPoint(a)}
          onMouseLeave={() => onPoint(null)}
          onClick={() => onOpen(a)}
          className={`absolute top-0 left-0 w-full rounded-lg text-left shadow-[0_1px_3px_rgba(15,23,42,0.1)] ring-1 ring-slate-200/80 transition-colors hover:ring-slate-300 ${
            pointedKeys.includes(keyOf(a)) ? "bg-orange-50" : "bg-white"
          } ${
            a.source ? "p-2.5" : "p-2 opacity-90"
          }`}
        >
          {a.context && (
            // (In a list: the bullet it's in, in full, as a hint of what it's about.)
            <span className="mb-0.5 block text-[11px] leading-snug text-neutral-400">
              {a.context}
            </span>
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

/**
 * A note's mark on a page (a note at a spot). Clicking it opens its note; hovering it shows a
 * preview of the notes citing it; dragging it moves it (a few pixels' wobble is still a click).
 */
/**
 * Keeps a preview shown beside something on a page (below it, `gap` apart) inside the reader's
 * shown part: moved left if it would go past its right edge (right, past its left), and above
 * the thing if it would go past its bottom. Measured each time it's shown (`shown` changes).
 */
function useInView(box: React.RefObject<HTMLElement | null>, shown: unknown, beside: { height: number; gap: number; side?: boolean }) {
  useLayoutEffect(() => {
    const element = box.current;
    const scroller = element?.closest<HTMLElement>("[data-pdf-scroller]");
    if (!element || !scroller) return;
    element.style.transform = "";
    const view = scroller.getBoundingClientRect();
    const at = element.getBoundingClientRect();
    const margin = 8;
    let dx = 0;
    if (at.right > view.right - margin) dx = view.right - margin - at.right;
    if (at.left + dx < view.left + margin) dx = view.left + margin - at.left;
    // (Above it: up by its own height, the thing's, and the gap on both sides. Shown at its side
    // instead: up just enough.)
    const over = at.bottom - (view.bottom - margin);
    const dy = over <= 0 ? 0 : beside.side ? -over : -(at.height + beside.height + 2 * beside.gap);
    if (dx || dy) element.style.transform = `translate(${Math.round(dx)}px, ${Math.round(dy)}px)`;
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * A note citing a passage, in the passage's pop-up: the whole note as it shows it (without its
 * properties), scrolled to the part citing the passage, which is marked; scroll it for the rest.
 */
function CitationPreview({ citation, format }: { citation: Citation; format: Format }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    textOf(citation.note).then(
      (whole) => current && setText(shownText(whole, format, {})?.text ?? citation.written ?? ""),
      () => current && setText(citation.written ?? ""),
    );
    return () => {
      current = false;
    };
  }, [citation.note, citation.written, format]);
  if (text === null) return <span className="block px-2 leading-snug text-neutral-800">{citation.text}</span>;
  return (
    <div className="max-h-64 overflow-x-hidden overflow-y-auto overscroll-contain text-[13px] [&_.card-note]:px-2 [&_.card-note]:py-0">
      <NotePreview text={text} format={format} path={citation.note} marked={citation.written} margin={false} />
    </div>
  );
}

/**
 * A link on a page to a place in the PDF, like a citation to its reference in the bibliography:
 * hovering it a moment shows the text there (the reference), and the paper in Zotero if it's
 * there, to open. The preview stays while the mouse is over it, to click Open.
 */
function PlaceLink({
  link,
  label,
  scale,
  document,
  inactive,
  onFollow,
  paperFor,
  onOpenPaper,
}: {
  link: PdfLink & { page: number; top?: number; left?: number; figure?: { name?: string } };
  label: string;
  scale: number;
  document: PdfDocument;
  inactive: boolean;
  onFollow: (newPane: boolean) => void;
  paperFor: (reference: string) => Promise<api.ZoteroItem | null>;
  onOpenPaper: (paper: api.ZoteroItem) => void;
}) {
  // (A figure's link: the figure, its part of the page drawn; otherwise the text there, like a reference.)
  const [preview, setPreview] = useState<{ text: string; paper: api.ZoteroItem | null } | { figure: Region; page: PdfPage } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useInView(box, preview, { height: link.height * scale, gap: 4 });
  const showing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hiding = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wanted = useRef(false);
  useEffect(
    () => () => {
      clearTimeout(showing.current);
      clearTimeout(hiding.current);
    },
    [],
  );
  const stay = () => {
    wanted.current = true;
    clearTimeout(hiding.current);
  };
  const leave = () => {
    wanted.current = false;
    clearTimeout(showing.current);
    hiding.current = setTimeout(() => setPreview(null), 150);
  };
  const show = () => {
    stay();
    if (preview) return;
    showing.current = setTimeout(async () => {
      const page = await document.page(link.page).catch(() => null);
      if (link.figure && page?.figureAt && page.drawPart) {
        const figure = await page.figureAt(link.top ?? 0, link.left, link.figure.name).catch(() => null);
        if (figure && wanted.current) return setPreview({ figure, page });
      }
      const text = (await page?.textAt?.(link.top ?? 0, link.left).catch(() => ""))?.trim();
      if (!text || !wanted.current) return;
      setPreview({ text, paper: null });
      const paper = await paperFor(text);
      if (paper && wanted.current) setPreview({ text, paper });
    }, 300);
  };
  return (
    <>
      <a
        href="#"
        aria-label={label}
        data-link-preview
        draggable={false}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={show}
        onPointerLeave={leave}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onFollow(event.metaKey || event.ctrlKey);
        }}
        className={`absolute rounded-[2px] hover:bg-sky-400/10 ${inactive ? "pointer-events-none" : "cursor-pointer"}`}
        style={areaStyle(link, scale)}
      />
      {preview && (
        <div
          ref={box}
          role="tooltip"
          data-link-preview
          onPointerEnter={stay}
          onPointerLeave={leave}
          onPointerDown={(event) => event.stopPropagation()}
          className={`absolute z-30 flex flex-col gap-2 rounded-lg bg-white text-xs text-neutral-700 shadow-[0_4px_24px_rgba(0,0,0,0.16)] ring-1 ring-neutral-200 ${
            "figure" in preview ? "p-2" : "w-80 p-3"
          }`}
          style={{ left: link.x * scale, top: (link.y + link.height) * scale + 4 }}
        >
          {"figure" in preview ? (
            <FigurePart page={preview.page} region={preview.figure} label={`Figure on page ${link.page}`} />
          ) : (
            <p className="line-clamp-6 leading-snug select-text">{preview.text}</p>
          )}
          {"paper" in preview && preview.paper && (
            <div className="flex items-end gap-2 border-t border-neutral-100 pt-2">
              <div className="min-w-0 flex-1">
                <div className="text-[10px] tracking-wide text-neutral-400 uppercase">In your Zotero library</div>
                <div className="truncate font-medium text-neutral-800" title={preview.paper.title}>
                  {preview.paper.title}
                </div>
                <div className="truncate text-neutral-500">{[preview.paper.authors.join(", "), preview.paper.year].filter(Boolean).join(" · ")}</div>
              </div>
              {preview.paper.pdf && (
                <button
                  onClick={() => {
                    setPreview(null);
                    onOpenPaper(preview.paper!);
                  }}
                  className="shrink-0 rounded-md bg-neutral-800 px-2 py-1 text-white hover:bg-neutral-700"
                >
                  Open
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}

/** The largest a figure's preview is drawn, in pixels (a figure across a page's columns is wider). */
const FIGURE_SIZE = { width: 560, height: 420 };

/** A part of a page (a figure), drawn as large as fits a preview. */
function FigurePart({ page, region, label }: { page: PdfPage; region: Region; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const width = Math.min(FIGURE_SIZE.width, region.width * 1.5, (FIGURE_SIZE.height * region.width) / region.height);
  useEffect(() => {
    if (canvas.current) page.drawPart?.(canvas.current, region, width).catch(() => {});
  }, [page, region, width]);
  return <canvas ref={canvas} role="img" aria-label={label} className="block" style={{ width, height: (width * region.height) / region.width }} />;
}

/**
 * What a link's preview says: the start of a note; a Zotero paper's authors and year; where a PDF
 * is. Null if it isn't there.
 */
async function previewOf(target: string): Promise<string | null> {
  if (isZoteroPaper(target)) {
    const paper = await findPaper(target.slice("zotero:".length));
    return paper ? [paper.authors.join(", "), paper.year].filter(Boolean).join(" · ") || "A paper in Zotero." : null;
  }
  if (/\.pdf$/i.test(target)) return target.includes("/") ? `A PDF in ${target.slice(0, target.lastIndexOf("/"))}` : "A PDF";
  return startOfNote(target);
}

/**
 * Words on a page linking to a note or another PDF: underlined like a link. Clicking opens the note; hovering a
 * moment shows the start of it; right-clicking, its menu.
 */
function NoteLinkMark({
  note,
  to,
  title,
  rects,
  inactive,
  onOpen,
  onMenu,
}: {
  /** The note (its path in the workspace), or null if the link can't be followed. */
  note: string | null;
  /** The link's address, as kept, and the title of the PDF it goes to (if it has one). */
  to: string;
  title?: string;
  rects: Rect[];
  /** While placing a note or choosing an area, it's in the way: not clickable. */
  inactive: boolean;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const name = title ?? (note ?? to).split("/").pop()!.replace(/\.[^.]+$/, "");
  /**
   * The preview, once read: a note's text (without its properties), shown as in the editor; or
   * what a PDF is; null: there's no such note or PDF.
   */
  const [preview, setPreview] = useState<{ note: string; format: Format; text: string } | { text: string | null } | null>(null);
  const showing = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hiding = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wanted = useRef(false);
  useEffect(
    () => () => {
      clearTimeout(showing.current);
      clearTimeout(hiding.current);
    },
    [],
  );
  const first = rects[0];
  const last = rects[rects.length - 1];
  const box = useRef<HTMLDivElement>(null);
  useInView(box, preview, { height: last && first ? last.top + last.height - first.top : 0, gap: 6 });
  // (It stays while the mouse is over it, to scroll it; it goes a moment after the mouse leaves both.)
  const stay = () => {
    wanted.current = true;
    clearTimeout(hiding.current);
  };
  const leave = () => {
    wanted.current = false;
    clearTimeout(showing.current);
    hiding.current = setTimeout(() => setPreview(null), 150);
  };
  async function read(target: string) {
    const format = noteFormat(target);
    if (!format) return { text: await previewOf(target) };
    const text = await textOf(target).catch(() => null);
    if (text === null) return { text: null };
    return { note: target, format, text: shownText(text, format, {})?.text ?? "" };
  }
  return (
    <>
      <a
        href="#"
        aria-label={name}
        data-link-preview
        draggable={false}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={() => {
          stay();
          if (preview) return;
          showing.current = setTimeout(() => {
            if (!note) return setPreview({ text: null });
            read(note).then((found) => wanted.current && setPreview(found));
          }, 250);
        }}
        onPointerLeave={leave}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpen();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onMenu(event.clientX, event.clientY);
        }}
        // (Its pieces are placed on the page: the link itself takes no room.)
        className={`contents ${inactive ? "pointer-events-none" : ""}`}
      >
        {rects.map((r, i) => (
          <span
            key={i}
            data-note-link
            className={`absolute rounded-[2px] border-b-[1.5px] border-sky-600/80 hover:bg-sky-400/15 ${inactive ? "pointer-events-none" : "cursor-pointer"}`}
            style={{ left: r.left, top: r.top, width: r.width, height: r.height }}
          />
        ))}
      </a>
      {preview && first && (
        <div
          ref={box}
          role="tooltip"
          data-link-preview
          onPointerEnter={stay}
          onPointerLeave={leave}
          onPointerDown={(event) => event.stopPropagation()}
          className={`absolute z-30 flex flex-col rounded-lg bg-white text-xs text-neutral-700 shadow-[0_4px_24px_rgba(0,0,0,0.16)] ring-1 ring-neutral-200 ${
            // (Wide for a note to read; small when there's only a line to say, as for an empty note.)
            "note" in preview && preview.text.trim() ? "w-[26rem]" : "w-64"
          }`}
          style={{ left: first.left, top: last.top + last.height + 6 }}
        >
          <span className="px-3 pt-2.5 pb-1 text-[11px] font-medium text-neutral-500">{name}</span>
          {"note" in preview ? (
            // The note as the editor shows it, scrolled to read more of it (like a code editor's hover documentation).
            <div className="note-preview max-h-80 overflow-x-hidden overflow-y-auto overscroll-contain pb-1 text-[13px]">
              {preview.text.trim() ? (
                <NotePreview text={preview.text} format={preview.format} path={preview.note} margin={false} />
              ) : (
                <p className="px-3 pb-2.5 text-neutral-400">An empty note.</p>
              )}
            </div>
          ) : (
            <span className={`line-clamp-6 px-3 pb-3 leading-snug ${preview.text === null ? "text-neutral-400" : ""}`}>
              {preview.text === null
                ? note && !noteFormat(note)
                  ? "Not there anymore."
                  : "Not created yet: clicking the link makes it."
                : preview.text || "An empty note."}
            </span>
          )}
        </div>
      )}
    </>
  );
}

function NoteMark({
  annotation,
  page,
  scale,
  citations,
  onOpen,
  onMove,
}: {
  annotation: Annotation & { type: "note" };
  page: number;
  scale: number;
  citations: Citation[];
  onOpen: () => void;
  onMove: (to: { x: number; y: number }) => void;
}) {
  /** While dragging: how far it's been moved, in pixels. */
  const [moved, setMoved] = useState<{ dx: number; dy: number } | null>(null);
  const [preview, setPreview] = useState(false);
  const previewBox = useRef<HTMLDivElement>(null);
  useInView(previewBox, preview, { height: NOTE_SIZE, gap: 6, side: true });
  const hovering = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** Set when a drag ends, so the click that follows doesn't open the note. */
  const dragged = useRef(false);
  const previewId = `note-preview-${annotation.id}`;

  useEffect(() => () => clearTimeout(hovering.current), []);

  function startDrag(event: React.PointerEvent) {
    event.stopPropagation();
    if (event.button !== 0) return;
    const start = { x: event.clientX, y: event.clientY };
    let far = false;
    const onPointerMove = (e: PointerEvent) => {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!far && Math.hypot(dx, dy) < 4) return;
      far = true;
      setPreview(false);
      setMoved({ dx, dy });
    };
    const onPointerUp = (e: PointerEvent) => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      setMoved(null);
      if (!far) return;
      dragged.current = true;
      onMove({
        x: Math.max(0, annotation.x + (e.clientX - start.x) / scale),
        y: Math.max(0, annotation.y + (e.clientY - start.y) / scale),
      });
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  }

  const left = annotation.x * scale + (moved?.dx ?? 0);
  const top = annotation.y * scale + (moved?.dy ?? 0);
  return (
    <>
      <button
        aria-label={`Note on page ${page}`}
        aria-describedby={preview ? previewId : undefined}
        onPointerDown={startDrag}
        onPointerEnter={() => {
          clearTimeout(hovering.current);
          hovering.current = setTimeout(() => setPreview(true), 250);
        }}
        onPointerLeave={() => {
          clearTimeout(hovering.current);
          setPreview(false);
        }}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          onOpen();
        }}
        className={`absolute z-10 flex items-center justify-center rounded-[4px] text-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] ${SWATCHES[annotation.colour]} ${
          moved ? "cursor-grabbing" : "cursor-pointer"
        }`}
        style={{ left, top, width: NOTE_SIZE, height: NOTE_SIZE }}
      >
        <Icon path={mdiNoteText} size="14px" />
      </button>
      {preview && citations.length > 0 && (
        <div
          ref={previewBox}
          id={previewId}
          role="tooltip"
          className="pointer-events-none absolute z-30 flex w-64 flex-col gap-2 rounded-lg bg-white p-3 text-xs text-neutral-700 shadow-[0_4px_24px_rgba(0,0,0,0.16)] ring-1 ring-neutral-200"
          style={{ left: left + NOTE_SIZE + 6, top }}
        >
          {citations.map((c) => (
            <div key={`${c.note}|${c.at}`}>
              <div className="mb-0.5 text-[11px] text-neutral-400">{c.note.split("/").pop()!.replace(/\.[^.]+$/, "")}</div>
              <p className="line-clamp-6 leading-snug">{c.text || "An empty note."}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// Code blocks like Obsidian's: a ``` block is shown as a shaded box in a code font. Its fence lines
// take no room unless the cursor is in it; instead, its corner has a language menu and a copy
// button. The code is highlighted with CodeMirror's parser for that language, loaded when first used.

import { languages } from "@codemirror/language-data";
import { EditorSelection, type EditorState, Prec, type Range as Ranged, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, ViewPlugin, WidgetType } from "@codemirror/view";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import type { Parser } from "@lezer/common";
import { LanguageDescription } from "@codemirror/language";
import { useState } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { mdiFormatListNumbered } from "@mdi/js";
import { Icon } from "@mdi/react";
import { setCodeOptions } from "./codeOptions";
import { findFormatting, type Format, type Span } from "./formatting";

/** Parsers by language name: null if there's none for that name, a promise while loading. */
const parsers = new Map<string, Parser | null | Promise<void>>();

/** Sent when a language's parser has loaded, so its code blocks get highlighted. */
const parserLoaded = StateEffect.define<null>();

function parserFor(language: string): Parser | null | undefined {
  const known = parsers.get(language);
  return known instanceof Promise ? undefined : known;
}

/** Editors that are open, to tell when a parser has loaded. */
const openViews = new Set<EditorView>();

function loadParser(language: string) {
  if (parsers.has(language)) return;
  const description = LanguageDescription.matchLanguageName(languages, language, true);
  if (!description) {
    parsers.set(language, null);
    return;
  }
  parsers.set(
    language,
    description.load().then(
      (support) => {
        parsers.set(language, support.language.parser);
        for (const view of openViews) view.dispatch({ effects: parserLoaded.of(null) });
      },
      () => {
        parsers.set(language, null);
      },
    ),
  );
}

/** Every language CodeMirror knows, by name, for the language menu. */
const LANGUAGE_NAMES = languages.map((language) => language.name).sort((a, b) => a.localeCompare(b));
const PLAIN = "Plain text";

/** How a language is written after the fence: "Python" → "python". */
const fenceTag = (name: string) => (name === PLAIN ? "" : name.toLowerCase().replace(/\s+/g, "-"));

/** The name to show for what's written after the fence. */
const displayName = (tag: string) =>
  tag ? (LanguageDescription.matchLanguageName(languages, tag, true)?.name ?? tag) : PLAIN;

function matches(name: string, query: string) {
  const search = query.trim().toLowerCase();
  if (!search) return true;
  const description = languages.find((language) => language.name === name);
  return [name, ...(description?.alias ?? [])].some((word) => word.toLowerCase().includes(search));
}

/** The corner of a code block: a language menu (with search) and a copy button. */
function CodeBlockCorner({
  language,
  code,
  numbers,
  onPick,
  onToggleNumbers,
  onDone,
}: {
  language: string;
  code: string;
  numbers: boolean;
  onPick: (tag: string) => void;
  onToggleNumbers: () => void;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [copied, setCopied] = useState(false);
  // Names starting with what's typed first ("shell" → Shell before PowerShell).
  const startsWith = (name: string) => name.toLowerCase().startsWith(query.trim().toLowerCase());
  const options = [PLAIN, ...LANGUAGE_NAMES]
    .filter((name) => matches(name, query))
    .sort((a, b) => Number(startsWith(b)) - Number(startsWith(a)));

  const close = () => {
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  };
  const pick = (name: string) => {
    close();
    onPick(fenceTag(name));
  };

  return (
    <span
      className="cm-codeblock-header"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      {/* Copy and line numbers first: they only show on hover, so the language keeps the corner. */}
      <button
        type="button"
        aria-label="Copy code"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() =>
          navigator.clipboard?.writeText(code).then(
            () => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            },
            () => {},
          )
        }
        className="cm-codeblock-copy"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <button
        type="button"
        aria-label="Line numbers"
        title="Line numbers"
        aria-pressed={numbers}
        onMouseDown={(event) => event.preventDefault()}
        onClick={onToggleNumbers}
        className="cm-codeblock-copy cm-codeblock-numbers-toggle"
      >
        <Icon path={mdiFormatListNumbered} size="1.1em" />
      </button>
      <button
        type="button"
        aria-label="Language"
        aria-haspopup="listbox"
        aria-expanded={open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => (open ? close() : setOpen(true))}
        className="cm-codeblock-language"
      >
        {displayName(language)} ▾
      </button>
      {open && (
        <span className="cm-codeblock-menu">
          <input
            aria-label="Search languages"
            autoFocus
            placeholder="Search…"
            value={query}
            spellCheck={false}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlighted(0);
            }}
            onKeyDown={(event) => {
              // Keys typed here are for the menu, not for the note under it.
              event.stopPropagation();
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                setHighlighted((h) => Math.max(0, Math.min(options.length - 1, h + step)));
              } else if (event.key === "Enter") {
                event.preventDefault();
                if (options[highlighted]) pick(options[highlighted]);
              } else if (event.key === "Escape") {
                close();
                onDone();
              }
            }}
          />
          <ul role="listbox" aria-label="Languages">
            {options.map((name, index) => (
              <li
                key={name}
                role="option"
                aria-selected={index === highlighted}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlighted(index)}
                onClick={() => pick(name)}
              >
                {name}
              </li>
            ))}
          </ul>
        </span>
      )}
    </span>
  );
}

const roots = new WeakMap<HTMLElement, Root>();

/** The code block's corner, in place of its opening fence while the cursor is elsewhere. */
class CodeBlockHeader extends WidgetType {
  constructor(
    readonly format: Format,
    readonly language: string,
    readonly code: string,
    readonly numbers: boolean,
  ) {
    super();
  }

  eq(other: CodeBlockHeader) {
    return other.language === this.language && other.code === this.code && other.numbers === this.numbers;
  }

  toDOM(view: EditorView) {
    const element = document.createElement("span");
    element.className = "cm-codeblock-corner";
    const root = createRoot(element);
    roots.set(element, root);
    // Drawn right away, so it's there (and measured) as soon as the code block is.
    flushSync(() => this.render(root, view, element));
    return element;
  }

  // Keep the same corner (and an open menu) when only the code changed.
  updateDOM(element: HTMLElement, view: EditorView) {
    const root = roots.get(element);
    if (!root) return false;
    this.render(root, view, element);
    return true;
  }

  destroy(element: HTMLElement) {
    const root = roots.get(element);
    roots.delete(element);
    setTimeout(() => root?.unmount());
  }

  ignoreEvent() {
    return true;
  }

  private render(root: Root, view: EditorView, element: HTMLElement) {
    root.render(
      <CodeBlockCorner
        language={this.language}
        code={this.code}
        numbers={this.numbers}
        onPick={(tag) => {
          // Rewrites the opening fence with the language chosen (keeping Markdown's options there).
          // The cursor stays where it was, rather than jumping to wherever the note was last edited.
          const pos = view.posAtDOM(element);
          const block = blockAt(view, this.format, pos);
          if (block && this.format === "markdown") {
            const options = { numbers: block.numbers ?? false, highlights: block.highlights ?? [] };
            view.dispatch({ changes: setCodeOptions(view.state.doc.toString(), "markdown", { ...block, args: tag }, options) });
            return;
          }
          const fence = view.state.doc.lineAt(pos);
          view.dispatch({ changes: { from: fence.from, to: fence.to, insert: "```" + tag } });
        }}
        onToggleNumbers={() => {
          const block = blockAt(view, this.format, view.posAtDOM(element));
          if (!block) return;
          const options = { numbers: !block.numbers, highlights: block.highlights ?? [] };
          view.dispatch({ changes: setCodeOptions(view.state.doc.toString(), this.format, block, options) });
        }}
        onDone={() => {}}
      />,
    );
  }
}

/** The code block around a position in the note. */
function blockAt(view: EditorView, format: Format, pos: number) {
  return findFormatting(view.state.doc.toString(), format).find(
    (span) => span.kind === "codeblock" && span.from <= pos && pos <= span.to,
  );
}

// Each editor's line last clicked, so Shift+click can highlight every line from it.
const lastClicked = new WeakMap<EditorView, { block: number; line: number }>();

/** Highlights a line (or un-highlights it); with Shift, every line from the one last clicked
 * (highlighting them, or not, as that one is). */
function toggleLine(view: EditorView, format: Format, pos: number, line: number, range: boolean) {
  const block = blockAt(view, format, pos);
  if (!block) return;
  const highlights = new Set(block.highlights ?? []);
  // From the line last clicked in this block or, if none, the nearest one already highlighted.
  const last = lastClicked.get(view);
  const nearest = [...highlights].sort((a, b) => Math.abs(a - line) - Math.abs(b - line))[0];
  const from = last?.block === block.from ? last.line : nearest;
  if (range && from !== undefined) {
    // The range takes the state the first line was left in: highlighted, or not.
    const highlight = highlights.has(from);
    const [a, b] = [Math.min(from, line), Math.max(from, line)];
    for (let n = a; n <= b; n++) {
      if (highlight) highlights.add(n);
      else highlights.delete(n);
    }
  } else if (highlights.has(line)) {
    highlights.delete(line);
  } else {
    highlights.add(line);
  }
  lastClicked.set(view, { block: block.from, line });
  const options = { numbers: block.numbers ?? false, highlights: [...highlights] };
  view.dispatch({ changes: setCodeOptions(view.state.doc.toString(), format, block, options) });
}

/** A code line's number: shown when the block has line numbers, on hover otherwise. Click it to
 * highlight the line. */
class LineNumber extends WidgetType {
  constructor(
    readonly format: Format,
    readonly line: number,
    readonly highlighted: boolean,
    readonly shown: boolean,
    /** How many digits the block's last number has: the column is that wide. */
    readonly digits: number,
  ) {
    super();
  }

  eq(other: LineNumber) {
    return (
      other.line === this.line &&
      other.highlighted === this.highlighted &&
      other.shown === this.shown &&
      other.digits === this.digits
    );
  }

  toDOM(view: EditorView) {
    const number = document.createElement("span");
    number.className = this.shown ? "cm-codeblock-number" : "cm-codeblock-number cm-codeblock-number-on-hover";
    number.setAttribute("role", "button");
    number.setAttribute("aria-label", `Line ${this.line}`);
    number.setAttribute("aria-pressed", String(this.highlighted));
    number.title = this.highlighted ? "Un-highlight (Shift+click: a range)" : "Highlight (Shift+click: a range)";
    // The digits in their own span, a little smaller, on the code's baseline.
    const digits = document.createElement("span");
    digits.textContent = String(this.line);
    number.append(digits);
    if (this.shown) number.style.width = `${this.digits}ch`;
    // On press rather than click: the press re-draws the number, which can lose the click.
    number.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (event.button === 0) toggleLine(view, this.format, view.posAtDOM(number), this.line, event.shiftKey);
    });
    return number;
  }

  ignoreEvent() {
    return true;
  }
}

const hiddenFence = Decoration.replace({});

function decorate(state: EditorState, format: Format): DecorationSet {
  const text = state.doc.toString();
  const blocks = findFormatting(text, format).filter((span) => span.kind === "codeblock");
  const decorations: Ranged<Decoration>[] = [];
  for (const block of blocks) decorations.push(...decorateBlock(state, text, block, format));
  return Decoration.set(decorations, true);
}

function decorateBlock(state: EditorState, text: string, block: Span, format: Format): Ranged<Decoration>[] {
  const [open, close] = block.markers;
  const language = block.args ?? "";
  const codeFrom = Math.min(open.to + 1, close.from);
  const codeTo = Math.max(codeFrom, close.from - 1);
  const code = text.slice(codeFrom, codeTo);
  const decorations: Ranged<Decoration>[] = [];

  // The fences show while the cursor is in the block (after its very start); otherwise their lines
  // take no room, and the box starts and ends with the code.
  const editing = state.selection.ranges.some((r) => r.head > block.from && r.head <= block.to);
  const fenceLine = state.doc.lineAt(open.from).number;
  const closingLine = state.doc.lineAt(close.to).number;
  const highlights = new Set(block.highlights ?? []);

  // In Typst, the #[ … ] that holds the options is never shown: only the code is.
  for (const hidden of block.wrapper ?? []) {
    decorations.push(Decoration.replace({ block: true }).range(hidden.from, hidden.to));
  }
  const collapsed = !editing && closingLine - fenceLine > 1;
  const first = collapsed ? fenceLine + 1 : fenceLine;
  const last = collapsed ? closingLine - 1 : closingLine;

  // Every line of the block is part of the box.
  for (let number = fenceLine; number <= closingLine; number++) {
    const classes = ["cm-codeblock"];
    if (collapsed && (number === fenceLine || number === closingLine)) classes.push("cm-codeblock-fence");
    if (number === first) classes.push("cm-codeblock-start");
    // (Below the corner's language and buttons, in a strip of their own above the code.)
    if (number === first && !editing) classes.push("cm-codeblock-below-corner");
    if (number === last) classes.push("cm-codeblock-end");
    const line = number - fenceLine;
    const isCode = number > fenceLine && number < closingLine;
    if (isCode && highlights.has(line)) classes.push("cm-codeblock-highlighted");
    decorations.push(Decoration.line({ class: classes.join(" ") }).range(state.doc.line(number).from));
    if (isCode) {
      const digits = String(closingLine - fenceLine - 1).length;
      const widget = new LineNumber(format, line, highlights.has(line), !!block.numbers, digits);
      decorations.push(Decoration.widget({ widget, side: -1 }).range(state.doc.line(number).from));
    }
  }
  if (!editing) {
    const header = new CodeBlockHeader(format, language, code, !!block.numbers);
    decorations.push(Decoration.replace({ widget: header }).range(open.from, open.to));
    if (close.from < close.to) decorations.push(hiddenFence.range(close.from, close.to));
  }

  // Highlighting, once the language's parser is there.
  const parser = language ? parserFor(language.toLowerCase()) : null;
  if (parser && code) {
    highlightTree(parser.parse(code), classHighlighter, (from, to, classes) => {
      decorations.push(Decoration.mark({ class: classes }).range(codeFrom + from, codeFrom + to));
    });
  }
  return decorations;
}

/** Loads the parsers for the languages the note's code blocks use. */
const loader = (format: Format) =>
  ViewPlugin.define((view) => {
    openViews.add(view);
    const load = () => {
      for (const span of findFormatting(view.state.doc.toString(), format)) {
        if (span.kind === "codeblock" && span.args) loadParser(span.args.toLowerCase());
      }
    };
    load();
    return {
      update: (update) => update.docChanged && load(),
      destroy: () => openViews.delete(view),
    };
  });

/**
 * ↑ and ↓ (with Shift, selecting) inside a code block: to the line above or below in the code,
 * at the same column, or the end of a shorter line, coming back to the column after. (The
 * browser's own way measures the screen, and the box's hidden fences and corner can throw it off.)
 * At the code's first or last line, it's left to the editor, to leave the block.
 */
function moveInCode(format: Format, up: boolean, extend: boolean) {
  return (view: EditorView) => {
    const { state } = view;
    const range = state.selection.main;
    const line = state.doc.lineAt(range.head);
    const target = up ? line.number - 1 : line.number + 1;
    if (target < 1 || target > state.doc.lines) return false;
    const block = findFormatting(state.doc.toString(), format).find(
      (span) => span.kind === "codeblock" && span.markers[0].to < line.from && line.to < span.markers[1].from,
    );
    if (!block) return false;
    const next = state.doc.line(target);
    // (Only from code line to code line: not onto the fences.)
    if (next.from <= block.markers[0].to || next.to >= block.markers[1].from) return false;
    const column = range.goalColumn ?? range.head - line.from;
    const head = next.from + Math.min(column, next.length);
    const moved = extend ? EditorSelection.range(range.anchor, head, column) : EditorSelection.cursor(head, 0, undefined, column);
    view.dispatch({ selection: EditorSelection.create([moved]), scrollIntoView: true, userEvent: "select" });
    return true;
  };
}

export function codeBlocks(format: Format) {
  const field = StateField.define<DecorationSet>({
    create: (state) => decorate(state, format),
    update: (decorations, transaction) =>
      transaction.docChanged || transaction.selection || transaction.effects.some((e) => e.is(parserLoaded))
        ? decorate(transaction.state, format)
        : decorations,
    provide: (f) => EditorView.decorations.from(f),
  });
  const arrows = Prec.high(
    keymap.of([
      { key: "ArrowUp", run: moveInCode(format, true, false), shift: moveInCode(format, true, true) },
      { key: "ArrowDown", run: moveInCode(format, false, false), shift: moveInCode(format, false, true) },
    ]),
  );
  return [field, loader(format), arrows, theme];
}

const mono = "ui-monospace, SFMono-Regular, Menlo, monospace";

const theme = EditorView.theme({
  ".cm-line.cm-codeblock": {
    position: "relative",
    background: "#f7f6f3",
    fontFamily: mono,
    fontSize: "0.87em",
    lineHeight: "1.6",
    padding: "0 1.25em !important",
  },
  // The same room above and below the code as on its sides.
  ".cm-line.cm-codeblock-start": { borderTopLeftRadius: "8px", borderTopRightRadius: "8px", paddingTop: "1.1em !important" },
  // Room for the corner's strip above the code: as tall as a line, and a little more.
  ".cm-line.cm-codeblock-start.cm-codeblock-below-corner": { paddingTop: "2.35em !important" },
  ".cm-line.cm-codeblock-end": { borderBottomLeftRadius: "8px", borderBottomRightRadius: "8px", paddingBottom: "1.1em !important" },
  // Collapsed fence lines: no room taken; the opening one holds the corner, over the first code line.
  ".cm-line.cm-codeblock-fence": {
    height: "0",
    padding: "0 !important",
    lineHeight: "0",
    position: "relative",
    overflow: "visible",
  },
  // Placed against the (collapsed) fence line, so it sits in the box's top-right corner.
  ".cm-codeblock-corner": { position: "static" },
  // In a strip of its own at the top of the box, above the first line of code (never over it).
  ".cm-codeblock-header": {
    position: "absolute",
    top: "0.45em",
    right: "0.85em",
    height: "1.6em",
    zIndex: "5",
    display: "flex",
    gap: "2px",
    alignItems: "center",
    lineHeight: "1.6",
    fontFamily: mono,
    whiteSpace: "nowrap",
  },
  ".cm-line:not(.cm-codeblock-fence) .cm-codeblock-header": { position: "static", justifyContent: "flex-end" },
  ".cm-codeblock-language, .cm-codeblock-copy": {
    color: "#a3a3a3",
    fontSize: "0.85em",
    lineHeight: "1.6",
    padding: "0 6px",
    borderRadius: "4px",
  },
  ".cm-codeblock-language:hover, .cm-codeblock-copy:hover": { background: "#ebeae6", color: "#525252" },
  ".cm-codeblock-copy": { opacity: "0", transition: "opacity 150ms" },
  ".cm-line.cm-codeblock:hover .cm-codeblock-copy, .cm-codeblock-copy:focus, .cm-codeblock-header:focus-within .cm-codeblock-copy":
    { opacity: "1" },
  ".cm-codeblock-numbers-toggle": { display: "flex", alignItems: "center", padding: "2px 4px !important" },
  ".cm-codeblock-numbers-toggle[aria-pressed=true]": { opacity: "1", color: "#525252" },
  // Line numbers: a column before the code, or (when off) in the box's padding, on hover.
  ".cm-codeblock-number": {
    display: "inline-block",
    marginRight: "1.1em",
    textAlign: "right",
    color: "#b5b3ad",
    cursor: "pointer",
    userSelect: "none",
  },
  // Digits are as tall as capitals and code is mostly lowercase: at full size they look too high.
  ".cm-codeblock-number > span": { fontSize: "0.88em" },
  ".cm-codeblock-number:hover": { color: "#525252" },
  ".cm-codeblock-number[aria-pressed=true]": { color: "#b45309", fontWeight: "600" },
  // Centred in the box's padding, on the code's line: the code doesn't move.
  ".cm-codeblock-number-on-hover": {
    position: "absolute",
    top: "0",
    left: "0",
    width: "1.25em",
    lineHeight: "1.6",
    textAlign: "center",
    marginRight: "0",
    opacity: "0",
  },
  ".cm-line.cm-codeblock:hover .cm-codeblock-number-on-hover": { opacity: "1" },
  // The first line has the box's top padding above its code.
  ".cm-line.cm-codeblock-start .cm-codeblock-number-on-hover": { top: "1.1em" },
  ".cm-line.cm-codeblock-start.cm-codeblock-below-corner .cm-codeblock-number-on-hover": { top: "2.35em" },
  ".cm-line.cm-codeblock.cm-codeblock-highlighted": { background: "#fff3bf" },
  ".cm-codeblock-menu": {
    position: "absolute",
    top: "calc(100% + 4px)",
    right: "0",
    width: "13rem",
    padding: "4px",
    borderRadius: "10px",
    background: "white",
    boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
    fontFamily: "system-ui, sans-serif",
    fontSize: "13px",
  },
  ".cm-codeblock-menu input": {
    width: "100%",
    padding: "4px 8px",
    marginBottom: "4px",
    borderRadius: "6px",
    background: "#f5f5f5",
    outline: "none",
    font: "inherit",
  },
  ".cm-codeblock-menu ul": { maxHeight: "14rem", overflowY: "auto", margin: "0", padding: "0", listStyle: "none" },
  ".cm-codeblock-menu li": { padding: "3px 8px", borderRadius: "6px", cursor: "default", color: "#404040" },
  ".cm-codeblock-menu li[aria-selected=true]": { background: "#f5f5f5", color: "#171717" },
  // Highlighting, in quiet colours like Obsidian's light theme.
  ".tok-keyword": { color: "#a626a4" },
  ".tok-string, .tok-string2": { color: "#50a14f" },
  ".tok-number, .tok-bool, .tok-atom": { color: "#986801" },
  ".tok-comment": { color: "#a0a1a7", fontStyle: "italic" },
  ".tok-variableName.tok-definition, .tok-function": { color: "#4078f2" },
  ".tok-typeName, .tok-className": { color: "#c18401" },
  ".tok-propertyName": { color: "#e45649" },
  ".tok-operator, .tok-punctuation": { color: "#696c77" },
  ".tok-meta": { color: "#4078f2" },
});

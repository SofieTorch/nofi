// The sidebar's Library section (see tests/library.test.tsx): the user's Zotero library, read
// when the section is shown, and again whenever it changes in Zotero, so it's always the same.
// Its libraries (the user's own open, then groups), their collections, and their papers: a
// paper in a collection is only shown inside it, and a library lists the papers in none.
// Searching (from the Search button on the header) lists the papers matching across all of them. A paper with a PDF opens it in the
// reader.
//
// Libraries and collections can be hidden, per workspace (right-click › Hide, or the Library's
// settings). Hidden means hidden everywhere here: a hidden collection's collections are hidden
// too, and papers only in hidden collections are left out of the library's papers and search.

import { shortAuthors } from "../pdf/annotations";
import { mdiBookshelf, mdiChevronRight, mdiCogOutline, mdiEyeOffOutline, mdiFileDocumentOutline, mdiFilePdfBox, mdiFolderOpenOutline, mdiFolderOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as api from "../api";
import { Menu } from "../ui/Menu";

/** The path a Zotero paper's PDF is opened with (a tab's path), from its id. */
export const zoteroPath = (id: string) => `zotero:${id}`;

/** A paper in the Zotero library (its id), if it's there. */
export async function findPaper(id: string): Promise<api.ZoteroItem | undefined> {
  const library = await api.zoteroLibrary().catch(() => null);
  return library?.libraries.flatMap((l) => l.items).find((item) => item.id === id);
}

type Props = {
  /** Read again when this changes (Refresh). */
  version: number;
  /** Whether the search field is shown (from the Search button on the Library's header). */
  searching: boolean;
  onSearching: (searching: boolean) => void;
  /** Where the Library's settings are open (in the window), if they are. */
  settingsAt: { x: number; y: number } | null;
  onSettings: (at: { x: number; y: number } | null) => void;
  /** The open PDF's path, to highlight its paper. */
  highlightedPath?: string;
  /** Opens a paper's PDF; `newPane` with ⌘ (Ctrl elsewhere) held. */
  onOpen: (paper: api.ZoteroItem, newPane: boolean) => void;
};

type State = { status: "loading" } | { status: "missing" } | { status: "failed"; reason: string } | { status: "ready"; library: api.ZoteroLibrary };

/** How a collection is named among what's hidden: `<library id>/collections/<key>`. */
const collectionId = (library: ZLibrary, collection: api.ZoteroCollection) => `${library.id}/collections/${collection.key}`;

export function Library({ version, searching, onSearching, settingsAt, onSettings, highlightedPath, onOpen }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [query, setQuery] = useState("");
  /** What's hidden in this workspace (libraries' and collections' ids), in the order hidden. */
  const [hidden, setHidden] = useState<string[]>([]);
  /** A library's or collection's right-click menu. */
  const [menu, setMenu] = useState<{ id: string; name: string; at: { x: number; y: number } }>();

  useEffect(() => {
    let current = true;
    api.getHiddenInLibrary().then(
      (found) => current && setHidden(found),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  // Hiding the field clears the search.
  useEffect(() => {
    if (!searching) setQuery("");
  }, [searching]);

  function changeHidden(next: string[]) {
    setHidden(next);
    api.saveHiddenInLibrary(next).catch(console.error);
  }
  const hide = (id: string) => !hidden.includes(id) && changeHidden([...hidden, id]);
  const show = (id: string) => changeHidden(hidden.filter((h) => h !== id));

  // Read when shown, on Refresh, and whenever Zotero changes it (what's open and typed stays).
  useEffect(() => {
    let current = true;
    let reading = 0;
    const read = () => {
      const mine = ++reading;
      api.zoteroLibrary().then(
        (library) => current && mine === reading && setState(library ? { status: "ready", library } : { status: "missing" }),
        (reason) => current && mine === reading && setState({ status: "failed", reason: String(reason) }),
      );
    };
    read();
    const unlisten = api.onZoteroChanged(read);
    return () => {
      current = false;
      unlisten.then((stop) => stop());
    };
  }, [version]);

  if (state.status === "loading") return null;
  if (state.status === "missing") return <p className="px-3 py-1 text-sm text-neutral-500">Zotero isn't on this computer.</p>;
  if (state.status === "failed")
    return (
      <p role="alert" className="px-3 py-1 text-sm text-red-600">
        {state.reason}
      </p>
    );

  const libraries = shown(state.library.libraries, new Set(hidden));
  const rows = { highlightedPath, onOpen, onMenu: (id: string, name: string, at: { x: number; y: number }) => setMenu({ id, name, at }) };
  const found = query.trim() ? search(libraries, query) : null;
  return (
    <div className="flex flex-col">
      {menu && (
        <Menu
          label={menu.name}
          at={menu.at}
          onClose={() => setMenu(undefined)}
          items={[
            { label: `Hide “${menu.name}”`, icon: mdiEyeOffOutline, run: () => hide(menu.id) },
            { label: "Library settings…", icon: mdiCogOutline, run: () => onSettings(menu.at) },
          ]}
        />
      )}
      {settingsAt && (
        <LibrarySettings
          at={settingsAt}
          libraries={state.library.libraries}
          hidden={hidden}
          onShow={show}
          onHide={hide}
          onClose={() => onSettings(null)}
        />
      )}
      {searching && (
        <div className="sticky top-0 z-10 bg-white px-2 pb-1">
          <input
            type="search"
            autoFocus
            aria-label="Search the library"
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              onSearching(false);
            }}
            className="w-full rounded-md bg-neutral-100 px-2 py-1 text-sm outline-none placeholder:text-neutral-400 focus:ring-1 focus:ring-neutral-300"
          />
        </div>
      )}
      <div className="px-1.5 pb-2">
        {found ? (
          found.length ? (
            <ul>
              {found.map((paper) => (
                <Paper key={paper.id} paper={paper} depth={0} {...rows} />
              ))}
            </ul>
          ) : (
            <p className="px-2 text-sm text-neutral-500">No papers match.</p>
          )
        ) : (
          <ul>
            {libraries.map((library, n) => (
              <LibraryNode key={library.name + n} library={library} open={n === 0} {...rows} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

type Rows = Pick<Props, "highlightedPath" | "onOpen"> & {
  /** Right-clicking a library or collection (its id and name, and where). */
  onMenu: (id: string, name: string, at: { x: number; y: number }) => void;
};
type ZLibrary = api.ZoteroLibrary["libraries"][number];

/**
 * The libraries as shown, without what's hidden: hidden libraries; hidden collections, and the
 * collections in them; and papers only in hidden collections (papers in no collection stay).
 */
function shown(libraries: ZLibrary[], hidden: ReadonlySet<string>): ZLibrary[] {
  return libraries
    .filter((library) => !hidden.has(library.id))
    .map((library) => {
      const byKey = new Map(library.collections.map((c) => [c.key, c]));
      const isShown = (collection: api.ZoteroCollection): boolean => {
        if (hidden.has(collectionId(library, collection))) return false;
        const parent = collection.parent ? byKey.get(collection.parent) : undefined;
        return !parent || isShown(parent);
      };
      const collections = library.collections.filter(isShown);
      const inAny = new Set(library.collections.flatMap((c) => c.items));
      const inShown = new Set(collections.flatMap((c) => c.items));
      const items = library.items.filter((paper) => !inAny.has(paper.id) || inShown.has(paper.id));
      return { ...library, collections, items };
    });
}

/** The papers matching every word typed, in their title, authors or year (each once). */
function search(libraries: ZLibrary[], query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const seen = new Set<string>();
  return libraries
    .flatMap((library) => library.items)
    .filter((paper) => {
      const text = `${paper.title} ${paper.authors.join(" ")} ${paper.year ?? ""}`.toLowerCase();
      if (seen.has(paper.id) || !words.every((word) => text.includes(word))) return false;
      seen.add(paper.id);
      return true;
    })
    .slice(0, 200);
}

function LibraryNode({ library, open, ...rows }: Rows & { library: ZLibrary; open: boolean }) {
  const [expanded, setExpanded] = useState(open);
  const byId = new Map(library.items.map((paper) => [paper.id, paper]));
  // (A paper in a collection is only shown inside it; the library itself lists those in none.)
  const filed = new Set(library.collections.flatMap((c) => c.items));
  const unfiled = library.items.filter((paper) => !filed.has(paper.id));
  return (
    <li>
      <Folder
        name={library.name}
        icon={mdiBookshelf}
        depth={0}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        onMenu={(at) => rows.onMenu(library.id, library.name, at)}
      />
      {expanded && (
        <ul>
          {library.collections
            .filter((c) => !c.parent)
            .map((collection) => (
              <CollectionNode key={collection.key} collection={collection} library={library} byId={byId} depth={1} {...rows} />
            ))}
          {unfiled.map((paper) => (
            <Paper key={paper.id} paper={paper} depth={1} {...rows} />
          ))}
        </ul>
      )}
    </li>
  );
}

function CollectionNode({
  collection,
  library,
  byId,
  depth,
  ...rows
}: Rows & { collection: api.ZoteroCollection; library: ZLibrary; byId: Map<string, api.ZoteroItem>; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const papers = collection.items
    .map((id) => byId.get(id))
    .filter((p): p is api.ZoteroItem => !!p)
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  return (
    <li>
      <Folder
        name={collection.name}
        icon={expanded ? mdiFolderOpenOutline : mdiFolderOutline}
        depth={depth}
        expanded={expanded}
        onToggle={() => setExpanded(!expanded)}
        onMenu={(at) => rows.onMenu(collectionId(library, collection), collection.name, at)}
      />
      {expanded && (
        <ul>
          {library.collections
            .filter((c) => c.parent === collection.key)
            .map((inside) => (
              <CollectionNode key={inside.key} collection={inside} library={library} byId={byId} depth={depth + 1} {...rows} />
            ))}
          {papers.map((paper) => (
            <Paper key={paper.id} paper={paper} depth={depth + 1} {...rows} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Folder({
  name,
  icon,
  depth,
  expanded,
  onToggle,
  onMenu,
}: {
  name: string;
  icon: string;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  onMenu: (at: { x: number; y: number }) => void;
}) {
  return (
    <button
      aria-expanded={expanded}
      onClick={onToggle}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
      className={`${row} w-full text-left hover:bg-neutral-100`} style={{ paddingLeft: indent(depth) }}>
      <Icon path={mdiChevronRight} size="14px" className={`shrink-0 text-neutral-400 transition-transform ${expanded ? "rotate-90" : ""}`} />
      <Icon path={icon} size="16px" className="shrink-0 text-neutral-500" />
      <span className="truncate">{name}</span>
    </button>
  );
}

function Paper({ paper, depth, highlightedPath, onOpen }: Pick<Rows, "highlightedPath" | "onOpen"> & { paper: api.ZoteroItem; depth: number }) {
  const name = [paper.title, shortAuthors(paper.authors), paper.year].filter(Boolean).join(", ");
  const details = [paper.authors.join(", "), paper.year].filter(Boolean).join(" · ");
  const title = details ? `${paper.title}\n${details}` : paper.title;
  const current = zoteroPath(paper.id) === highlightedPath;
  const label = (
    <>
      <span className="size-3.5 shrink-0" />
      <Icon path={paper.pdf ? mdiFilePdfBox : mdiFileDocumentOutline} size="16px" className="shrink-0 text-neutral-400" />
      <span className="truncate">{paper.title}</span>
    </>
  );
  return (
    <li aria-current={current ? "true" : undefined} className={`rounded-md ${current ? "bg-neutral-100" : ""}`}>
      {paper.pdf ? (
        <button
          aria-label={name}
          title={title}
          onClick={(event) => onOpen(paper, event.metaKey || event.ctrlKey)}
          className={`${row} w-full text-left hover:bg-neutral-100`}
          style={{ paddingLeft: indent(depth) }}
        >
          {label}
        </button>
      ) : (
        <div aria-description="No PDF in Zotero" title={title} className={`${row} text-neutral-400`} style={{ paddingLeft: indent(depth) }}>
          {label}
        </div>
      )}
    </li>
  );
}

const row = "flex items-center gap-1.5 rounded-md py-1 pr-2 text-sm text-neutral-700";

const indent = (depth: number) => `${0.25 + depth * 0.875}rem`;

/**
 * The Library's settings: every library and collection, with a box to show it. In a hidden one,
 * what's inside can't be ticked on its own. Done, Escape or a click elsewhere closes them.
 */
function LibrarySettings({
  at,
  libraries,
  hidden,
  onShow,
  onHide,
  onClose,
}: {
  at: { x: number; y: number };
  libraries: ZLibrary[];
  hidden: string[];
  onShow: (id: string) => void;
  onHide: (id: string) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
    }
    function onMouseDown(event: MouseEvent) {
      if (!panel.current?.contains(event.target as Node)) close.current();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, []);

  const box = (id: string, name: string, depth: number, within: boolean) => {
    const showing = !hidden.includes(id);
    return (
      <label key={id} className={`flex items-center gap-2 rounded-md py-1 pr-2 ${within ? "text-neutral-800" : "text-neutral-400"}`} style={{ paddingLeft: `${0.5 + depth}rem` }}>
        <input
          type="checkbox"
          aria-label={name}
          checked={showing}
          disabled={!within}
          onChange={() => (showing ? onHide(id) : onShow(id))}
          className="accent-neutral-700"
        />
        <span className="truncate">{name}</span>
      </label>
    );
  };
  const collections = (library: ZLibrary, parent: string | null, depth: number, within: boolean): ReactNode[] =>
    library.collections
      .filter((c) => c.parent === parent)
      .flatMap((c) => {
        const id = collectionId(library, c);
        return [box(id, c.name, depth, within), ...collections(library, c.key, depth + 1, within && !hidden.includes(id))];
      });

  // (Kept inside the window.)
  const left = Math.max(8, Math.min(at.x, window.innerWidth - 296));
  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Library settings"
      style={{ left, top: at.y + 4 }}
      className="fixed z-50 flex max-h-[60vh] w-72 flex-col rounded-lg bg-white text-sm shadow-[0_4px_24px_rgba(0,0,0,0.16)] ring-1 ring-neutral-200"
    >
      <p className="px-3 pt-2.5 pb-1 text-[11px] tracking-wide text-neutral-400 uppercase">Show in the Library</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
        {libraries.map((library) => {
          const within = !hidden.includes(library.id);
          return [box(library.id, library.name, 0, true), ...collections(library, null, 1, within)];
        })}
      </div>
      <div className="flex justify-end border-t border-neutral-100 px-2 py-1.5">
        <button onClick={onClose} className="rounded-md px-2.5 py-1 text-sm text-neutral-700 hover:bg-neutral-100">
          Done
        </button>
      </div>
    </div>,
    document.body,
  );
}

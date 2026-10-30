import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { ExplorerLayout, FileEntry, NoteFormat, Workspace } from "../api";
import { FileExplorer } from "../explorer/FileExplorer";
import { TopBar } from "./TopBar";

export function WorkspaceScreen({ workspace }: { workspace: Workspace }) {
  const [layout, setLayout] = useState<ExplorerLayout | null>(null);
  // Mirrors `layout`, so menu events always change the latest layout.
  const layoutRef = useRef<ExplorerLayout | null>(null);
  const [hovering, setHovering] = useState(false);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [filesError, setFilesError] = useState<string>();
  const [newNotePath, setNewNotePath] = useState<string>();
  const [problem, setProblem] = useState<string>();

  async function loadFiles() {
    try {
      setFiles(await api.listFiles());
      setFilesError(undefined);
    } catch (error) {
      setFilesError(String(error));
    }
  }

  useEffect(() => {
    loadFiles();
  }, []);

  async function newNote(format?: NoteFormat) {
    try {
      const path = format ? await api.createNote(format) : await api.createNote();
      setProblem(undefined);
      setNewNotePath(path);
      await loadFiles();
    } catch (error) {
      setProblem(`Couldn't create the note: ${error}`);
    }
  }

  function showLayout(next: ExplorerLayout) {
    layoutRef.current = next;
    setLayout(next);
  }

  useEffect(() => {
    api.getExplorerLayout().then(showLayout, () => showLayout({ side: "left", mode: "pinned" }));
  }, []);

  function changeLayout(change: (current: ExplorerLayout) => ExplorerLayout) {
    if (!layoutRef.current) return;
    const next = change(layoutRef.current);
    showLayout(next);
    api.saveExplorerLayout(next).catch(console.error);
  }

  const togglePinned = () =>
    changeLayout((l) => ({ ...l, mode: l.mode === "pinned" ? "auto-hide" : "pinned" }));
  const moveToOtherSide = () =>
    changeLayout((l) => ({ ...l, side: l.side === "left" ? "right" : "left" }));

  useEffect(() => {
    const unlisten = api.onMenuAction((action) => {
      if (action === "new-note") newNote();
      if (action === "new-markdown-note") newNote("markdown");
      if (action === "toggle-explorer-pinned") togglePinned();
      if (action === "move-explorer-to-other-side") moveToOtherSide();
    });
    return () => {
      unlisten.then((stopListening) => stopListening());
    };
  }, []);

  // Don't show anything until we know where the explorer goes, so it doesn't jump.
  if (!layout) return null;

  const explorerProps = {
    layout,
    files,
    error: filesError,
    highlightedPath: newNotePath,
    onTogglePinned: togglePinned,
    onNewNote: () => newNote(),
  };

  return (
    <div className="flex h-screen flex-col bg-white">
      <TopBar
        workspaceName={workspace.name}
        explorerSide={layout.side}
        onExplorerSideChange={(side) => changeLayout((l) => ({ ...l, side }))}
      />
      <div
        className={`relative flex min-h-0 flex-1 ${layout.side === "right" ? "flex-row-reverse" : ""}`}
      >
        {layout.mode === "pinned" ? (
          <FileExplorer {...explorerProps} floating={false} visible />
        ) : (
          <div
            aria-label="Show file explorer"
            data-side={layout.side}
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
            className="relative z-10 h-full w-2 shrink-0"
          >
            {/* Always mounted so it can animate out and keeps its open folders. */}
            <FileExplorer {...explorerProps} floating visible={hovering} />
          </div>
        )}
        <main className="relative flex-1 overflow-auto p-6">
          {problem && (
            <p
              role="alert"
              className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-white px-4 py-2 text-sm text-red-600 shadow-[0_2px_12px_rgba(0,0,0,0.08)]"
            >
              {problem}
            </p>
          )}
        </main>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { ExplorerLayout, Workspace } from "../api";
import { FileExplorer } from "../explorer/FileExplorer";
import { TopBar } from "./TopBar";

export function WorkspaceScreen({ workspace }: { workspace: Workspace }) {
  const [layout, setLayout] = useState<ExplorerLayout | null>(null);
  // Mirrors `layout`, so menu events always change the latest layout.
  const layoutRef = useRef<ExplorerLayout | null>(null);
  const [hovering, setHovering] = useState(false);

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
      if (action === "toggle-explorer-pinned") togglePinned();
      if (action === "move-explorer-to-other-side") moveToOtherSide();
    });
    return () => {
      unlisten.then((stopListening) => stopListening());
    };
  }, []);

  // Don't show anything until we know where the explorer goes, so it doesn't jump.
  if (!layout) return null;

  const explorerProps = { layout, onTogglePinned: togglePinned };

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
        <main className="flex-1 overflow-auto p-6" />
      </div>
    </div>
  );
}

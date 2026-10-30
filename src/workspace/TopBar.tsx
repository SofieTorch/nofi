import { mdiPageLayoutSidebarLeft, mdiPageLayoutSidebarRight } from "@mdi/js";
import type { ExplorerLayout } from "../api";
import { IconButton } from "../ui/IconButton";
import { isMac } from "../ui/platform";

type Props = {
  workspaceName: string;
  explorerSide: ExplorerLayout["side"];
  onExplorerSideChange: (side: ExplorerLayout["side"]) => void;
};

export function TopBar({ workspaceName, explorerSide, onExplorerSideChange }: Props) {
  return (
    // data-tauri-drag-region lets the user move the window by dragging the bar.
    <header
      data-tauri-drag-region
      className={`relative flex h-10 shrink-0 items-center border-b border-neutral-200 bg-white pr-2 ${
        isMac ? "pl-20" : "pl-3"
      }`}
    >
      <h1 className="pointer-events-none absolute inset-x-0 text-center text-sm font-medium text-neutral-700">
        {workspaceName}
      </h1>
      <div className="relative ml-auto flex items-center gap-0.5">
        <IconButton
          icon={mdiPageLayoutSidebarLeft}
          label="Explorer on the left"
          pressed={explorerSide === "left"}
          onClick={() => onExplorerSideChange("left")}
        />
        <IconButton
          icon={mdiPageLayoutSidebarRight}
          label="Explorer on the right"
          pressed={explorerSide === "right"}
          onClick={() => onExplorerSideChange("right")}
        />
      </div>
    </header>
  );
}

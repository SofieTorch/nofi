import { mdiTuneVariant } from "@mdi/js";
import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import { IconButton } from "../ui/IconButton";
import { PageSettingsPopover } from "./PageSettingsPopover";

/** How long typing has to pause before the pages are drawn again. */
const REDRAW_DELAY_MS = 200;

type Props = {
  /** The note's current text (Typst). */
  text: string;
  /** The note's path in the workspace: it can use the workspace's files, like images. */
  path?: string;
  /** Called with a position in the text when a page is clicked. */
  onJump: (position: number) => void;
  /** Replaces the note's text, e.g. after a page setting changed. */
  onChangeText: (text: string) => void;
};

/**
 * The note drawn as real pages by Typst, like the PDF it would become. Redrawn as you type; if
 * the note has a mistake, the last good pages stay up with the mistake explained above them.
 */
export function PagesPane({ text, path, onJump, onChangeText }: Props) {
  const [pages, setPages] = useState<api.PagePicture[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [mistake, setMistake] = useState<string>();
  // Only the newest drawing counts, even if an older one finishes later.
  const latest = useRef(0);
  const firstDraw = useRef(true);

  useEffect(() => {
    const draw = () => {
      const drawing = ++latest.current;
      (path ? api.renderPages(text, path) : api.renderPages(text)).then(
        (drawn) => {
          if (drawing !== latest.current) return;
          setPages(drawn);
          setMistake(undefined);
        },
        (reason) => drawing === latest.current && setMistake(String(reason)),
      );
    };
    // Draw the first time straight away; after that, wait until typing pauses.
    if (firstDraw.current) {
      firstDraw.current = false;
      draw();
      return;
    }
    const timer = setTimeout(draw, REDRAW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, path]);

  async function jumpFromClick(index: number, event: React.MouseEvent<HTMLImageElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const page = pages[index];
    // The picture may be shown smaller or bigger than the page: convert pixels to points.
    const x = ((event.clientX - box.left) / box.width) * page.width;
    const y = ((event.clientY - box.top) / box.height) * page.height;
    const position = await api.pagePosition(index, x, y);
    if (position !== null) onJump(position);
  }

  return (
    <section aria-label="Pages" className="relative h-full overflow-auto bg-neutral-100">
      <div className="sticky top-0 z-10">
        <div className="flex justify-end px-2 pt-2" data-page-settings-button>
          <IconButton
            icon={mdiTuneVariant}
            label="Page settings"
            pressed={showSettings}
            onClick={() => setShowSettings(!showSettings)}
          />
        </div>
        {showSettings && (
          <PageSettingsPopover
            text={text}
            onChangeText={onChangeText}
            onClose={() => setShowSettings(false)}
          />
        )}
        {mistake && (
          <p role="alert" className="mx-3 mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {mistake}
          </p>
        )}
      </div>
      <div className="flex flex-col items-center gap-6 p-6">
        {pages.map((page, index) => (
          <img
            key={index}
            alt={`Page ${index + 1}`}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(page.svg)}`}
            onClick={(event) => jumpFromClick(index, event)}
            // Points to CSS pixels (96 / 72), but never wider than the pane.
            style={{ width: `min(100%, ${(page.width * 4) / 3}px)` }}
            className="cursor-text bg-white shadow-[0_1px_6px_rgba(0,0,0,0.08)]"
          />
        ))}
      </div>
    </section>
  );
}

/** Shown instead of pages for notes Typst can't draw. */
export function NoPages() {
  return (
    <section
      aria-label="Pages"
      className="flex h-full items-center justify-center bg-neutral-100 p-6 text-sm text-neutral-400"
    >
      Pages are only for Typst notes.
    </section>
  );
}

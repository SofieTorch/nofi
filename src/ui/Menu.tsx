import { Icon } from "@mdi/react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export type MenuItem = { label: string; icon?: string; danger?: boolean; run: () => void };

type Props = {
  /** What the menu is for (its accessible name). */
  label: string;
  /** Where it was opened (the mouse), in the window. */
  at: { x: number; y: number };
  items: MenuItem[];
  onClose: () => void;
};

/** A right-click menu: a small floating card at the mouse. Escape or a click elsewhere closes it. */
export function Menu({ label, at, items, onClose }: Props) {
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    function onMouseDown(event: MouseEvent) {
      if (!menu.current?.contains(event.target as Node)) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown, true);
    };
  }, [onClose]);

  // (In the page itself: what it was opened from can be moved off-screen with a transform.)
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const all = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
        const at = all.indexOf(document.activeElement as HTMLElement);
        all[(at + (event.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
      }}
      style={{ left: at.x, top: at.y }}
      className="fixed z-50 min-w-36 rounded-lg bg-white p-1 text-sm shadow-[0_2px_12px_rgba(0,0,0,0.12)]"
    >
      {items.map((item) => (
        <button
          key={item.label}
          role="menuitem"
          onClick={() => {
            onClose();
            item.run();
          }}
          className={`${itemStyle} ${item.danger ? "text-red-600" : "text-neutral-700"}`}
        >
          {item.icon && <Icon path={item.icon} size="15px" className={item.danger ? undefined : "text-neutral-500"} />}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}

export const itemStyle = "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left outline-none hover:bg-neutral-100 focus:bg-neutral-100";

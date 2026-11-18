import { mdiClose } from "@mdi/js";
import { useEffect, useId, useRef } from "react";
import type { BoardBackground, EditorSettings } from "../api";
import { IconButton } from "../ui/IconButton";

type Props = {
  settings: EditorSettings;
  onChange: (settings: EditorSettings) => void;
  onClose: () => void;
};

/** Settings for how the app behaves in every workspace, in a floating card over the window. */
export function SettingsDialog({ settings, onChange, onClose }: Props) {
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    card.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-[15vh]" onMouseDown={onClose}>
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-4 shadow-[0_4px_24px_rgba(0,0,0,0.12)] outline-none"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="settings-title" className="text-sm font-semibold text-neutral-800">
            Settings
          </h2>
          <IconButton icon={mdiClose} label="Close" onClick={onClose} />
        </div>
        <h3 className="mb-1 text-xs font-medium tracking-wide text-neutral-500 uppercase">Editor</h3>
        <Toggle
          label="Block handles"
          description="Show a handle beside each block, to drag it somewhere else."
          checked={settings.blockHandles}
          onChange={(blockHandles) => onChange({ ...settings, blockHandles })}
        />
        <h3 className="mt-3 mb-1 text-xs font-medium tracking-wide text-neutral-500 uppercase">Boards</h3>
        <Choice
          label="Background"
          options={[
            { value: "plain", label: "Plain" },
            { value: "grid", label: "Grid" },
          ]}
          value={settings.boardBackground}
          onChange={(boardBackground) => onChange({ ...settings, boardBackground })}
        />
      </div>
    </div>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 rounded-md py-2">
      <div>
        <div id={id} className="text-sm text-neutral-800">
          {label}
        </div>
        <div className="text-xs text-neutral-500">{description}</div>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-neutral-800" : "bg-neutral-300"}`}
      >
        <span
          className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-4" : ""
          }`}
        />
      </button>
    </div>
  );
}

/** One of a few options, side by side (like a segmented control). */
function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: BoardBackground; label: string }[];
  value: BoardBackground;
  onChange: (value: BoardBackground) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div id={id} className="text-sm text-neutral-800">
        {label}
      </div>
      <div role="radiogroup" aria-labelledby={id} className="flex rounded-md bg-neutral-100 p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            role="radio"
            aria-checked={option.value === value}
            onClick={() => onChange(option.value)}
            className={`rounded px-2.5 py-1 text-xs ${option.value === value ? "bg-white text-neutral-800 shadow-sm" : "text-neutral-500 hover:text-neutral-700"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

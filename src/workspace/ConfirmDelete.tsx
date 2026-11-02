import { useEffect, useId, useRef } from "react";

type Props = {
  /** The file's name, with its extension. */
  name: string;
  onDelete: () => void;
  onCancel: () => void;
};

/** Asks before deleting a file. Cancel is the safe choice, so it has the focus. */
export function ConfirmDelete({ name, onDelete, onCancel }: Props) {
  const title = useId();
  const description = useId();
  const cancel = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancel.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/10 pt-[20vh]" onMouseDown={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={title}
        aria-describedby={description}
        onMouseDown={(event) => event.stopPropagation()}
        className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-xl bg-white p-4 shadow-[0_4px_24px_rgba(0,0,0,0.12)]"
      >
        <h2 id={title} className="text-sm font-semibold break-words text-neutral-800">
          Delete “{name}”?
        </h2>
        <p id={description} className="mt-1 text-sm text-neutral-600">
          It will be moved to the Trash, where you can still get it back.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={cancel}
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-neutral-700 ring-1 ring-neutral-200 hover:bg-neutral-50"
          >
            Cancel
          </button>
          <button onClick={onDelete} className="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700">
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

import type { EditorView } from "@codemirror/view";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { Problem } from "../api";
import { currentProblems } from "./typstProblems";

type Props = {
  /** The note's problems from its last check (the list itself reads where they are now). */
  problems: Problem[];
  view: RefObject<EditorView | null>;
};

/** "2 problems" at the top of the note; opens a list of them with their fixes. */
export function ProblemsButton({ problems, view }: Props) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const hasErrors = problems.some((p) => p.severity === "error");

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  function goTo(position: number) {
    const editor = view.current;
    if (!editor) return;
    editor.dispatch({ selection: { anchor: position }, scrollIntoView: true });
    editor.focus();
    setOpen(false);
  }

  const listed = open && view.current ? currentProblems(view.current) : [];

  return (
    <div ref={container} className="sticky top-3 z-20 float-right mr-3">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className={`rounded-full px-2.5 py-0.5 text-xs shadow-[0_2px_8px_rgba(0,0,0,0.08)] ${
          hasErrors ? "bg-red-50 text-red-700 hover:bg-red-100" : "bg-amber-50 text-amber-700 hover:bg-amber-100"
        }`}
      >
        {problems.length} {problems.length === 1 ? "problem" : "problems"}
      </button>
      {open && (
        <ul
          aria-label="Problems"
          className="absolute top-8 right-0 w-80 rounded-xl bg-white p-1.5 text-sm shadow-[0_4px_20px_rgba(0,0,0,0.12)]"
        >
          {listed.map(({ from, problem, fixes }, index) => (
            <li
              key={index}
              className={`rounded-lg border-l-[3px] px-2.5 py-2 ${
                problem.severity === "error" ? "border-red-400" : "border-amber-400"
              }`}
            >
              <button type="button" onClick={() => goTo(from)} className="text-left text-neutral-800 hover:underline">
                {problem.message}
              </button>
              {problem.hints.map((hint) => (
                <p key={hint} className="mt-0.5 text-xs text-neutral-500">
                  {hint}
                </p>
              ))}
              {fixes.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {fixes.map((fix) => (
                    <button
                      key={fix.label}
                      type="button"
                      onClick={() => {
                        fix.apply();
                        setOpen(false);
                      }}
                      className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-800 hover:bg-neutral-200"
                    >
                      {fix.label}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

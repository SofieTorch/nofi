import { useEffect, useId, useRef, useState } from "react";
import { isMac } from "./platform";

/** Sent to a focused suggesting field (e.g. by Edit › Show Suggestions) to open its list. */
export const SHOW_SUGGESTIONS = "marginalia:show-suggestions";

/** Ctrl+Space, or ⌘I (Ctrl+I on Windows and Linux). */
export function isShowSuggestionsShortcut(event: { key: string; ctrlKey: boolean; metaKey: boolean }) {
  const mod = isMac ? event.metaKey : event.ctrlKey;
  return (event.ctrlKey && event.key === " ") || (mod && event.key.toLowerCase() === "i");
}

type Props = {
  label: string;
  value: string;
  onChange: (text: string) => void;
  /** The suggestions to show now (already narrowed down by the caller). */
  options: string[];
  /** What's being typed: with something typed, the first suggestion is ready for Enter. */
  query: string;
  onPick: (option: string) => void;
  /** Enter without a highlighted suggestion, or leaving the field. */
  onCommit: () => void;
  /** Escape when no suggestions are showing. */
  onCancel?: () => void;
  inputRef?: (input: HTMLInputElement | null) => void;
  placeholder?: string;
  className?: string;
};

/**
 * A text field with a list of suggestions under it (an ARIA combobox). Arrow keys move through
 * them, Enter or a click picks one, Escape closes the list. Anything else can still be typed.
 */
export function SuggestingInput({
  label,
  value,
  onChange,
  options,
  query,
  onPick,
  onCommit,
  onCancel,
  inputRef,
  placeholder,
  className,
}: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const showing = open && options.length > 0;
  const field = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = field.current;
    const show = () => setOpen(true);
    input?.addEventListener(SHOW_SUGGESTIONS, show);
    return () => input?.removeEventListener(SHOW_SUGGESTIONS, show);
  }, []);

  // Typing something highlights the best match; with nothing typed, nothing is highlighted.
  const optionsKey = options.join("\n");
  useEffect(() => setHighlighted(query ? 0 : -1), [optionsKey, query]);

  function pick(option: string) {
    setOpen(false);
    onPick(option);
  }

  return (
    <span className="cm-suggesting">
      <input
        ref={(input) => {
          field.current = input;
          inputRef?.(input);
        }}
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={`${id}-list`}
        aria-activedescendant={showing && highlighted >= 0 ? `${id}-${highlighted}` : undefined}
        spellCheck={false}
        placeholder={placeholder}
        value={value}
        className={className}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          onCommit();
        }}
        onKeyDown={(event) => {
          if (isShowSuggestionsShortcut(event)) {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            const step = event.key === "ArrowDown" ? 1 : -1;
            setHighlighted((h) => Math.max(0, Math.min(options.length - 1, h + step)));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (showing && highlighted >= 0) pick(options[highlighted]);
            else onCommit();
          } else if (event.key === "Escape") {
            if (showing) setOpen(false);
            else onCancel?.();
          }
        }}
      />
      {showing && (
        <ul role="listbox" id={`${id}-list`} aria-label={`Suggestions for ${label}`} className="cm-suggestions">
          {options.map((option, index) => (
            <li
              key={option}
              id={`${id}-${index}`}
              role="option"
              aria-selected={index === highlighted}
              // Keep the focus in the field while clicking.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(option)}
              onMouseEnter={() => setHighlighted(index)}
              className="cm-suggestion"
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { PageSetting, ReadPageSettings } from "../api";
import { loadFonts } from "./fonts";

type Props = {
  /** The note's current text. */
  text: string;
  /** Replaces the note's text with the changed one. */
  onChangeText: (text: string) => void;
  onClose: () => void;
};

const PAPERS: [string, string][] = [
  ["", "Default (A4)"],
  ["a4", "A4"],
  ["a5", "A5"],
  ["a3", "A3"],
  ["us-letter", "US Letter"],
  ["us-legal", "US Legal"],
];

/** Typst numbering patterns, with what they look like. */
const PAGE_NUMBERS: [string, string][] = [
  ["", "None"],
  ["1", "1, 2, 3"],
  ["1 / 1", "1 / 12"],
  ["- 1 -", "- 1 -"],
  ["i", "i, ii, iii"],
];

/** Languages for hyphenation and quotation marks (Typst's language codes). */
const LANGUAGES: [string, string][] = [
  ["en", "English"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["nl", "Dutch"],
  ["ca", "Catalan"],
  ["sv", "Swedish"],
  ["da", "Danish"],
  ["nb", "Norwegian"],
  ["fi", "Finnish"],
  ["pl", "Polish"],
  ["cs", "Czech"],
  ["ru", "Russian"],
  ["uk", "Ukrainian"],
  ["el", "Greek"],
  ["tr", "Turkish"],
  ["ja", "Japanese"],
  ["zh", "Chinese"],
  ["ko", "Korean"],
  ["ar", "Arabic"],
  ["he", "Hebrew"],
];


/**
 * The page settings the note's `#set` rules can have, as a small form. Each change is written
 * into the note straight away; settings written another way in the note's code are read-only.
 */
export function PageSettingsPopover({ text, onChangeText, onClose }: Props) {
  const [settings, setSettings] = useState<ReadPageSettings>({ values: {}, locked: [] });
  const [fontNames, setFontNames] = useState<string[]>([]);
  const [problem, setProblem] = useState<string>();
  const popover = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    api.readPageSettings(text).then((read) => current && setSettings(read), () => {});
    return () => {
      current = false;
    };
  }, [text]);

  useEffect(() => {
    loadFonts().then(setFontNames);
  }, []);

  // Escape, or a click anywhere else, closes it.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popover.current?.contains(target) && !(target as Element).closest?.("[data-page-settings-button]")) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [onClose]);

  async function change(setting: PageSetting) {
    try {
      onChangeText(await api.changePageSetting(text, setting));
      setProblem(undefined);
    } catch (reason) {
      setProblem(String(reason));
    }
  }

  const { values, locked } = settings;
  const isLocked = (name: string) => locked.includes(name);
  const paper = values.paper ?? "";
  const font = values.font ?? "";

  return (
    <div
      ref={popover}
      role="dialog"
      aria-label="Page settings"
      className="absolute top-10 right-3 z-20 max-h-[calc(100vh-7rem)] w-72 overflow-y-auto rounded-xl bg-white p-3 text-sm shadow-[0_4px_20px_rgba(0,0,0,0.12)]"
    >
      {problem && (
        <p role="alert" className="mb-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
          {problem}
        </p>
      )}
      <Field label="Paper" locked={isLocked("paper")}>
        <select
          aria-label="Paper"
          value={paper}
          disabled={isLocked("paper")}
          onChange={(e) => change({ setting: "paper", value: e.target.value || null })}
          className={control}
        >
          {PAPERS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
          {!PAPERS.some(([value]) => value === paper) && <option value={paper}>{paper}</option>}
        </select>
      </Field>
      <Field label="Orientation" locked={isLocked("landscape")}>
        <select
          aria-label="Orientation"
          value={values.landscape ? "landscape" : "portrait"}
          disabled={isLocked("landscape")}
          onChange={(e) => change({ setting: "landscape", value: e.target.value === "landscape" || null })}
          className={control}
        >
          <option value="portrait">Portrait</option>
          <option value="landscape">Landscape</option>
        </select>
      </Field>
      <Field label="Columns" locked={isLocked("columns")}>
        <select
          aria-label="Columns"
          value={String(values.columns ?? 1)}
          disabled={isLocked("columns")}
          onChange={(e) => {
            const columns = Number(e.target.value);
            change({ setting: "columns", value: columns === 1 ? null : columns });
          }}
          className={control}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={String(n)}>
              {n}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Margins (cm)" locked={isLocked("margin")}>
        <NumberField
          label="Margins (cm)"
          value={values.marginCm ?? null}
          disabled={isLocked("margin")}
          step={0.5}
          onCommit={(value) => change({ setting: "marginCm", value })}
        />
      </Field>
      <Field label="Font" locked={isLocked("font")}>
        <select
          aria-label="Font"
          value={font}
          disabled={isLocked("font")}
          onChange={(e) => change({ setting: "font", value: e.target.value || null })}
          className={control}
        >
          <option value="">Default (Libertinus Serif)</option>
          {font && !fontNames.includes(font) && <option value={font}>{font}</option>}
          {fontNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Text size (pt)" locked={isLocked("textSize")}>
        <NumberField
          label="Text size (pt)"
          value={values.textSizePt ?? null}
          disabled={isLocked("textSize")}
          step={0.5}
          onCommit={(value) => change({ setting: "textSizePt", value })}
        />
      </Field>
      <div className="my-2 h-px bg-neutral-100" />
      <Field label="Page numbers" locked={isLocked("pageNumbers")}>
        <select
          aria-label="Page numbers"
          value={values.pageNumbers ?? ""}
          disabled={isLocked("pageNumbers")}
          onChange={(e) => change({ setting: "pageNumbers", value: e.target.value || null })}
          className={control}
        >
          {PAGE_NUMBERS.map(([pattern, label]) => (
            <option key={pattern} value={pattern}>
              {label}
            </option>
          ))}
          {values.pageNumbers && !PAGE_NUMBERS.some(([p]) => p === values.pageNumbers) && (
            <option value={values.pageNumbers}>{values.pageNumbers}</option>
          )}
        </select>
      </Field>
      <Field label="Header" locked={isLocked("header")}>
        <TextField
          label="Header"
          value={values.header ?? null}
          disabled={isLocked("header")}
          onCommit={(value) => change({ setting: "header", value })}
        />
      </Field>
      <Field label="Footer" locked={isLocked("footer")}>
        <TextField
          label="Footer"
          value={values.footer ?? null}
          disabled={isLocked("footer")}
          onCommit={(value) => change({ setting: "footer", value })}
        />
      </Field>
      <div className="my-2 h-px bg-neutral-100" />
      <Field label="Justify text" locked={isLocked("justify")}>
        <input
          type="checkbox"
          aria-label="Justify text"
          checked={values.justify ?? false}
          disabled={isLocked("justify")}
          onChange={(e) => change({ setting: "justify", value: e.target.checked || null })}
        />
      </Field>
      <Field label="Line spacing (em)" locked={isLocked("lineSpacing")}>
        <NumberField
          label="Line spacing (em)"
          value={values.lineSpacingEm ?? null}
          disabled={isLocked("lineSpacing")}
          step={0.05}
          placeholder="0.65"
          onCommit={(value) => change({ setting: "lineSpacingEm", value })}
        />
      </Field>
      <Field label="First-line indent (em)" locked={isLocked("firstLineIndent")}>
        <NumberField
          label="First-line indent (em)"
          value={values.firstLineIndentEm ?? null}
          disabled={isLocked("firstLineIndent")}
          step={0.5}
          placeholder="None"
          onCommit={(value) => change({ setting: "firstLineIndentEm", value })}
        />
      </Field>
      <Field label="Language" locked={isLocked("language")}>
        <select
          aria-label="Language"
          value={values.language ?? ""}
          disabled={isLocked("language")}
          onChange={(e) => change({ setting: "language", value: e.target.value || null })}
          className={control}
        >
          <option value="">Default (English)</option>
          {LANGUAGES.map(([code, name]) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
          {values.language && !LANGUAGES.some(([code]) => code === values.language) && (
            <option value={values.language}>{values.language}</option>
          )}
        </select>
      </Field>
    </div>
  );
}

const control =
  "w-full rounded-md bg-neutral-100 px-2 py-1 text-neutral-800 outline-none focus:ring-1 focus:ring-neutral-300 disabled:text-neutral-400";

function Field({ label, locked, children }: { label: string; locked: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_1fr] items-center gap-2 py-1">
      <span className="text-neutral-500">{label}</span>
      <div>
        {children}
        {locked && <p className="mt-0.5 text-xs text-neutral-400">Set in the note's code</p>}
      </div>
    </div>
  );
}

/** Text written on Enter or when leaving the field; empty takes it away. */
function TextField({
  label,
  value,
  disabled,
  onCommit,
}: {
  label: string;
  value: string | null;
  disabled: boolean;
  onCommit: (value: string | null) => void;
}) {
  const saved = value ?? "";
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const commit = () => draft !== saved && onCommit(draft.trim() === "" ? null : draft);
  return (
    <input
      aria-label={label}
      placeholder="None"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={control}
    />
  );
}

/** A number typed in full before it's used: written on Enter or when leaving the field. */
function NumberField({
  label,
  value,
  disabled,
  step,
  placeholder = "Default",
  onCommit,
}: {
  label: string;
  value: number | null;
  disabled: boolean;
  step: number;
  placeholder?: string;
  onCommit: (value: number | null) => void;
}) {
  const saved = value === null ? "" : String(value);
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);

  function commit() {
    if (draft === saved) return;
    if (draft.trim() === "") return onCommit(null);
    const number = Number(draft);
    if (Number.isFinite(number) && number > 0) onCommit(number);
    else setDraft(saved);
  }

  return (
    <input
      type="number"
      aria-label={label}
      min={0}
      step={step}
      placeholder={placeholder}
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      className={control}
    />
  );
}

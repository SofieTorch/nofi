import {
  mdiChevronDown,
  mdiCodeTags,
  mdiFormatAlignCenter,
  mdiFormatAlignJustify,
  mdiFormatAlignLeft,
  mdiFormatAlignRight,
  mdiFormatBold,
  mdiFormatColorText,
  mdiFormatIndentDecrease,
  mdiFormatIndentIncrease,
  mdiFormatItalic,
  mdiFormatSize,
  mdiFormatStrikethroughVariant,
  mdiFormatUnderline,
  mdiLinkVariant,
  mdiMarker,
  mdiSigma,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import type { EditorView } from "@codemirror/view";
import { useEffect, useState } from "react";
import { isMac } from "../ui/platform";
import { loadFonts } from "./fonts";
import type { Format, Range } from "./formatting";
import {
  type BlockType,
  blockTypeAt,
  indent,
  type Option,
  optionsAt,
  setOption,
  type Style,
  type StyleEdit,
  stylesAt,
  toggleStyle,
  turnInto,
} from "./styles";

const mod = isMac ? "⌘" : "Ctrl+";
const shift = isMac ? "⇧" : "Shift+";

type StyleButton = { style: Style; label: string; icon: string; shortcut?: string };

/** The buttons always shown, for each format. */
const MAIN: Record<Format, StyleButton[]> = {
  typst: [
    { style: "bold", label: "Bold", icon: mdiFormatBold, shortcut: `${mod}B` },
    { style: "italic", label: "Italic", icon: mdiFormatItalic, shortcut: `${mod}I` },
    { style: "underline", label: "Underline", icon: mdiFormatUnderline, shortcut: `${mod}U` },
    { style: "strikethrough", label: "Strikethrough", icon: mdiFormatStrikethroughVariant, shortcut: `${mod}${shift}X` },
    { style: "highlight", label: "Highlight", icon: mdiMarker, shortcut: `${mod}${shift}H` },
  ],
  markdown: [
    { style: "bold", label: "Bold", icon: mdiFormatBold, shortcut: `${mod}B` },
    { style: "italic", label: "Italic", icon: mdiFormatItalic, shortcut: `${mod}I` },
    { style: "strikethrough", label: "Strikethrough", icon: mdiFormatStrikethroughVariant, shortcut: `${mod}${shift}X` },
    { style: "highlight", label: "Highlight", icon: mdiMarker, shortcut: `${mod}${shift}H` },
    { style: "code", label: "Code", icon: mdiCodeTags, shortcut: `${mod}E` },
  ],
};

const MORE: { style: Style; label: string }[] = [
  { style: "smallcaps", label: "Small capitals" },
  { style: "superscript", label: "Superscript" },
  { style: "subscript", label: "Subscript" },
  { style: "overline", label: "Overline" },
  { style: "uppercase", label: "Uppercase" },
  { style: "lowercase", label: "Lowercase" },
  { style: "footnote", label: "Footnote" },
];

/** Colours that look good on the page, like Notion's. Written as `rgb("#…")`. */
const TEXT_COLOURS: [string, string][] = [
  ["Grey", "#787774"],
  ["Brown", "#9f6b53"],
  ["Orange", "#d9730d"],
  ["Yellow", "#cb912f"],
  ["Green", "#448361"],
  ["Blue", "#337ea9"],
  ["Purple", "#9065b0"],
  ["Pink", "#c14c8a"],
  ["Red", "#d44c47"],
];
const HIGHLIGHT_COLOURS: [string, string][] = [
  ["Grey", "#f1f1ef"],
  ["Brown", "#f4eeee"],
  ["Orange", "#fbecdd"],
  ["Green", "#edf3ec"],
  ["Blue", "#e7f3f8"],
  ["Purple", "#f6f3f9"],
  ["Pink", "#faf1f5"],
  ["Red", "#fdebec"],
];
const typstColour = (hex: string) => `rgb("${hex}")`;

const BLOCK_TYPES: { type: BlockType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "heading-1", label: "Heading 1" },
  { type: "heading-2", label: "Heading 2" },
  { type: "heading-3", label: "Heading 3" },
  { type: "bulleted-list", label: "Bulleted list" },
  { type: "numbered-list", label: "Numbered list" },
  { type: "to-do-list", label: "To-do list" },
  { type: "quote", label: "Quote" },
  { type: "callout", label: "Callout" },
];

/** Sizes relative to the text around it. */
const SIZES: [string, string | null][] = [
  ["Small", "0.8em"],
  ["Default", null],
  ["Large", "1.25em"],
  ["Larger", "1.5em"],
  ["Huge", "2em"],
];

const ALIGNMENTS: { value: string; label: string; icon: string }[] = [
  { value: "left", label: "Align left", icon: mdiFormatAlignLeft },
  { value: "center", label: "Align centre", icon: mdiFormatAlignCenter },
  { value: "right", label: "Align right", icon: mdiFormatAlignRight },
];

type Props = { view: EditorView; format: Format; text: string; selection: Range };

/**
 * The bubble above selected text: the styles that can be applied, pressed if the text has them.
 * Colours, links and the less common styles open small panels under it.
 */
export function FormatToolbar({ view, format, text, selection }: Props) {
  const [panel, setPanel] = useState<"turn-into" | "more" | "colour" | "text" | "link" | "paragraph" | null>(null);
  const styles = stylesAt(text, format, selection);
  const options = optionsAt(text, format, selection);
  const blockType = blockTypeAt(text, format, selection);
  const alignment = ALIGNMENTS.find((a) => a.value === (options.align ?? "left")) ?? ALIGNMENTS[0];

  function apply(edit: StyleEdit | null) {
    if (!edit) return;
    view.dispatch({
      changes: edit.changes,
      selection: { anchor: edit.selection.from, head: edit.selection.to },
      userEvent: "input.format",
    });
    view.focus();
  }
  const toggle = (style: Style) => apply(toggleStyle(text, format, selection, style));
  const set = (option: Option, value: string | null) => apply(setOption(text, format, selection, option, value));
  const canToggle = (style: Style) => styles.includes(style) || toggleStyle(text, format, selection, style) !== null;
  const togglePanel = (which: typeof panel) => setPanel(panel === which ? null : which);

  const styleButton = ({ style, label, icon, shortcut }: StyleButton) => (
    <ToolbarButton
      key={style}
      label={label}
      icon={icon}
      title={shortcut ? `${label} (${shortcut})` : label}
      pressed={styles.includes(style)}
      disabled={!canToggle(style)}
      onClick={() => toggle(style)}
    />
  );

  return (
    <div
      role="toolbar"
      aria-label="Format"
      className="cm-format-toolbar"
      // Clicks keep the text selected, except in the link's address field.
      onMouseDown={(event) => {
        const field = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
        if (!field) event.preventDefault();
      }}
    >
      <div className="cm-format-buttons">
        <button
          type="button"
          aria-label="Turn into"
          title="Turn into"
          aria-haspopup="menu"
          aria-expanded={panel === "turn-into"}
          onClick={() => togglePanel("turn-into")}
          className="cm-turn-into"
        >
          {BLOCK_TYPES.find((b) => b.type === blockType)?.label}
          <Icon path={mdiChevronDown} size="14px" />
        </button>
        <span className="cm-format-separator" />
        {MAIN[format].map(styleButton)}
        {format === "markdown" && (
          <ToolbarButton
            label="Link"
            icon={mdiLinkVariant}
            pressed={panel === "link" || !!options.link}
            expanded={panel === "link"}
            onClick={() => togglePanel("link")}
          />
        )}
        {format === "typst" && (
          <>
            <ToolbarButton
              label="Colour"
              icon={mdiFormatColorText}
              title="Text and highlight colour"
              pressed={panel === "colour" || !!options.colour}
              expanded={panel === "colour"}
              onClick={() => togglePanel("colour")}
            />
            <ToolbarButton
              label="Text size and font"
              icon={mdiFormatSize}
              pressed={panel === "text" || !!options.size || !!options.font}
              expanded={panel === "text"}
              onClick={() => togglePanel("text")}
            />
            <ToolbarButton
              label="Link"
              icon={mdiLinkVariant}
              pressed={panel === "link" || !!options.link}
              expanded={panel === "link"}
              onClick={() => togglePanel("link")}
            />
            {styleButton({ style: "code", label: "Code", icon: mdiCodeTags, shortcut: `${mod}E` })}
            {styleButton({ style: "maths", label: "Maths", icon: mdiSigma })}
            <ToolbarButton
              label="More styles"
              icon={mdiChevronDown}
              pressed={panel === "more"}
              expanded={panel === "more"}
              popup="menu"
              onClick={() => togglePanel("more")}
            />
            <span className="cm-format-separator" />
            <ToolbarButton
              label="Paragraph"
              icon={styles.includes("justify") ? mdiFormatAlignJustify : alignment.icon}
              title="Alignment and indent"
              pressed={panel === "paragraph"}
              expanded={panel === "paragraph"}
              onClick={() => togglePanel("paragraph")}
            />
          </>
        )}
      </div>

      {panel === "turn-into" && (
        <div role="menu" aria-label="Turn into" className="cm-format-panel cm-format-menu">
          {BLOCK_TYPES.filter(({ type }) => format === "typst" || type !== "callout").map(({ type, label }) => (
            <button
              key={type}
              type="button"
              role="menuitemradio"
              aria-checked={blockType === type}
              onClick={() => apply(turnInto(text, format, selection, type))}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {panel === "text" && (
        <div role="dialog" aria-label="Text size and font" className="cm-format-panel cm-text-panel">
          <div role="group" aria-label="Text size" className="cm-sizes">
            {SIZES.map(([label, value]) => (
              <button
                key={label}
                type="button"
                aria-pressed={(options.size ?? null) === value}
                onClick={() => set("size", value)}
              >
                {label}
              </button>
            ))}
          </div>
          <FontPicker current={options.font} onPick={(font) => set("font", font)} />
        </div>
      )}

      {panel === "paragraph" && (
        <div role="group" aria-label="Paragraph" className="cm-format-panel cm-format-row">
          {ALIGNMENTS.map(({ value, label, icon }) => (
            <ToolbarButton
              key={value}
              label={label}
              icon={icon}
              pressed={(options.align ?? "left") === value}
              onClick={() => set("align", value)}
            />
          ))}
          <ToolbarButton
            label="Justify"
            icon={mdiFormatAlignJustify}
            pressed={styles.includes("justify")}
            onClick={() => toggle("justify")}
          />
          <span className="cm-format-separator" />
          <ToolbarButton
            label="Indent"
            icon={mdiFormatIndentIncrease}
            title={`Indent (${mod}])`}
            onClick={() => apply(indent(text, format, selection, "in"))}
          />
          <ToolbarButton
            label="Outdent"
            icon={mdiFormatIndentDecrease}
            title={`Outdent (${mod}[)`}
            disabled={indent(text, format, selection, "out") === null}
            onClick={() => apply(indent(text, format, selection, "out"))}
          />
        </div>
      )}

      {panel === "more" && (
        <div role="menu" aria-label="More styles" className="cm-format-panel cm-format-menu">
          {MORE.map(({ style, label }) => (
            <button
              key={style}
              type="button"
              role="menuitemcheckbox"
              aria-checked={styles.includes(style)}
              disabled={!canToggle(style)}
              onClick={() => toggle(style)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {panel === "colour" && (
        <div role="dialog" aria-label="Colours" className="cm-format-panel">
          <Palette
            name="Text colour"
            colours={TEXT_COLOURS}
            current={options.colour}
            onPick={(hex) => set("colour", hex === null ? null : typstColour(hex))}
          />
          <Palette
            name="Highlight colour"
            colours={HIGHLIGHT_COLOURS}
            current={options.highlight === "default" ? undefined : options.highlight}
            background
            onPick={(hex) => set("highlight", hex === null ? null : typstColour(hex))}
          />
        </div>
      )}

      {panel === "link" && (
        <LinkField
          current={options.link}
          onSave={(address) => set("link", address)}
          onRemove={() => set("link", null)}
          onCancel={() => {
            setPanel(null);
            view.focus();
          }}
        />
      )}
    </div>
  );
}

function FontPicker({ current, onPick }: { current?: string; onPick: (font: string | null) => void }) {
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    loadFonts().then(setFonts);
  }, []);
  return (
    <select
      aria-label="Font"
      value={current ?? ""}
      onChange={(event) => onPick(event.target.value || null)}
      className="cm-font-picker"
    >
      <option value="">Default font</option>
      {current && !fonts.includes(current) && <option value={current}>{current}</option>}
      {fonts.map((font) => (
        <option key={font} value={font}>
          {font}
        </option>
      ))}
    </select>
  );
}

function ToolbarButton({
  label,
  icon,
  title,
  pressed,
  expanded,
  popup,
  disabled,
  onClick,
}: {
  label: string;
  icon: string;
  title?: string;
  pressed?: boolean;
  /** For buttons that open a panel: whether it's open. */
  expanded?: boolean;
  popup?: "menu";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={title ?? label}
      aria-pressed={expanded === undefined ? pressed : undefined}
      aria-expanded={expanded}
      aria-haspopup={popup}
      data-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon path={icon} size="16px" />
    </button>
  );
}

function Palette({
  name,
  colours,
  current,
  background,
  onPick,
}: {
  name: string;
  colours: [string, string][];
  /** The colour the text has now, as written in Typst. */
  current?: string;
  background?: boolean;
  onPick: (hex: string | null) => void;
}) {
  return (
    <div role="group" aria-label={name} className="cm-palette">
      <span className="cm-palette-name">{name}</span>
      <div className="cm-palette-swatches">
        <button
          type="button"
          aria-label="Default"
          title="Default"
          aria-pressed={current === undefined}
          onClick={() => onPick(null)}
          className="cm-swatch"
          style={background ? { background: "#fef08a" } : { color: "#262626" }}
        >
          A
        </button>
        {colours.map(([label, hex]) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            aria-pressed={current === typstColour(hex)}
            onClick={() => onPick(hex)}
            className="cm-swatch"
            style={background ? { background: hex } : { color: hex }}
          >
            A
          </button>
        ))}
      </div>
    </div>
  );
}

function LinkField({
  current,
  onSave,
  onRemove,
  onCancel,
}: {
  current?: string;
  onSave: (address: string) => void;
  onRemove: () => void;
  onCancel: () => void;
}) {
  const [address, setAddress] = useState(current ?? "");
  // "typst.app" means "https://typst.app"; other kinds of address (mailto:…) are kept as typed.
  const complete = (typed: string) => (/^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : `https://${typed}`);
  return (
    <div className="cm-format-panel cm-link-panel">
      <input
        aria-label="Link address"
        autoFocus
        spellCheck={false}
        placeholder="Paste or type a link"
        value={address}
        onChange={(event) => setAddress(event.target.value)}
        onFocus={(event) => event.target.select()}
        onKeyDown={(event) => {
          // Keys typed here are for this field, not for the note under it.
          event.stopPropagation();
          if (event.key === "Enter") event.preventDefault();
          if (event.key === "Enter" && address.trim()) onSave(complete(address.trim()));
          if (event.key === "Escape") onCancel();
        }}
      />
      {current && (
        <button type="button" onClick={onRemove}>
          Remove link
        </button>
      )}
    </div>
  );
}

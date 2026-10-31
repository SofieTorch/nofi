import { mdiClose, mdiCodeBraces, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useEffect, useRef, useState } from "react";
import * as api from "../api";
import type { KnownProperty, Property, PropertyValue } from "../api";
import { SuggestingInput } from "../ui/SuggestingInput";
import type { Format } from "./formatting";

type Props = {
  format: Format;
  /** The properties block as written in the note, or null if the note has none. */
  block: string | null;
  /** Writes a new block into the note (empty text removes it). */
  onWrite: (block: string) => void;
  /** Shows the block as text in the editor instead of this table. */
  onEditAsText: () => void;
};

type Kind = PropertyValue["type"];
const KINDS: { kind: Exclude<Kind, "other">; label: string }[] = [
  { kind: "text", label: "Text" },
  { kind: "number", label: "Number" },
  { kind: "boolean", label: "Yes/No" },
  { kind: "date", label: "Date" },
  { kind: "list", label: "List" },
];

// The row to focus once the block has been rewritten (it may be drawn by a new table).
let focusAfterWrite: string | null = null;

/** A note's properties as an editable table, like Obsidian's. Any name, any kind of value. */
export function PropertiesTable({ format, block, onWrite, onEditAsText }: Props) {
  const [properties, setProperties] = useState<Property[] | null>(block === null ? [] : null);
  const [problem, setProblem] = useState<string>();
  const nameInputs = useRef(new Map<string, HTMLInputElement>());
  // Names and values the workspace's other notes use, for suggestions.
  const [known, setKnown] = useState<KnownProperty[]>([]);
  const loadKnown = () => api.suggestProperties().then(setKnown, () => {});
  useEffect(() => {
    loadKnown();
  }, []);

  useEffect(() => {
    if (block === null) {
      setProperties([]);
      return;
    }
    let current = true;
    api.parseProperties(format, block).then(
      (parsed) => {
        if (!current) return;
        setProperties(parsed);
        setProblem(undefined);
      },
      (reason) => current && setProblem(String(reason)),
    );
    return () => {
      current = false;
    };
  }, [format, block]);

  useEffect(() => {
    if (!focusAfterWrite || !properties) return;
    const input = nameInputs.current.get(focusAfterWrite);
    if (input) {
      input.focus();
      input.select();
      focusAfterWrite = null;
    }
  }, [properties]);

  async function write(next: Property[]) {
    try {
      onWrite(await api.writeProperties(format, next));
      loadKnown();
    } catch (reason) {
      setProblem(String(reason));
    }
  }

  const list = properties ?? [];
  const replace = (index: number, property: Property) =>
    write(list.map((p, i) => (i === index ? property : p)));

  function addProperty() {
    const taken = new Set(list.map((p) => p.key));
    let key = "property";
    for (let n = 2; taken.has(key); n++) key = `property ${n}`;
    focusAfterWrite = key;
    write([...list, { key, value: { type: "text", value: "" }, raw: null }]);
  }

  // A note without properties only gets a quiet button to add the first one.
  if (block === null) {
    return (
      <div className="cm-properties-empty">
        <button type="button" onClick={addProperty} className="cm-properties-add">
          <Icon path={mdiPlus} size="14px" />
          Add property
        </button>
      </div>
    );
  }

  return (
    <div role="group" aria-label="Properties" className="cm-properties">
      {problem && (
        <p role="alert" className="cm-properties-problem">
          {problem}
        </p>
      )}
      {list.map((property, index) => (
        <div key={`${index}-${property.key}`} className="cm-property">
          <NameField
            property={property}
            known={known.filter((k) => !list.some((p) => p.key === k.key))}
            inputRef={(input) => {
              if (input) nameInputs.current.set(property.key, input);
              else nameInputs.current.delete(property.key);
            }}
            onRename={(key, kind) => {
              // A name chosen for a still-empty value gets the type that name usually has.
              const value = kind && isEmpty(property.value) ? convert(property.value, kind) : property.value;
              replace(index, { ...property, key, value, raw: null });
            }}
          />
          {property.value.type === "other" ? (
            <code className="cm-property-raw" title="Edit as text to change this">
              {rawValue(property)}
            </code>
          ) : (
            <>
              <ValueField
                name={property.key}
                suggestions={known.find((k) => k.key === property.key)?.values ?? []}
                value={property.value}
                onChange={(value) => replace(index, { ...property, value, raw: null })}
              />
              <select
                aria-label={`Type of ${property.key}`}
                value={KINDS.find((k) => k.kind === property.value.type)?.label}
                onChange={(event) => {
                  const kind = KINDS.find((k) => k.label === event.target.value)!.kind;
                  replace(index, { ...property, value: convert(property.value, kind), raw: null });
                }}
                className="cm-property-type"
              >
                {KINDS.map(({ label }) => (
                  <option key={label}>{label}</option>
                ))}
              </select>
            </>
          )}
          <button
            type="button"
            aria-label={`Remove ${property.key}`}
            title="Remove"
            onClick={() => write(list.filter((_, i) => i !== index))}
            className="cm-property-remove"
          >
            <Icon path={mdiClose} size="14px" />
          </button>
        </div>
      ))}
      <div className="cm-properties-footer">
        <button type="button" onClick={addProperty} className="cm-properties-add">
          <Icon path={mdiPlus} size="14px" />
          Add property
        </button>
        <button
          type="button"
          aria-label="Edit properties as text"
          title="Edit as text"
          onClick={onEditAsText}
          className="cm-properties-add"
        >
          <Icon path={mdiCodeBraces} size="14px" />
        </button>
      </div>
    </div>
  );
}

/** Commits on Enter or when leaving the field, not on every key. */
function useDraft(saved: string, commit: (text: string) => void) {
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const done = () => {
    if (draft !== saved) commit(draft);
  };
  return {
    value: draft,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value),
    onBlur: done,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") done();
      if (event.key === "Escape") setDraft(saved);
    },
  };
}

function NameField({
  property,
  known,
  inputRef,
  onRename,
}: {
  property: Property;
  /** Names other notes use that this note doesn't have yet. */
  known: KnownProperty[];
  inputRef: (input: HTMLInputElement | null) => void;
  onRename: (key: string, kind?: KnownProperty["kind"]) => void;
}) {
  const [draft, setDraft] = useState(property.key);
  // Until something is typed, every suggestion shows (e.g. for a new "property").
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    setDraft(property.key);
    setTyped(false);
  }, [property.key]);

  const query = typed ? draft.trim().toLowerCase() : "";
  const options = known.map((k) => k.key).filter((key) => key.toLowerCase().includes(query));

  function rename(name: string) {
    const key = name.trim();
    if (key && key !== property.key) onRename(key, known.find((k) => k.key === key)?.kind);
  }

  return (
    <SuggestingInput
      label={`Name of ${property.key}`}
      value={draft}
      onChange={(text) => {
        setDraft(text);
        setTyped(true);
      }}
      options={options}
      query={query}
      onPick={(name) => {
        setDraft(name);
        rename(name);
      }}
      onCommit={() => rename(draft)}
      onCancel={() => {
        setDraft(property.key);
        setTyped(false);
      }}
      inputRef={inputRef}
      className="cm-property-name"
    />
  );
}

function ValueField({
  name,
  value,
  suggestions,
  onChange,
}: {
  name: string;
  value: Exclude<PropertyValue, { type: "other" }>;
  /** Values this property has in other notes. */
  suggestions: string[];
  onChange: (value: PropertyValue) => void;
}) {
  const text = value.type === "list" ? value.value.join(", ") : String(value.value);
  const draft = useDraft(text, (typed) => {
    if (value.type === "number") {
      const number = Number(typed);
      if (typed.trim() !== "" && Number.isFinite(number)) onChange({ type: "number", value: number });
    } else if (value.type === "list") {
      onChange({ type: "list", value: splitList(typed) });
    } else if (value.type === "text") {
      onChange({ type: "text", value: typed });
    }
  });

  switch (value.type) {
    case "boolean":
      return (
        <span className="cm-property-value">
          <input
            type="checkbox"
            aria-label={name}
            checked={value.value}
            onChange={(event) => onChange({ type: "boolean", value: event.target.checked })}
          />
        </span>
      );
    case "date":
      return (
        <input
          type="date"
          aria-label={name}
          value={value.value}
          onChange={(event) => event.target.value && onChange({ type: "date", value: event.target.value })}
          className="cm-property-value"
        />
      );
    case "number":
      return <input type="number" aria-label={name} className="cm-property-value" {...draft} />;
    case "list":
      return <ListField name={name} items={value.value} suggestions={suggestions} onChange={onChange} />;
    case "text":
      return <TextField name={name} text={value.value} suggestions={suggestions} onChange={onChange} />;
  }
}

function TextField({
  name,
  text,
  suggestions,
  onChange,
}: {
  name: string;
  text: string;
  suggestions: string[];
  onChange: (value: PropertyValue) => void;
}) {
  const [draft, setDraft] = useState(text);
  const [typed, setTyped] = useState(false);
  useEffect(() => {
    setDraft(text);
    setTyped(false);
  }, [text]);
  const query = typed ? draft.trim().toLowerCase() : "";
  const options = suggestions.filter((v) => v !== draft && v.toLowerCase().includes(query));
  const save = (value: string) => value !== text && onChange({ type: "text", value });

  return (
    <SuggestingInput
      label={name}
      value={draft}
      placeholder="Empty"
      onChange={(typedText) => {
        setDraft(typedText);
        setTyped(true);
      }}
      options={options}
      query={query}
      onPick={(value) => {
        setDraft(value);
        save(value);
      }}
      onCommit={() => save(draft)}
      onCancel={() => setDraft(text)}
      className="cm-property-value"
    />
  );
}

/** Items separated by commas; suggestions are for the item being typed (after the last comma). */
function ListField({
  name,
  items,
  suggestions,
  onChange,
}: {
  name: string;
  items: string[];
  suggestions: string[];
  onChange: (value: PropertyValue) => void;
}) {
  const saved = items.join(", ");
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);

  const lastComma = draft.lastIndexOf(",");
  const current = draft.slice(lastComma + 1).trim();
  const others = splitList(draft.slice(0, Math.max(lastComma, 0)));
  const options = suggestions.filter(
    (v) => !others.includes(v) && v !== current && v.toLowerCase().includes(current.toLowerCase()),
  );
  const save = (text: string) => {
    const next = splitList(text);
    if (next.join(", ") !== saved) onChange({ type: "list", value: next });
  };

  return (
    <SuggestingInput
      label={name}
      value={draft}
      placeholder="item, item…"
      onChange={setDraft}
      options={options}
      query={current}
      // Replace the item being typed and get ready for the next one.
      onPick={(item) => setDraft(`${lastComma >= 0 ? `${draft.slice(0, lastComma + 1)} ` : ""}${item}, `)}
      onCommit={() => save(draft)}
      onCancel={() => setDraft(saved)}
      className="cm-property-value"
    />
  );
}

const isEmpty = (value: PropertyValue) =>
  (value.type === "text" && value.value.trim() === "") || (value.type === "list" && value.value.length === 0);

/** How the value is written, without the name in front of it. */
function rawValue({ key, raw }: Property) {
  const text = raw ?? "";
  const named = new RegExp(`^\\s*("?)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\1\\s*:\\s*`);
  return text.replace(named, "");
}

const splitList = (text: string) =>
  text
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

/** Keeps as much of the value as makes sense when its kind changes. */
function convert(value: PropertyValue, kind: Exclude<Kind, "other">): PropertyValue {
  const text =
    value.type === "list" ? value.value.join(", ") : "value" in value ? String(value.value) : "";
  switch (kind) {
    case "text":
      return { type: "text", value: text };
    case "number": {
      const number = Number(text);
      return { type: "number", value: Number.isFinite(number) && text !== "" ? number : 0 };
    }
    case "boolean":
      return { type: "boolean", value: ["true", "yes", "1"].includes(text.toLowerCase()) };
    case "date":
      return {
        type: "date",
        value: /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : new Date().toISOString().slice(0, 10),
      };
    case "list":
      return { type: "list", value: splitList(text) };
  }
}

// A fake of the backend's properties reading and writing, for editor tests. It understands
// simple `key: value` lines (in a `---` block, or a #metadata block for Typst) and, like the real
// one, writes unchanged properties back exactly as they were. The real formats are specified in
// src-tauri/tests/note_properties.rs.

import { vi } from "vitest";
import * as api from "../../src/api";

function valueOf(text: string): api.PropertyValue {
  if (text === "true" || text === "false") return { type: "boolean", value: text === "true" };
  if (/^-?\d+(\.\d+)?$/.test(text)) return { type: "number", value: Number(text) };
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { type: "date", value: text };
  if (text.startsWith("[")) {
    const items = text.slice(1, -1).split(",").map((item) => item.trim());
    return { type: "list", value: items.filter(Boolean) };
  }
  if (text.startsWith("{")) return { type: "other" };
  return { type: "text", value: text };
}

function textOf(value: api.PropertyValue): string {
  switch (value.type) {
    case "list":
      return `[${value.value.join(", ")}]`;
    case "other":
      return "{}";
    default:
      return String(value.value);
  }
}

export function useFakeProperties() {
  vi.mocked(api.parseProperties).mockImplementation(async (_format, block) =>
    block
      .split("\n")
      .slice(1, -1)
      .map((line) => {
        const [key, ...rest] = line.split(": ");
        return { key, value: valueOf(rest.join(": ")), raw: line };
      }),
  );
  vi.mocked(api.writeProperties).mockImplementation(async (format, properties) => {
    if (properties.length === 0) return "";
    const lines = properties.map((p) => p.raw ?? `${p.key}: ${textOf(p.value)}`);
    return format === "markdown"
      ? `---\n${lines.join("\n")}\n---`
      : `#metadata((\n${lines.join("\n")}\n)) <properties>`;
  });
}

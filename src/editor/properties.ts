// Where a note's properties block is: the `---` frontmatter at the very top of a Markdown note,
// or `#metadata((…)) <properties>` at the very top of a Typst note. (The backend reads and writes
// what's inside; the editor only needs to know where it is, quickly, while you type.)

import type { Format, Range } from "./formatting";

export function findPropertiesBlock(text: string, format: Format): Range | null {
  return format === "markdown" ? findFrontmatter(text) : findMetadata(text);
}

function findFrontmatter(text: string): Range | null {
  const firstLineEnd = text.indexOf("\n");
  if (firstLineEnd === -1 || text.slice(0, firstLineEnd).replace(/\r$/, "") !== "---") return null;
  let offset = firstLineEnd + 1;
  for (const line of text.slice(offset).split("\n")) {
    const content = line.replace(/\r$/, "");
    if (content === "---" || content === "...") return { from: 0, to: offset + content.length };
    offset += line.length + 1;
  }
  return null;
}

function findMetadata(text: string): Range | null {
  const start = "#metadata(";
  if (!text.startsWith(start)) return null;
  // Find the matching ")", skipping brackets inside "strings".
  let depth = 0;
  for (let i = start.length - 1; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (char === "(") {
      depth++;
    } else if (char === ")" && --depth === 0) {
      const label = /^[ \t]*<properties>/.exec(text.slice(i + 1));
      return label ? { from: 0, to: i + 1 + label[0].length } : null;
    }
  }
  return null;
}

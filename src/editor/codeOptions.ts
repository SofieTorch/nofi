// Writing a code block's options (line numbers, highlighted lines) into the note. Markdown puts
// them after the language (```python {2-4} showLineNumbers); Typst wraps the block in #[ … ] with
// one show rule, so they show in the pages too. Every Typst result in
// tests/fixtures/code-options.json is checked by the Rust tests to be valid Typst.

import type { Format, Span } from "./formatting";

export type CodeOptions = { numbers: boolean; highlights: number[] };

/** Runs of consecutive line numbers, like [[1, 3], [5, 5]] for 1, 2, 3, 5. */
function runs(lines: number[]): [number, number][] {
  const sorted = [...new Set(lines)].sort((a, b) => a - b);
  const found: [number, number][] = [];
  for (const line of sorted) {
    const last = found[found.length - 1];
    if (last && line === last[1] + 1) last[1] = line;
    else found.push([line, line]);
  }
  return found;
}

const HIGHLIGHT = 'highlight(fill: rgb("#fff3bf"), it.body)';
const NUMBER = "#box(width: 2em, text(fill: luma(150), str(it.number)))";

/** The Typst rule for these options. */
function typstRule({ numbers, highlights }: CodeOptions): string {
  const items = runs(highlights).flatMap(([a, b]) =>
    b - a >= 2 ? [`..range(${a}, ${b + 1})`] : Array.from({ length: b - a + 1 }, (_, k) => String(a + k)),
  );
  // A one-number array needs its comma: (2,).
  const list = items.length === 1 && !items[0].startsWith("..") ? `${items[0]},` : items.join(", ");
  const line = highlights.length > 0 ? `if it.number in (${list}) [#${HIGHLIGHT}] else [#it.body]` : null;
  if (numbers && line) return `#show raw.line: it => [${NUMBER}#${line}]`;
  if (numbers) return `#show raw.line: it => [${NUMBER}#it.body]`;
  return `#show raw.line: it => ${line}`;
}

/** The change to the note that gives the code block these options. */
export function setCodeOptions(text: string, format: Format, block: Span, options: CodeOptions) {
  const [open, close] = block.markers;
  const nothing = !options.numbers && options.highlights.length === 0;

  if (format === "markdown") {
    const ranges = runs(options.highlights)
      .map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`))
      .join(",");
    const fence = `\`\`\`${block.args ?? ""}${ranges ? ` {${ranges}}` : ""}${options.numbers ? " showLineNumbers" : ""}`;
    return { from: open.from, to: open.to, insert: fence };
  }

  const fenced = text.slice(open.from, close.to);
  const insert = nothing ? fenced : `#[\n${typstRule(options)}\n${fenced}\n]`;
  return { from: block.from, to: block.to, insert };
}

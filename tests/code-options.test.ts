// Line numbers and highlighted lines of code blocks: how they're written into the note and read
// back. The examples are in tests/fixtures/code-options.json, shared with the Rust tests, which
// check each Typst result is valid Typst (so they show in the pages too).

import { describe, expect, it } from "vitest";
import { type CodeOptions, setCodeOptions } from "../src/editor/codeOptions";
import { findFormatting, type Format } from "../src/editor/formatting";
import examples from "./fixtures/code-options.json";

const codeBlock = (text: string, format: Format) => findFormatting(text, format).find((s) => s.kind === "codeblock")!;

function apply(text: string, format: Format, options: CodeOptions) {
  const edit = setCodeOptions(text, format, codeBlock(text, format), options);
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

for (const format of ["typst", "markdown"] as const) {
  describe(`Code block options in ${format === "typst" ? "Typst" : "Markdown"} notes`, () => {
    for (const example of examples[format]) {
      it(`${example.name}: written`, () => {
        expect(apply(example.before, format, example.options)).toBe(example.after);
      });

      it(`${example.name}: read back`, () => {
        const block = codeBlock(example.after, format);
        expect({ numbers: block.numbers ?? false, highlights: block.highlights ?? [] }).toEqual(example.options);
        expect(block.args).toBe("python");
      });
    }
  });
}

describe("Reading a code block with options", () => {
  it("the whole wrapped block is one code block, from #[ to ]", () => {
    const text = examples.typst[0].after;
    const block = codeBlock(text, "typst");
    expect([block.from, block.to]).toEqual([0, text.length]);
  });

  it("a #[ … ] around a code block with other code isn't read as options", () => {
    const text = "#[\n#set text(red)\n```python\nx\n```\n]";
    const block = codeBlock(text, "typst");
    expect(block.from).toBe(text.indexOf("```"));
    expect(block.numbers).toBeUndefined();
  });

  it("only the language is the language in Markdown", () => {
    expect(codeBlock("```js {2} showLineNumbers\nx\n```", "markdown").args).toBe("js");
  });
});

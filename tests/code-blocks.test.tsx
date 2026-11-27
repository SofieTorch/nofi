// Code blocks like Obsidian's: a ``` block is a shaded box in a code font, its fences hidden unless
// the cursor is in it, with a language menu and a copy button in its corner, and the code highlighted.

import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const CODE = "def greet(name):\n    return name";
const NOTE = `Some text.\n\`\`\`python\n${CODE}\n\`\`\`\nAfter.`;

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": NOTE, "Todo.md": NOTE };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

async function openNote(name = "Paper.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name });
}

const codeLines = (editor: HTMLElement) => [...editor.querySelectorAll(".cm-codeblock")];

describe("Code blocks", () => {
  it("are shown as a box, with their fences hidden", async () => {
    const editor = await openNote();

    expect(codeLines(editor)).toHaveLength(4);
    expect(editor).toHaveTextContent("def greet(name):");
    expect(editor).not.toHaveTextContent("```");
  });

  it("start with their code: the fence lines take no room", async () => {
    notes["Paper.typ"] = "```\nplain code\n```";
    const editor = await openNote();

    const fences = editor.querySelectorAll(".cm-codeblock-fence");
    expect(fences).toHaveLength(2);
    // (After its line number, which shows on hover.)
    expect(editor.querySelector(".cm-codeblock-start")).toHaveTextContent(/^1?plain code$/);
  });

  it("say their language in the corner", async () => {
    const editor = await openNote();

    expect(within(editor).getByRole("button", { name: "Language" })).toHaveTextContent("Python");
  });

  it("without a language, say it's plain text", async () => {
    notes["Paper.typ"] = "```\nplain code\n```";
    const editor = await openNote();

    expect(within(editor).getByRole("button", { name: "Language" })).toHaveTextContent("Plain text");
  });

  it("have a button that copies the code", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const editor = await openNote();

    await userEvent.click(within(editor).getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith(CODE);
  });

  it("show their fences while the cursor is in them, to change the language", async () => {
    const editor = await openNote();
    const view = EditorView.findFromDOM(editor)!;

    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: NOTE.indexOf("greet") } });
    });

    expect(editor).toHaveTextContent("```python");
  });

  it("highlight the code for its language", async () => {
    const editor = await openNote();

    await vi.waitFor(() => expect(editor.querySelector(".tok-keyword")).toHaveTextContent("def"), { timeout: 3000 });
  });

  it("work the same in Markdown notes", async () => {
    const editor = await openNote("Todo.md");

    expect(codeLines(editor)).toHaveLength(4);
    expect(editor).not.toHaveTextContent("```");
  });

  it("nothing inside is formatted", async () => {
    notes["Paper.typ"] = "```\nx = 2 * 3 * 4\n```";
    const editor = await openNote();

    expect(editor.querySelector("strong")).toBeNull();
    expect(editor).toHaveTextContent("x = 2 * 3 * 4");
  });
});

// ↑ and ↓ inside a code block go line by line through the code, keeping the column (the browser's
// own way, which measures the screen, can be thrown off by the box's hidden fence lines).
describe("Moving through code with the arrows", () => {
  const LINES = "Before.\n```python\nfirst = 1\nsecond_line = 22\nx\nlast = 4\n```\nAfter.";
  async function cursorAt(part: string, offset = 0) {
    notes["Paper.typ"] = LINES;
    const editor = await openNote();
    const view = EditorView.findFromDOM(editor)!;
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: LINES.indexOf(part) + offset } });
    });
    return view;
  }
  const where = (view: EditorView) => {
    const head = view.state.selection.main.head;
    const line = view.state.doc.lineAt(head);
    return `${line.text}|${head - line.from}`;
  };

  it("↑ goes to the line above in the code, at the same column", async () => {
    const view = await cursorAt("second_line", 6);

    await userEvent.keyboard("{ArrowUp}");

    expect(where(view)).toBe("first = 1|6");
  });

  it("↓ goes to the line below in the code", async () => {
    const view = await cursorAt("first", 3);

    await userEvent.keyboard("{ArrowDown}");

    expect(where(view)).toBe("second_line = 22|3");
  });

  it("a shorter line on the way: the cursor stops at its end, and comes back to its column after", async () => {
    const view = await cursorAt("second_line", 10);

    await userEvent.keyboard("{ArrowDown}");
    expect(where(view)).toBe("x|1");

    await userEvent.keyboard("{ArrowDown}");
    expect(where(view)).toBe("last = 4|8");
  });

  it("with Shift, the selection grows line by line", async () => {
    const view = await cursorAt("x");

    await userEvent.keyboard("{Shift>}{ArrowUp}{/Shift}");

    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe("second_line = 22\n");
  });
});

describe("The language menu", () => {
  async function openMenu(editor: HTMLElement) {
    await userEvent.click(within(editor).getByRole("button", { name: "Language" }));
    return within(editor).findByRole("listbox", { name: "Languages" });
  }
  const fence = (editor: HTMLElement) => EditorView.findFromDOM(editor)!.state.doc.toString().split("\n")[1];

  it("lists every language, with plain text first", async () => {
    const editor = await openNote();

    const options = within(await openMenu(editor)).getAllByRole("option").map((o) => o.textContent);

    expect(options[0]).toBe("Plain text");
    for (const language of ["Python", "Rust", "JavaScript", "SQL"]) expect(options).toContain(language);
  });

  it("choosing one changes the code block's language", async () => {
    const editor = await openNote();
    const menu = await openMenu(editor);

    await userEvent.click(within(menu).getByRole("option", { name: "Rust" }));

    expect(fence(editor)).toBe("```rust");
  });

  it("typing narrows the list, and Enter picks the first match", async () => {
    const editor = await openNote();
    await openMenu(editor);

    await userEvent.keyboard("javas");
    const options = within(await within(editor).findByRole("listbox", { name: "Languages" })).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toContain("JavaScript");
    expect(options.length).toBeLessThan(5);
    await userEvent.keyboard("{Enter}");

    expect(fence(editor)).toBe("```javascript");
  });

  it("languages whose name starts with what's typed come first", async () => {
    const editor = await openNote();
    await openMenu(editor);

    await userEvent.keyboard("shell");

    const options = within(await within(editor).findByRole("listbox", { name: "Languages" })).getAllByRole("option");
    expect(options[0]).toHaveTextContent("Shell");
  });

  it("plain text takes the language away", async () => {
    const editor = await openNote();

    await userEvent.click(within(await openMenu(editor)).getByRole("option", { name: "Plain text" }));

    expect(fence(editor)).toBe("```");
  });

  it("Escape closes it without changing anything", async () => {
    const editor = await openNote();
    await openMenu(editor);

    await userEvent.keyboard("{Escape}");

    expect(within(editor).queryByRole("listbox", { name: "Languages" })).not.toBeInTheDocument();
    expect(fence(editor)).toBe("```python");
  });
});

describe("Line numbers and highlighted lines", () => {
  const WRAPPED = (rule: string) => `Intro.\n#[\n${rule}\n\`\`\`python\na = 1\nb = 2\nc = 3\n\`\`\`\n]\nAfter.`;
  const NUMBERS = "#show raw.line: it => [#box(width: 2em, text(fill: luma(150), str(it.number)))#it.body]";
  const text = (editor: HTMLElement) => EditorView.findFromDOM(editor)!.state.doc.toString();
  const lineNumber = (editor: HTMLElement, n: number) => within(editor).getByRole("button", { name: `Line ${n}` });

  it("the corner's Line numbers button numbers the lines", async () => {
    notes["Paper.typ"] = "```python\na = 1\nb = 2\n```";
    const editor = await openNote();

    await userEvent.click(within(editor).getByRole("button", { name: "Line numbers" }));

    expect(text(editor)).toContain("#show raw.line: it =>");
    expect(lineNumber(editor, 1)).toHaveTextContent("1");
    expect(within(editor).getByRole("button", { name: "Line numbers" })).toHaveAttribute("aria-pressed", "true");
  });

  it("the Typst that makes them work isn't shown, only the code", async () => {
    notes["Paper.typ"] = WRAPPED(NUMBERS);
    const editor = await openNote();

    expect(editor).not.toHaveTextContent("#show");
    expect(editor).not.toHaveTextContent("#[");
    expect(editor).toHaveTextContent("a = 1");
    expect(lineNumber(editor, 3)).toHaveTextContent("3");
  });

  it("clicking a line's number highlights it, and again un-highlights it", async () => {
    notes["Paper.typ"] = WRAPPED(NUMBERS);
    const editor = await openNote();

    await userEvent.click(lineNumber(editor, 2));
    expect(text(editor)).toContain("it.number in (2,)");
    expect(lineNumber(editor, 2).closest(".cm-line")).toHaveClass("cm-codeblock-highlighted");

    await userEvent.click(lineNumber(editor, 2));
    expect(text(editor)).not.toContain("it.number in");
  });

  it("Shift+click highlights every line from the last one clicked", async () => {
    notes["Paper.typ"] = WRAPPED(NUMBERS);
    const editor = await openNote();

    // One keyboard and mouse, so Shift stays held for the click.
    const user = userEvent.setup();
    await user.click(lineNumber(editor, 1));
    await user.keyboard("{Shift>}");
    await user.click(lineNumber(editor, 3));
    await user.keyboard("{/Shift}");

    expect(text(editor)).toContain("it.number in (..range(1, 4))");
  });

  it("Shift+click also works on a block whose numbers were just turned on", async () => {
    notes["Paper.typ"] = "```python\na = 1\nb = 2\nc = 3\nd = 4\n```";
    const editor = await openNote();
    const user = userEvent.setup();

    await user.click(within(editor).getByRole("button", { name: "Line numbers" }));
    await user.click(lineNumber(editor, 1));
    await user.keyboard("{Shift>}");
    await user.click(lineNumber(editor, 3));
    await user.keyboard("{/Shift}");

    expect(text(editor)).toContain("it.number in (..range(1, 4))");
  });

  it("Shift+click highlights a range on a block without line numbers, too", async () => {
    notes["Paper.typ"] = "```python\na = 1\nb = 2\nc = 3\nd = 4\n```";
    const editor = await openNote();
    const user = userEvent.setup();

    await user.click(lineNumber(editor, 2));
    await user.keyboard("{Shift>}");
    await user.click(lineNumber(editor, 4));
    await user.keyboard("{/Shift}");

    expect(text(editor)).toContain("it.number in (..range(2, 5))");
  });

  it("Shift+click works in Markdown notes", async () => {
    notes["Todo.md"] = "```python\na = 1\nb = 2\nc = 3\n```";
    const editor = await openNote("Todo.md");
    const user = userEvent.setup();

    await user.click(lineNumber(editor, 1));
    await user.keyboard("{Shift>}");
    await user.click(lineNumber(editor, 3));
    await user.keyboard("{/Shift}");

    expect(text(editor).split("\n")[0]).toBe("```python {1-3}");
  });

  it("Shift+click un-highlights a range when the first line clicked was un-highlighted", async () => {
    notes["Todo.md"] = "```python {1-5}\na = 1\nb = 2\nc = 3\nd = 4\ne = 5\n```";
    const editor = await openNote("Todo.md");
    const user = userEvent.setup();

    await user.click(lineNumber(editor, 2));
    await user.keyboard("{Shift>}");
    await user.click(lineNumber(editor, 4));
    await user.keyboard("{/Shift}");

    expect(text(editor).split("\n")[0]).toBe("```python {1,5}");
  });

  it("Shift+click with nothing clicked yet extends the nearest highlighted line", async () => {
    notes["Todo.md"] = "```python {2}\na = 1\nb = 2\nc = 3\nd = 4\n```";
    const editor = await openNote("Todo.md");
    const user = userEvent.setup();

    await user.keyboard("{Shift>}");
    await user.click(lineNumber(editor, 4));
    await user.keyboard("{/Shift}");

    expect(text(editor).split("\n")[0]).toBe("```python {2-4}");
  });

  it("a line is highlighted as soon as the mouse is pressed on its number", async () => {
    notes["Todo.md"] = "```python\na = 1\nb = 2\n```";
    const editor = await openNote("Todo.md");

    await userEvent.pointer({ keys: "[MouseLeft>]", target: lineNumber(editor, 2) });

    expect(text(editor).split("\n")[0]).toBe("```python {2}");
  });

  it("the number column is as wide as the longest number, with no room to spare", async () => {
    notes["Paper.typ"] = WRAPPED(NUMBERS);
    const editor = await openNote();

    expect(lineNumber(editor, 1).style.width).toBe("1ch");
  });

  it("numbers shown on hover are the code's size", async () => {
    notes["Paper.typ"] = "```python\na = 1\n```";
    const editor = await openNote();

    expect(getComputedStyle(lineNumber(editor, 1)).fontSize).not.toBe("0.8em");
  });

  it("without line numbers, the numbers still show on hover, to highlight lines", async () => {
    notes["Paper.typ"] = "```python\na = 1\nb = 2\n```";
    const editor = await openNote();

    expect(lineNumber(editor, 2)).toHaveClass("cm-codeblock-number-on-hover");
    await userEvent.click(lineNumber(editor, 2));

    expect(text(editor)).toContain("it.number in (2,)");
    expect(text(editor)).not.toContain("str(it.number)");
  });

  it("Markdown notes write them after the language", async () => {
    notes["Todo.md"] = "```python\na = 1\nb = 2\n```";
    const editor = await openNote("Todo.md");

    await userEvent.click(within(editor).getByRole("button", { name: "Line numbers" }));
    await userEvent.click(lineNumber(editor, 2));

    expect(text(editor).split("\n")[0]).toBe("```python {2} showLineNumbers");
  });
});

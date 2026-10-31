// The format toolbar: selecting text shows what can be applied to it (bold, italic, highlight…),
// with the styles it already has shown pressed; pressing one again removes it. How each style is
// written is specified in tests/text-styles.test.ts.

import { EditorView } from "@codemirror/view";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = {
    "Paper.typ": "Read more papers.\nA #highlight[key] idea.",
    "Todo.md": "Buy milk.",
  };
  vi.mocked(api.listFiles).mockResolvedValue(Object.keys(notes).map(file));
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
});

async function openNote(name = "Paper.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  const editor = await screen.findByRole("textbox", { name });
  return EditorView.findFromDOM(editor)!;
}

/** Selects `part` (the first time it appears in the note), like dragging over it. */
function select(view: EditorView, part: string) {
  const from = view.state.doc.toString().indexOf(part);
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: from, head: from + part.length } });
  });
}

const toolbar = () => screen.findByRole("toolbar", { name: "Format" });
const button = async (name: string) =>
  within(await toolbar()).getAllByRole("button", { name: new RegExp(`^${name}$`) })[0];
const text = (view: EditorView) => view.state.doc.toString();
const selected = (view: EditorView) => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);

describe("The format toolbar", () => {
  it("shows up when text is selected, with what can be applied to it", async () => {
    const view = await openNote();

    select(view, "more");

    const buttons = within(await toolbar()).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(buttons).toEqual([
      "Turn into",
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Highlight",
      "Colour",
      "Text size and font",
      "Link",
      "Code",
      "Maths",
      "More styles",
      "Paragraph",
    ]);
  });

  it("isn't there without a selection", async () => {
    const view = await openNote();

    act(() => view.dispatch({ selection: { anchor: 3 } }));

    expect(screen.queryByRole("toolbar", { name: "Format" })).not.toBeInTheDocument();
  });

  it("applies a style to the selected text, which stays selected", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.click(await button("Bold"));

    expect(text(view)).toBe("Read *more* papers.\nA #highlight[key] idea.");
    expect(selected(view)).toBe("more");
    expect(await button("Bold")).toHaveAttribute("aria-pressed", "true");
  });

  it("shows the styles the selected text already has as pressed", async () => {
    const view = await openNote();

    select(view, "key");

    expect(await button("Highlight")).toHaveAttribute("aria-pressed", "true");
    expect(await button("Bold")).toHaveAttribute("aria-pressed", "false");
  });

  it("pressing a style the text already has removes it", async () => {
    const view = await openNote();
    select(view, "key");

    await userEvent.click(await button("Highlight"));

    expect(text(view)).toBe("Read more papers.\nA key idea.");
    expect(selected(view)).toBe("key");
  });

  it("styles can't be applied where they wouldn't work, like code over several lines", async () => {
    const view = await openNote();

    select(view, "papers.\nA");

    expect(await button("Code")).toBeDisabled();
    expect(await button("Bold")).toBeEnabled();
  });

  it("Markdown notes get Markdown's styles", async () => {
    const view = await openNote("Todo.md");

    select(view, "milk");

    const buttons = within(await toolbar()).getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(buttons).toEqual(["Turn into", "Bold", "Italic", "Strikethrough", "Highlight", "Code", "Link"]);
  });
});

describe("Style shortcuts", () => {
  it("⌘B (Ctrl+B on Windows and Linux) makes the selection bold, and again removes it", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.keyboard("{Control>}b{/Control}");
    expect(text(view)).toContain("Read *more* papers.");

    await userEvent.keyboard("{Control>}b{/Control}");
    expect(text(view)).toContain("Read more papers.");
  });

  it("⌘I makes the selection italic", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.keyboard("{Control>}i{/Control}");

    expect(text(view)).toContain("Read _more_ papers.");
  });

  it("without a selection, ⌘I still shows suggestions", async () => {
    const view = await openNote();
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 4 } });
    });

    await userEvent.keyboard("{Control>}i{/Control}");

    await vi.waitFor(() => expect(api.completeTypst).toHaveBeenCalledWith(expect.any(String), 4, true));
    expect(text(view)).toBe(notes["Paper.typ"]);
  });

  it("the buttons say their shortcuts", async () => {
    const view = await openNote();
    select(view, "more");

    expect((await button("Bold")).title).toMatch(/Ctrl\+B|⌘B/);
  });
});

describe("More styles", () => {
  it("lists the less common styles, and applies the one chosen", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.click(await button("More styles"));
    const menu = await screen.findByRole("menu", { name: "More styles" });
    const items = within(menu).getAllByRole("menuitemcheckbox").map((item) => item.textContent);
    expect(items).toEqual(["Small capitals", "Superscript", "Subscript", "Overline", "Uppercase", "Lowercase", "Footnote"]);

    await userEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Superscript" }));

    expect(text(view)).toContain("Read #super[more] papers.");
  });

  it("shows the ones the text already has as checked", async () => {
    notes["Paper.typ"] = "Water is H#sub[2]O.";
    const view = await openNote();
    select(view, "2");

    await userEvent.click(await button("More styles"));

    const menu = await screen.findByRole("menu", { name: "More styles" });
    expect(within(menu).getByRole("menuitemcheckbox", { name: "Subscript" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("Colours", () => {
  it("gives text a colour from a palette", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.click(await button("Colour"));
    const palette = await screen.findByRole("group", { name: "Text colour" });
    await userEvent.click(within(palette).getByRole("button", { name: "Red" }));

    expect(text(view)).toContain('Read #text(fill: rgb("#d44c47"))[more] papers.');
    expect(selected(view)).toBe("more");
  });

  it("gives text a highlight colour", async () => {
    const view = await openNote();
    select(view, "key");

    await userEvent.click(await button("Colour"));
    const palette = await screen.findByRole("group", { name: "Highlight colour" });
    await userEvent.click(within(palette).getByRole("button", { name: "Blue" }));

    expect(text(view)).toContain('A #highlight(fill: rgb("#e7f3f8"))[key] idea.');
  });

  it("shows the current colour as pressed, and Default takes it away", async () => {
    notes["Paper.typ"] = 'A #text(fill: rgb("#d44c47"))[red] word.';
    const view = await openNote();
    select(view, "red");

    await userEvent.click(await button("Colour"));
    const palette = await screen.findByRole("group", { name: "Text colour" });
    expect(within(palette).getByRole("button", { name: "Red" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(within(palette).getByRole("button", { name: "Default" }));

    expect(text(view)).toBe("A red word.");
  });
});

describe("Links", () => {
  it("asks for the address, and links the selected text", async () => {
    const view = await openNote();
    select(view, "papers");

    await userEvent.click(await button("Link"));
    const address = await screen.findByRole("textbox", { name: "Link address" });
    await userEvent.type(address, "https://arxiv.org{Enter}");

    expect(text(view)).toContain('Read more #link("https://arxiv.org")[papers].');
  });

  it("an address typed without https:// gets it", async () => {
    const view = await openNote();
    select(view, "papers");

    await userEvent.click(await button("Link"));
    await userEvent.type(await screen.findByRole("textbox", { name: "Link address" }), "arxiv.org{Enter}");

    expect(text(view)).toContain('#link("https://arxiv.org")[papers]');
  });

  it("an existing link's address can be changed or removed", async () => {
    notes["Paper.typ"] = 'See #link("https://a.org")[docs].';
    const view = await openNote();
    select(view, "docs");

    await userEvent.click(await button("Link"));
    const address = await screen.findByRole("textbox", { name: "Link address" });
    expect(address).toHaveValue("https://a.org");
    await userEvent.click(screen.getByRole("button", { name: "Remove link" }));

    expect(text(view)).toBe("See docs.");
  });
});

/** A button in the Paragraph menu (alignment, justify, indent). */
async function paragraph(name: string) {
  if (!screen.queryByRole("group", { name: "Paragraph" })) await userEvent.click(await button("Paragraph"));
  return within(await screen.findByRole("group", { name: "Paragraph" })).getByRole("button", { name });
}

describe("Alignment", () => {
  it("centres the lines the selection is on", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.click(await paragraph("Align centre"));

    expect(text(view)).toBe("#align(center)[Read more papers.]\nA #highlight[key] idea.");
  });

  it("shows the current alignment as pressed; left is the default", async () => {
    notes["Paper.typ"] = "#align(right)[Title]\nText.";
    const view = await openNote();

    select(view, "Title");
    expect(await paragraph("Align right")).toHaveAttribute("aria-pressed", "true");

    select(view, "Text");
    expect(await paragraph("Align left")).toHaveAttribute("aria-pressed", "true");
  });

  it("justifies the lines the selection is on, and again un-justifies them", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.click(await paragraph("Justify"));
    expect(text(view)).toContain("#par(justify: true)[Read more papers.]");

    await userEvent.click(await paragraph("Justify"));
    expect(text(view)).toContain("Read more papers.\nA");
  });
});

describe("How styles look in the editor", () => {
  it("coloured text is shown in its colour", async () => {
    notes["Paper.typ"] = 'A #text(fill: rgb("#d44c47"))[red] word.';
    await openNote();

    expect(await screen.findByText("red")).toHaveStyle({ color: "#d44c47" });
  });

  it("text with a size or a font is shown in it", async () => {
    notes["Paper.typ"] = 'A #text(size: 1.5em)[big] and #text(font: "Georgia")[serif] word.';
    await openNote();

    expect(await screen.findByText("big")).toHaveStyle({ fontSize: "1.5em" });
    expect(screen.getByText("serif")).toHaveStyle({ fontFamily: '"Georgia"' });
  });

  it("aligned text is shown aligned", async () => {
    notes["Paper.typ"] = "#align(center)[Title]\nText.";
    await openNote();

    expect((await screen.findByText("Title")).closest(".cm-line")).toHaveClass("cm-align-center");
  });

  it("superscript is shown raised", async () => {
    notes["Paper.typ"] = "The 10#super[th] try.";
    await openNote();

    expect((await screen.findByText("th")).tagName).toBe("SUP");
  });
});

describe("Turn into", () => {
  it("lists the kinds of block, with the current one checked", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.click(await button("Turn into"));

    const menu = await screen.findByRole("menu", { name: "Turn into" });
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual([
      "Text",
      "Heading 1",
      "Heading 2",
      "Heading 3",
      "Bulleted list",
      "Numbered list",
      "Quote",
      "Callout",
    ]);
    expect(within(menu).getByRole("menuitemradio", { name: "Text" })).toHaveAttribute("aria-checked", "true");
  });

  it("turns the lines the selection is on into the kind chosen", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.click(await button("Turn into"));
    await userEvent.click(within(await screen.findByRole("menu", { name: "Turn into" })).getByRole("menuitemradio", { name: "Heading 1" }));

    expect(text(view)).toBe("= Read more papers.\nA #highlight[key] idea.");
    expect(selected(view)).toBe("more");
  });

  it("the button says what kind of block it is now", async () => {
    notes["Paper.typ"] = "- an item";
    const view = await openNote();

    select(view, "item");

    expect(await button("Turn into")).toHaveTextContent("Bulleted list");
  });

  it("Markdown notes can't have callouts", async () => {
    const view = await openNote("Todo.md");
    select(view, "milk");

    await userEvent.click(await button("Turn into"));

    const menu = await screen.findByRole("menu", { name: "Turn into" });
    expect(within(menu).queryByRole("menuitemradio", { name: "Callout" })).not.toBeInTheDocument();
  });
});

describe("Text size and font", () => {
  it("makes the selected text bigger or smaller", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.click(await button("Text size and font"));
    const sizes = await screen.findByRole("group", { name: "Text size" });
    expect(within(sizes).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Small",
      "Default",
      "Large",
      "Larger",
      "Huge",
    ]);
    await userEvent.click(within(sizes).getByRole("button", { name: "Larger" }));

    expect(text(view)).toContain("Read #text(size: 1.5em)[more] papers.");
  });

  it("gives the selected text a font from the computer's fonts", async () => {
    vi.mocked(api.listFonts).mockResolvedValue(["Arial", "Georgia"]);
    const view = await openNote();
    select(view, "more");

    await userEvent.click(await button("Text size and font"));
    const font = await screen.findByRole("combobox", { name: "Font" });
    await vi.waitFor(() => expect(within(font).getByRole("option", { name: "Georgia" })).toBeInTheDocument());
    await userEvent.selectOptions(font, "Georgia");

    expect(text(view)).toContain('Read #text(font: "Georgia")[more] papers.');
  });

  it("shows the current size as pressed", async () => {
    notes["Paper.typ"] = "A #text(size: 2em)[huge] word.";
    const view = await openNote();
    select(view, "huge");

    await userEvent.click(await button("Text size and font"));

    const sizes = await screen.findByRole("group", { name: "Text size" });
    expect(within(sizes).getByRole("button", { name: "Huge" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("Indenting", () => {
  it("the Paragraph menu indents text and brings it back", async () => {
    const view = await openNote();
    select(view, "more");

    await userEvent.click(await paragraph("Indent"));
    expect(text(view)).toContain("#pad(left: 2em)[Read more papers.]");

    await userEvent.click(await paragraph("Outdent"));
    expect(text(view)).toContain("Read more papers.\nA");
  });

  it("Tab nests a list item and Shift+Tab brings it back", async () => {
    notes["Paper.typ"] = "- one\n- two";
    const view = await openNote();
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: text(view).indexOf("two") } });
    });

    await userEvent.keyboard("{Tab}");
    expect(text(view)).toBe("- one\n  - two");

    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(text(view)).toBe("- one\n- two");
  });

  it("⌘] and ⌘[ indent and bring back any text", async () => {
    const view = await openNote();
    act(() => {
      view.focus();
      view.dispatch({ selection: { anchor: 2 } });
    });

    await userEvent.keyboard("{Control>}]{/Control}");
    expect(text(view)).toContain("#pad(left: 2em)[Read more papers.]");

    // "[[" is how the test's keyboard writes a single "[".
    await userEvent.keyboard("{Control>}[[{/Control}");
    expect(text(view)).toContain("Read more papers.\nA");
  });
});

describe("Links in Markdown notes", () => {
  it("links the selected text", async () => {
    const view = await openNote("Todo.md");
    select(view, "milk");

    await userEvent.click(await button("Link"));
    await userEvent.type(await screen.findByRole("textbox", { name: "Link address" }), "shop.example{Enter}");

    expect(text(view)).toBe("Buy [milk](https://shop.example).");
  });
});

describe("How blocks look in the editor", () => {
  it("quotes, callouts and indented text are shown as such", async () => {
    notes["Paper.typ"] =
      "#quote(block: true)[Wise]\n#block(fill: luma(240), inset: 10pt, radius: 4pt, width: 100%)[Note]\n#pad(left: 2em)[Inset]";
    await openNote();

    expect((await screen.findByText("Wise")).closest(".cm-line")).toHaveClass("cm-quote");
    expect(screen.getByText("Note").closest(".cm-line")).toHaveClass("cm-callout");
    expect(screen.getByText("Inset").closest(".cm-line")).toHaveStyle({ paddingLeft: "2em" });
  });
});

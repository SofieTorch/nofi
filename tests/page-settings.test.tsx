// Page settings for Typst notes, in a popover in the page view. They're written into the note as
// ordinary Typst (`#set page(…)` rules, see src-tauri/tests/page_settings.rs), so changing one is
// an edit to the note: it's saved, redrawn, and can be undone like typing.

import { EditorView } from "@codemirror/view";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

const NOTE = "= Attention\nA study.";
const noSettings: api.ReadPageSettings = { values: {}, locked: [] };

beforeEach(() => {
  setUpFakeBackend();
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  vi.mocked(api.listFiles).mockResolvedValue([file("Paper.typ"), file("Todo.md")]);
  vi.mocked(api.readNote).mockImplementation(async (path) => (path === "Todo.md" ? "# Todo" : NOTE));
  vi.mocked(api.getShowPages).mockResolvedValue(true);
  vi.mocked(api.renderPages).mockResolvedValue([{ svg: "<svg/>", width: 595, height: 842 }]);
  vi.mocked(api.readPageSettings).mockResolvedValue(noSettings);
  vi.mocked(api.listFonts).mockResolvedValue(["Arial", "Libertinus Serif"]);
});

async function openNote(name = "Paper.typ") {
  render(<App />);
  await userEvent.click(await screen.findByRole("button", { name }));
  return screen.findByRole("textbox", { name });
}

async function openSettings() {
  await userEvent.click(await screen.findByRole("button", { name: "Page settings" }));
  return screen.findByRole("dialog", { name: "Page settings" });
}

const textIn = (editor: HTMLElement) => EditorView.findFromDOM(editor)!.state.doc.toString();

describe("Page settings", () => {
  it("open from the page view, with paper, orientation, columns, margins, font and text size", async () => {
    await openNote();

    const settings = await openSettings();

    for (const name of ["Paper", "Orientation", "Columns", "Font"]) {
      expect(within(settings).getByRole("combobox", { name })).toBeInTheDocument();
    }
    expect(within(settings).getByRole("spinbutton", { name: "Margins (cm)" })).toBeInTheDocument();
    expect(within(settings).getByRole("spinbutton", { name: "Text size (pt)" })).toBeInTheDocument();
  });

  it("show the note's current settings", async () => {
    vi.mocked(api.readPageSettings).mockResolvedValue({
      values: { paper: "a5", landscape: true, columns: 2, marginCm: 1.5, font: "Arial", textSizePt: 12 },
      locked: [],
    });
    await openNote();

    const settings = await openSettings();

    expect(api.readPageSettings).toHaveBeenCalledWith(NOTE);
    await vi.waitFor(() => expect(within(settings).getByRole("combobox", { name: "Paper" })).toHaveValue("a5"));
    expect(within(settings).getByRole("combobox", { name: "Orientation" })).toHaveValue("landscape");
    expect(within(settings).getByRole("combobox", { name: "Columns" })).toHaveValue("2");
    expect(within(settings).getByRole("spinbutton", { name: "Margins (cm)" })).toHaveValue(1.5);
    expect(within(settings).getByRole("combobox", { name: "Font" })).toHaveValue("Arial");
    expect(within(settings).getByRole("spinbutton", { name: "Text size (pt)" })).toHaveValue(12);
  });

  it("changing a setting writes it into the note, which is saved and redrawn", async () => {
    const changed = `#set page(columns: 2)\n${NOTE}`;
    vi.mocked(api.changePageSetting).mockResolvedValue(changed);
    const editor = await openNote();
    const settings = await openSettings();

    await userEvent.selectOptions(within(settings).getByRole("combobox", { name: "Columns" }), "2");

    expect(api.changePageSetting).toHaveBeenCalledWith(NOTE, { setting: "columns", value: 2 });
    await vi.waitFor(() => expect(textIn(editor)).toBe(changed));
    await vi.waitFor(() => expect(api.saveNote).toHaveBeenCalledWith("Paper.typ", changed));
    await vi.waitFor(() => expect(api.renderPages).toHaveBeenLastCalledWith(changed, expect.any(String)));
  });

  it("going back to one column removes the setting (Typst's default)", async () => {
    vi.mocked(api.readPageSettings).mockResolvedValue({ values: { columns: 2 }, locked: [] });
    vi.mocked(api.changePageSetting).mockResolvedValue(NOTE);
    await openNote();
    const settings = await openSettings();
    const columns = within(settings).getByRole("combobox", { name: "Columns" });
    await vi.waitFor(() => expect(columns).toHaveValue("2"));

    await userEvent.selectOptions(columns, "1");

    expect(api.changePageSetting).toHaveBeenCalledWith(NOTE, { setting: "columns", value: null });
  });

  it("the font can be any font on the computer", async () => {
    vi.mocked(api.changePageSetting).mockResolvedValue(NOTE);
    await openNote();
    const settings = await openSettings();
    const font = within(settings).getByRole("combobox", { name: "Font" });

    await vi.waitFor(() => expect(within(font).getByRole("option", { name: "Arial" })).toBeInTheDocument());
    await userEvent.selectOptions(font, "Arial");

    expect(api.changePageSetting).toHaveBeenCalledWith(NOTE, { setting: "font", value: "Arial" });
  });

  it("margins and text size are typed, and emptying them goes back to the default", async () => {
    vi.mocked(api.readPageSettings).mockResolvedValue({ values: { textSizePt: 11 }, locked: [] });
    vi.mocked(api.changePageSetting).mockResolvedValue(NOTE);
    await openNote();
    const settings = await openSettings();

    await userEvent.type(within(settings).getByRole("spinbutton", { name: "Margins (cm)" }), "2{Enter}");
    const size = within(settings).getByRole("spinbutton", { name: "Text size (pt)" });
    await vi.waitFor(() => expect(size).toHaveValue(11));
    await userEvent.clear(size);
    await userEvent.keyboard("{Enter}");

    expect(api.changePageSetting).toHaveBeenCalledWith(NOTE, { setting: "marginCm", value: 2 });
    expect(api.changePageSetting).toHaveBeenCalledWith(NOTE, { setting: "textSizePt", value: null });
  });

  it("settings written another way in the note's code can't be changed here, and say so", async () => {
    vi.mocked(api.readPageSettings).mockResolvedValue({ values: {}, locked: ["margin"] });
    await openNote();

    const settings = await openSettings();

    const margins = within(settings).getByRole("spinbutton", { name: "Margins (cm)" });
    await vi.waitFor(() => expect(margins).toBeDisabled());
    expect(within(settings).getByText("Set in the note's code")).toBeInTheDocument();
  });

  it("explains when a setting can't be changed", async () => {
    vi.mocked(api.changePageSetting).mockRejectedValue("The margin is set in the note's code; change it there.");
    await openNote();
    const settings = await openSettings();

    await userEvent.selectOptions(within(settings).getByRole("combobox", { name: "Columns" }), "3");

    expect(await within(settings).findByRole("alert")).toHaveTextContent("The margin is set in the note's code");
  });

  it("also set how paragraphs look: justified, line spacing, first-line indent, and the language", async () => {
    vi.mocked(api.readPageSettings).mockResolvedValue({
      values: { justify: true, lineSpacingEm: 1, firstLineIndentEm: 1.5, language: "es" },
      locked: [],
    });
    vi.mocked(api.changePageSetting).mockResolvedValue(NOTE);
    await openNote();
    const settings = await openSettings();
    const justify = within(settings).getByRole("checkbox", { name: "Justify text" });

    await vi.waitFor(() => expect(justify).toBeChecked());
    expect(within(settings).getByRole("spinbutton", { name: "Line spacing (em)" })).toHaveValue(1);
    expect(within(settings).getByRole("spinbutton", { name: "First-line indent (em)" })).toHaveValue(1.5);
    expect(within(settings).getByRole("combobox", { name: "Language" })).toHaveValue("es");

    await userEvent.click(justify);
    await userEvent.selectOptions(within(settings).getByRole("combobox", { name: "Language" }), "de");

    expect(api.changePageSetting).toHaveBeenCalledWith(NOTE, { setting: "justify", value: null });
    expect(api.changePageSetting).toHaveBeenCalledWith(NOTE, { setting: "language", value: "de" });
  });

  it("set page numbers, and a header and footer for every page", async () => {
    vi.mocked(api.readPageSettings).mockResolvedValue({ values: { header: "My notes" }, locked: [] });
    vi.mocked(api.changePageSetting).mockResolvedValue(NOTE);
    await openNote();
    const settings = await openSettings();
    const header = within(settings).getByRole("textbox", { name: "Header" });
    await vi.waitFor(() => expect(header).toHaveValue("My notes"));

    await userEvent.selectOptions(within(settings).getByRole("combobox", { name: "Page numbers" }), "1 / 1");
    await userEvent.type(within(settings).getByRole("textbox", { name: "Footer" }), "Draft{Enter}");
    await userEvent.clear(header);
    await userEvent.keyboard("{Enter}");

    expect(api.changePageSetting).toHaveBeenCalledWith(NOTE, { setting: "pageNumbers", value: "1 / 1" });
    expect(api.changePageSetting).toHaveBeenCalledWith(NOTE, { setting: "footer", value: "Draft" });
    expect(api.changePageSetting).toHaveBeenCalledWith(NOTE, { setting: "header", value: null });
  });

  it("Escape closes them", async () => {
    await openNote();
    await openSettings();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Page settings" })).not.toBeInTheDocument();
  });

  it("Markdown notes have no page settings", async () => {
    await openNote("Todo.md");

    await screen.findByRole("region", { name: "Pages" });

    expect(screen.queryByRole("button", { name: "Page settings" })).not.toBeInTheDocument();
  });
});

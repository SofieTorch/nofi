// Images in notes. Pasting an image (or dropping an image file on the note) saves it in the
// workspace's `assets` folder and adds it on a line of its own, with the path from the note's
// folder: `#image("assets/…")` in Typst, `![](assets/…)` in Markdown. The editor shows the picture
// in place of that line (the code shows while the cursor is on it). Dragging the picture's left
// or right edge resizes it: `width: 60%` in Typst, `![|300](…)` (pixels, like Obsidian) in Markdown.
// Saving and reading the files, and Typst using them, is specified in src-tauri/tests/images.rs.

import { EditorView } from "@codemirror/view";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api";
import App from "../src/App";
import { file, folder, setUpFakeBackend } from "./support/fake-backend";

vi.mock("../src/api");

let notes: Record<string, string>;

beforeEach(() => {
  setUpFakeBackend();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 2, 15, 30, 12));
  vi.mocked(api.getLastWorkspace).mockResolvedValue({ name: "Research", path: "/Research" });
  notes = { "Paper.typ": "Intro.", "Ideas.md": "Intro.", "Papers/Attention.typ": "Intro." };
  vi.mocked(api.listFiles).mockResolvedValue([folder("Papers", [file("Papers/Attention.typ")]), file("Paper.typ"), file("Ideas.md")]);
  vi.mocked(api.readNote).mockImplementation(async (path) => notes[path]);
  return () => vi.useRealTimers();
});

async function openNote(path = "Paper.typ") {
  render(<App />);
  if (path.includes("/")) await userEvent.click(await screen.findByRole("button", { name: path.split("/")[0] }));
  const name = path.split("/").pop()!;
  await userEvent.click(await screen.findByRole("button", { name }));
  const editor = await screen.findByRole("textbox", { name });
  const view = EditorView.findFromDOM(editor.closest<HTMLElement>(".cm-editor")!)!;
  act(() => {
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  return { editor, view };
}

const text = (view: EditorView) => view.state.doc.toString();
const picture = () => new File([new Uint8Array([137, 80, 78, 71])], "image.png", { type: "image/png" });

function paste(editor: HTMLElement, files: File[], plain = "") {
  fireEvent.paste(editor, { clipboardData: { files, types: files.length ? ["Files"] : ["text/plain"], getData: () => plain } });
}

describe("Pasting an image", () => {
  it("saves it in the workspace's assets folder, named like Obsidian does", async () => {
    const { editor } = await openNote();

    paste(editor, [picture()]);

    await vi.waitFor(() => expect(api.saveAsset).toHaveBeenCalledWith("Pasted image 20261102153012.png", expect.any(Uint8Array)));
  });

  it("adds it to the note on a line of its own", async () => {
    const { editor, view } = await openNote();

    paste(editor, [picture()]);

    await vi.waitFor(() => expect(text(view)).toBe('Intro.\n\n#image("assets/Pasted image 20261102153012.png")\n\n'));
  });

  it("the cursor goes after it, ready to keep writing (so the picture shows)", async () => {
    const { editor, view } = await openNote();

    paste(editor, [picture()]);

    await vi.waitFor(() => expect(text(view)).toContain("#image"));
    expect(text(view).endsWith("\n\n")).toBe(true);
    expect(view.state.selection.main.head).toBe(text(view).length);
  });

  it("from a note in a folder, the path starts from that folder", async () => {
    const { editor, view } = await openNote("Papers/Attention.typ");

    paste(editor, [picture()]);

    await vi.waitFor(() => expect(text(view)).toContain('#image("../assets/Pasted image 20261102153012.png")'));
  });

  it("in Markdown, it's a Markdown image, with %20 for spaces", async () => {
    const { editor, view } = await openNote("Ideas.md");

    paste(editor, [picture()]);

    await vi.waitFor(() => expect(text(view)).toContain("![](assets/Pasted%20image%2020261102153012.png)"));
  });

  it("pasting text still pastes text", async () => {
    const { editor } = await openNote();

    paste(editor, [], "words");

    expect(api.saveAsset).not.toHaveBeenCalled();
  });

  it("dropping an image file on the note adds it too, keeping the file's name", async () => {
    const { editor, view } = await openNote();

    fireEvent.drop(editor, { dataTransfer: { files: [new File([new Uint8Array([1])], "figure 1.jpg", { type: "image/jpeg" })], types: ["Files"] } });

    await vi.waitFor(() => expect(text(view)).toContain('#image("assets/figure 1.jpg")'));
  });

  it("when it can't be saved, says why", async () => {
    vi.mocked(api.saveAsset).mockRejectedValueOnce("The disk is full.");
    const { editor } = await openNote();

    paste(editor, [picture()]);

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add the image: The disk is full.");
  });
});

describe("Images in the editor", () => {
  const shownImage = (editor: HTMLElement) => editor.querySelector<HTMLImageElement>(".cm-image img");
  const frameOf = (editor: HTMLElement) => editor.querySelector<HTMLElement>(".cm-image-frame");

  it("show the picture in place of their line", async () => {
    notes["Paper.typ"] = 'Intro.\n\n#image("assets/a.png")\n\nAfter.';
    const { editor } = await openNote();

    await vi.waitFor(() => expect(shownImage(editor)?.getAttribute("src")).toMatch(/^blob:|^data:/));
    expect(api.readWorkspaceFile).toHaveBeenCalledWith("assets/a.png");
    expect(within(editor).queryByText(/#image/)).not.toBeInTheDocument();
  });

  it("read the file from the note's folder", async () => {
    notes["Papers/Attention.typ"] = 'Intro.\n\n#image("../assets/a.png")\n\nAfter.';
    await openNote("Papers/Attention.typ");

    await vi.waitFor(() => expect(api.readWorkspaceFile).toHaveBeenCalledWith("assets/a.png"));
  });

  it("show the code while the cursor is on their line", async () => {
    notes["Paper.typ"] = 'Intro.\n\n#image("assets/a.png")\n\nAfter.';
    const { editor, view } = await openNote();

    act(() => view.dispatch({ selection: { anchor: text(view).indexOf("#image") + 3 } }));

    expect(shownImage(editor)).toBeNull();
    expect(editor.textContent).toContain('#image("assets/a.png")');
  });

  it("show their width", async () => {
    notes["Paper.typ"] = 'Intro.\n\n#image("assets/a.png", width: 40%)\n\nAfter.';
    const { editor } = await openNote();

    await vi.waitFor(() => expect(frameOf(editor)!.style.width).toBe("40%"));
  });

  it("a Markdown image shows too, with its width in pixels", async () => {
    notes["Ideas.md"] = "Intro.\n\n![a chart|300](assets/chart%201.png)\n\nAfter.";
    const { editor } = await openNote("Ideas.md");

    await vi.waitFor(() => expect(frameOf(editor)!.style.width).toBe("300px"));
    expect(api.readWorkspaceFile).toHaveBeenCalledWith("assets/chart 1.png");
    expect(shownImage(editor)!.alt).toBe("a chart");
  });

  it("an image that can't be found says so", async () => {
    vi.mocked(api.readWorkspaceFile).mockRejectedValue("This note doesn't exist anymore.");
    notes["Paper.typ"] = 'Intro.\n\n#image("assets/gone.png")\n\nAfter.';
    const { editor } = await openNote();

    expect(await within(editor).findByText("Image not found: assets/gone.png")).toBeInTheDocument();
  });
});

describe("Resizing an image", () => {
  /** Drags an image's edge (the picture is 400px wide in a 500px wide note) by some pixels. */
  async function dragEdge(editor: HTMLElement, view: EditorView, edge: "left" | "right", by: number) {
    const frame = await vi.waitFor(() => editor.querySelector<HTMLElement>(".cm-image-frame")!);
    vi.spyOn(frame, "getBoundingClientRect").mockReturnValue({ left: 0, width: 400, right: 400 } as DOMRect);
    vi.spyOn(view.contentDOM, "getBoundingClientRect").mockReturnValue({ left: 0, width: 500, right: 500 } as DOMRect);
    const handle = editor.querySelector<HTMLElement>(`.cm-image-handle-${edge}`)!;
    fireEvent.pointerDown(handle, { button: 0, clientX: 400 });
    fireEvent.pointerMove(window, { clientX: 400 + by });
    fireEvent.pointerUp(window, { clientX: 400 + by });
  }

  it("dragging its right edge writes the new width, as a part of the note's width", async () => {
    notes["Paper.typ"] = 'Intro.\n\n#image("assets/a.png")\n\nAfter.';
    const { editor, view } = await openNote();

    await dragEdge(editor, view, "right", -150);

    expect(text(view)).toBe('Intro.\n\n#image("assets/a.png", width: 50%)\n\nAfter.');
  });

  it("dragging its left edge outwards makes it bigger", async () => {
    notes["Paper.typ"] = 'Intro.\n\n#image("assets/a.png", width: 80%)\n\nAfter.';
    const { editor, view } = await openNote();

    await dragEdge(editor, view, "left", -50);

    expect(text(view)).toContain("width: 90%");
  });

  it("never wider than the note", async () => {
    notes["Paper.typ"] = 'Intro.\n\n#image("assets/a.png")\n\nAfter.';
    const { editor, view } = await openNote();

    await dragEdge(editor, view, "right", 600);

    expect(text(view)).toContain("width: 100%");
  });

  it("in Markdown, the width is written in pixels, like Obsidian", async () => {
    notes["Ideas.md"] = "Intro.\n\n![chart](assets/a.png)\n\nAfter.";
    const { editor, view } = await openNote("Ideas.md");

    await dragEdge(editor, view, "right", -100);

    expect(text(view)).toBe("Intro.\n\n![chart|300](assets/a.png)\n\nAfter.");
  });
});

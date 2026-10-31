// The "/" menu, like Notion's and Obsidian's: typing "/" at the start of a line or after a space
// lists blocks to insert (headings, lists, maths, tables, columns…). The commands come from the
// backend, which makes sure each one keeps the note valid.

import type { Completion, CompletionContext, CompletionResult, CompletionSource } from "@codemirror/autocomplete";
import * as api from "../api";
import type { Format } from "./formatting";

// The commands never change while the app runs: ask once per format.
const commands = new Map<Format, Promise<api.SlashCommand[]>>();
const commandsFor = (format: Format) => {
  if (!commands.has(format)) commands.set(format, api.slashCommands(format).catch(() => []));
  return commands.get(format)!;
};

/** Forgets the commands (for tests, which each use their own fake backend). */
export function forgetSlashCommands() {
  commands.clear();
}

/** A command matches if its name, or one of the other words it's known by, has what's typed. */
function matches(command: api.SlashCommand, query: string) {
  const words = [...command.label.toLowerCase().split(" "), ...command.keywords];
  return command.label.toLowerCase().includes(query) || words.some((word) => word.startsWith(query));
}

export function slashMenu(format: Format): CompletionSource {
  return async (context: CompletionContext): Promise<CompletionResult | null> => {
    const typed = context.matchBefore(/\/[\w-]*$/);
    if (!typed) return null;
    const line = context.state.doc.lineAt(typed.from);
    const before = context.state.sliceDoc(line.from, typed.from);
    // Only at the start of a line or after a space: "and/or" and links stay as they are.
    if (before !== "" && !/\s$/.test(before)) return null;
    // Inside maths, "/" divides.
    if (format === "typst" && (before.match(/(?<!\\)\$/g)?.length ?? 0) % 2 === 1) return null;

    const all = await commandsFor(format);
    const query = typed.text.slice(1).toLowerCase();
    const sections = [...new Set(all.map((command) => command.section))];
    const atLineStart = before.trim() === "";

    return {
      // From after the "/", so what's typed after it is what's matched.
      from: typed.from + 1,
      filter: false,
      options: all
        .filter((command) => matches(command, query))
        .map(
          (command): Completion => ({
            label: command.label,
            info: command.description,
            section: { name: command.section, rank: sections.indexOf(command.section) },
            apply: (view, _completion, from, to) => {
              // Blocks start on their own line.
              const newLine = command.block && !atLineStart ? "\n" : "";
              const at = from - 1 + newLine.length + command.cursor;
              view.dispatch({
                changes: { from: from - 1, to, insert: newLine + command.insert },
                selection: { anchor: at, head: at + command.selection },
                userEvent: "input.complete",
              });
            },
          }),
        ),
    };
  };
}

// Typst's own parser (the typst-syntax crate, compiled to WebAssembly from typst-parser/), so the
// editor reads notes exactly like the Typst compiler does. It's loaded once when the app starts
// (`loadTypstParser`); after that, parsing is instant: a note is parsed again on every change.

/** A piece of a note's syntax tree, like a `Strong` (*bold*) and what's inside it. */
export type SyntaxNode = {
  /** Typst's name for it, like "Strong", "FuncCall", "Text". */
  kind: string;
  /** Where it is in the note, counted like the editor counts (UTF-16). */
  from: number;
  to: number;
  /** Whether it or something in it is an error (like an unclosed bracket). */
  error: boolean;
  children: SyntaxNode[];
};

type Exports = {
  memory: WebAssembly.Memory;
  alloc(len: number): number;
  dealloc(ptr: number, len: number): void;
  parse(ptr: number, len: number): number;
  tree_len(): number;
  kind_names(): number;
  kind_names_len(): number;
};

let parser: { exports: Exports; kinds: string[] } | null = null;

function start(instance: WebAssembly.Instance) {
  const exports = instance.exports as unknown as Exports;
  // (Calls first: they can grow the module's memory, which replaces its buffer.)
  const at = exports.kind_names();
  const length = exports.kind_names_len();
  const names = new Uint8Array(exports.memory.buffer, at, length);
  parser = { exports, kinds: new TextDecoder().decode(names).split("\n") };
}

/** Loads the parser from the compiled module's bytes. */
export async function loadTypstParser(bytes: BufferSource | Promise<BufferSource>) {
  const { instance } = await WebAssembly.instantiate(await bytes);
  start(instance);
}

/** Whether the parser is loaded. */
export const typstParserLoaded = () => parser !== null;

const encoder = new TextEncoder();

/** Parses a note's Typst text into its syntax tree. */
export function parseTypst(text: string): SyntaxNode {
  if (!parser) throw new Error("Typst's parser isn't loaded yet (loadTypstParser).");
  const { exports, kinds } = parser;
  const bytes = encoder.encode(text);
  const ptr = exports.alloc(bytes.length);
  new Uint8Array(exports.memory.buffer, ptr, bytes.length).set(bytes);
  const at = exports.parse(ptr, bytes.length);
  exports.dealloc(ptr, bytes.length);
  // Four numbers per node, in document order: kind (+256 if an error), from, to, nodes it takes up.
  const length = exports.tree_len();
  const tree = new Uint32Array(exports.memory.buffer, at, length).slice();

  const read = (index: number): SyntaxNode => {
    const code = tree[index * 4];
    const size = tree[index * 4 + 3];
    const node: SyntaxNode = { kind: kinds[code & 255], from: tree[index * 4 + 1], to: tree[index * 4 + 2], error: code >= 256, children: [] };
    for (let child = index + 1; child < index + size; child += tree[child * 4 + 3]) node.children.push(read(child));
    return node;
  };
  return read(0);
}

// Compiles Typst's parser (typst-parser/) to WebAssembly for the editor, as
// src/editor/typst-parser.wasm. Runs before `npm run dev`, `build` and `test`; quick when unchanged.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";

const built = "typst-parser/target/wasm32-unknown-unknown/release/typst_parser.wasm";
const target = "src/editor/typst-parser.wasm";

try {
  execFileSync(
    "cargo",
    ["build", "--quiet", "--release", "--target", "wasm32-unknown-unknown", "--manifest-path", "typst-parser/Cargo.toml"],
    { stdio: "inherit" },
  );
} catch {
  console.error("\nCouldn't build Typst's parser. It needs Rust's WebAssembly target:\n  rustup target add wasm32-unknown-unknown\n");
  process.exit(1);
}
// (Copied only when it changed, so the dev server doesn't reload for nothing.)
if (!existsSync(target) || !readFileSync(built).equals(readFileSync(target))) copyFileSync(built, target);

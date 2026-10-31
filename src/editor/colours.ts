// Typst colours, shown on screen. Typst's named colours have their own shades (its `red` isn't
// the browser's), so they're listed here.

const NAMED: Record<string, string> = {
  black: "#000000",
  gray: "#aaaaaa",
  silver: "#dddddd",
  white: "#ffffff",
  navy: "#001f3f",
  blue: "#0074d9",
  aqua: "#7fdbff",
  teal: "#39cccc",
  eastern: "#239dad",
  purple: "#b10dc9",
  fuchsia: "#f012be",
  maroon: "#85144b",
  red: "#ff4136",
  orange: "#ff851b",
  yellow: "#ffdc00",
  olive: "#3d9970",
  green: "#2ecc40",
  lime: "#01ff70",
};

/** The CSS colour for a colour written in Typst, if it's one that can be shown. */
export function cssColour(typst: string): string | undefined {
  const value = typst.trim();
  const hex = /^rgb\(\s*"(#[0-9a-fA-F]{3,8})"\s*\)$/.exec(value);
  if (hex) return hex[1];
  const numbers = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(value);
  if (numbers) return `rgb(${numbers[1]}, ${numbers[2]}, ${numbers[3]})`;
  const luma = /^luma\(\s*(\d+)\s*\)$/.exec(value);
  if (luma) return `rgb(${luma[1]}, ${luma[1]}, ${luma[1]})`;
  return NAMED[value];
}

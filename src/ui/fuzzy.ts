/**
 * How well a name matches what's typed, its letters in order, ignoring case and spaces (lower is
 * better: fewer letters skipped); null if it doesn't match.
 */
export function fuzzyScore(name: string, typed: string): number | null {
  const lower = name.toLowerCase();
  let at = -1;
  let gaps = 0;
  for (const char of typed.toLowerCase()) {
    if (char === " ") continue;
    const next = lower.indexOf(char, at + 1);
    if (next === -1) return null;
    gaps += next - at - 1;
    at = next;
  }
  return gaps;
}

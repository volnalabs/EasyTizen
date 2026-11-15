import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Every .tsx file under src/. */
function sources(dir = "src"): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : path.endsWith(".tsx") ? [path] : [];
  });
}

// `safe-top`, `safe-bottom` and `safe-x` set padding to the system inset. On the same element as
// a padding utility for that side, one of the two silently wins (on desktop the inset is 0, so a
// dialog footer lost its bottom padding). Put the inset on a wrapper, or use calc(… + env(…)).
const CONFLICTS: [RegExp, RegExp][] = [
  [/\bsafe-bottom\b/, /(?:^|[\s:])(?:p|py|pb)-/],
  [/\bsafe-top\b/, /(?:^|[\s:])(?:p|py|pt)-/],
  [/\bsafe-x\b/, /(?:^|[\s:])(?:p|px|ps|pe|pl|pr)-/],
];

describe("safe areas", () => {
  it("never share an element with padding on the same side", () => {
    const found: string[] = [];
    for (const file of sources()) {
      for (const m of readFileSync(file, "utf8").matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const cls = m[1] ?? m[2];
        for (const [safe, pad] of CONFLICTS) if (safe.test(cls) && pad.test(cls)) found.push(`${file}: ${cls.slice(0, 80)}`);
      }
    }
    expect(found).toEqual([]);
  });
});

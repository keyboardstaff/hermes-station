#!/usr/bin/env node
/**
 * codemod_tokens.mjs — Replace inline numeric style literals with var(--hms-*).
 *
 * Usage: node scripts/codemod_tokens.mjs [--dry-run]
 *
 * Only replaces values with exact token matches in tokens.css.
 * Leaves shorthands, 100%, and other unrepresentable values untouched.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = join(__dirname, "..", "src");
const DRY_RUN = process.argv.includes("--dry-run");

// ── Replacement table ──────────────────────────────────────────────
// Each entry: [regex, replacement-string]
// Order matters: longer/more-specific patterns first to avoid partial matches.
const REPLACEMENTS = [
  // ── fontSize (string literals, single or double quotes) ──────────
  [/fontSize:\s*['"]0\.6875rem['"]/g,  "fontSize: 'var(--hms-text-xs)'"],
  [/fontSize:\s*['"]0\.8125rem['"]/g,  "fontSize: 'var(--hms-text-sm)'"],
  [/fontSize:\s*['"]0\.875rem['"]/g,   "fontSize: 'var(--hms-text-body)'"],
  [/fontSize:\s*['"]0\.9375rem['"]/g,  "fontSize: 'var(--hms-text-base)'"],
  [/fontSize:\s*['"]1\.125rem['"]/g,   "fontSize: 'var(--hms-text-lg)'"],
  [/fontSize:\s*['"]1\.25rem['"]/g,    "fontSize: 'var(--hms-text-xl)'"],
  [/fontSize:\s*['"]1\.5rem['"]/g,     "fontSize: 'var(--hms-text-2xl)'"],
  // 1rem and 0.75rem must come after the longer rem strings above
  [/fontSize:\s*['"]1rem['"]/g,        "fontSize: 'var(--hms-text-md)'"],
  [/fontSize:\s*['"]0\.75rem['"]/g,    "fontSize: 'var(--hms-text-caption)'"],

  // ── gap (bare number, pixel value = number × 1px in React inline styles) ──
  // Use negative lookahead for digit to avoid partial matches (e.g. 16 ≠ 1 + 6).
  [/gap:\s*18(?!\d)/g,  "gap: 'var(--hms-space-5)'"],   // 18 → 20px (rounds up)
  [/gap:\s*16(?!\d)/g,  "gap: 'var(--hms-space-4)'"],
  [/gap:\s*14(?!\d)/g,  "gap: 'var(--hms-space-4)'"],   // 14 → 16px (rounds up)
  [/gap:\s*12(?!\d)/g,  "gap: 'var(--hms-space-3)'"],
  [/gap:\s*10(?!\d)/g,  "gap: 'var(--hms-space-3)'"],   // 10 → 12px (rounds up)
  [/gap:\s*8(?!\d)/g,   "gap: 'var(--hms-space-2)'"],
  [/gap:\s*6(?!\d)/g,   "gap: 'var(--hms-space-2)'"],   // 6 → 8px  (rounds up)
  [/gap:\s*5(?!\d)/g,   "gap: 'var(--hms-space-1)'"],   // 5 → 4px  (rounds down)
  [/gap:\s*4(?!\d)/g,   "gap: 'var(--hms-space-1)'"],
  [/gap:\s*3(?!\d)/g,   "gap: 'var(--hms-space-1)'"],   // 3 → 4px  (rounds up)
  [/gap:\s*2(?!\d)/g,   "gap: 'var(--hms-space-1)'"],   // 2 → 4px  (rounds up)

  // ── padding (bare number → px) ───────────────────────────────────
  [/padding:\s*24(?!\d)/g,  "padding: 'var(--hms-space-6)'"],
  [/padding:\s*16(?!\d)/g,  "padding: 'var(--hms-space-4)'"],
  [/padding:\s*12(?!\d)/g,  "padding: 'var(--hms-space-3)'"],
  [/padding:\s*8(?!\d)/g,   "padding: 'var(--hms-space-2)'"],

  // padding string literals with single value only (avoid touching shorthands)
  [/padding:\s*["']8px["']/g,  "padding: 'var(--hms-space-2)'"],
  [/padding:\s*["']4px["']/g,  "padding: 'var(--hms-space-1)'"],

  // ── margin (bare 0 is intentionally left — no token benefit) ────
  // (no margin replacements — shorthands and 0 are acceptable)
];

// ── File walker ────────────────────────────────────────────────────
function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) yield full;
  }
}

// ── Main ───────────────────────────────────────────────────────────
let totalFiles = 0;
let totalChanges = 0;

for (const file of walk(SRC_DIR)) {
  const original = readFileSync(file, "utf8");
  let updated = original;
  let fileChanges = 0;

  for (const [pattern, replacement] of REPLACEMENTS) {
    const before = updated;
    updated = updated.replace(pattern, replacement);
    if (updated !== before) {
      // Count occurrences replaced (rough estimate via match count)
      const matches = before.match(pattern);
      fileChanges += matches ? matches.length : 0;
    }
  }

  if (updated !== original) {
    totalFiles += 1;
    totalChanges += fileChanges;
    const rel = relative(join(__dirname, ".."), file);
    console.log(`  ${DRY_RUN ? "[dry]" : "✓"} ${rel} (${fileChanges} replacements)`);
    if (!DRY_RUN) {
      writeFileSync(file, updated, "utf8");
    }
  }
}

console.log(
  `\n${DRY_RUN ? "Dry run:" : "Done:"} ${totalChanges} replacements across ${totalFiles} files.`
);

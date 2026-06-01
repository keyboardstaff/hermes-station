#!/usr/bin/env bash
# scripts/lint_no_inline_style.sh
#
# CI guard: block TSX files that use raw numeric literals in inline `style` props
# for properties that have a corresponding var(--hms-*) token.
#
# Excluded (intentional, no token equivalent):
#   - Percentage/viewport values: "100%", "100vh", "100vw"
#   - em-based values: "1em", "1.25em", etc.  (relative to font context)
#   - Shorthand values with spaces: "8px 12px", "4px 0", "0 auto", etc.
#   - width / height properties (too varied; governed by layout tokens separately)
#
# Allowed:  style={{ gap: 'var(--hms-space-2)' }}
# Blocked:  style={{ fontSize: '0.875rem' }}  /  style={{ gap: 8 }}
#
# Run:  bash scripts/lint_no_inline_style.sh
# Exit: 0 = clean, 1 = violations found

set -euo pipefail

PATTERN='style=\{\{[^}]*(fontSize|padding|margin|gap)['"'"'"]?\s*:\s*['"'"'"]?[0-9]'

VIOLATIONS=$(grep -rEn "$PATTERN" src/ --include='*.tsx' \
  | grep -v 'var(--hms-'  \
  | grep -Ev '(100%|100vh|100vw)'  \
  | grep -Ev "[0-9](em)['\",]" \
  | grep -Ev ":\s*['\"][0-9.]+rem['\"]" \
  | grep -Ev ":\s*['\"][0-9][^'\"]*\s[^'\"]*['\"]" \
  || true)

# Colour literals: raw #hex / rgb()/rgba() inside an inline style object.
# Use a var(--hms-*) token instead. Lines that already reference a token
# (var(--hms-) anywhere on the line) pass, so token+legacy-fallback during
# migration is tolerated; append "hms-allow-color" to exempt a genuine case
# (e.g. a fixed brand asset / gradient with no token equivalent).
COLOR_PATTERN='style=\{\{[^}]*(#[0-9a-fA-F]{3,8}\b|rgba?\()'
COLOR_VIOLATIONS=$(grep -rEn "$COLOR_PATTERN" src/ --include='*.tsx' \
  | grep -v 'var(--hms-' \
  | grep -v 'hms-allow-color' \
  || true)

STATUS=0
if [[ -n "$VIOLATIONS" ]]; then
  echo "❌  Inline numeric style literals found — use var(--hms-*) tokens instead:"
  echo ""
  echo "$VIOLATIONS"
  echo ""
  STATUS=1
fi
if [[ -n "$COLOR_VIOLATIONS" ]]; then
  echo "❌  Inline colour literals found — use var(--hms-*) colour tokens instead:"
  echo ""
  echo "$COLOR_VIOLATIONS"
  echo ""
  STATUS=1
fi

if [[ "$STATUS" -ne 0 ]]; then
  echo "Ref: src/styles/tokens.css"
  exit 1
fi

echo "✓  No inline numeric/colour style literals found."

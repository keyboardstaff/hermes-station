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

ALLOWLIST_FILE="scripts/lint_no_inline_style.allowlist"

filter_allowlisted_paths() {
  if [[ ! -f "$ALLOWLIST_FILE" ]]; then
    cat
    return
  fi

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    local path="${line%%:*}"
    if grep -Fxq "$path" "$ALLOWLIST_FILE"; then
      continue
    fi
    echo "$line"
  done
}

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

# DOM-style hover mutations: directly assigning e.currentTarget.style.background/
# color/etc inside TSX event handlers. These are the highest-signal D64 smell:
# they hide interactive styling in JS instead of shared CSS classes. Existing
# offenders are allowlisted file-by-file and burned down incrementally.
HOVER_PATTERN='\.style\.(background|color|border|borderColor|opacity)\s*='
HOVER_VIOLATIONS=$(grep -rEn "$HOVER_PATTERN" src/ --include='*.tsx' \
  | grep -v 'hms-allow-hover' \
  | filter_allowlisted_paths \
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
if [[ -n "$HOVER_VIOLATIONS" ]]; then
  echo "❌  Inline DOM style mutations found — replace JS hover with shared CSS classes instead:"
  echo ""
  echo "$HOVER_VIOLATIONS"
  echo ""
  echo "Ref: docs/UI_CONVENTIONS.md §2 and $ALLOWLIST_FILE"
  STATUS=1
fi

if [[ "$STATUS" -ne 0 ]]; then
  echo "Ref: src/styles/tokens.css"
  exit 1
fi

echo "✓  No inline numeric/colour style literals or DOM-style hover mutations found."

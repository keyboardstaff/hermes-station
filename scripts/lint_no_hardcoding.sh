#!/usr/bin/env bash
# Forbid upstream literals/imports outside the wrapper layer. Returns 0 clean, 1 with hits.
# Allow specific lines with `# hms-allow-hardcoding` or `# noqa: hms-no-hardcoding`.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

INCLUDE='server'

# Wrapper-layer files that may mention upstream literals.
EXCLUDE_PATHS='server/lib/upstream_paths.py|server/lib/config_reader.py|server/lib/upstream_shim.py|server/lifecycle.py'

fail=0

PATTERNS=(
  '\b1313\b|server.lib.config_reader.hms_port()'
  '\b9119\b|server.lib.config_reader.dashboard_url()'
  'ai\.hermes\.gateway|server.lib.upstream_paths.launchd_label()'
  'hermes-gateway\.service|server.lib.upstream_paths.systemd_service_name()'
  '"~/\.hermes"|server.lib.upstream_paths.hermes_home()'
  'Path\.home\(\) */ *"\.hermes"|server.lib.upstream_paths.hermes_home()'
  '"state\.db"|server.lib.upstream_paths.state_db_path()'
)

for entry in "${PATTERNS[@]}"; do
    pattern="${entry%%|*}"
    hint="${entry#*|}"
    hits=$(grep -rnE --include='*.py' "$pattern" "$INCLUDE" 2>/dev/null \
        | grep -vE "$EXCLUDE_PATHS" \
        | grep -v -E '(noqa: hms-no-hardcoding|hms-allow-hardcoding)' || true)
    if [[ -n "$hits" ]]; then
        if (( fail == 0 )); then
            echo "✗ hms-no-hardcoding lint failures:"
        fi
        echo
        echo "  pattern: $pattern"
        echo "  use:     $hint"
        echo "$hits" | sed 's/^/    /'
        fail=1
    fi
done

# Direct upstream imports must go through the shim layer.
UPSTREAM_IMPORT_RE='^[[:space:]]*(from|import)[[:space:]]+(hermes_cli|gateway|tools|run_agent|hermes_constants|hermes_state)\b'

shim_hits=$(grep -rnE --include='*.py' "$UPSTREAM_IMPORT_RE" "$INCLUDE" 2>/dev/null \
    | grep -vE "$EXCLUDE_PATHS" \
    | grep -v -E '(noqa: hms-no-hardcoding|hms-allow-hardcoding)' || true)

if [[ -n "$shim_hits" ]]; then
    if (( fail == 0 )); then
        echo "✗ hms-no-hardcoding lint failures:"
    fi
    echo
    echo "  pattern: direct upstream import (bypasses shim layer)"
    echo "  use:     from server.lib.upstream_shim import shim  →  shim.<group>.<name>"
    echo "$shim_hits" | sed 's/^/    /'
    fail=1
fi

if (( fail == 0 )); then
    echo "✓ no-hardcoding lint clean"
    exit 0
fi
echo
echo "Append ``# hms-allow-hardcoding`` to the line if the literal"
echo "is genuinely required (e.g. test fixtures asserting a specific"
echo "default), or refactor through the wrapper module."
exit 1

#!/usr/bin/env bash
# Run the Python test suite under the hermes-agent venv.
#
# The repo's local venv/ has neither the upstream agent (tools, gateway,
# run_agent, ...) nor its third-party deps (fastapi, aiohttp, ...), so a bare
# `pytest` fails with `ModuleNotFoundError: No module named 'tools'`. The
# hermes-agent venv has the agent installed editable, so its interpreter
# imports everything without any PYTHONPATH juggling.
#
# Usage:
#   bash scripts/test.sh                       # full suite (tests/)
#   bash scripts/test.sh tests/unit/test_ws.py -q
#   HMS_PYTHON=/path/to/python bash scripts/test.sh

set -euo pipefail

cd "$(dirname "$0")/.."

# Order: HMS_PYTHON > ~/.hermes/hermes-agent/venv > system python3.
# Mirrors scripts/dev.sh:discover_python so dev + test pick the same interpreter.
discover_python() {
    if [[ -n "${HMS_PYTHON:-}" && -x "${HMS_PYTHON:-}" ]]; then
        echo "$HMS_PYTHON"; return
    fi
    # Manual ~ expansion: handles HERMES_HOME being a literal "~/.hermes" string.
    local hermes_home="${HERMES_HOME:-$HOME/.hermes}"
    case "$hermes_home" in
        "~"|"~/"*) hermes_home="${HOME}${hermes_home#\~}" ;;
    esac
    local agent_venv="$hermes_home/hermes-agent/venv/bin/python"
    if [[ -x "$agent_venv" ]]; then
        echo "$agent_venv"; return
    fi
    echo "$(command -v python3)"
}

PY="$(discover_python)"
echo "→ Using Python: $PY"

if ! "$PY" -c "import tools, gateway, run_agent" 2>/dev/null; then
    cat >&2 <<EOF
✗ The chosen Python ($PY) cannot import hermes-agent modules.
  • Install hermes-agent into its venv (~/.hermes/hermes-agent/venv), or
  • Set HMS_PYTHON=/path/to/the/right/python before running scripts/test.sh.
EOF
    exit 1
fi

# Default to the whole suite; forward any caller args (test paths, -k, -q, ...).
if [[ $# -eq 0 ]]; then
    set -- tests/
fi

exec "$PY" -m pytest "$@"

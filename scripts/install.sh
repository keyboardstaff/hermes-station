#!/usr/bin/env bash
# One-command install: build the SPA, install the plugin package into the
# hermes-agent venv (uv-aware — `uv venv` ships no pip), register the plugin
# and enable it in config.yaml. Idempotent; re-run after `git pull` to update.
#
#   ./scripts/install.sh           # full install
#   ./scripts/install.sh --dev     # + dev tools (pyright / ruff / pytest / watchdog)
#   ./scripts/install.sh --skip-frontend   # backend only (dist/ already built)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WITH_DEV=0
SKIP_FRONTEND=0
for arg in "$@"; do
    case "$arg" in
        --dev)           WITH_DEV=1 ;;
        --skip-frontend) SKIP_FRONTEND=1 ;;
        --help|-h)
            sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *) echo "Unknown arg: $arg (see --help)" >&2; exit 2 ;;
    esac
done

HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
VENV="$HERMES_HOME/hermes-agent/venv"
PY="$VENV/bin/python"

if [[ ! -x "$PY" ]]; then
    echo "✗ hermes-agent venv not found at $VENV" >&2
    echo "  Install hermes-agent first (its setup script creates the venv)," >&2
    echo "  or point HERMES_HOME at the right place." >&2
    exit 1
fi

# ── 1. Frontend → dist/ ──────────────────────────────────────────────────────
if [[ "$SKIP_FRONTEND" == 0 ]]; then
    # pnpm only: the lockfile is pnpm-lock.yaml and a stray `npm install`
    # corrupts the .pnpm layout.
    if ! command -v pnpm >/dev/null 2>&1; then
        echo "✗ pnpm not found — install it first:" >&2
        echo "    corepack enable && corepack prepare pnpm@latest --activate" >&2
        echo "  (or: npm install -g pnpm)" >&2
        exit 1
    fi
    echo "→ pnpm install"
    (cd "$REPO_ROOT" && pnpm install)
    echo "→ pnpm build (SPA → dist/)"
    (cd "$REPO_ROOT" && pnpm build)
fi

# ── 2. Python package → hermes-agent venv ────────────────────────────────────
SPEC="$REPO_ROOT"
[[ "$WITH_DEV" == 1 ]] && SPEC="$REPO_ROOT[dev]"

if command -v uv >/dev/null 2>&1; then
    # uv works against any venv, including ones it created without pip.
    echo "→ uv pip install -e (into $VENV)"
    uv pip install -e "$SPEC" --python "$PY"
elif "$PY" -m pip --version >/dev/null 2>&1; then
    echo "→ pip install -e (into $VENV)"
    "$PY" -m pip install -e "$SPEC"
else
    # A uv-created venv has no pip and uv isn't on PATH — bootstrap pip once.
    echo "→ bootstrapping pip (ensurepip) into $VENV"
    "$PY" -m ensurepip --upgrade
    "$PY" -m pip install -e "$SPEC"
fi

# ── 3. Register the plugin + enable it in config.yaml ────────────────────────
echo "→ hms install"
"$VENV/bin/hms" install

echo
echo "✓ Hermes Station installed."
echo
echo "If this is the first install, enable gateway autostart:"
echo "    hermes gateway install"
echo "If the gateway is already running, reload it to pick up the plugin:"
echo "    $VENV/bin/hms restart"

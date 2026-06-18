#!/usr/bin/env bash
# Run Vite (:3131) + Python backend `python -m server dev` (Unix socket) in parallel; Ctrl-C kills both.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Order: HMS_PYTHON > ~/.hermes/hermes-agent/venv > system python3.
# Avoid bootstrap via `python3 -c` — miniconda system python silently lacks hermes_cli.
discover_python() {
    if [[ -n "${HMS_PYTHON:-}" && -x "${HMS_PYTHON:-}" ]]; then
        echo "$HMS_PYTHON"; return
    fi
    # Manual ~ expansion: handles HERMES_HOME being a literal "~/.hermes" string
    # (matches upstream_paths.hermes_home's defensive expanduser).
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
if ! "$PY" -c "import hermes_constants, aiohttp" 2>/dev/null; then
    cat >&2 <<EOF
✗ The chosen Python ($PY) is missing hermes-agent imports.

The Station plugin needs to run inside the same interpreter that
hosts hermes-agent — by default the venv at
\$HERMES_HOME/hermes-agent/venv (typically ~/.hermes/hermes-agent/venv).

Options:
  • Install hermes-agent first (https://hermes-agent.nousresearch.com/docs).
  • Set HMS_PYTHON=/path/to/the/right/python before running pnpm dev.
EOF
    exit 1
fi

PIDS=()
cleanup() {
    echo
    echo "→ Shutting down dev processes"
    # Guard the expansion: macOS bash 3.2 + `set -u` errors on "${PIDS[@]}"
    # when the array is empty (e.g. the preflight exits before any child spawns).
    if [[ ${#PIDS[@]} -gt 0 ]]; then
        for pid in "${PIDS[@]}"; do
            if kill -0 "$pid" 2>/dev/null; then
                kill "$pid" 2>/dev/null || true
            fi
        done
    fi
    wait || true
}
trap cleanup EXIT INT TERM

# Mirror hms_host() into the shell so Vite binds the same address;
# without this a 0.0.0.0 backend stays LAN-unreachable.
if [[ -z "${HMS_HOST:-}" ]]; then
    RESOLVED_HOST="$("$PY" -c 'import sys
try:
    from server.lib import config_reader
    sys.stdout.write(config_reader.hms_host())
except Exception:
    sys.stdout.write("127.0.0.1")
' 2>/dev/null || echo "127.0.0.1")"
    export HMS_HOST="$RESOLVED_HOST"
fi
echo "→ HMS_HOST=$HMS_HOST"

# The dev backend binds a Unix socket — NOT a TCP port — so the only open dev
# port is Vite's 3131 and there's never a clash with the production gateway
# (TCP :1313). Export HMS_DEV_SOCK so the Vite proxy and the Python child use
# the same socket path.
export HMS_DEV_SOCK="${HMS_DEV_SOCK:-$("$PY" -c 'from server.cli import _dev_socket_path; print(_dev_socket_path())')}"

# Preflight: refuse to start if another dev backend is already live on the
# socket (usually a `pnpm dev` still running). A stale socket file from a crash
# is harmless — the backend unlinks it on bind.
if [[ -S "$HMS_DEV_SOCK" ]] && "$PY" -c "import socket,sys; s=socket.socket(socket.AF_UNIX); sys.exit(0 if s.connect_ex('$HMS_DEV_SOCK')==0 else 1)" 2>/dev/null; then
    cat >&2 <<EOF
✗ A dev backend is already live on $HMS_DEV_SOCK.

Likely another \`pnpm dev\` is still running. Stop it first, or set a different
socket: HMS_DEV_SOCK=/tmp/other.sock pnpm dev
EOF
    exit 1
fi
echo "→ Dev backend socket: $HMS_DEV_SOCK"

# Start the backend FIRST and wait for it to bind the socket, then start Vite —
# otherwise Vite proxies the first /api/* requests into a socket nothing is
# listening on yet (the transient "ECONNREFUSED .../station-dev.sock" errors).
echo "→ Starting Python dev backend (Unix socket)…"
# HMS_ENV=dev enables permissive localhost CORS so Vite can talk to aiohttp.
# Entry point is the `dev` subcommand of the `server` package CLI
# (server/cli.py); there is no standalone `server.dev_server` module.
HMS_ENV=dev "$PY" -m server dev --reload &
PIDS+=($!)

echo "→ Waiting for the dev backend to accept connections…"
for _ in $(seq 1 100); do  # up to ~10s (100 × 0.1s)
    if [[ -S "$HMS_DEV_SOCK" ]] && "$PY" -c "import socket,sys; s=socket.socket(socket.AF_UNIX); sys.exit(0 if s.connect_ex('$HMS_DEV_SOCK')==0 else 1)" 2>/dev/null; then
        break
    fi
    sleep 0.1
done

# Discover pnpm — mirrors install.sh; duplicated here so dev.sh stays
# self-contained (no sourced helper). Resolution order: PATH → PNPM_HOME →
# corepack → npx.
probe_ok() { "$@" --version >/dev/null 2>&1; }
PNPM=()
if command -v pnpm >/dev/null 2>&1 && probe_ok pnpm; then
    PNPM=(pnpm)
else
    for pnpm_dir in "${PNPM_HOME:-}" "$HOME/.local/share/pnpm" "$HOME/Library/pnpm"; do
        if [[ -n "$pnpm_dir" && -x "$pnpm_dir/pnpm" ]] && probe_ok "$pnpm_dir/pnpm"; then
            PNPM=("$pnpm_dir/pnpm")
            break
        fi
    done
fi
if [[ ${#PNPM[@]} -eq 0 ]] && command -v corepack >/dev/null 2>&1; then
    export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    if probe_ok corepack pnpm; then
        PNPM=(corepack pnpm)
    fi
fi
if [[ ${#PNPM[@]} -eq 0 ]] && command -v npx >/dev/null 2>&1; then
    PNPM_PIN="$(sed -n 's/^[[:space:]]*"packageManager":[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO_ROOT/package.json")"
    if probe_ok npx -y "${PNPM_PIN:-pnpm}"; then
        PNPM=(npx -y "${PNPM_PIN:-pnpm}")
    fi
fi
if [[ ${#PNPM[@]} -eq 0 ]]; then
    cat >&2 <<'EOF'
✗ pnpm not found (tried PATH, PNPM_HOME, corepack, npx).
  Install Node.js ≥ 18 first, then install pnpm via one of:
    npm install -g pnpm
    corepack enable
  If you used pnpm's standalone installer, open a NEW terminal so PNPM_HOME
  is on your PATH, or: export PATH="$HOME/Library/pnpm:$PATH"  (macOS)
EOF
    exit 1
fi

echo "→ Starting Vite (port 3131)…"
"${PNPM[@]}" dev:client &
PIDS+=($!)

wait

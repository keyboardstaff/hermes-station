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
    # corrupts the .pnpm layout. Every candidate is PROBED with `--version`
    # before being adopted — present-but-broken tools fall through (e.g.
    # Debian/Kali's `corepack` system package crashes running modern pnpm:
    # ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING). Resolution order:
    #   1. pnpm on PATH;
    #   2. the standalone installer's home — it only appends PNPM_HOME to the
    #      shell rc, so the terminal that just ran it (and any script) doesn't
    #      see it until a new shell;
    #   3. corepack (ships with Node ≥ 16.13) running pnpm directly — no
    #      `corepack enable` needed, so no root and no global mutation; honors
    #      package.json's packageManager pin;
    #   4. npx, fetching the exact packageManager-pinned version.
    probe_ok() { "$@" --version >/dev/null 2>&1; }

    PNPM=()
    if command -v pnpm >/dev/null 2>&1 && probe_ok pnpm; then
        PNPM=(pnpm)
    else
        for dir in "${PNPM_HOME:-}" "$HOME/.local/share/pnpm" "$HOME/Library/pnpm"; do
            if [[ -n "$dir" && -x "$dir/pnpm" ]] && probe_ok "$dir/pnpm"; then
                PNPM=("$dir/pnpm")
                break
            fi
        done
    fi
    if [[ ${#PNPM[@]} -eq 0 ]] && command -v corepack >/dev/null 2>&1; then
        export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
        if probe_ok corepack pnpm; then
            PNPM=(corepack pnpm)
        else
            echo "! corepack is present but can't run pnpm (Debian/Kali's corepack" >&2
            echo "  package is known-broken) — falling back to npx" >&2
        fi
    fi
    if [[ ${#PNPM[@]} -eq 0 ]] && command -v npx >/dev/null 2>&1; then
        # e.g. "pnpm@11.5.2" — keeps the npx route on the lockfile's version.
        PNPM_PIN="$(sed -n 's/^[[:space:]]*"packageManager":[[:space:]]*"\([^"]*\)".*/\1/p' "$REPO_ROOT/package.json")"
        if probe_ok npx -y "${PNPM_PIN:-pnpm}"; then
            PNPM=(npx -y "${PNPM_PIN:-pnpm}")
        fi
    fi
    if [[ ${#PNPM[@]} -eq 0 ]]; then
        echo "✗ pnpm not found (no pnpm, corepack or npx on PATH)." >&2
        echo "  Install Node.js ≥ 18 first, then one of:" >&2
        echo "    corepack enable        (may need sudo with a system node)" >&2
        echo "    npm install -g pnpm" >&2
        echo "  If you installed pnpm via its standalone installer, open a NEW" >&2
        echo "  terminal — it only adds PNPM_HOME to your shell rc." >&2
        exit 1
    fi
    echo "→ ${PNPM[*]} install"
    (cd "$REPO_ROOT" && "${PNPM[@]}" install)
    echo "→ ${PNPM[*]} build (SPA → dist/)"
    (cd "$REPO_ROOT" && "${PNPM[@]}" build)
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

# ── 4. Symlink hms into PATH ──────────────────────────────────────────────────
# Try /usr/local/bin first (on PATH everywhere, writable on macOS + most Linux).
# Fall back to ~/.local/bin (XDG user-bin; always writable, may need PATH edit).
HMS_CMD="$VENV/bin/hms"
_HMS_LINK_CREATED=0
for _ldir in "/usr/local/bin" "$HOME/.local/bin"; do
    [[ "$_ldir" == "$HOME/.local/bin" ]] && mkdir -p "$_ldir"
    if [[ -d "$_ldir" ]] && ln -sf "$VENV/bin/hms" "$_ldir/hms" 2>/dev/null; then
        echo "→ hms symlinked → $_ldir/hms"
        HMS_CMD="hms"
        _HMS_LINK_CREATED=1
        # Warn if ~/.local/bin was used but isn't in PATH yet (bare system).
        if [[ "$_ldir" == "$HOME/.local/bin" && ":${PATH}:" != *":$HOME/.local/bin:"* ]]; then
            echo "  ⚠  ~/.local/bin is not in your PATH yet."
            echo "     Add to ~/.zshrc (zsh) or ~/.bash_profile (bash):"
            echo "       export PATH=\"\$HOME/.local/bin:\$PATH\""
            echo "     Then restart your shell or: source ~/.zshrc"
        fi
        break
    fi
done
if [[ "$_HMS_LINK_CREATED" == 0 ]]; then
    echo "! Could not write to /usr/local/bin or ~/.local/bin — no hms symlink created." >&2
    echo "  To use hms from anywhere, add $VENV/bin to your PATH, or:" >&2
    echo "    sudo ln -sf $VENV/bin/hms /usr/local/bin/hms" >&2
fi

echo
echo "✓ Hermes Station installed."
echo
echo "If this is the first install, enable gateway autostart:"
echo "    hermes gateway install"
echo "If the gateway is already running, reload it to pick up the plugin:"
echo "    $HMS_CMD restart"

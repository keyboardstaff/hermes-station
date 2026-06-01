#!/usr/bin/env bash
# Symlink (default) or copy (--copy) the station plugin into hermes-agent's plugin tree. Idempotent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

discover_hermes_home() {
    local home
    home="$(python3 - <<'PY' 2>/dev/null || true
try:
    from hermes_constants import get_hermes_home
    print(get_hermes_home())
except Exception:
    pass
PY
)"
    if [[ -n "$home" ]]; then
        echo "$home"
        return
    fi
    echo "${HERMES_HOME:-$HOME/.hermes}"
}

HERMES_HOME="$(discover_hermes_home)"
AGENT_ROOT="$HERMES_HOME/hermes-agent"
TARGET_DIR="$AGENT_ROOT/plugins/platforms/station"

MODE="symlink"
for arg in "$@"; do
    case "$arg" in
        --copy)    MODE="copy" ;;
        --help|-h)
            cat <<EOF
Usage: install_plugin.sh [--copy]

  --copy   Deep-copy the plugin instead of symlinking.

Detected:
  HERMES_HOME   = $HERMES_HOME
  Plugin target = $TARGET_DIR
EOF
            exit 0
            ;;
        *) echo "Unknown arg: $arg" >&2; exit 2 ;;
    esac
done

if [[ ! -d "$AGENT_ROOT" ]]; then
    echo "✗ hermes-agent not found at $AGENT_ROOT" >&2
    echo "  Install hermes-agent first, or set HERMES_HOME=/path/to/.hermes" >&2
    exit 1
fi

echo "→ Installing station plugin into $TARGET_DIR ($MODE mode)"
mkdir -p "$TARGET_DIR"

link_or_copy() {
    local src="$1" dst="$2"
    if [[ -e "$dst" || -L "$dst" ]]; then
        rm -rf "$dst"
    fi
    if [[ "$MODE" == "copy" ]]; then
        cp -R "$src" "$dst"
    else
        ln -s "$src" "$dst"
    fi
}

link_or_copy "$REPO_ROOT/server"      "$TARGET_DIR/server"
link_or_copy "$REPO_ROOT/plugin.yaml" "$TARGET_DIR/plugin.yaml"

# dist/ may not exist pre `pnpm build` — symlink anyway; production tolerates missing dist/.
if [[ ! -e "$REPO_ROOT/dist" ]]; then
    mkdir -p "$REPO_ROOT/dist"
fi
link_or_copy "$REPO_ROOT/dist" "$TARGET_DIR/dist"

# Self-publish plugin dir to sys.path so absolute `from server.X import Y` imports resolve.
cat >"$TARGET_DIR/__init__.py" <<'PY'
import sys
from pathlib import Path
_plugin_dir = str(Path(__file__).resolve().parent)
if _plugin_dir not in sys.path:
    sys.path.insert(0, _plugin_dir)
from server import register

__all__ = ["register"]
PY

echo "✓ Plugin files in place"
echo
echo "Next steps:"
echo "  1. Edit $HERMES_HOME/config.yaml — under platforms.station set enabled: true"
echo "     (or run \`hms install\` to have the CLI do this automatically)"
echo "  2. Start the gateway: hermes gateway run   (or systemd/launchd via \`hermes gateway start\`)"
echo "  3. Open the UI:       http://localhost:\$(python3 -c 'from server.lib.config_reader import hms_port; print(hms_port())' 2>/dev/null || echo 3131)"

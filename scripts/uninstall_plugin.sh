#!/usr/bin/env bash
# Remove plugin files only — does NOT touch config.yaml or systemd/launchd (that's `hms uninstall`).

set -euo pipefail

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
TARGET_DIR="$HERMES_HOME/hermes-agent/plugins/platforms/station"

if [[ ! -e "$TARGET_DIR" ]]; then
    echo "Nothing to do — $TARGET_DIR does not exist."
    exit 0
fi

echo "→ Removing $TARGET_DIR"
rm -rf "$TARGET_DIR"
echo "✓ Plugin files removed."
echo
echo "Note: station entries in $HERMES_HOME/config.yaml and any"
echo "      launchd/systemd units are NOT touched. Disable them with:"
echo "        hms uninstall    # purges platforms.station from config.yaml"
echo "      or manually delete the platforms.station section yourself"
echo "      and run \`hermes gateway uninstall\`."

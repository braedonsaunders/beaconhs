#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
TARGET_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
TARGET_FILE="$TARGET_DIR/beaconhs-dev.desktop"

mkdir -p "$TARGET_DIR"

cat >"$TARGET_FILE" <<DESKTOP
[Desktop Entry]
Version=1.0
Type=Application
Name=BeaconHS Dev
Comment=Install dependencies and run BeaconHS in development mode
Exec=$SCRIPT_DIR/dev-launcher.sh
Path=$REPO_ROOT
Icon=utilities-terminal
Terminal=true
Categories=Development;
StartupNotify=false
DESKTOP

chmod +x "$TARGET_FILE"
printf 'Installed %s\n' "$TARGET_FILE"

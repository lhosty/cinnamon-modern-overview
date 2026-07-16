#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
TARGET=/usr/share/cinnamon/js/ui
SCHEMA_DIR=/usr/share/glib-2.0/schemas
LEGACY_SCHEMA="$SCHEMA_DIR/org.cinnamon.overview-modern.gschema.xml"
STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="$HOME/cinnamon-overview-backup-before-v19-$STAMP"
FILES="main.js overview.js appGrid.js searchResults.js workspace.js workspacesView.js panel.js"

mkdir -p "$BACKUP"
for file in $FILES; do
    test -f "$ROOT/patched/$file"
    test -f "$TARGET/$file"
    cp "$TARGET/$file" "$BACKUP/$file"
done

for file in $FILES; do
    sudo install -m 0644 "$ROOT/patched/$file" "$TARGET/$file"
done

if [ -f "$LEGACY_SCHEMA" ]; then
    sudo rm -f "$LEGACY_SCHEMA"
    sudo glib-compile-schemas "$SCHEMA_DIR"
fi

printf '%s\n' "$BACKUP" > "$HOME/.ovm-v19-last-backup"
printf 'Modern Overview v19 installed.\nBackup: %s\n' "$BACKUP"
printf 'The panel now remains visible as an Overview dock and restores its native visibility mode on exit.\n'
printf 'End the Cinnamon session completely and sign in again.\n'

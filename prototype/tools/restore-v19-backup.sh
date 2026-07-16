#!/bin/sh
set -eu

TARGET=/usr/share/cinnamon/js/ui
MARKER="$HOME/.ovm-v19-last-backup"
FILES="main.js overview.js appGrid.js searchResults.js workspace.js workspacesView.js panel.js"

test -f "$MARKER"
BACKUP=$(cat "$MARKER")
test -d "$BACKUP"

for file in $FILES; do
    test -f "$BACKUP/$file"
    sudo install -m 0644 "$BACKUP/$file" "$TARGET/$file"
done

printf 'Backup restored from: %s\n' "$BACKUP"
printf 'End the Cinnamon session completely and sign in again.\n'

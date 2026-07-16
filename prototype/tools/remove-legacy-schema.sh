#!/bin/sh
set -eu

SCHEMA_DIR=/usr/share/glib-2.0/schemas
LEGACY_SCHEMA="$SCHEMA_DIR/org.cinnamon.overview-modern.gschema.xml"

if [ -f "$LEGACY_SCHEMA" ]; then
    sudo rm -f "$LEGACY_SCHEMA"
    sudo glib-compile-schemas "$SCHEMA_DIR"
    printf 'Legacy Modern Overview schema removed.\n'
else
    printf 'Legacy Modern Overview schema is not installed.\n'
fi

printf 'v17 does not read any project-specific GSettings key.\n'

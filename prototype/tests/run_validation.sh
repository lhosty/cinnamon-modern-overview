#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

for file in "$ROOT"/patched/*.js; do
    node --check "$file"
done

for script in "$ROOT"/install-v19.sh \
              "$ROOT"/restore-v19-backup.sh \
              "$ROOT"/remove-legacy-schema.sh; do
    sh -n "$script"
done

node "$ROOT/tests/validate.js"

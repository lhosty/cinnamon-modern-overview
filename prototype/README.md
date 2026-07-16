# Proof of concept source

This directory contains the final v19 proof of concept tested on Cinnamon 6.6.7 under X11.

## Contents

- `patched/`: complete modified JavaScript files.
- `patches/`: cumulative patch and the last incremental patch.
- `tests/`: validation scripts.
- `tools/`: install, restore and legacy-cleanup scripts from the prototype package.
- `VALIDATION.txt`: latest validation output.

## Warning

These files replace Cinnamon core JavaScript components. They are supplied for maintainer review and advanced testing only.

The cumulative patch is based on the original Cinnamon files used during development and may not apply cleanly to current master. Rebase and review are required.

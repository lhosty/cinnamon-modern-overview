# Technical overview

## Design principle

The prototype extends Cinnamon's existing shell components instead of adding a second shell, daemon or standalone launcher.

## Modified files and responsibilities

### `main.js`

- Routes overlay-key and physical Super events.
- Prevents modal Super events from reaching Cinnamon's generic close action.
- Handles duplicate releases and bare-Super cancellation.

### `overview.js`

- Owns Overview state, Windows/Applications modes and transitions.
- Implements the double-Super state machine.
- Coordinates unified search, view switching, swipe capture and lifecycle cleanup.
- Uses reversible close animation and deferred teardown.
- Coordinates panel Overview mode.

### `appGrid.js`

- Implements the application grid, paging, focus movement and application activation.
- Integrates application context actions and running-state behavior.

### `searchResults.js`

- Presents grouped application, file, web and calculator results.
- Manages keyboard navigation and result activation.

### `workspace.js`

- Enables native DND for window clones.
- Supports workspace drop targets and window movement.
- Implements geometry-based arrow navigation between window clones.

### `workspacesView.js`

- Owns workspace swipe begin/end behavior.
- Rounds and clamps workspace targets.
- Separates logical workspace activation from visual settle animation.

### `panel.js`

- Adds an explicit Overview mode for panels.
- Reveals hideable panels as docks without changing the user's persistent setting.
- Restores auto-hide/intelligent-hide state when leaving.
- Fixes intelligent-hide refresh when focus becomes null.

### `layout.js`

- Audited but not modified in the final prototype.
- Existing work-area behavior is reused for panel-aware Overview geometry.

## Patch size

Relative to the Cinnamon 6.6.7 source files used as the prototype base:

- 7 files modified;
- approximately 5,726 insertions;
- approximately 836 deletions.

This size reflects a mature proof of concept built through many iterations. Upstream work should likely be split into smaller reviewable changes.

## Suggested upstream split

1. Spatial window navigation.
2. Safe/native workspace swipe and DND integration.
3. Panel Overview mode and intelligent-hide fixes.
4. Applications mode and app grid.
5. Unified search presentation.
6. Super input routing and mode state machine.
7. Transition/performance cleanup.

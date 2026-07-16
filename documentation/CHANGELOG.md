# Cinnamon Modern Overview — development changelog

This changelog documents the evolution of the proof of concept. Experimental releases are included to show how the current behavior was reached; only the latest state should be evaluated as the proposed experience.

## v19 — Spatial keyboard navigation

- Replaced purely index-based arrow navigation with navigation based on the real transformed center of each window clone.
- Fixed reversed left/right behavior in centered incomplete rows, such as three-window layouts.
- Improved navigation for irregular layouts with five, seven, ten or more windows.
- Kept Cinnamon's `GridNavigator` as a compatibility fallback when geometry is unavailable.

## v18 — Panel as an Overview dock

- Added a dedicated panel Overview mode instead of disabling panels through opacity animations.
- Kept always-visible panels present through Overview opening and closing.
- Temporarily revealed auto-hidden and intelligently-hidden panels as interactive docks in the Overview.
- Restored each panel to its configured behavior on exit.
- Fixed intelligent-hide recalculation when no window has focus.
- Reserved panel edges in Overview content geometry to prevent overlap.
- Removed the visible empty panel gap during Overview closing.

## v17 — Reversible close animation and deferred teardown

- Turned the double-Super recognition window into an immediate visible close animation.
- Made a second Super reverse the in-progress close and open Applications.
- Removed the silent wait before closing.
- Released desktop interaction before heavy actor destruction.
- Deferred Overview actor-tree teardown to an idle callback.
- Protected rapid reopen against delayed cleanup.

## v16 — Input timing and close responsiveness

- Reduced the double-Super interval from 700 ms to 450 ms.
- Shortened closing animation duration.
- Changed closing easing to start responding immediately.

## v15 — Native Super integration without project-specific settings

- Removed the custom `org.cinnamon.overview-modern` GSettings dependency.
- Registered the Overview Super behavior as part of Cinnamon's core input flow.
- Removed per-user activation requirements and schema installation.

## v14 — Diagnostic-driven Super and swipe fixes

- Intercepted Super inside the Overview modal before Cinnamon's generic keybinding dispatcher could close it.
- Dispatched bare-Super activation on key release rather than key press.
- Added duplicate-release protection and cancellation for `Super + another key`.
- Added safe capability checks for adjustment transition cleanup.
- Rounded and clamped workspace swipe destinations to integer workspace indexes.
- Guaranteed logical swipe-state cleanup with `try/finally`.

## v13 + hotfix — Direct background swipe target and shortcut state

- Connected empty workspace drop/background actors directly to the background-swipe entry point.
- Moved shortcut sequence state into the Overview.
- Added a hotfix for a missing GLib import that prevented the Overview from opening.

## v12 — Input-path experiments

- Restored stage capture for background motion.
- Added physical-button polling to recover from missing release events.
- Changed overlay-key dispatch behavior.
- This release remained experimental and did not resolve all modal-input conflicts.

## v11 — Explicit swipe target and Super event restructuring

- Added explicit target values to workspace swipe completion.
- Separated logical swipe completion from visual settle animation.
- Added generation guards and timeout fallback for interrupted settles.
- Reworked physical Super and overlay-key fallback routing.

## v10 — Early state and cleanup refinements

- Narrowed drag close guards to Overview window drag rather than global drag state.
- Delayed workspace activation until swipe completion.
- Added early adjustment settle callbacks and input guards.
- This was an intermediate experimental release.

## v9 — Native window drag-and-drop

- Enabled native Cinnamon DND for Overview window clones.
- Added workspace monitor drop targets.
- Added edge-hover workspace switching while dragging windows.
- Added drag lifecycle cleanup and click suppression after dragging.
- Filtered background swipe initiation from window actors.

## v1–v8 — Foundation and interface development

- Expanded Cinnamon's existing Overview rather than replacing the desktop shell.
- Added distinct Windows and Applications modes.
- Added an application grid and integrated search presentation.
- Added application, web, file and calculator result groups.
- Added keyboard focus/navigation between the grid, search and Overview.
- Added context actions for applications and running windows.
- Iterated on spacing, text truncation, animation, search layout and interaction consistency.

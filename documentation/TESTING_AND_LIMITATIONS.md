# Testing scope and limitations

## Confirmed in a real session

- Cinnamon 6.6.7.
- X11 session.
- Windows Overview opening and closing.
- Double-Super Applications workflow.
- Applications mode and search.
- Background workspace swipe.
- Window drag-and-drop between workspaces.
- Panel as an Overview dock.
- Auto-hide/intelligent-hide restoration.
- Spatial keyboard navigation with incomplete window rows.

## Automated validation included

The included validation reports 32 checks covering:

- Super routing and duplicate handling;
- close/reopen state transitions;
- panel Overview mode;
- workspace swipe target settlement;
- spatial window navigation;
- patch application;
- byte-for-byte output verification;
- archive integrity.

These are static and behavioral-model checks. They do not replace compositor-level integration tests.

## Not yet broadly validated

- Wayland.
- Multiple-monitor arrangements in live testing.
- Mixed DPI and fractional scaling.
- Vertical or side panels across all themes.
- RTL layout.
- Screen readers and full accessibility review.
- Touchscreens and touchpads beyond mouse-style captured events.
- Low-end GPUs and a broad performance matrix.
- Current Cinnamon master after rebase.

## Safety note

The prototype replaces Cinnamon core JavaScript files. It should only be tested by developers or advanced users with backups and a recovery method. It is not a distribution package.

# Title

A native productivity Overview for Cinnamon: faster multitasking across windows, apps, files, web and workspaces

# Body

I would like to share a working proof of concept that expands Cinnamon's existing Overview into a native productivity hub for multitasking—without replacing the traditional desktop, panel, menu or window-management model that defines Cinnamon.

This is not only a visual redesign or a mock-up. The prototype has been developed and tested on Cinnamon 6.6.7 under X11. It brings window management, application launching, file discovery, quick calculations, web navigation and workspace control into one coherent interface that can be operated efficiently with the keyboard, mouse or touchpad.

## Why this could be valuable

A typical work session now involves several parallel tasks: a browser, documents, spreadsheets, communication tools, terminals, file-manager windows and applications spread across multiple workspaces. Cinnamon already provides the individual pieces needed to manage this, but the workflow is divided between the panel, menu, Overview, keyboard shortcuts, file manager and browser.

The proposed Overview creates a single temporary workspace for answering common questions quickly:

- What is already open?
- Which window do I need next?
- Where is the application, file or folder I need?
- Can I move this task to another workspace?
- Can I calculate something without interrupting my current work?
- Can I open a website or search the web without first opening a browser window?

The goal is to reduce context switching, pointer travel and repeated menu navigation. The user presses `Super`, completes the task, and returns to work.

## The proposed workflow

### Windows and Applications as two connected modes

- `Super` opens the Windows Overview.
- `Super` twice within 400 ms opens Applications directly.
- `Super` from Applications returns to Windows.
- `Super` from Windows closes the Overview with a visible, reversible animation.
- A visible Windows/Applications selector keeps the workflow discoverable for users who prefer the mouse.

This provides a fast keyboard path without removing the traditional Cinnamon menu or changing the normal desktop outside the Overview.

### Productive keyboard-first navigation

The interface is designed so that many routine actions do not require constant mouse use:

- arrow-key navigation between window previews based on their real screen positions;
- correct spatial navigation even when the last row is incomplete;
- keyboard movement through the application grid and search results;
- `Enter` to activate the selected window, application, file or action;
- predictable movement between the search field, results, window view and application view;
- context actions for applications without leaving the Overview.

This is especially useful during long multitasking sessions, for users who prefer keyboard-driven workflows, and on notebooks where repeated touchpad movement is slower and less comfortable than a short key sequence.

### Unified search that does more than launch applications

The search field is intended as a practical command surface, not only an application filter. The current prototype supports:

- application search with ranked matching and limited typo tolerance;
- local file and folder discovery, prioritizing recent documents and common user directories;
- cancellable asynchronous file enumeration with strict time, depth and candidate limits so typing remains responsive;
- direct opening of files and folders with their default applications;
- arithmetic calculations with parentheses, operator precedence, powers, decimals and unary signs;
- opening the expression in a compatible calculator, or copying the result when the installed calculator cannot preload it;
- direct URLs and domains opened in the default browser;
- ordinary text converted into a web search in the default browser;
- grouped results that remain navigable entirely by keyboard.

Examples of tasks that can be completed without leaving the Overview:

```text
2450 * 1.08
(128 + 64) / 3
linuxmint.com
https://github.com/linuxmint/cinnamon
quarterly report
Calculator
```

The important point is not the number of providers by itself. It is that launching an app, finding a document, calculating a value and opening a website all follow the same interaction model.

### Application grid with useful running-state actions

The Applications mode is more than a static icon grid. The prototype includes application actions such as:

- open or focus an application;
- open a new window when supported;
- show one or several already-open windows;
- expose desktop-file actions;
- launch using discrete-GPU offloading when available;
- close the application's open windows when supported.

This connects application launching with current task management instead of treating them as unrelated interfaces.

### Faster workspace management

The Overview also makes workspaces a first-class part of daily multitasking:

- drag the empty background horizontally to move between workspaces;
- drag window previews to another workspace;
- use edge switching while dragging a window;
- keep logical workspace activation synchronized with the visual animation;
- navigate windows spatially instead of relying on an index that can feel reversed in uneven layouts.

This makes organizing work by project or activity easier to understand and faster to perform.

### The existing Cinnamon panel becomes an Overview dock

When a panel uses auto-hide or intelligent hide, the prototype temporarily reveals that same panel while the Overview is open. It acts as a familiar dock without introducing a second dock implementation.

This means users keep access to their existing:

- launchers;
- grouped window list;
- system tray;
- clock and calendar;
- status applets;
- custom panel applets.

When the Overview closes, the panel returns to the user's original auto-hide or intelligent-hide behavior. Always-visible panels remain visible throughout the transition, avoiding the empty reserved gap that previously appeared while the panel faded back in.

## Why this approach fits Cinnamon

The proposal is not to turn Cinnamon into GNOME Shell. The normal Cinnamon experience remains unchanged:

- the traditional panel still exists;
- the application menu still exists;
- desktop icons and normal windows still behave as expected;
- the Overview appears only when the user deliberately invokes it.

The difference is that Cinnamon gains an optional high-efficiency layer for people who manage many simultaneous tasks. Users who never need it can continue using Cinnamon exactly as they do today. Users who do need it gain a faster and more coherent workflow without installing a separate launcher, dock, window switcher or search utility.

It also reuses Cinnamon's own infrastructure—Overview, workspaces, panels, applets, search providers, keybindings and drag-and-drop—rather than creating a parallel desktop shell inside Cinnamon.

## Practical benefits

### For multitasking

Windows, applications, files, quick actions and workspaces are visible in one place. This reduces the mental and mechanical cost of switching between tools while working on several tasks.

### For keyboard-oriented users

Common actions become reachable through `Super`, arrows and `Enter`, reducing dependence on the pointer and making repeated task switching faster.

### For notebook users

A compact screen and touchpad benefit from a single overview where windows can be inspected, selected, reorganized and launched without repeatedly moving across the panel, menu and desktop. Workspace swiping also fits naturally with touchpad-oriented use.

### For new and existing Cinnamon users

The Windows/Applications selector makes the feature discoverable, while the familiar panel and desktop remain intact. The learning curve is low because the proposal extends existing Cinnamon concepts instead of replacing them.

### For the Cinnamon project

Several parts have independent upstream value even if the complete proposal is not adopted at once:

- spatial keyboard navigation for uneven window layouts;
- stable workspace swipe and window drag-and-drop;
- panel restoration and intelligent-hide fixes;
- a reusable panel Overview mode;
- application-grid and context-action improvements;
- asynchronous local file search;
- calculation and URL handling in search;
- reversible, low-latency Overview transitions.

## Prototype status

The attached package includes:

- the modified Cinnamon JavaScript files;
- a cumulative patch;
- the final incremental patch;
- screenshots;
- a full development changelog;
- technical notes;
- install and restore tools;
- validation output and behavioral tests.

It has been tested in a real Cinnamon 6.6.7 X11 session. The validation suite contains 32 static and behavioral checks, but this remains a proof of concept rather than a merge-ready pull request. A proper upstream effort would still require rebasing, Cinnamon coding-style review, accessibility review, Wayland testing, broader theme and multi-monitor testing, and performance testing on more hardware.

## Questions for the community and maintainers

1. Would this improve your real daily workflow when several windows and tasks are open?
2. Does the `Super` / double-`Super` model feel fast and understandable?
3. Should the search field combine applications, files, calculations, URLs and web actions, or should some providers be optional?
4. Does revealing the existing auto-hidden panel as an Overview dock feel natural?
5. Which parts should be proposed upstream first as smaller, reviewable changes?
6. Are there keyboard, touchpad, accessibility or multi-monitor behaviors that should be considered before formalizing the design?

I believe this has the potential to give Cinnamon a noticeably stronger productivity workflow while preserving the traditional desktop experience that its users value. The intention of this discussion is to determine whether the community sees the same value and how the work could be shaped into an upstream-friendly direction.

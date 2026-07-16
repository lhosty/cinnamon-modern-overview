# Title

Modernize Cinnamon's Overview into a unified window, application and workspace hub

# Body

## Summary

I would like to propose an evolution of Cinnamon's existing Overview into a unified, native productivity hub for windows, applications, search and workspaces—while preserving Cinnamon's traditional desktop, panel and familiar workflow.

This is not only a visual mock-up. I built and tested a working proof of concept on Cinnamon 6.6.7 under X11. The attached archive contains the modified source files, a cumulative patch, screenshots, validation output and a technical summary.

## Why this would be valuable

Cinnamon already has strong individual components: a traditional panel, window overview, workspaces, application launching and search. The current experience, however, keeps many of these tasks separated.

A unified Overview reduces the number of context switches required to:

- find a running window;
- move a window to another workspace;
- launch an application;
- search for an application or file;
- perform a quick calculation or web search;
- navigate entirely by keyboard;
- use the panel as a familiar dock while managing windows.

The main goal is not to change Cinnamon's identity. It is to make the existing desktop faster and more discoverable while keeping the traditional panel and desktop available exactly as users expect outside the Overview.

## Proposed interaction model

### Window and application modes

The Overview has two clear modes:

- **Windows** — running windows and workspace navigation;
- **Applications** — application grid and application search.

The user can switch modes through the visible selector or with the keyboard.

### Super key workflow

- `Super` from the desktop opens the Windows Overview.
- `Super` twice within 400 ms opens Applications.
- `Super` from Applications returns to Windows.
- `Super` from Windows closes the Overview with a visible, reversible animation.
- A second Super during that closing animation cancels the close and opens Applications.

This keeps single-Super behavior fast while making the application grid immediately accessible.

### Unified search

Typing in the Overview can provide:

- applications;
- files;
- web search;
- calculator results;
- existing Cinnamon search providers.

The proof of concept keeps the interface simple: one search field, grouped results and keyboard navigation.

### Workspace interaction

- Drag the empty background horizontally to switch workspaces.
- Drag window clones between workspaces.
- Use edge-hover switching while dragging a window.
- Use arrow keys to navigate windows according to their real visual position, including incomplete or irregular rows.

### Panel as an Overview dock

When the panel is configured for auto-hide or intelligent hide, it becomes temporarily visible and interactive while the Overview is open.

When leaving the Overview, the panel returns to its configured behavior. Always-visible panels remain visible without a delayed fade or an empty reserved gap.

This reuses the user's existing panel and applets instead of introducing a second dock implementation.

## User benefits

- Faster keyboard-driven and mouse-driven task switching.
- Better discoverability for workspaces and running windows.
- A direct application-grid workflow without replacing the traditional menu.
- Familiar panel applets remain available inside the Overview.
- Better navigation in layouts with many windows.
- More consistent visual transitions and less perceived latency.
- A modern workflow that remains recognizably Cinnamon.

## Implementation benefits

The prototype is implemented inside Cinnamon's existing JavaScript UI architecture. It does not require a separate daemon or a project-specific GSettings schema.

The work is divided across existing responsibilities:

- Overview state and transitions;
- application grid and search results;
- workspace swipe and window drag-and-drop;
- keyboard routing;
- panel Overview mode;
- spatial window navigation.

The attached validation suite contains 32 static and behavioral checks, plus patch application and byte-for-byte verification. This does not replace real compositor testing, but it helped prevent regressions while iterating on input handling and animation state.

## Prototype status and limitations

Tested:

- Cinnamon 6.6.7;
- X11 session;
- real daily-use workflow;
- window Overview, application mode, search, Super routing, workspace swipe, window drag-and-drop and panel integration.

Still needed before upstream integration:

- rebase against current Cinnamon master;
- coding-style and architecture review;
- Wayland testing;
- multi-monitor testing across different layouts and scale factors;
- vertical/top/side panel testing;
- RTL and accessibility review;
- broader theme and hardware testing;
- decision on defaults and configuration options.

I am not asking for the current patch to be merged unchanged. I am asking whether this interaction model is a direction the Cinnamon project would consider, and what architectural changes maintainers would require for an upstream-quality implementation.

## Questions for maintainers and the community

1. Should the unified Overview be the default evolution of the current Overview, or an optional mode?
2. Should double-Super be enabled by default or configurable?
3. Should auto-hidden/intelligently-hidden panels always appear as a dock inside the Overview?
4. Should application/file/web/calculator results share one search view, or should some providers remain optional?
5. Would maintainers prefer this work split into smaller independent proposals and pull requests?

## Attachments

The attached archive includes:

- sanitized screenshots;
- full feature changelog;
- technical architecture summary;
- tested-scope and known-limitations document;
- cumulative patch;
- complete modified JavaScript files;
- validation scripts and results;
- GPL license and modification notice.

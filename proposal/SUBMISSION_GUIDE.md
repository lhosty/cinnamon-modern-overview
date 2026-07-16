# Submission guide

## Recommended channel

Use **Linux Mint GitHub Discussions → Ideas** as the primary post. The Cinnamon section of the Linux Mint forum directs feature ideas to the Linux Mint GitHub Discussions area.

The Cinnamon repository currently restricts creation of new issues, so the proposal should begin as an Idea/Discussion rather than as a bug report or a merge request.

## Recommended post order

1. Title.
2. One-paragraph summary focused on user value.
3. Three screenshots displayed inline.
4. Current workflow problem.
5. Proposed behavior.
6. Benefits to Cinnamon users and maintainers.
7. Prototype status and limitations.
8. Questions for maintainers/community.
9. Attach the archive at the end.

## Best title

**Modernize Cinnamon's Overview into a unified window, application and workspace hub**

Alternative title:

**Proposal: A native unified Overview for windows, apps, search and workspace navigation**

## Screenshots

Screenshots are strongly recommended. They make the idea understandable before a reviewer reads the technical details.

Upload these three directly into the post:

1. `01-window-overview-panel-dock.png`
2. `02-applications-and-search.png`
3. `03-calculator-and-web-search.png`

Keep `04-panel-restore-gap-before-fix.png` for a technical reply explaining the panel integration bug that the prototype fixed.

A short 15–25 second screen recording would be even more persuasive. Suggested sequence:

1. Press Super to open the window Overview.
2. Press Super twice to open Applications.
3. Type an application name and a calculator expression.
4. Return to Windows.
5. Swipe between workspaces.
6. Drag a window to another workspace.
7. Close the Overview and show the panel restoring without a visual gap.

## Positioning

Present the work as:

- an evolution of Cinnamon's existing Overview;
- a working proof of concept;
- compatible with Cinnamon's traditional desktop identity;
- a request for design direction and maintainers' feedback;
- not a demand to merge the current patch unchanged.

Avoid framing it as “make Cinnamon copy GNOME.” The strongest argument is that Cinnamon can offer a modern productivity layer while keeping its familiar panel, desktop and traditional workflow.

## Attachment note

Suggested line at the end of the post:

> I attached a GPL-licensed proof-of-concept archive containing the cumulative patch, modified source files, screenshots, validation output and a technical summary. It was tested on Cinnamon 6.6.7 under X11 and is intended for review, discussion and rebasing—not as a ready-to-merge patch.

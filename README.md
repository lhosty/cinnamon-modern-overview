# Cinnamon Modern Overview — proposal package

This archive is a submission-ready package for presenting a working proof of concept to the Linux Mint/Cinnamon community.

The proposal evolves Cinnamon's existing Overview into a unified native hub for:

- window switching and workspace management;
- application launching;
- application, file, web and calculator search;
- keyboard and mouse navigation;
- window drag-and-drop between workspaces;
- native-style workspace swipe;
- panel-as-dock behavior while the Overview is open.

## Start here

1. Read `proposal/SUBMISSION_GUIDE.md`.
2. Copy the English text from `proposal/GITHUB_IDEA_EN.md` into the **Ideas** category of Linux Mint GitHub Discussions.
3. Upload the first three images from `screenshots/` directly into the post so they render inline.
4. Attach this archive as the technical proof of concept.
5. Use `proposal/COMMUNITY_DISCUSSION_EN.md` for a more conversational follow-up discussion.

Portuguese versions are included for review and adaptation.

## Prototype status

- Tested in a real Cinnamon 6.6.7 X11 session.
- Based on Cinnamon core JavaScript files, licensed under GPL-2.0-or-later.
- Includes a cumulative patch, patched files, test scripts and validation output.
- This is a proof of concept, not a merge-ready pull request.
- Rebase, coding-style review, accessibility review, Wayland testing and broader hardware/theme testing are still required.

## Archive structure

- `proposal/`: ready-to-post text and submission guidance.
- `documentation/`: changelog, architecture, value proposition and test scope.
- `screenshots/`: sanitized screenshots suitable for a public post.
- `prototype/`: source files, patches, tests and install/restore tools.
- `COPYING`: GNU GPL version 2 license text.

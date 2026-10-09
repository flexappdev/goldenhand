---
description: Commit and push site changes, then wait for GitHub Pages to rebuild
argument-hint: [what changed]
---
1. Run `git status` and summarise what changed. If images were added anywhere outside `assets/img/`, move them there, resize to max 1600px wide, convert to WebP (~82 quality), keep each under 300 KB, and update references (with alt, width, height; lazy-load everything except the hero).
2. This repo is PUBLIC. Refuse to commit pricing internals, margins, strategy or vault notes; those belong in flexappdev/adikai.
3. Commit with an imperative message based on: $ARGUMENTS (or the diff if empty). Push to main.
4. Poll `gh api repos/flexappdev/goldenhand/pages/builds/latest` every 10s until status is built for the new commit, or report the error.
5. Reply with the commit link and https://flexappdev.github.io/goldenhand/ plus any changed page path.

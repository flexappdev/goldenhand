# Golden Hand Handyman

Public website for Golden Hand Handyman — powered by AdikAI.

## Live

| Page | URL |
|---|---|
| Homepage | https://flexappdev.github.io/goldenhand/ |
| Golden Hand Rapid — 24/7 emergency, at your door in 60 min | https://flexappdev.github.io/goldenhand/rapid/ |
| Contracts | https://flexappdev.github.io/goldenhand/contracts.html |
| Lead console (operators) | https://flexappdev.github.io/goldenhand/leads.html |

Deployed by GitHub Pages from `main` (root). A push goes live in ~1 minute; hard-refresh if you still see the old version.

## Lead intake

The "Get a quote" form creates a lead that a person must approve or reject in `/leads.html`. It runs in DEMO mode (browser-only) until Supabase is configured. Setup, capability labels and follow-ups: [docs/LEAD-INTAKE.md](docs/LEAD-INTAKE.md).

## Updating

- **Claude Code:** make changes, then run `/push <what changed>` (see `.claude/commands/push.md`).
- **claude.ai:** say `/push` with the change or attach images.
- Images go in `assets/img/` as WebP, max 1600px wide, under 300 KB.

This repo is public: no pricing internals, margins, strategy or notes. Those live in the private `flexappdev/adikai` repo.

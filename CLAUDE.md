# Claude Code instructions: Lilycove Co

Before writing any code this session:
1. Read the PRD: ~/Documents/ai brian lmao/10-Projects/personal projects/Lilycove Co/PROJECT.md
2. Read ~/Documents/ai brian lmao/10-Projects/personal projects/Lilycove Co/STATUS.md (live now, next, waiting on Ben) and pick up from it.
3. Apply the /codestart skill's Ponytail lazy-senior-dev discipline.

To find files here, read `AGENT-INDEX.md` first. After adding, moving or deleting files, re-run: `python3 ~/"Documents/ai brian lmao/30-Resources/scripts/index_repos.py" .`

## Issue tracker
Local files: `issues/NN-slug.md` (Matt Pocock to-tickets template). Work the frontier: lowest number whose blockers are done. Mark `**Status:** done` and tick boxes when finished. Learnings go in `progress.txt` (append only).

## Ralph loop
- One issue per round. Test first (tdd skill), typecheck, tests green, commit, append progress.txt, stop.
- Hands-on: `scripts/ralph-once.sh`. AFK: `scripts/afk-ralph.sh 10` (cap = rounds).
- Scripts unset ANTHROPIC_API_KEY so Claude Code uses Ben's subscription, never per-token billing.

## Hard rules
- Never spend money, add paid APIs, or bill per token without Ben's explicit yes.
- Never delete files without Ben's yes.
- Never log into or talk to Pokémon GO servers. Screen reading only.
- Free/open-source only. Credit ohbem (Apache 2.0), PvPoke, Matt Pocock skills (MIT).
- Ben's naming/keep rules live in the PRD. Don't invent new ones; ask.

## Stack (decided 2026-11-22)
TypeScript on Node · ohbem for ranks · PvPoke gamemaster/rankings JSON · SQLite · ffmpeg for video frames · Apple Vision OCR via a small Swift helper · IV bars read from pixels · local web server, opened on Mac and iPhone · iPhone Shortcut (Back Tap) for live mode.

## Test fixtures
`fixtures/screenshots/` and `fixtures/videos/` (from Ben). Expected answers go in `fixtures/expected.json`.

# lilycove_co/src - detail index

Generated 2026-11-26. Back to [overview](../AGENT-INDEX.md). Every line has the full path from `lilycove_co/`.

**src/**
31 files, 31 code/docs. Top types: 31 .ts.

- `src/autorefresh.ts` - Keeps PvPoke/ohbem data fresh: refresh every time the app starts (Ben 2026-11-26), then on a schedule. Failures are logged, never fatal.
- `src/build.ts` - Build facts for a kept Pokémon: PvPoke meta rank, recommended moves (+ Elite TM), second-move cost, evolve candy.
- `src/cli.ts` - Usage: npm run rank -- [nickname]
- `src/collection.ts` - Collection: all saved scans - ranks - keep slots - Keep / Trade / Transfer lists with renames + search strings.
- `src/cost.ts` - Power-up and second-move costs (Pokémon GO tables). Pure.
- `src/data.ts` - Local cache of rank/meta data. Sources: ohbem's masterfile (Apache 2.0) and PvPoke (MIT) on GitHub.
- `src/index.ts` - exports nameFromNumbers
- `src/main.ts` - Entry point for the always-on Mac server (run by launchd at login).
- `src/meta.ts` - Meta tab (Ben, 2026-11-26): PvPoke's top 100 per league; greyed out when Ben doesn't have it. Pure apart from reading the cache.
- `src/metawatch.ts` - Meta watch (Ben, 2026-11-26): after each PvPoke download, compare with the last snapshot and save what changed
- `src/namer.ts` - Namer: builds Ben's rename string. Format (PRD story 20-24)
- `src/plan.ts` - Planner (Ben, 2026-11-23): type in dust + Elite TMs - which kept Pokémon to build, and who gets the TMs. Pure.
- `src/pokedex.ts` - Pokédex tab (Ben, 2026-11-23): Pokémon GO's special dexes (shiny, lucky, 100%, XXL, ...) with missing spots by national dex number.
- `src/rank.ts` - Rank Engine: species + IVs + level - PvP rank for every evolution stage in Little/Great/Ultra (via ohbem).
- `src/refresh.ts`
- `src/rules.ts` - Keep / trade rules beyond PvP slots (PRD stories 14-19, 25-26). Pure: plain data in, decisions out.
- `src/search.ts` - Pokémon GO search string that finds one exact Pokémon, e.g. "bulbasaur&cp512".
- `src/server.ts` - Local web server: opened on the Mac and iPhone. Home page: scan count (today + lifetime), upload, Keep/Trade/Transfer, Failed scans.
- `src/session.ts` - "This session" (Ben, 2026-11-23): a session ends when an hour passes with no upload, or when the app is closed and
- `src/slots.ts` - Slot Assigner: one keeper per target species x league (x mega). Pure: plain data in, assignment out.
- `src/species.ts` - Species Resolver: candy family + CP/HP/IV math picks the species (PRD: never trust the nickname).
- `src/sprites.ts` - Pixel-art sprites for the Collection tab: Pokémon Showdown's gen 5 style sprites (every species incl. regional forms),
- `src/store.ts` - Store: every scan saved to a local SQLite file (Node's built-in node:sqlite, no extra deps).
- `src/teams.ts` - Teams tab (Ben, 2026-11-26): recommended 3-Pokémon teams per league from the Pokémon Ben has (or can build),
- `src/uploads.ts` - Upload cleanup (issue 11): screenshots/videos are deleted once used; failed scans stay 1 day (Ben, 2026-11-23).

### `src/screen/`
- `src/screen/arc.ts` - Level arc: the white semicircle over the Pokémon. Solid white from the left end up to the dot, faint after it.
- `src/screen/dex.ts` - Pokédex screenshot reader (issue 12). Tuned on Ben's 1320 px iPhone shiny-dex screenshots.
- `src/screen/flags.ts` - Visual-only flags read from pixels (issue 09). Tuned on Ben's 1320 px iPhone screenshots.
- `src/screen/ivbars.ts` - IV bars read straight from pixels: filled (orange, or red at 15) vs empty (grey), 3 segments of 5.
- `src/screen/read.ts` - Screen Reader: appraisal screenshot - structured fields. Failed reads say why (never dropped).
- `src/screen/vision.ts` - Adapter around the Swift Vision helper (bin/vision, built from helper/vision.swift on first use).

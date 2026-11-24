# 12: Fill the Pokédex tab from Pokédex screenshots

**What to build:** Ben screenshots his in-game Pokédex with a special filter on (Shiny, Lucky, 100%, XXL, XXS, Shadow, Purified). Missing spots show the national dex number; caught spots show the Pokémon. Read each screenshot and mark every visible dex number as have / missing for that dex, so the Pokédex tab shows what's left to collect.

**Blocked by:** Ben's Pokédex screenshots in `fixtures/pokedex/<dex>/` + `fixtures/pokedex/expected.json` (see the README there)

**Status:** done (shiny fixtures; re-check when other dexes' screenshots come in)

Already built (2026-11-23): Pokédex tab at `/pokedex` (`src/pokedex.ts`, `pokedexPage` in `src/server.ts`), dex kinds in `DEX_KINDS`, marks in SQLite (`store.dexMarks` / `setDexMark`), tap a spot to cycle not known -> have -> missing, upload per dex to `data/pokedex-inbox/<dex>/`. The reader plugs in as `ServerOptions.readDex(path, kind) => DexRead` (wire it in `src/main.ts`); when set, uploads are read, marks saved, and the screenshot deleted.

- [x] Look at Ben's screenshots first: grid size, where numbers sit, how caught vs missing spots look, header text (which dex filter is on)
- [x] `src/screen/dex.ts`: screenshot -> `{ have: number[], missing: number[] }` (Apple Vision OCR via `src/screen/vision.ts` for the numbers; caught spots: infer numbers from neighbours, since caught tiles may not show a number)
- [x] Never guess: a tile it can't place is left out (stays "not known yet")
- [x] Optional: read which dex filter is on from the header and warn if it doesn't match the chosen dex
- [x] Wire `readDex` in `src/main.ts`; process anything already waiting in `data/pokedex-inbox/` on start
- [x] Tests against `fixtures/pokedex/expected.json`: 0 wrong marks

# 09: Detect shiny, shadow, costume, event and special background

**What to build:** Read the visual-only flags from the screenshot so issue 07's rules can use them (protected shiny/costume/event, shadow slots, `trade evt` / `trade sbg` tags).

**Blocked by:** 07. Waiting on Ben's example screenshots (a shiny, a shadow, a costume/event one, a special background).

**Status:** done

- [x] Shiny: not readable (only a brief sparkle animation). Protected instead: transfer searches end in `&!shiny&!costume`, so the game skips them
- [x] Shadow detected (violet flames around the Pokémon; Dynamax swirl excluded)
- [x] Costume: same as shiny, protected through the transfer search string
- [x] Special / location background detected (photo texture vs smooth gradient) -> `trade sbg yy`
- [x] Fixtures for each in fixtures/expected.json + test/flags.test.ts

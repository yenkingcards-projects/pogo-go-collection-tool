# 10: Live mode: CP hidden by the Dynamic Island

**What to build:** When the Back Tap Shortcut runs, the iPhone's Dynamic Island grows over the top of the screen and can cover the CP number, so many live scans fail with "Could not read cp". The reader should still work out the Pokémon when CP is covered.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Examples in `fixtures/live-failures/` (Shadow Bulbasaur CP 244, 53 HP) read successfully
- [x] When CP is unreadable, solve level from HP + IVs + species, and use the level arc's white dot to pick between candidate levels
- [x] If still ambiguous, the notification says "CP covered: try again" instead of a generic failure
- [x] Notification for a missing appraisal says "Open the appraisal first"
- [x] Existing fixture tests still pass

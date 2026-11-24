You are one round of a Ralph loop for Lilycove Co. Follow CLAUDE.md.

1. Read CLAUDE.md, every file in issues/, and progress.txt.
2. Pick the lowest-numbered issue with "**Status:** ready-for-agent" whose "Blocked by" issues are all "**Status:** done".
3. If that issue needs something only Ben can give (missing fixtures, a purchase, a decision), append a dated note to progress.txt saying exactly what Ben must do, then print <promise>BLOCKED</promise> and stop.
4. Work ONLY on that issue. Use the tdd skill: failing test first, then code. Run typecheck and tests until green.
5. When every acceptance box passes: tick the boxes, set "**Status:** done", append to progress.txt (date, issue number, what you learned, anything the next round should know), and git commit with message "issue NN: <title>".
6. Stop after one issue. If no ready issues remain and all are done, print <promise>COMPLETE</promise>.

Never spend money, never call paid APIs, never delete files, never contact Pokémon GO servers.

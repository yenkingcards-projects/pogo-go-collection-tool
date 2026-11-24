# Pokémon GO collection tool (Lilycove Co)

A local helper for sorting a Pokémon GO collection. It runs on a Mac, and you open it on the Mac or your iPhone.

- Reads appraisal screenshots and screen recordings (Apple Vision OCR + IV bars read from pixels).
- Works out PvP IV ranks for every evolution in Little, Great and Ultra League ([ohbem](https://github.com/Mygod/ohbem)) and checks them against [PvPoke](https://pvpoke.com) rankings.
- Sorts everything into Keep / Trade / Transfer, with a rename string and a search string you copy straight into the game.
- Collection tab: list or Pokédex-style grid. Each tile's bar shows Little / Great / Ultra / Master builds (solid = built, striped = have one, not built). Includes a dust and Elite TM planner.
- Pokédex tab: tracks special dexes (shiny, lucky, 100%, XXL...) from screenshots.

It only reads screenshots. It never logs into or talks to Pokémon GO servers.

## Run it

Needs macOS, Node 22+, Xcode command line tools (for the Vision helper) and ffmpeg.

```bash
npm install
npm start
```

Then open http://localhost:4242. To keep it running at login, run `scripts/install-server.sh` once. iPhone live mode setup: [docs/live-mode-setup.md](docs/live-mode-setup.md).

## Credits

See [CREDITS.md](CREDITS.md): ohbem (Apache 2.0), PvPoke data (MIT), Pokémon Showdown sprites, pogoapi.net.

Not affiliated with Niantic, Nintendo, Game Freak or The Pokémon Company.

## Support

If this helps you, [support Ready Set Ink on Ko-fi](https://ko-fi.com/J2E225ZV4T).

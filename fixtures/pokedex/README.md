# Pokédex screenshot fixtures (issue 12)

One folder per dex: `shiny/`, `lucky/`, `hundo/`, `xxl/`, `xxs/`, `shadow/`, `purified/`.
Drop Pokémon GO Pokédex screenshots (with that dex's filter on) in the matching folder.
Expected answers go in `fixtures/pokedex/expected.json`:

```json
{ "shiny/IMG_0001.PNG": { "have": [1, 2, 4], "missing": [3, 5] } }
```

Screenshots uploaded on the Pokédex tab before the reader exists wait in `data/pokedex-inbox/<dex>/` and can be copied here.

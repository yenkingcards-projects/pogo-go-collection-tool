import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readCache } from '../src/data.js';
import { loadBuildFacts, generation, GENERATIONS } from '../src/build.js';

const CACHE = fileURLToPath(new URL('../data/cache/', import.meta.url));
const facts = loadBuildFacts(CACHE);
const gm = readCache(CACHE, 'pvpoke-gamemaster.json');
const pos = (cp: number, id: string) => (readCache(CACHE, `pvpoke-rankings-${cp}.json`) as any[]).findIndex((r) => r.speciesId === id) + 1;

describe('build facts (PvPoke meta rank, moves, Elite TMs, costs)', () => {
  it('meta rank = place in PvPoke league rankings; shadows and regional forms use their own entry', () => {
    expect(facts.metaRank('great', 'Medicham', false)).toBe(pos(1500, 'medicham'));
    expect(facts.metaRank('great', 'Sableye', true)).toBe(pos(1500, 'sableye_shadow'));
    expect(facts.metaRank('great', 'Stunfisk (Galarian)', false)).toBe(pos(1500, 'stunfisk_galarian'));
    expect(facts.metaRank('great', 'Not A Pokemon', false)).toBeUndefined();
    expect(facts.metaRank('great', 'Venusaur (Mega)', false)).toBeGreaterThan(0);
    expect(facts.moves('great', 'Venusaur (Mega)', false)).toHaveLength(3); // mega not ranked -> plain Venusaur's moves
  });

  it('moves = PvPoke recommended moveset, each flagged if it needs an Elite TM', () => {
    const moves = facts.moves('great', 'Lapras', false);
    const want = (readCache(CACHE, 'pvpoke-rankings-1500.json') as any[]).find((r) => r.speciesId === 'lapras').moveset as string[];
    const elite = new Set(gm.pokemon.find((p: any) => p.speciesId === 'lapras').eliteMoves ?? []);
    expect(moves).toHaveLength(3);
    expect(moves.map((m) => m.id)).toEqual(want);
    expect(moves.map((m) => m.elite)).toEqual(want.map((id) => elite.has(id)));
    expect(moves[0].fast).toBe(true);
    expect(moves[1].name).toMatch(/^[A-Z][a-z]/); // display name, not MOVE_ID
  });

  it('types of the target (lowercase, from the PvPoke gamemaster)', () => {
    expect(facts.types('Stunfisk (Galarian)')).toEqual(['ground', 'steel']);
    expect(facts.types('Medicham')).toEqual(['fighting', 'psychic']);
    expect(facts.types('Not A Pokemon')).toEqual([]);
  });

  it('second charged move dust', () => {
    expect(facts.secondMoveDust('Medicham')).toBe(50_000);
    expect(facts.secondMoveDust('Lapras')).toBe(75_000);
  });

  it('evolve candy along the evolution line (regional forms follow their own line)', () => {
    expect(facts.evolveCandy('krabby', 99)).toBe(50);
    expect(facts.evolveCandy('bulbasaur', 3)).toBe(125);
    expect(facts.evolveCandy('zigzagoon_galarian', 862)).toBe(125);
    expect(facts.evolveCandy('kingler', 99)).toBe(0);
    expect(facts.evolveCandy('kingler', 1)).toBeUndefined();
  });

  it('family id groups a line for candy counts', () => {
    expect(facts.family('kingler')).toBe(facts.family('krabby'));
    expect(facts.family('kingler')).not.toBe(facts.family('bulbasaur'));
  });
});

describe('generations', () => {
  it('number + region by Pokédex number', () => {
    expect(generation(1)).toEqual({ n: 1, region: 'Kanto' });
    expect(generation(251)).toEqual({ n: 2, region: 'Johto' });
    expect(generation(809)).toEqual({ n: 7, region: 'Alola' });
    expect(generation(906)).toEqual({ n: 9, region: 'Paldea' });
    expect(GENERATIONS.map((g) => g.region)).toEqual(['Kanto', 'Johto', 'Hoenn', 'Sinnoh', 'Unova', 'Kalos', 'Alola', 'Galar', 'Paldea']);
  });
});

import { loadDexSpecies } from '../src/pokedex.js';
describe('Pokédex species list', () => {
  it('one base-form entry per released national dex number', () => {
    const list = loadDexSpecies(fileURLToPath(new URL('../data/cache/', import.meta.url)));
    expect(list[0]).toEqual({ dex: 1, name: 'Bulbasaur', id: 'bulbasaur' });
    expect(list.find((s) => s.dex === 3)?.mega).toBe(true); // Mega Venusaur
    expect(list.find((s) => s.dex === 382)?.mega).toBe(true); // Primal Kyogre
    expect(list.find((s) => s.dex === 4)?.mega).toBeUndefined();
    expect(list.find((s) => s.dex === 52)?.name).toBe('Meowth');
    expect(new Set(list.map((s) => s.dex)).size).toBe(list.length);
    expect(list.length).toBeGreaterThan(900);
  });
});

describe('Master League + final evolution (grid view, Ben 2026-11-24)', () => {
  it('Master League meta rank comes from PvPoke rankings-10000', () => {
    expect(facts.metaRank('master', 'Dragonite', false)).toBe(pos(10000, 'dragonite'));
  });
  it('final evolution follows the family line; a branch picks the best Master League rank', () => {
    expect(facts.finalEvo('dratini')).toMatchObject({ id: 'dragonite', name: 'Dragonite', dex: 149 });
    expect(facts.finalEvo('dragonite')).toMatchObject({ id: 'dragonite' });
    expect(facts.finalEvo('zigzagoon_galarian')).toMatchObject({ id: 'obstagoon' });
    const eeveelutions = ['vaporeon', 'jolteon', 'flareon', 'espeon', 'umbreon', 'leafeon', 'glaceon', 'sylveon'];
    const best = eeveelutions.filter((id) => pos(10000, id) > 0).sort((a, b) => pos(10000, a) - pos(10000, b))[0];
    expect(facts.finalEvo('eevee')!.id).toBe(best);
  });
});

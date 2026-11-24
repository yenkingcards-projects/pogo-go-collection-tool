import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshCache, CACHE_FILES } from '../src/data.js';
import { createRankEngine, type RankEngine } from '../src/rank.js';

const CACHE = fileURLToPath(new URL('../data/cache/', import.meta.url));

describe('refreshCache', () => {
  it('downloads every data file into the cache folder', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    const fakeFetch = (async (url: string) => new Response(JSON.stringify({ url }))) as typeof fetch;
    await refreshCache(dir, fakeFetch);
    for (const name of Object.keys(CACHE_FILES)) {
      expect(existsSync(join(dir, name))).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, name), 'utf8')).url).toBe(CACHE_FILES[name]);
    }
  });
});

describe('rank engine', () => {
  let engine: RankEngine;
  beforeAll(async () => {
    if (!existsSync(join(CACHE, 'ohbem-masterfile.json'))) await refreshCache(CACHE);
    engine = createRankEngine(CACHE);
  });

  // Anchors from ohbem's README (Elgyem 1/4/12 L7 is Little #548).
  it('Elgyem 1/4/12 L7: Little #548 as basic, Great entry for Beheeyem as stage 1', () => {
    const r = engine.rank('Elgyem', { atk: 1, def: 4, sta: 12 }, 7);
    expect(r.currentStage).toBe(0);
    expect(r.ranks.little).toEqual([expect.objectContaining({ species: 'Elgyem', stage: 0, rank: 548, cp: 494 })]);
    expect(r.ranks.great?.map((x) => [x.species, x.stage])).toEqual([['Elgyem', 0], ['Beheeyem', 1]]);
  });

  it('Talonflame 15/15/14 at level cap 51 is Ultra #21 (stage 2)', () => {
    const r = createRankEngine(CACHE, { levelCap: 51 }).rank('Talonflame', { atk: 15, def: 15, sta: 14 }, 1);
    expect(r.currentStage).toBe(2);
    expect(r.ranks.ultra).toContainEqual(expect.objectContaining({ species: 'Talonflame', stage: 2, rank: 21 }));
  });

  it('every evolution stage is ranked: Piplup gets Prinplup (1) and Empoleon (2) in Great', () => {
    const r = engine.rank('piplup', { atk: 0, def: 15, sta: 15 }, 10);
    expect(r.ranks.great?.map((x) => [x.species, x.stage])).toEqual([['Prinplup', 1], ['Empoleon', 2]]);
  });

  it('mega forms only count when released in Pokémon GO (per PvPoke): Altaria yes, Excadrill no', () => {
    const megas = (sp: string, atk: number, def: number, sta: number) =>
      Object.values(engine.rank(sp, { atk, def, sta }, 15).ranks).flat().filter((x) => x!.mega).map((x) => x!.species);
    expect(megas('Swablu', 4, 12, 11)).toContain('Altaria');
    expect(megas('Drilbur', 0, 14, 9)).toEqual([]); // the video's Drilbur: rank library offers an unreleased Mega Excadrill
  });

  it('species PvPoke only lists by form (Minior, Pumpkaboo) are still found', () => {
    expect(engine.rank('Minior', { atk: 15, def: 2, sta: 12 }, 1).species).toBe('Minior');
    expect(engine.rank('Pumpkaboo', { atk: 3, def: 15, sta: 9 }, 13).species).toBe('Pumpkaboo');
  });

  it('unknown species throws a clear error', () => {
    expect(() => engine.rank('Notamon', { atk: 0, def: 0, sta: 0 }, 1)).toThrow(/Notamon/);
  });
});

describe('typed numbers -> rename', () => {
  it('Piplup 0/15/15 L10 names as Prinplup Great rank with stage code', async () => {
    const { nameFromNumbers } = await import('../src/index.js');
    const out = nameFromNumbers(createRankEngine(CACHE), 'Piplup', { atk: 0, def: 15, sta: 15 }, 10, 'pip');
    // Prinplup Great + Empoleon Ultra second league; nickname dropped to stay within 12 chars.
    expect(out.name).toMatch(/^G\d+ 1 U\d+ 2$/);
  });
});

describe('regional forms rank as their own form', () => {
  const engine = createRankEngine(CACHE);
  it('Galarian Zigzagoon ranks its own line (Galarian Linoone -> Obstagoon), not the normal one', () => {
    const r = engine.rank('Zigzagoon', { atk: 12, def: 15, sta: 14 }, 20, 'zigzagoon_galarian');
    expect(r.species).toBe('Zigzagoon'); // plain name kept for the search string
    expect(r.ranks.great!.map((x) => x.species)).toEqual(['Linoone (Galarian)', 'Obstagoon']);
    expect(r.ranks.little![0].species).toBe('Zigzagoon (Galarian)');
    const plain = engine.rank('Zigzagoon', { atk: 12, def: 15, sta: 14 }, 20);
    expect(plain.ranks.great!.map((x) => x.species)).not.toContain('Obstagoon');
  });

  it('Alolan Vulpix uses the Alolan form; unknown ids fall back to the normal form', () => {
    const a = engine.rank('Vulpix', { atk: 0, def: 15, sta: 15 }, 20, 'vulpix_alolan');
    expect(Object.values(a.ranks).flat().some((x) => x!.species === 'Ninetales (Alolan)')).toBe(true);
    const n = engine.rank('Vulpix', { atk: 0, def: 15, sta: 15 }, 20, 'vulpix_nonsense');
    expect(Object.values(n.ranks).flat().some((x) => x!.species.includes('Alolan'))).toBe(false);
  });
});

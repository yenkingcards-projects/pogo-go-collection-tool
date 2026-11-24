import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { openStore, type Store } from '../src/store.js';
import { createRankEngine } from '../src/rank.js';
import { createCollection, loadMeta, loadFacts } from '../src/collection.js';
import { loadBuildFacts } from '../src/build.js';
import { powerUpCost } from '../src/cost.js';

const CACHE = fileURLToPath(new URL('../data/cache/', import.meta.url));
const ranks = createRankEngine(CACHE);
const meta = loadMeta(CACHE);
const facts = loadFacts(CACHE);

// Saves a scan the way the server does: summary columns + full appraisal as detail.
function scan(store: Store, species: string, ivs: [number, number, number], level: number, cp: number, hp: number, nickname = '', extra: object = {}) {
  const d = { species, ivs: { atk: ivs[0], def: ivs[1], sta: ivs[2] }, level, cp, hp, nickname, location: 'Lansing, MI, United States', date: '11/14/2026', ...extra };
  return store.save({ species, atk: ivs[0], def: ivs[1], sta: ivs[2], level, cp }, d);
}

describe('collection (scans -> ranks -> slots -> lists)', () => {
  let store: Store;
  beforeAll(() => { store = openStore(':memory:'); });

  it('a good Piplup is kept with a slot rename and a search string', () => {
    const id = scan(store, 'Piplup', [0, 15, 15], 10, 250, 50);
    const p = createCollection({ store, ranks, meta, facts }).place(id);
    expect(p.verdict).toBe('keep');
    // Empoleon is an Ultra meta pick and this one is Ultra #4, so that slot wins (stage 2 code, Great Prinplup as 2nd league).
    expect(p.name).toBe('U4 2 G15 1');
    expect(p.slot).toMatchObject({ league: 'ultra', target: 'Empoleon', rank: 4 });
    expect(p.search).toBe('piplup&cp250');
    expect(p.beats).toBe('');
  });

  it('a better one beats the kept one; the old one moves on or goes to transfer', () => {
    const store2 = openStore(':memory:');
    const c = createCollection({ store: store2, ranks, meta, facts });
    const a = scan(store2, 'Piplup', [2, 14, 13], 10, 260, 49);
    expect(c.place(a).verdict).toBe('keep');
    const b = scan(store2, 'Piplup', [0, 15, 15], 10, 250, 50);
    const p = c.place(b);
    expect(p.beats).toMatch(/^beats your [GUL]\d+$/);
    const lists = c.lists();
    expect(lists.keep.map((k) => k.id)).toContain(b);
  });

  it('a weak one goes to the transfer list; the same Pokémon scanned twice counts once', () => {
    const store3 = openStore(':memory:');
    const c = createCollection({ store: store3, ranks, meta, facts });
    const w = scan(store3, 'Piplup', [15, 0, 0], 10, 280, 44);
    expect(c.place(w).verdict).toBe('transfer');
    scan(store3, 'Piplup', [15, 0, 0], 10, 280, 44);
    const lists = c.lists();
    expect(lists.transfer).toHaveLength(1);
    expect(lists.trade).toEqual([]);
  });

  it('a species name on screen is not a nickname (Pokémon never renamed)', () => {
    const store4 = openStore(':memory:');
    const id = scan(store4, 'Piplup', [0, 15, 15], 10, 250, 50, 'Piplup');
    expect(createCollection({ store: store4, ranks, meta, facts }).place(id).name).toBe('U4 2 G15 1');
    // Fixture 4: Turtonator never renamed -> "U233", not "U233 Turton".
    const id2 = scan(store4, 'Turtonator', [13, 13, 10], 15, 924, 85, 'Turtonator');
    expect(createCollection({ store: store4, ranks, meta, facts }).place(id2).name).toBe('U233');
    // A real nickname is kept.
    const store5 = openStore(':memory:');
    const id3 = scan(store5, 'Turtonator', [13, 13, 10], 15, 924, 85, 'spiky');
    expect(createCollection({ store: store5, ranks, meta, facts }).place(id3).name).toBe('U233 spiky');
  });
});

describe('collection rules (issue 07)', () => {
  const weak: [number, number, number] = [15, 0, 0];
  it('a weak lucky stays (protected) and is marked evolve-for-dex', () => {
    const st = openStore(':memory:');
    const id = scan(st, 'Piplup', weak, 10, 280, 44, '', { lucky: true });
    const c = createCollection({ store: st, ranks, meta, facts });
    expect(c.place(id)).toMatchObject({ verdict: 'keep' });
    expect(c.lists().keep[0]).toMatchObject({ why: 'lucky · evolve for dex' });
  });

  it('a weak one caught in Japan goes to Trade named "trade d 24"', () => {
    const st = openStore(':memory:');
    const id = scan(st, 'Piplup', weak, 10, 280, 44, '', { location: 'Osaka, Japan', date: '3/2/2024' });
    const c = createCollection({ store: st, ranks, meta, facts });
    expect(c.place(id)).toMatchObject({ verdict: 'trade', name: 'trade d 24' });
    expect(c.lists().trade).toHaveLength(1);
  });

  it('legendary from game data; trade evolution (Kadabra) gets "trade evo"', () => {
    const st = openStore(':memory:');
    const leg = scan(st, 'Mewtwo', [0, 0, 0], 1, 100, 20);
    const kad = scan(st, 'Kadabra', [15, 0, 0], 1, 50, 15);
    const c = createCollection({ store: st, ranks, meta, facts });
    expect(c.place(leg)).toMatchObject({ verdict: 'keep' });
    expect(c.place(kad)).toMatchObject({ verdict: 'trade', name: 'trade evo 26' });
  });

  it('never-transfer exceptions are editable and respected', () => {
    const st = openStore(':memory:');
    const id = scan(st, 'Piplup', weak, 10, 280, 44);
    const c = createCollection({ store: st, ranks, meta, facts });
    expect(c.place(id).verdict).toBe('transfer');
    st.addException('Piplup');
    expect(st.exceptions()).toEqual(['Piplup']);
    expect(c.place(id).verdict).toBe('keep');
    st.removeException('Piplup');
    expect(c.place(id).verdict).toBe('transfer');
  });

  it('shadows get their own slots, separate from the regular one', () => {
    const st = openStore(':memory:');
    const a = scan(st, 'Piplup', [0, 15, 15], 10, 250, 50);
    const b = scan(st, 'Piplup', [0, 15, 15], 10, 250, 50, '', { shadow: true, hp: 51 });
    const c = createCollection({ store: st, ranks, meta, facts });
    expect(c.place(a).verdict).toBe('keep');
    expect(c.place(b)).toMatchObject({ verdict: 'keep', beats: '' });
  });

  it('a Pokémon that can\'t be ranked still shows up (never dropped silently)', () => {
    const st = openStore(':memory:');
    const id = scan(st, 'Notamon', [1, 2, 3], 10, 300, 50);
    const c = createCollection({ store: st, ranks, meta, facts });
    expect(c.place(id).verdict).toBe('transfer');
    expect(c.lists().transfer[0]).toMatchObject({ id, why: 'could not rank this species/form yet' });
  });
});

describe('collection entries (Collection tab)', () => {
  const build = loadBuildFacts(CACHE);

  it('a kept Pokémon shows its build: target level/CP, dust + candy to get there, moves, meta rank, owned candy', () => {
    const store = openStore(':memory:');
    const id = scan(store, 'Piplup', [0, 15, 15], 10, 250, 50, '', { speciesId: 'piplup', candyCount: 120 });
    const e = createCollection({ store, ranks, meta, facts, build }).entries().find((x) => x.id === id)!;
    expect(e).toMatchObject({ verdict: 'keep', speciesId: 'piplup', dex: 393, gen: { n: 4, region: 'Sinnoh' }, candyHave: 120 });
    const b = e.build!;
    expect(b).toMatchObject({ league: 'ultra', target: 'Empoleon', ivRank: 4, targetId: 'empoleon', targetDex: 395 }); // sprite for the evolve arrow
    expect(b.powerUp).toEqual(powerUpCost(10, b.level));
    expect(b.evolveCandy).toBe(125); // 25 + 100
    expect(b.secondMove).toEqual({ dust: build.secondMoveDust('Empoleon'), candy: expect.any(Number) });
    expect(b.total.dust).toBe(b.powerUp.dust + b.secondMove!.dust);
    expect(b.total.candy).toBe(b.powerUp.candy + 125 + b.secondMove!.candy);
    expect(b.moves).toHaveLength(3);
    expect(b.metaRank).toBe(build.metaRank('ultra', 'Empoleon', false));
  });

  it('candy count comes from the newest scan in the family; a non-keeper has no build', () => {
    const store = openStore(':memory:');
    scan(store, 'Krabby', [15, 15, 15], 20, 1000, 80, '', { speciesId: 'krabby', candyCount: 40 });
    const k = scan(store, 'Kingler', [15, 0, 0], 10, 711, 62, '', { speciesId: 'kingler', candyCount: 55 });
    const all = createCollection({ store, ranks, meta, facts, build }).entries();
    expect(all.every((e) => e.candyHave === 55)).toBe(true);
    const kingler = all.find((e) => e.id === k)!;
    if (kingler.verdict !== 'keep') expect(kingler.build).toBeUndefined();
  });
});

describe('collection entries: built, moves done, typed candy (Ben, 2026-11-23)', () => {
  const build = loadBuildFacts(CACHE);

  it('a Pokémon at its target stage and level is built; marking moves done drops the 2nd-move cost', () => {
    const store = openStore(':memory:');
    const piplup = scan(store, 'Piplup', [0, 15, 15], 10, 250, 50, '', { speciesId: 'piplup' });
    const c = createCollection({ store, ranks, meta, facts, build });
    const p = c.entries().find((x) => x.id === piplup)!;
    expect(p.build).toMatchObject({ stageDone: false, levelDone: false, built: false });
    expect(p.movesDone).toBe(false);

    const st2 = openStore(':memory:');
    const emp = scan(st2, 'Empoleon', [0, 15, 15], p.build!.level, p.build!.cp, 150, '', { speciesId: 'empoleon' });
    const c2 = createCollection({ store: st2, ranks, meta, facts, build });
    const e = c2.entries().find((x) => x.id === emp)!;
    expect(e.build).toMatchObject({ stageDone: true, levelDone: true, built: true });
    expect(e.build!.total.dust).toBe(e.build!.secondMove!.dust);
    st2.setMovesDone(e.movesKey, true);
    const done = c2.entries().find((x) => x.id === emp)!;
    expect(done.movesDone).toBe(true);
    expect(done.build!.total).toEqual({ dust: 0, candy: 0, xl: 0 });
  });

  it('typed candy beats an older scan count; a newer scan beats the typed one', () => {
    const store = openStore(':memory:');
    scan(store, 'Piplup', [0, 15, 15], 10, 250, 50, '', { speciesId: 'piplup', candyCount: 120 });
    const c = createCollection({ store, ranks, meta, facts, build });
    const fam = c.entries()[0].family;
    store.setCandy(fam, { candy: 300, xl: 4 }, '2999-01-01 00:00:00');
    expect(c.entries()[0]).toMatchObject({ candyHave: 300, xlHave: 4 });
    store.setCandy(fam, { candy: 301 }, '2000-01-01 00:00:00'); // older than the scan
    expect(c.entries()[0]).toMatchObject({ candyHave: 120, xlHave: 4 });
  });
});

describe('better one found: get rid of the old best (Ben, 2026-11-23)', () => {
  it('place() names the old best it pushed off the Keep list, with its search string', () => {
    const st = openStore(':memory:');
    const c = createCollection({ store: st, ranks, meta, facts });
    const ids = [[5, 10, 10], [3, 12, 12], [2, 13, 14], [1, 14, 15]].map((a, i) => {
      const id = scan(st, 'Kangaskhan', a as [number, number, number], 20, 1000 + i, 100 + i);
      return { id, p: c.place(id) };
    });
    // #3 (2/13/14) beat #2 but #2 found another slot: nothing to get rid of.
    expect(ids[2].p.replaced).toEqual([]);
    // #4 (1/14/15) pushed #3 to the Transfer list.
    expect(ids[3].p.beats).toMatch(/^beats your /);
    expect(ids[3].p.replaced).toEqual([{ id: ids[2].id, species: 'Kangaskhan', verdict: 'transfer', search: c.lists().transfer.find((x) => x.id === ids[2].id)!.search }]);
  });
});

describe('collection grid spots (Collection grid view, Ben 2026-11-24)', () => {
  const build = loadBuildFacts(CACHE);

  it('a kept Pokémon colours its build target tile in its build league: built or not yet', () => {
    const store = openStore(':memory:');
    const id = scan(store, 'Piplup', [0, 15, 15], 10, 250, 50, '', { speciesId: 'piplup' });
    const e = createCollection({ store, ranks, meta, facts, build }).entries().find((x) => x.id === id)!;
    expect(e.grid).toEqual([{ name: 'Empoleon', id: 'empoleon', dex: 395, league: 'ultra', built: false, pvpoke: expect.objectContaining({ ultra: build.metaRank('ultra', 'Empoleon', false) }) }]);
  });

  it('functionally perfect (15 atk, 14+ def/sta) adds a Master League spot on its final evolution, built at level 50', () => {
    const store = openStore(':memory:');
    const a = scan(store, 'Dratini', [15, 15, 14], 20, 600, 80, '', { speciesId: 'dratini' });
    const b = scan(store, 'Dragonite', [15, 14, 15], 50, 4100, 190, '', { speciesId: 'dragonite' });
    const all = createCollection({ store, ranks, meta, facts, build }).entries();
    const ml = (id: number) => all.find((x) => x.id === id)!.grid.find((s) => s.league === 'master');
    expect(ml(a)).toMatchObject({ id: 'dragonite', dex: 149, built: false, pvpoke: expect.objectContaining({ master: build.metaRank('master', 'Dragonite', false) }) });
    expect(ml(b)).toMatchObject({ id: 'dragonite', built: true });
  });

  it('a Pokémon with no build gets one plain spot on its own species', () => {
    const store = openStore(':memory:');
    const id = scan(store, 'Pidgey', [1, 2, 3], 10, 100, 30, '', { speciesId: 'pidgey' });
    const e = createCollection({ store, ranks, meta, facts, build }).entries().find((x) => x.id === id)!;
    if (!e.build) expect(e.grid).toEqual([{ name: 'Pidgey', id: 'pidgey', dex: 16, pvpoke: expect.any(Object) }]);
  });
});

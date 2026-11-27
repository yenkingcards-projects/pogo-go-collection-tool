import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { effectiveness, offMetaMoveset, buildTeams, loadLeagueData, type LeagueMon } from '../src/teams.js';
import { diffMeta, checkMeta, makeSnapshot, type Snapshot } from '../src/metawatch.js';
import { openStore } from '../src/store.js';

describe('type chart', () => {
  it('GO multipliers: 1.6 super, 0.625 not very, 0.390625 immune; dual types multiply', () => {
    expect(effectiveness('water', ['fire'])).toBe(1.6);
    expect(effectiveness('water', ['fire', 'ground'])).toBeCloseTo(2.56);
    expect(effectiveness('fire', ['water'])).toBe(0.625);
    expect(effectiveness('normal', ['ghost'])).toBe(0.390625);
    expect(effectiveness('fighting', ['psychic', 'normal'])).toBe(0.625 * 1.6);
  });
});

describe('off-meta build (Ben 2026-11-26)', () => {
  const type = (id: string) => ({ A: 'steel', B: 'fighting', C: 'fighting', D: 'rock', F: 'electric' } as Record<string, string>)[id];
  it('keeps fast + main charged move; second charged move = most used other move, a new type first', () => {
    const uses = [{ moveId: 'A', uses: 50 }, { moveId: 'B', uses: 40 }, { moveId: 'C', uses: 30 }, { moveId: 'D', uses: 20 }];
    expect(offMetaMoveset(['F', 'A', 'B'], uses, type)).toEqual(['F', 'A', 'D']); // C is fighting like B, so rock
  });
  it('same as recommended when there is no other charged move', () => {
    expect(offMetaMoveset(['F', 'A', 'B'], [{ moveId: 'A', uses: 5 }, { moveId: 'B', uses: 4 }], type)).toEqual(['F', 'A', 'B']);
  });
});

describe('team builder', () => {
  const mon = (id: string, place: number, types: string[], moveTypes: string[]): LeagueMon => ({
    id, name: id, place, score: 90 - place, roles: { lead: 80, closer: 80, switch: 80 }, types,
    moves: moveTypes.map((t, i) => ({ id: `${id}${i}`, name: `${id}${i}`, type: t, fast: i === 0, elite: false })),
    offMoves: moveTypes.map((t, i) => ({ id: `${id}o${i}`, name: `${id}o${i}`, type: t, fast: i === 0, elite: false })), beats: [], losesTo: [],
  });
  const data = new Map([
    mon('azumarill', 1, ['water', 'fairy'], ['water', 'ice', 'water']), mon('registeel', 2, ['steel'], ['steel', 'fighting', 'steel']),
    mon('medicham', 3, ['fighting', 'psychic'], ['fighting', 'ice', 'psychic']), mon('lanturn', 4, ['water', 'electric'], ['electric', 'water', 'grass']),
    mon('swampert', 60, ['water', 'ground'], ['water', 'ground', 'water']), mon('venusaur', 70, ['grass', 'poison'], ['grass', 'grass', 'poison']),
    mon('skarmory', 80, ['steel', 'flying'], ['flying', 'flying', 'dark']),
  ].map((m) => [m.id, m]));
  const cand = (id: string, built = true) => ({ id, name: id, entryId: 1, built, shadow: false });
  it('picks 3 different Pokémon with Lead / Switch / Closer roles from what Ben has', () => {
    const [t] = buildTeams(data, ['azumarill', 'registeel', 'medicham', 'lanturn'].map((id) => cand(id)));
    expect(t.members).toHaveLength(3);
    expect(new Set(t.members.map((m) => m.id)).size).toBe(3);
    expect(t.members.map((m) => m.role)).toEqual(['Lead', 'Switch', 'Closer']);
    expect(t.covers).toBeGreaterThan(0);
  });
  it('off-meta uses only Pokémon outside the top 50, with their off-meta moves', () => {
    const all = [...data.keys()].map((id) => cand(id));
    const [t] = buildTeams(data, all, { offMeta: true });
    expect(t.members.map((m) => m.id).sort()).toEqual(['skarmory', 'swampert', 'venusaur']);
    expect(t.members[0].moves[0].id).toContain('o');
    expect(buildTeams(data, all.slice(0, 4), { offMeta: true })).toEqual([]);
  });
  it('fewer than 3 candidates = no team', () => {
    expect(buildTeams(data, [cand('azumarill'), cand('medicham')])).toEqual([]);
  });
  it('real PvPoke data: every league loads with moves + off-meta builds', () => {
    const d = loadLeagueData(fileURLToPath(new URL('../data/cache/', import.meta.url)));
    const g = [...d.great.values()];
    expect(g.length).toBeGreaterThan(100);
    expect(g[0].moves).toHaveLength(3);
    expect(g[0].types.length).toBeGreaterThan(0);
    expect(g.some((m) => m.offMoves[2]?.id !== m.moves[2]?.id)).toBe(true);
  });
});

describe('meta watch (Ben 2026-11-26)', () => {
  const ranks = (ids: string[]) => ids.map((id) => ({ speciesId: id, speciesName: id[0].toUpperCase() + id.slice(1) }));
  const ids = (n: number, prefix = 'm') => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
  const gm = (date: string, power = 50) => ({ timestamp: date, moves: [{ moveId: 'ICE_PUNCH', name: 'Ice Punch', power, energy: 40, energyGain: 0, turns: 1 }] });
  it('Pokémon that climbed 10+ places into the top 100 = boosted; dropped 10+ or out = fell; move stat changes listed', () => {
    const before = ids(120);
    const after = ['m115', ...before.filter((x) => x !== 'm115' && x !== 'm2')]; // m115 jumps to #1, m2 drops out of the list
    const old = makeSnapshot(gm('2026-10-01'), { great: ranks(before) });
    const now = makeSnapshot(gm('2026-11-01', 55), { great: ranks(after) });
    const c = diffMeta(old, now)!;
    expect(c.from).toBe('2026-10-01');
    expect(c.leagues.great!.up[0]).toMatchObject({ id: 'm115', from: 115, to: 1 });
    expect(c.leagues.great!.down[0]).toMatchObject({ id: 'm2', from: 2, to: undefined });
    expect(c.moves).toEqual([{ id: 'ICE_PUNCH', name: 'Ice Punch', changes: [{ field: 'power', from: 50, to: 55 }] }]);
  });
  it('nothing changed = no alert', () => {
    const s = makeSnapshot(gm('2026-10-01'), { great: ranks(ids(50)) });
    expect(diffMeta(s, s)).toBeNull();
  });
  it('checkMeta: first run uses the baseline, saves an alert when changed, then remembers today', async () => {
    const store = openStore(':memory:');
    const old = makeSnapshot(gm('2026-10-01'), { great: ranks(ids(20)) });
    const now = makeSnapshot(gm('2026-11-01', 60), { great: ranks(ids(20)) });
    await checkMeta(store, now, async () => old);
    expect(store.metaChanges()).toHaveLength(1);
    expect(store.metaSnapshot()!.date).toBe('2026-11-01');
    await checkMeta(store, now, async () => { throw new Error('baseline not needed again'); });
    expect(store.metaChanges()).toHaveLength(1);
    store.dismissMetaChange(store.metaChanges()[0].id);
    expect(store.metaChanges()[0].dismissed).toBe(true);
  });
  it('no baseline (offline first run) = today becomes the baseline, no alert', async () => {
    const store = openStore(':memory:');
    await checkMeta(store, makeSnapshot(gm('2026-11-01'), {}) as Snapshot, async () => null);
    expect(store.metaChanges()).toEqual([]);
    expect(store.metaSnapshot()).toBeDefined();
  });
});

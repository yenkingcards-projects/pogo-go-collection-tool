// Meta watch (Ben, 2026-11-26): after each PvPoke download, compare with the last snapshot and save what changed:
// Pokémon that climbed or fell in each league's rankings, and move stat changes (Pokémon GO balance patches show up there).
// Pure apart from the cache read + the optional one-time baseline download from PvPoke's GitHub history.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCache } from './data.js';
import type { AnyLeague } from './build.js';

const LEAGUES: [AnyLeague, number][] = [['great', 1500], ['ultra', 2500], ['master', 10000], ['little', 500]];
const KEEP = 200; // places remembered per league
const TOP = 100;
const MIN_MOVE = 10; // places climbed/fallen to count
const MOVE_FIELDS = ['power', 'energy', 'energyGain', 'turns'] as const;

export interface Snapshot {
  date: string;
  places: Partial<Record<AnyLeague, Record<string, number>>>;
  names: Record<string, string>;
  moves: Record<string, { name: string; stats: Record<string, number>; buffs?: string }>;
}
export interface Shift { id: string; name: string; from?: number; to?: number }
export interface MoveChange { id: string; name: string; changes: { field: string; from: number | string; to: number | string }[] }
export interface MetaChange {
  from: string; to: string;
  leagues: Partial<Record<AnyLeague, { up: Shift[]; down: Shift[] }>>;
  moves: MoveChange[];
}

/** Snapshot from raw PvPoke JSON (gamemaster + rankings per league; a missing league is skipped). */
export function makeSnapshot(gm: any, rankings: Partial<Record<AnyLeague, { speciesId: string; speciesName: string }[]>>): Snapshot {
  const places: Snapshot['places'] = {}, names: Record<string, string> = {};
  for (const [l] of LEAGUES) {
    const rows = rankings[l];
    if (!rows) continue;
    places[l] = Object.fromEntries(rows.slice(0, KEEP).map((r, i) => { names[r.speciesId] = r.speciesName; return [r.speciesId, i + 1]; }));
  }
  const moves: Snapshot['moves'] = {};
  for (const m of gm.moves ?? []) {
    const stats: Record<string, number> = {};
    for (const f of MOVE_FIELDS) if (typeof m[f] === 'number') stats[f] = m[f];
    moves[m.moveId] = { name: m.name, stats, ...(m.buffs && { buffs: `${m.buffs.join('/')} ${m.buffTarget ?? ''} ${m.buffApplyChance ?? ''}`.trim() }) };
  }
  return { date: String(gm.timestamp ?? '').slice(0, 10), places, names, moves };
}

export function snapshotFromCache(dir: string): Snapshot {
  const rankings: Partial<Record<AnyLeague, any[]>> = {};
  for (const [l, cp] of LEAGUES) if (existsSync(join(dir, `pvpoke-rankings-${cp}.json`))) rankings[l] = readCache(dir, `pvpoke-rankings-${cp}.json`);
  return makeSnapshot(readCache(dir, 'pvpoke-gamemaster.json'), rankings);
}

/** What changed from old to new. null = nothing worth an alert. */
export function diffMeta(old: Snapshot, now: Snapshot): MetaChange | null {
  const leagues: MetaChange['leagues'] = {};
  for (const [l] of LEAGUES) {
    const a = old.places[l], b = now.places[l];
    if (!a || !b) continue;
    const up: Shift[] = [], down: Shift[] = [];
    for (const [id, to] of Object.entries(b)) {
      if (to > TOP) continue;
      const from = a[id];
      if (from === undefined || from - to >= MIN_MOVE) up.push({ id, name: now.names[id] ?? id, from, to });
    }
    for (const [id, from] of Object.entries(a)) {
      if (from > TOP) continue;
      const to = b[id];
      if (to === undefined || to - from >= MIN_MOVE) down.push({ id, name: now.names[id] ?? old.names[id] ?? id, from, to });
    }
    const gain = (s: Shift) => (s.from ?? KEEP + 1) - (s.to ?? KEEP + 1);
    up.sort((x, y) => gain(y) - gain(x)); down.sort((x, y) => gain(x) - gain(y));
    if (up.length || down.length) leagues[l] = { up: up.slice(0, 15), down: down.slice(0, 15) };
  }
  const moves: MoveChange[] = [];
  for (const [id, m] of Object.entries(now.moves)) {
    const o = old.moves[id];
    if (!o) continue; // brand-new moves aren't a balance change
    const changes: MoveChange['changes'] = [];
    for (const f of MOVE_FIELDS) if (o.stats[f] !== undefined && m.stats[f] !== undefined && o.stats[f] !== m.stats[f]) changes.push({ field: f, from: o.stats[f], to: m.stats[f] });
    if ((o.buffs ?? '') !== (m.buffs ?? '')) changes.push({ field: 'effect', from: o.buffs ?? 'none', to: m.buffs ?? 'none' });
    if (changes.length) moves.push({ id, name: m.name, changes });
  }
  if (!Object.keys(leagues).length && !moves.length) return null;
  return { from: old.date, to: now.date, leagues, moves };
}

/**
 * First run only: a baseline from PvPoke's GitHub history ~30 days back, so the first alert shows the last month's changes.
 * Public GitHub API, no key. Returns null when offline / rate-limited (then today's data becomes the baseline).
 */
export async function historicSnapshot(daysBack = 30, fetchImpl: typeof fetch = fetch): Promise<Snapshot | null> {
  try {
    const until = new Date(Date.now() - daysBack * 86_400_000).toISOString();
    const res = await fetchImpl(`https://api.github.com/repos/pvpoke/pvpoke/commits?path=src/data/gamemaster.json&until=${until}&per_page=1`, { headers: { 'user-agent': 'lilycove-co' } });
    if (!res.ok) return null;
    const sha = ((await res.json()) as any[])[0]?.sha;
    if (!sha) return null;
    const raw = (p: string) => fetchImpl(`https://raw.githubusercontent.com/pvpoke/pvpoke/${sha}/src/data/${p}`).then((r) => (r.ok ? r.json() : undefined));
    const gm = await raw('gamemaster.json');
    if (!gm) return null;
    const rankings: Partial<Record<AnyLeague, any[]>> = {};
    for (const [l, cp] of LEAGUES) rankings[l] = await raw(`rankings/all/overall/rankings-${cp}.json`);
    return makeSnapshot(gm, rankings);
  } catch { return null; }
}

/**
 * Called at start and after every PvPoke download. Compares with the saved snapshot (first run: the historic baseline,
 * if it could be fetched), saves any change as an alert, then saves today's snapshot.
 */
export async function checkMeta(store: { metaSnapshot(): Snapshot | undefined; setMetaSnapshot(s: Snapshot): void; addMetaChange(c: MetaChange): number },
  now: Snapshot, baseline: () => Promise<Snapshot | null> = () => historicSnapshot()): Promise<MetaChange | null> {
  const old = store.metaSnapshot() ?? (await baseline());
  const change = old ? diffMeta(old, now) : null;
  if (change) store.addMetaChange(change);
  store.setMetaSnapshot(now);
  return change;
}

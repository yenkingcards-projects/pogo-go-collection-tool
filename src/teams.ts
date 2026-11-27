// Teams tab (Ben, 2026-11-26): recommended 3-Pokémon teams per league from the Pokémon Ben has (or can build),
// plus an off-meta mode: Pokémon outside PvPoke's top 50 running an off-meta build (a less common charged move for coverage).
// Data: PvPoke gamemaster + rankings (MIT). Pure apart from loadLeagueData.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCache } from './data.js';
import type { AnyLeague } from './build.js';

export const TEAM_LEAGUES: { key: AnyLeague; label: string; cp: number }[] = [
  { key: 'great', label: 'Great', cp: 1500 }, { key: 'ultra', label: 'Ultra', cp: 2500 }, { key: 'master', label: 'Master', cp: 10000 }, { key: 'little', label: 'Little', cp: 500 },
];
/** Off-meta = outside PvPoke's top 50 for that league (Claude's call 2026-11-26). */
export const OFF_META_AFTER = 50;
const THREATS = 40;

// Pokémon GO type chart: attacker -> defenders it hits super effectively / not very / barely (GO "immune").
const SE: Record<string, string> = {
  normal: '', fire: 'grass ice bug steel', water: 'fire ground rock', electric: 'water flying', grass: 'water ground rock', ice: 'grass ground flying dragon',
  fighting: 'normal ice rock dark steel', poison: 'grass fairy', ground: 'fire electric poison rock steel', flying: 'grass fighting bug', psychic: 'fighting poison',
  bug: 'grass psychic dark', rock: 'fire ice flying bug', ghost: 'psychic ghost', dragon: 'dragon', dark: 'psychic ghost', steel: 'ice rock fairy', fairy: 'fighting dragon dark',
};
const NVE: Record<string, string> = {
  normal: 'rock steel', fire: 'fire water rock dragon', water: 'water grass dragon', electric: 'electric grass dragon', grass: 'fire grass poison flying bug dragon steel',
  ice: 'fire water ice steel', fighting: 'poison flying psychic bug fairy', poison: 'poison ground rock ghost', ground: 'grass bug', flying: 'electric rock steel',
  psychic: 'psychic steel', bug: 'fire fighting poison flying ghost steel fairy', rock: 'fighting ground steel', ghost: 'dark', dragon: 'steel', dark: 'fighting dark fairy',
  steel: 'fire water electric steel', fairy: 'fire poison steel',
};
const IMMUNE: Record<string, string> = { normal: 'ghost', electric: 'ground', fighting: 'ghost', poison: 'steel', ground: 'flying', psychic: 'dark', ghost: 'normal', dragon: 'fairy' };
const has = (list: string | undefined, t: string) => !!list && list.split(' ').includes(t);
/** Damage multiplier of a move type against a defender's types (1.6 / 0.625 / 0.390625 per type, multiplied). */
export function effectiveness(move: string, defender: string[]): number {
  return defender.reduce((m, t) => m * (has(SE[move], t) ? 1.6 : has(IMMUNE[move], t) ? 0.390625 : has(NVE[move], t) ? 0.625 : 1), 1);
}

export interface MoveInfo { id: string; name: string; type: string; fast: boolean; elite: boolean }
export interface LeagueMon {
  id: string; name: string; place: number; score: number;
  /** PvPoke role scores: lead, closer, switch. */
  roles: { lead: number; closer: number; switch: number };
  types: string[]; moves: MoveInfo[]; offMoves: MoveInfo[];
  /** Opponents PvPoke says it beats / loses to (its key matchups). */
  beats: string[]; losesTo: string[];
}
export type LeagueData = Record<AnyLeague, Map<string, LeagueMon>>;

/**
 * Off-meta build: PvPoke's recommended fast move, the main charged move, and for the second charged move the most-used
 * other charged move (one of a new type first, for coverage). Same as recommended when there is no other charged move.
 */
export function offMetaMoveset(moveset: string[], chargedUses: { moveId: string; uses: number }[], typeOf: (id: string) => string): string[] {
  const [fast, c1, c2] = moveset;
  const others = [...chargedUses].sort((a, b) => b.uses - a.uses).map((m) => m.moveId).filter((id) => id !== c1 && id !== c2);
  if (!others.length) return moveset;
  const covered = new Set([typeOf(c1), typeOf(c2)]);
  const pick = others.find((id) => !covered.has(typeOf(id))) ?? others[0];
  return [fast, c1, pick];
}

export function loadLeagueData(cacheDir: string): LeagueData {
  const gm = readCache(cacheDir, 'pvpoke-gamemaster.json');
  const byId = new Map((gm.pokemon as any[]).map((p) => [p.speciesId, p]));
  const moves = new Map((gm.moves as any[]).map((m) => [m.moveId, m]));
  const typeOf = (id: string) => moves.get(id)?.type ?? 'normal';
  const out = {} as LeagueData;
  for (const l of TEAM_LEAGUES) {
    const file = `pvpoke-rankings-${l.cp}.json`;
    const rows = existsSync(join(cacheDir, file)) ? (readCache(cacheDir, file) as any[]) : [];
    out[l.key] = new Map(rows.map((r, i) => {
      const p = byId.get(r.speciesId) ?? {};
      const elite = new Set<string>([...(p.eliteMoves ?? []), ...(p.legacyMoves ?? [])]);
      const info = (ids: string[]): MoveInfo[] => ids.filter(Boolean).map((id, n) => ({ id, name: moves.get(id)?.name ?? id, type: typeOf(id), fast: n === 0, elite: elite.has(id) }));
      const set: string[] = r.moveset ?? [];
      return [r.speciesId, {
        id: r.speciesId, name: r.speciesName, place: i + 1, score: r.score ?? 0,
        roles: { lead: r.scores?.[0] ?? 0, closer: r.scores?.[1] ?? 0, switch: r.scores?.[2] ?? 0 },
        types: ((p.types ?? []) as string[]).filter((t) => t && t !== 'none'),
        moves: info(set), offMoves: info(offMetaMoveset(set, r.moves?.chargedMoves ?? [], typeOf)),
        beats: (r.matchups ?? []).map((m: any) => m.opponent), losesTo: (r.counters ?? []).map((m: any) => m.opponent),
      } satisfies LeagueMon];
    }));
  }
  return out;
}

/** One Pokémon Ben could bring: from the Collection (built, or what it still costs). */
export interface Candidate { id: string; name: string; entryId: number; built: boolean; dust?: number; shadow: boolean }
export interface TeamMember extends Candidate { role: 'Lead' | 'Switch' | 'Closer'; place: number; types: string[]; moves: MoveInfo[] }
export interface Team { members: TeamMember[]; score: number; covers: number; threats: number; weakTo: string[] }

/** How well a Pokémon does into a threat: log of (its best move's damage multiplier / the threat's best move's), plus PvPoke's matchup lists. */
function edge(m: LeagueMon, moves: MoveInfo[], t: LeagueMon): number {
  const off = Math.max(1, ...moves.map((x) => effectiveness(x.type, t.types)));
  const def = Math.max(1, ...t.moves.map((x) => effectiveness(x.type, m.types)));
  let v = Math.log2(off / def);
  if (m.beats.includes(t.id) || t.losesTo.includes(m.id)) v += 1;
  if (m.losesTo.includes(t.id) || t.beats.includes(m.id)) v -= 1;
  return Math.max(-2, Math.min(2, v));
}

/**
 * Best teams of 3 from Ben's candidates. Score = how well the team handles PvPoke's top 40 (best member into each threat)
 * plus the members' PvPoke scores, a little extra for built ones and less for big dust bills.
 * Recommended: from his top-100 Pokémon (widened to 200, then all, if he has fewer than 3 there).
 * offMeta: only candidates outside the top 50, using their off-meta builds.
 */
export function buildTeams(data: Map<string, LeagueMon>, candidates: Candidate[], { offMeta = false, count = 3 } = {}): Team[] {
  const threats = [...data.values()].sort((a, b) => a.place - b.place).slice(0, THREATS);
  const known = candidates.filter((c) => data.has(c.id));
  const within = (n: number) => known.filter((c) => data.get(c.id)!.place <= n);
  const usable = offMeta ? known.filter((c) => data.get(c.id)!.place > OFF_META_AFTER)
    : [100, 200].map(within).find((l) => new Set(l.map((c) => c.id)).size >= 3) ?? known;
  const pool = usable
    // best PvPoke place first; one per species+shadow (the built one, else the cheapest)
    .sort((a, b) => data.get(a.id)!.place - data.get(b.id)!.place || Number(b.built) - Number(a.built) || (a.dust ?? Infinity) - (b.dust ?? Infinity))
    .filter((c, i, all) => all.findIndex((x) => x.id === c.id) === i)
    .slice(0, 30);
  // PvPoke score (top picks ~90, deep ranks ~60) matters about as much as coverage; built = +2, dust costs up to -3.
  const quality = (c: Candidate) => Math.max(0, data.get(c.id)!.score - 60) * 0.6 + (c.built ? 2 : -Math.min(3, (c.dust ?? 300_000) / 150_000));
  const movesOf = (c: Candidate) => (offMeta ? data.get(c.id)!.offMoves : data.get(c.id)!.moves);
  const edges = pool.map((c) => threats.map((t) => edge(data.get(c.id)!, movesOf(c), t)));
  const scored: { idx: number[]; score: number; covers: number }[] = [];
  for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) for (let c = b + 1; c < pool.length; c++) {
    if (new Set([pool[a].id, pool[b].id, pool[c].id].map((id) => id.replace(/_shadow$/, ''))).size < 3) continue;
    let s = 0, covers = 0;
    threats.forEach((_, t) => {
      const best = Math.max(edges[a][t], edges[b][t], edges[c][t]);
      s += best * (1 - t / (THREATS * 2)); // higher-ranked threats count a bit more
      if (best > 0) covers++;
    });
    s += [a, b, c].reduce((n, i) => n + quality(pool[i]), 0);
    scored.push({ idx: [a, b, c], score: s, covers });
  }
  scored.sort((x, y) => y.score - x.score);
  // Distinct teams: each pick shares at most one Pokémon with an earlier pick.
  const picked: typeof scored = [];
  for (const t of scored) {
    if (picked.length >= count) break;
    if (picked.every((p) => p.idx.filter((i) => t.idx.includes(i)).length <= 1)) picked.push(t);
  }
  return picked.map((t) => {
    const mons = t.idx.map((i) => pool[i]);
    // Roles: the arrangement with the best PvPoke lead + switch + closer scores.
    const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    const r = (c: Candidate) => data.get(c.id)!.roles;
    const best = orders.reduce((x, o) => (r(mons[o[0]]).lead + r(mons[o[1]]).switch + r(mons[o[2]]).closer > r(mons[x[0]]).lead + r(mons[x[1]]).switch + r(mons[x[2]]).closer ? o : x));
    const members = best.map((i, n) => {
      const c = mons[i], d = data.get(c.id)!;
      return { ...c, role: (['Lead', 'Switch', 'Closer'] as const)[n], place: d.place, types: d.types, moves: movesOf(c) };
    });
    const weakTo = threats.filter((_, ti) => t.idx.every((i) => edges[i][ti] < 0)).slice(0, 5).map((x) => x.name);
    return { members, score: Math.round(t.score * 10) / 10, covers: t.covers, threats: threats.length, weakTo };
  });
}

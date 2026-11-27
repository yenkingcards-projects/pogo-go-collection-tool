// Collection: all saved scans -> ranks -> keep slots -> Keep / Trade / Transfer lists with renames + search strings.
import { readCache } from './data.js';
import { assignSlots, beatsMessage, regionalBase, type Candidate, type MetaSets, type Assignment, type Slot } from './slots.js';
import { buildName, type League } from './namer.js';
import { searchString } from './search.js';
import type { RankEngine, RankResult, IVs } from './rank.js';
import type { Store } from './store.js';
import { applyRules, type RuleInput } from './rules.js';
import { powerUpCost, secondMoveCost, type Cost } from './cost.js';
import { generation, type AnyLeague, type BuildFacts, type Move } from './build.js';
import { sqlTime } from './uploads.js';

export interface Item {
  id: number; species: string; dex: number; cp: number; hp?: number; ivs: IVs;
  name: string; search: string; slot: Slot | null; why: string;
}
export interface Lists { keep: Item[]; trade: Item[]; transfer: Item[] }
/** What it takes to make a kept Pokémon its build (its keep slot). */
export interface Build {
  league: League; target: string; mega: boolean; ivRank: number; metaRank?: number;
  /** Target species id + dex (sprite for the evolve arrow on the Collection tab). */
  targetId: string; targetDex: number;
  /** Target's types, lowercase ([] = unknown). */
  types: string[];
  level: number; cp: number; powerUp: Cost; evolveCandy?: number; secondMove?: { dust: number; candy: number };
  moves: Move[];
  /** Off-meta build (Ben 2026-11-26). Same as moves when PvPoke has no other charged move. */
  offMoves: Move[]; total: Cost;
  /** At the target species / at (or past) the target level. built = both. */
  stageDone: boolean; levelDone: boolean; built: boolean;
}
/** One tile league on the Collection grid view: which species tile this Pokémon colours, in which league. */
export interface GridSpot {
  name: string; id: string; dex: number;
  /** No league = kept for another reason (plain tile, no colour). built = solid colour, else striped. */
  league?: AnyLeague; built?: boolean;
  /** PvPoke place of the tile species per league (filter on the grid). */
  pvpoke: Partial<Record<AnyLeague, number>>;
}
/** Master League (PRD: only "functionally perfect" flagging). Claude's call 2026-11-24: 15 attack, 14+ defense and HP; built at level 50. */
export const functionallyPerfect = (iv: IVs) => iv.atk === 15 && iv.def >= 14 && iv.sta >= 14;
export const MASTER_BUILT_LEVEL = 50;
const GRID_LEAGUES: AnyLeague[] = ['little', 'great', 'ultra', 'master'];

/** One saved Pokémon for the Collection tab. */
export interface Entry extends Item {
  verdict: Placement['verdict']; speciesId: string; level: number; gen: { n: number; region: string };
  /** When this Pokémon was scanned (ms). */
  scannedAt: number;
  shadow: boolean; lucky: boolean; best?: { league: League; target: string; rank: number };
  build?: Build;
  /** Owned candy for its family, from the newest scan that showed it (undefined = never read). */
  candyHave?: number; xlHave?: number;
  /** Candy family (typed candy is saved per family). */
  family: string;
  /** Ben ticked "moves done" (key survives a re-scan after powering up: family + IVs + shadow). */
  movesKey: string; movesDone: boolean;
  /** Collection grid view tiles this Pokémon shows on. */
  grid: GridSpot[];
}
export interface Placement {
  verdict: 'keep' | 'trade' | 'transfer'; name: string; search: string; beats: string; slot: Slot | null;
  /** Old bests this scan pushed off the Keep list (Ben gets rid of them with the search string). */
  replaced?: Replaced[];
}
export interface Replaced { id: number; species: string; verdict: 'trade' | 'transfer'; search: string }
export interface SpeciesFacts { legendary: Set<string>; mythical: Set<string>; canEvolve: Set<string>; tradeEvolves: Set<string>; needsXl: Set<string> }
export interface Collection { lists(): Lists; place(id: number): Placement; entries(): Entry[] }

const META_TOP = 100;
const LETTER: Record<League, string> = { great: 'G', ultra: 'U', little: 'L' };

/** Species in the top 100 of PvPoke's rankings per league ("meta picks"). Forms/shadows collapse to the base name. */
export function loadMeta(cacheDir: string, top = META_TOP): MetaSets {
  const names = (cp: number) =>
    new Set((readCache(cacheDir, `pvpoke-rankings-${cp}.json`) as { speciesName: string }[]).slice(0, top).map((r) => r.speciesName.replace(/\s*\(.*\)$/, '')));
  return { little: names(500), great: names(1500), ultra: names(2500) };
}

// Pokémon GO trade evolutions (evolve for free after a trade).
const TRADE_EVOLVERS = ['Kadabra', 'Machoke', 'Graveler', 'Haunter', 'Boldore', 'Gurdurr', 'Karrablast', 'Shelmet', 'Phantump', 'Pumpkaboo'];

/** Facts per species from PvPoke's gamemaster + rankings. needsXl = top 100 in a league where its best IVs need level > 40. */
export function loadFacts(cacheDir: string, top = META_TOP): SpeciesFacts {
  const gm = readCache(cacheDir, 'pvpoke-gamemaster.json').pokemon as any[];
  const base = (n: string) => n.replace(/\s*\(.*\)$/, '');
  const named = (pred: (p: any) => boolean) => new Set(gm.filter(pred).map((p) => base(p.speciesName)));
  const byId = new Map(gm.map((p) => [p.speciesId, p]));
  const needsXl = new Set<string>();
  for (const cp of [500, 1500, 2500])
    for (const r of (readCache(cacheDir, `pvpoke-rankings-${cp}.json`) as any[]).slice(0, top)) {
      const level = byId.get(r.speciesId)?.defaultIVs?.[`cp${cp}`]?.[0];
      if (level > 40) needsXl.add(base(r.speciesName));
    }
  return {
    legendary: named((p) => p.tags?.includes('legendary')),
    mythical: named((p) => p.tags?.includes('mythical')),
    canEvolve: named((p) => p.family?.evolutions?.length > 0),
    tradeEvolves: new Set(TRADE_EVOLVERS),
    needsXl,
  };
}

interface Row { id: number; d: any; r: RankResult & { unranked?: boolean }; at: string }

export function createCollection({ store, ranks, meta, facts, build: bf }: { store: Store; ranks: RankEngine; meta: MetaSets; facts: SpeciesFacts; build?: BuildFacts }): Collection {
  const cache = new Map<number, RankResult | null>();
  const rankOf = (id: number, d: any) => {
    if (!cache.has(id)) {
      try { cache.set(id, ranks.rank(d.species, d.ivs, d.level, d.speciesId)); } catch { cache.set(id, null); }
    }
    return cache.get(id)!;
  };

  // The same Pokémon scanned twice (same species, IVs, CP, HP) counts once: newest scan wins.
  function rows(excludeId?: number): Row[] {
    const byKey = new Map<string, Row>();
    for (const { id, detail: d, scannedAt: at } of store.details()) {
      if (id === excludeId) continue;
      // Can't rank (unknown form etc.): still listed, never dropped silently.
      const r = rankOf(id, d) ?? { species: d.species, currentStage: 0 as const, ranks: {}, unranked: true };
      byKey.set(`${r.species}|${d.ivs.atk}/${d.ivs.def}/${d.ivs.sta}|${d.cp}|${d.hp}`, { id, d, r, at });
    }
    return [...byKey.values()];
  }

  const candidates = (rs: Row[]): Candidate[] =>
    rs.map(({ id, d, r }) => ({
      id, currentStage: r.currentStage,
      // Shadows are ranked separately: their own slots.
      entries: Object.entries(r.ranks).flatMap(([league, list]) =>
        list!.map((x) => ({ league: league as League, target: d.shadow ? `${x.species} (shadow)` : x.species, stage: x.stage, rank: x.rank, mega: !!x.mega }))),
    }));

  function build(rs: Row[], a: Assignment): Map<number, Item & { verdict: Placement['verdict'] }> {
    const seen = new Map<string, number>();
    for (const { r, d } of rs) seen.set(`${r.species}|${d.cp}`, (seen.get(`${r.species}|${d.cp}`) ?? 0) + 1);
    const dupes = new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));

    const ruleInputs: RuleInput[] = rs.map(({ id, d, r }) => ({
      id, species: r.species, ivs: d.ivs, size: d.size, heightM: d.heightM, heaviest: d.heaviest, lightest: d.lightest,
      date: d.date, location: d.location, lucky: !!d.lucky, buddy: !!d.buddy, shiny: d.shiny, specialBackground: d.specialBackground,
      legendary: facts.legendary.has(r.species), mythical: facts.mythical.has(r.species),
      canEvolve: facts.canEvolve.has(r.species), tradeEvolves: facts.tradeEvolves.has(r.species),
      xlTrade: [r.species, ...Object.values(r.ranks).flat().map((x) => x!.species)].some((n) => facts.needsXl.has(regionalBase(n))),
    }));
    const rules = applyRules(ruleInputs, { exceptions: new Set(store.exceptions()) });

    return new Map(rs.map(({ id, d, r }) => {
      const slot = a.get(id) ?? null;
      const rule = rules.get(id)!;
      const dex = Object.values(r.ranks).flat()[0]?.dex ?? 0;
      // Never renamed -> the screen shows the species name, which is not a nickname.
      const nickname = d.nickname && d.nickname.toLowerCase() !== r.species.toLowerCase() ? d.nickname : '';
      const reasons = [
        ...(slot ? [`${LETTER[slot.league]}${slot.rank} ${slot.target}${slot.mega ? ' (mega)' : ''}`] : []),
        ...rule.keep,
        ...(rule.dex ? ['evolve for dex'] : []),
      ];
      const verdict: Placement['verdict'] = slot || rule.keep.length ? 'keep' : rule.trade ? 'trade' : 'transfer';
      const name = slot
        ? buildName({ currentStage: r.currentStage, ranks: r.ranks, nickname, primary: { league: slot.league, stage: slot.stage, rank: slot.rank, mega: slot.mega } })
        : verdict === 'trade' ? rule.trade! : '';
      const why = reasons.join(' · ') || (verdict === 'trade' ? 'trade tag' : r.unranked ? 'could not rank this species/form yet' : 'fills no keep slot');
      return [id, {
        id, species: r.species, dex, cp: d.cp, hp: d.hp, ivs: d.ivs, name, slot, why, verdict,
        search: searchString({ species: r.species, dex, cp: d.cp, hp: d.hp }, dupes.has(`${r.species}|${d.cp}`), verdict === 'transfer'),
      }];
    }));
  }

  return {
    lists() {
      const rs = rows();
      const items = [...build(rs, assignSlots(candidates(rs), meta)).values()].reverse(); // newest first
      return {
        keep: items.filter((i) => i.verdict === 'keep'),
        trade: items.filter((i) => i.verdict === 'trade'),
        transfer: items.filter((i) => i.verdict === 'transfer'),
      };
    },
    entries() {
      const rs = rows();
      const items = build(rs, assignSlots(candidates(rs), meta));
      const family = (d: any) => (bf ? bf.family(d.speciesId ?? bf.idOf(d.species) ?? '') : d.species);
      // Newest count wins: from a scan, or typed in by Ben (counts change as he plays). Duplicates of a Pokémon count too.
      const candy = new Map<string, { n: number; at: string }>(), xl = new Map<string, { n: number; at: string }>();
      for (const { detail: d, scannedAt } of store.details()) {
        if (d.candyCount !== undefined) candy.set(family(d), { n: d.candyCount, at: scannedAt });
        if (d.xlCount !== undefined) xl.set(family(d), { n: d.xlCount, at: scannedAt });
      }
      for (const [fam, t] of store.typedCandy()) {
        if (t.candy !== undefined && !(candy.get(fam)?.at! > t.candyAt!)) candy.set(fam, { n: t.candy, at: t.candyAt! });
        if (t.xl !== undefined && !(xl.get(fam)?.at! > t.xlAt!)) xl.set(fam, { n: t.xl, at: t.xlAt! });
      }
      const done = store.movesDone();
      return rs.map(({ id, d, r, at }) => {
        const it = items.get(id)!;
        const speciesId = d.speciesId ?? bf?.idOf(r.species) ?? '';
        const dex = bf?.dex(speciesId) ?? it.dex;
        const all = Object.entries(r.ranks).flatMap(([league, l]) => l!.map((x) => ({ league: league as League, ...x })));
        const top = all.sort((a, b) => a.rank - b.rank)[0];
        const e: Entry = {
          ...it, dex, speciesId, level: d.level, gen: generation(dex), scannedAt: sqlTime(at), shadow: !!d.shadow, lucky: !!d.lucky,
          ...(top && { best: { league: top.league, target: top.species, rank: top.rank } }),
          candyHave: candy.get(family(d))?.n, xlHave: xl.get(family(d))?.n, family: family(d),
          movesKey: `${family(d)}|${d.ivs.atk}/${d.ivs.def}/${d.ivs.sta}${d.shadow ? '|shadow' : ''}`, movesDone: false, grid: [],
        };
        e.movesDone = done.has(e.movesKey);
        const slot = it.slot;
        const target = slot && r.ranks[slot.league]?.find((x) => x.species === slot.target.replace(/ \(shadow\)$/, '') && !!x.mega === !!slot.mega);
        if (slot && target) {
          const mods = { shadow: !!d.shadow, lucky: !!d.lucky };
          const name = slot.mega ? `${target.species} (Mega)` : target.species;
          const powerUp = powerUpCost(d.level, target.level, mods);
          const evolveCandy = bf?.evolveCandy(speciesId, target.dex);
          const moveDust = bf?.secondMoveDust(target.species);
          const secondMove = moveDust ? secondMoveCost(moveDust, mods) : undefined;
          const left = e.movesDone ? undefined : secondMove;
          const stageDone = target.dex === dex, levelDone = d.level >= target.level - 1e-9;
          e.build = {
            league: slot.league, target: target.species, mega: !!slot.mega, ivRank: slot.rank, types: bf?.types(name) ?? [],
            targetId: bf?.idOf(target.species) ?? target.species.toLowerCase().replace(/[^a-z0-9]+/g, '_'), targetDex: target.dex,
            metaRank: bf?.metaRank(slot.league, name, !!d.shadow), level: target.level, cp: target.cp, powerUp, evolveCandy, secondMove,
            moves: bf?.moves(slot.league, name, !!d.shadow) ?? [],
            offMoves: bf?.offMoves(slot.league, name, !!d.shadow) ?? [],
            total: {
              dust: powerUp.dust + (left?.dust ?? 0),
              candy: powerUp.candy + (evolveCandy ?? 0) + (left?.candy ?? 0),
              xl: powerUp.xl,
            },
            stageDone, levelDone, built: stageDone && levelDone,
          };
        }
        const spot = (name: string, id: string, dexN: number, extra: Partial<GridSpot> = {}): GridSpot =>
          ({ name, id, dex: dexN, ...extra, pvpoke: Object.fromEntries(GRID_LEAGUES.flatMap((l) => { const n = bf?.metaRank(l, name, false); return n ? [[l, n]] : []; })) });
        // Mega builds share the plain species tile (one tile per Pokémon).
        if (e.build) e.grid.push(spot(e.build.target, e.build.targetId, e.build.targetDex, { league: e.build.league, built: e.build.built }));
        const fin = functionallyPerfect(d.ivs) ? bf?.finalEvo(speciesId) : undefined;
        if (fin) e.grid.push(spot(fin.name, fin.id, fin.dex, { league: 'master', built: fin.id === speciesId && d.level >= MASTER_BUILT_LEVEL }));
        if (!e.grid.length) e.grid.push(spot(r.species, speciesId, dex));
        return e;
      });
    },
    place(id) {
      const all = rows();
      const before = assignSlots(candidates(rows(id)), meta);
      const after = assignSlots(candidates(all), meta);
      const it = build(all, after).get(id);
      if (!it) return { verdict: 'transfer', name: '', search: '', beats: '', slot: null, replaced: [] };
      const beat = beatsMessage(before, after, id);
      const items = build(all, after);
      const replaced = beat.replaced.flatMap((old) => {
        const o = items.get(old);
        return o && o.verdict !== 'keep' ? [{ id: old, species: o.species, verdict: o.verdict, search: o.search }] : [];
      });
      return { verdict: it.verdict, name: it.name, search: it.search, beats: beat.text, slot: it.slot, replaced };
    },
  };
}

// Build facts for a kept Pokémon: PvPoke meta rank, recommended moves (+ Elite TM), second-move cost, evolve candy.
// Sources: PvPoke gamemaster + rankings (MIT), pogoapi.net evolutions (candy per evolution).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCache } from './data.js';
import type { League } from './namer.js';

export interface Move { id: string; name: string; fast: boolean; elite: boolean }
/** Keep-slot leagues + Master League (grid view only: Master isn't a keep slot, PRD = "functionally perfect" flag). */
export type AnyLeague = League | 'master';
export interface BuildFacts {
  /** 1-based place in PvPoke's league rankings ("#49 in Great League"). target = speciesName, e.g. "Linoone (Galarian)". */
  metaRank(league: AnyLeague, target: string, shadow: boolean): number | undefined;
  /** Last stage of the line (Dratini -> Dragonite). Branches pick the best Master League rank (Eevee -> best eeveelution). */
  finalEvo(speciesId: string): { id: string; name: string; dex: number } | undefined;
  /** PvPoke's recommended moveset: fast, charged, charged. */
  moves(league: League, target: string, shadow: boolean): Move[];
  secondMoveDust(target: string): number | undefined;
  /** Types of the target, lowercase ("water", "ground"). [] = unknown. */
  types(target: string): string[];
  /** Candy to evolve from the scanned form to the target dex. undefined = not on its line / unknown. */
  evolveCandy(fromSpeciesId: string, toDex: number): number | undefined;
  /** Candy family (PvPoke family id); falls back to the species id. */
  family(speciesId: string): string;
  /** PvPoke species id for a name ("Linoone (Galarian)" -> "linoone_galarian"). */
  idOf(target: string): string | undefined;
  dex(speciesId: string): number | undefined;
}

export const GENERATIONS = [
  { n: 1, region: 'Kanto', first: 1 }, { n: 2, region: 'Johto', first: 152 }, { n: 3, region: 'Hoenn', first: 252 },
  { n: 4, region: 'Sinnoh', first: 387 }, { n: 5, region: 'Unova', first: 494 }, { n: 6, region: 'Kalos', first: 650 },
  { n: 7, region: 'Alola', first: 722 }, { n: 8, region: 'Galar', first: 810 }, { n: 9, region: 'Paldea', first: 906 },
];
export function generation(dex: number): { n: number; region: string } {
  const g = [...GENERATIONS].reverse().find((x) => dex >= x.first) ?? GENERATIONS[0];
  return { n: g.n, region: g.region };
}

const LEAGUE_CP: Record<AnyLeague, number> = { little: 500, great: 1500, ultra: 2500, master: 10000 };
// pogoapi form label for PvPoke's regional suffix.
const REGION_FORM: Record<string, string> = { alolan: 'Alola', galarian: 'Galarian', hisuian: 'Hisuian', paldean: 'Paldea' };

export function loadBuildFacts(cacheDir: string): BuildFacts {
  const gm = readCache(cacheDir, 'pvpoke-gamemaster.json');
  const mons = gm.pokemon as any[];
  const byId = new Map(mons.map((p) => [p.speciesId, p]));
  const byName = new Map<string, any>();
  for (const p of mons) if (!byName.has(p.speciesName.toLowerCase())) byName.set(p.speciesName.toLowerCase(), p);
  const moveName = new Map((gm.moves as any[]).map((m) => [m.moveId, m.name as string]));
  // Master League file is optional (added 2026-11-24): missing = no Master ranks, never a crash.
  const rankings = Object.fromEntries((Object.keys(LEAGUE_CP) as AnyLeague[]).map((l) => {
    const file = `pvpoke-rankings-${LEAGUE_CP[l]}.json`;
    const list = (l === 'master' && !existsSync(join(cacheDir, file)) ? [] : readCache(cacheDir, file)) as any[];
    return [l, new Map(list.map((r, i) => [r.speciesId, { place: i + 1, moveset: r.moveset as string[] }]))];
  })) as Record<AnyLeague, Map<string, { place: number; moveset: string[] }>>;

  const idOf = (target: string) => byName.get(target.trim().toLowerCase())?.speciesId as string | undefined;
  // Megas missing from the league rankings fall back to the plain species.
  const ranked = (league: AnyLeague, target: string) => {
    const id = idOf(target);
    if (id && rankings[league].has(id)) return id;
    return / \(Mega.*\)$/.test(target) ? idOf(target.replace(/ \(Mega.*\)$/, '')) : id;
  };
  const entry = (league: AnyLeague, target: string, shadow: boolean) => {
    const id = ranked(league, target);
    if (!id) return undefined;
    return (shadow && rankings[league].get(`${id}_shadow`)) || rankings[league].get(id);
  };

  // Evolutions: "dex|form" -> [{ dex, form, candy }]
  const evoFile = join(cacheDir, 'pogoapi-evolutions.json');
  const evos = new Map<string, { dex: number; form: string; candy: number }[]>();
  if (existsSync(evoFile))
    for (const e of readCache(cacheDir, 'pogoapi-evolutions.json') as any[])
      evos.set(`${e.pokemon_id}|${e.form}`, (e.evolutions ?? []).map((x: any) => ({ dex: x.pokemon_id, form: x.form, candy: x.candy_required ?? 0 })));

  return {
    idOf,
    metaRank: (league, target, shadow) => entry(league, target, shadow)?.place,
    moves(league, target, shadow) {
      const e = entry(league, target, shadow);
      const p = byId.get(ranked(league, target) ?? '');
      if (!e || !p) return [];
      const elite = new Set<string>([...(p.eliteMoves ?? []), ...(p.legacyMoves ?? [])]);
      return e.moveset.map((id, i) => ({ id, name: moveName.get(id) ?? id, fast: i === 0, elite: elite.has(id) }));
    },
    types(target) {
      const p = byName.get(target.trim().toLowerCase()) ?? byName.get(target.replace(/ \(Mega.*\)$/, '').trim().toLowerCase());
      return ((p?.types ?? []) as string[]).filter((t) => t && t !== 'none');
    },
    secondMoveDust: (target) => byName.get(target.trim().toLowerCase())?.thirdMoveCost,
    evolveCandy(fromSpeciesId, toDex) {
      const p = byId.get(fromSpeciesId);
      if (!p) return undefined;
      if (p.dex === toDex) return 0;
      const region = fromSpeciesId.match(/_(alolan|galarian|hisuian|paldean)$/)?.[1];
      const start = `${p.dex}|${region ? REGION_FORM[region] : 'Normal'}`;
      // Breadth-first along the line; cheapest path to the target dex.
      const queue: [string, number][] = [[evos.has(start) ? start : `${p.dex}|Normal`, 0]];
      for (let i = 0; i < queue.length && i < 50; i++) {
        const [key, spent] = queue[i];
        for (const n of evos.get(key) ?? []) {
          if (n.dex === toDex) return spent + n.candy;
          queue.push([`${n.dex}|${n.form}`, spent + n.candy]);
        }
      }
      return undefined;
    },
    family: (speciesId) => byId.get(speciesId)?.family?.id ?? speciesId,
    finalEvo(speciesId) {
      const place = (id: string) => rankings.master.get(id)?.place ?? Infinity;
      let p = byId.get(speciesId);
      for (let i = 0; p && i < 5; i++) {
        const next = ((p.family?.evolutions ?? []) as string[]).map((id) => byId.get(id)).filter(Boolean);
        if (!next.length) break;
        p = next.sort((a, b) => place(a.speciesId) - place(b.speciesId))[0];
      }
      return p && { id: p.speciesId, name: p.speciesName, dex: p.dex };
    },
    dex: (speciesId) => byId.get(speciesId)?.dex,
  };
}

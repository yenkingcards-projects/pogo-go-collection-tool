// Rank Engine: species + IVs + level -> PvP rank for every evolution stage in Little/Great/Ultra (via ohbem).
import { createRequire } from 'node:module';
import { readCache } from './data.js';
import type { League, Stage } from './namer.js';

export interface IVs { atk: number; def: number; sta: number }
export interface StageRankDetail { species: string; dex: number; stage: Stage; rank: number; cp: number; level: number; mega?: boolean }
export interface RankResult { species: string; currentStage: Stage; ranks: Partial<Record<League, StageRankDetail[]>> }
export interface RankEngine { rank(species: string, ivs: IVs, level: number, speciesId?: string): RankResult }

const TYPE_IDS: Record<string, number> = { normal: 1, fighting: 2, flying: 3, poison: 4, ground: 5, rock: 6, bug: 7, ghost: 8, steel: 9,
  fire: 10, water: 11, grass: 12, electric: 13, psychic: 14, ice: 15, dragon: 16, dark: 17, fairy: 18 };

// ohbem is CommonJS; its types declare an ES default export.
const Ohbem: typeof import('ohbem').default = createRequire(import.meta.url)('ohbem');
const LEAGUES: League[] = ['little', 'great', 'ultra'];

export function createRankEngine(cacheDir: string, { levelCap = 50 } = {}): RankEngine {
  const pokemonData = readCache(cacheDir, 'ohbem-masterfile.json');
  const ohbem = new Ohbem({ pokemonData, levelCaps: [levelCap] });

  // Names come from PvPoke's gamemaster (masterfile has ids only). First entry per dex = base form.
  const nameOf = new Map<number, string>();
  const dexOf = new Map<string, number>();
  const megaReleased = new Set<number>(); // ohbem also knows unreleased megas; only count ones live in GO
  type GM = { dex: number; speciesName: string; speciesId: string; tags?: string[]; released?: boolean; types: string[]; baseStats: { atk: number; def: number; hp: number } };
  const gm = readCache(cacheDir, 'pvpoke-gamemaster.json').pokemon as GM[];
  for (const p of gm) {
    if (p.tags?.includes('mega') && p.released) megaReleased.add(p.dex);
    // Some species only appear by form ("Minior (Core)"): register the base name too.
    const base = p.speciesName.replace(/\s*\(.*\)$/, '');
    if (!nameOf.has(p.dex)) nameOf.set(p.dex, base);
    for (const key of [p.speciesId, p.speciesName, base].map((k) => k.toLowerCase()))
      if (!dexOf.has(key)) dexOf.set(key, p.dex);
  }

  // Regional forms (Galarian Zigzagoon...) have their own stats/types and evolution line. The masterfile only has
  // form ids, so match each PvPoke regional entry to the ohbem form with the same types + stats.
  const formOf = new Map<string, number>();       // speciesId -> ohbem form id
  const formName = new Map<string, string>();     // "dex:form" -> "Linoone (Galarian)"
  const sig = (types: number[], a: number, d: number, h: number) => `${[...types].sort().join(',')}|${a}|${d}|${h}`;
  for (const p of gm) {
    if (!/_(alolan|galarian|hisuian|paldean)$/.test(p.speciesId)) continue;
    const mon = pokemonData.pokemon[p.dex];
    if (!mon?.forms) continue;
    const want = sig(p.types.filter((t) => t !== 'none').map((t) => TYPE_IDS[t]), p.baseStats.atk, p.baseStats.def, p.baseStats.hp);
    const plain = sig(mon.types ?? [], mon.attack, mon.defense, mon.stamina);
    if (want === plain) continue; // can't tell it apart from the normal form
    for (const [fid, f] of Object.entries<any>(mon.forms)) {
      if (sig(f.types ?? mon.types ?? [], f.attack ?? mon.attack, f.defense ?? mon.defense, f.stamina ?? mon.stamina) !== want) continue;
      formOf.set(p.speciesId, Number(fid));
      formName.set(`${p.dex}:${fid}`, p.speciesName);
      break;
    }
  }
  // Evolved regional forms reached through evolutions (Galarian Zigzagoon -> Galarian Linoone) are named by the loop above too.

  // Stage = depth in the evolution tree (0 basic, 1 stage 1, 2 stage 2).
  const parent = new Map<number, number>();
  for (const [id, mon] of Object.entries<any>(pokemonData.pokemon))
    for (const evo of mon.evolutions ?? []) parent.set(evo.pokemon, Number(id));
  const stageOf = (dex: number): Stage => {
    let depth = 0;
    for (let p = parent.get(dex); p !== undefined && depth < 2; p = parent.get(p)) depth++;
    return depth as Stage;
  };

  return {
    rank(species, { atk, def, sta }, level, speciesId) {
      const dex = dexOf.get(species.trim().toLowerCase());
      if (dex === undefined) throw new Error(`Unknown species: ${species}`);
      const form = (speciesId && formOf.get(speciesId)) || 0;
      const raw = ohbem.queryPvPRank(dex, form, 0, 1, atk, def, sta, level);
      const ranks: RankResult['ranks'] = {};
      for (const league of LEAGUES) {
        const entries = Ohbem.filterLevelCaps(raw[league] ?? [], [levelCap]).filter((e) => !e.evolution || megaReleased.has(e.pokemon));
        if (entries.length)
          ranks[league] = entries.map((e) => ({
            species: formName.get(`${e.pokemon}:${e.form}`) ?? nameOf.get(e.pokemon) ?? String(e.pokemon),
            dex: e.pokemon, stage: stageOf(e.pokemon), rank: e.rank!, cp: e.cp!, level: e.level!,
            ...(e.evolution ? { mega: true } : {}),
          }));
      }
      return { species: nameOf.get(dex)!, currentStage: stageOf(dex), ranks };
    },
  };
}

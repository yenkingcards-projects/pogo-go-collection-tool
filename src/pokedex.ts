// Pokédex tab (Ben, 2026-11-23): Pokémon GO's special dexes (shiny, lucky, 100%, XXL, ...) with missing spots by national dex number.
// Marks come from Ben's taps now; reading Pokédex screenshots is issue 12 (reader plugs in as ServerOptions.readDex).
import { readCache } from './data.js';

export const DEX_KINDS = [
  { key: 'normal', label: 'Pokémon' }, { key: 'shiny', label: 'Shiny' }, { key: 'lucky', label: 'Lucky' }, { key: 'hundo', label: '100%' },
  { key: 'xxl', label: 'XXL' }, { key: 'xxs', label: 'XXS' }, { key: 'shadow', label: 'Shadow' }, { key: 'purified', label: 'Purified' },
  { key: 'mega', label: 'Mega' }, { key: 'gmax', label: 'G-Max' },
] as const;
/** Which spots a dex has: every species, only Mega-capable ones, or only spots read from screenshots (G-Max list isn't in PvPoke's data). */
export const DEX_SPOTS: Record<DexKind, 'all' | 'mega' | 'known'> = {
  normal: 'all', shiny: 'all', lucky: 'all', hundo: 'all', xxl: 'all', xxs: 'all', shadow: 'all', purified: 'all', mega: 'mega', gmax: 'known',
};
export type DexKind = (typeof DEX_KINDS)[number]['key'];
export const isDexKind = (k: unknown): k is DexKind => DEX_KINDS.some((d) => d.key === k);

export interface DexSpecies { dex: number; name: string; id: string; mega?: boolean }
/** What a Pokédex screenshot reader returns: the dex numbers it saw as caught / as missing spots. */
export type DexRead = { ok: true; have: number[]; missing: number[]; kind?: string } | { ok: false; reason: string };

/** One entry per national dex number released in Pokémon GO (PvPoke gamemaster), base form name. */
export function loadDexSpecies(cacheDir: string): DexSpecies[] {
  const byDex = new Map<number, DexSpecies>();
  const gm = readCache(cacheDir, 'pvpoke-gamemaster.json').pokemon as any[];
  const mega = new Set(gm.filter((p) => p.released && /\((Mega|Primal)/.test(p.speciesName)).map((p) => p.dex));
  for (const p of gm) {
    if (!p.released || p.dex < 1) continue;
    const plain = !/\(/.test(p.speciesName);
    const cur = byDex.get(p.dex);
    if (!cur || (plain && /\(/.test(cur.name))) byDex.set(p.dex, { dex: p.dex, name: p.speciesName, id: p.speciesId });
  }
  return [...byDex.values()].map((s) => (mega.has(s.dex) ? { ...s, mega: true } : s)).sort((a, b) => a.dex - b.dex);
}

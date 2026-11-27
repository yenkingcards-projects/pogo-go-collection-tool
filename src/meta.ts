// Meta tab (Ben, 2026-11-26): PvPoke's top 100 per league; greyed out when Ben doesn't have it. Pure apart from reading the cache.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCache } from './data.js';
import type { AnyLeague } from './build.js';

export interface MetaMon { rank: number; id: string; name: string; dex: number; shadow: boolean }
export const META_LEAGUES: { key: AnyLeague; label: string; cp: number }[] = [
  { key: 'great', label: 'Great', cp: 1500 }, { key: 'ultra', label: 'Ultra', cp: 2500 }, { key: 'master', label: 'Master', cp: 10000 }, { key: 'little', label: 'Little', cp: 500 },
];

/** Top N of each league's PvPoke rankings (a league whose file isn't downloaded is empty). */
export function loadMetaTop(cacheDir: string, top = 100): Record<AnyLeague, MetaMon[]> {
  const dex = new Map((readCache(cacheDir, 'pvpoke-gamemaster.json').pokemon as any[]).map((p) => [p.speciesId, p.dex as number]));
  const out = {} as Record<AnyLeague, MetaMon[]>;
  for (const l of META_LEAGUES) {
    const file = `pvpoke-rankings-${l.cp}.json`;
    const rows = existsSync(join(cacheDir, file)) ? (readCache(cacheDir, file) as { speciesId: string; speciesName: string }[]) : [];
    out[l.key] = rows.slice(0, top).map((r, i) => ({
      rank: i + 1, id: r.speciesId, name: r.speciesName, dex: dex.get(r.speciesId) ?? dex.get(r.speciesId.replace(/_shadow$/, '')) ?? 0, shadow: r.speciesId.endsWith('_shadow'),
    }));
  }
  return out;
}

/**
 * Do I have it? Yes when the Pokédex says caught (the Shadow dex for shadow picks), or a scanned Pokémon is this species
 * or builds into it. owned = species ids from scans ("_shadow" added for shadows).
 */
export function haveMeta(m: MetaMon, dexHave: Set<number>, shadowHave: Set<number>, owned: Set<string>): boolean {
  return owned.has(m.id) || (m.shadow ? shadowHave : dexHave).has(m.dex);
}

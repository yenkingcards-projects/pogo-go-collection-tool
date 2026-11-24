// Local cache of rank/meta data. Sources: ohbem's masterfile (Apache 2.0) and PvPoke (MIT) on GitHub.
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PVPOKE = 'https://raw.githubusercontent.com/pvpoke/pvpoke/master/src/data';
export const CACHE_FILES: Record<string, string> = {
  'ohbem-masterfile.json': 'https://raw.githubusercontent.com/WatWowMap/Masterfile-Generator/master/master-latest-basics.json',
  'pvpoke-gamemaster.json': `${PVPOKE}/gamemaster.json`,
  'pvpoke-rankings-500.json': `${PVPOKE}/rankings/all/overall/rankings-500.json`,
  'pvpoke-rankings-1500.json': `${PVPOKE}/rankings/all/overall/rankings-1500.json`,
  'pvpoke-rankings-2500.json': `${PVPOKE}/rankings/all/overall/rankings-2500.json`,
};

/** Nice to have (evolution candy costs, pogoapi.net). A failed download never blocks the PvPoke refresh. */
export const OPTIONAL_FILES: Record<string, string> = {
  'pogoapi-evolutions.json': 'https://pogoapi.net/api/v1/pokemon_evolutions.json',
  'pvpoke-rankings-10000.json': `${PVPOKE}/rankings/all/overall/rankings-10000.json`,
};

export const DEFAULT_CACHE_DIR = fileURLToPath(new URL('../data/cache/', import.meta.url));

/** Downloads every file first; only if all arrive as valid JSON are they swapped in (all-or-nothing). */
export async function refreshCache(dir = DEFAULT_CACHE_DIR, fetchImpl: typeof fetch = fetch): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const fresh: [string, string][] = [];
  for (const [name, url] of Object.entries(CACHE_FILES)) {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`);
    const text = await res.text();
    JSON.parse(text); // throws on an HTML error page etc.
    fresh.push([name, text]);
  }
  for (const [name, text] of fresh) writeFileSync(join(dir, `${name}.new`), text);
  for (const [name] of fresh) renameSync(join(dir, `${name}.new`), join(dir, name));
  for (const [name, url] of Object.entries(OPTIONAL_FILES)) {
    try {
      const res = await fetchImpl(url);
      const text = await res.text();
      if (!res.ok) continue;
      JSON.parse(text);
      writeFileSync(join(dir, `${name}.new`), text);
      renameSync(join(dir, `${name}.new`), join(dir, name));
    } catch { /* keep the old copy */ }
  }
}

export interface DataInfo { pvpokeDate: string; downloadedAt: string }
/** PvPoke's own gamemaster date + when we last downloaded it. */
export function dataInfo(dir = DEFAULT_CACHE_DIR): DataInfo {
  const file = join(dir, 'pvpoke-gamemaster.json');
  return {
    pvpokeDate: String(JSON.parse(readFileSync(file, 'utf8')).timestamp ?? '').slice(0, 10),
    downloadedAt: statSync(file).mtime.toISOString(),
  };
}

export const readCache = <T = any>(dir: string, name: string): T => JSON.parse(readFileSync(join(dir, name), 'utf8'));

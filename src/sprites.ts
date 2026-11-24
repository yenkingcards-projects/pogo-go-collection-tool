// Pixel-art sprites for the Collection tab: Pokémon Showdown's gen 5 style sprites (every species incl. regional forms),
// falling back to PokeAPI's sprite by Pokédex number. Downloaded once into data/cache/sprites/, then served locally.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SHOWDOWN = 'https://play.pokemonshowdown.com/sprites/gen5';
const POKEAPI = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon';
const REGION: Record<string, string> = { alolan: 'alola', galarian: 'galar', hisuian: 'hisui', paldean: 'paldea' };
const SPECIAL: Record<string, string> = { nidoran_female: 'nidoranf', nidoran_male: 'nidoranm' };
const RETRY_MISSING_MS = 7 * 86_400_000;

/** Candidate sprite URLs for a PvPoke species id, best first. */
export function spriteUrls(speciesId: string, dex?: number): string[] {
  const id = speciesId.replace(/_(shadow|mega.*|xs|xl)$/, '');
  const region = id.match(/^(.+?)_(alolan|galarian|hisuian|paldean)/);
  const name = SPECIAL[id] ?? (region ? `${region[1].replace(/_/g, '')}-${REGION[region[2]]}` : id.replace(/_/g, ''));
  const base = SPECIAL[id] ?? id.split('_')[0];
  return [...new Set([name, base])].map((n) => `${SHOWDOWN}/${n}.png`).concat(dex ? [`${POKEAPI}/${dex}.png`] : []);
}

/** PNG bytes for the species, or null. Never throws. */
export async function getSprite(dir: string, speciesId: string, dex?: number, fetchImpl: typeof fetch = fetch): Promise<Buffer | null> {
  if (!/^[a-z0-9_]+$/.test(speciesId)) return null;
  const file = join(dir, `${speciesId}.png`), none = join(dir, `${speciesId}.none`);
  if (existsSync(file)) return readFileSync(file);
  try { if (Date.now() - statSync(none).mtimeMs < RETRY_MISSING_MS) return null; } catch { /* not marked missing */ }
  mkdirSync(dir, { recursive: true });
  let offline = false;
  for (const url of spriteUrls(speciesId, dex)) {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.subarray(0, 4).toString('hex') !== '89504e47') continue; // not a PNG
      writeFileSync(file, buf);
      return buf;
    } catch { offline = true; }
  }
  if (!offline) writeFileSync(none, ''); // really missing: don't ask again for a week
  return null;
}

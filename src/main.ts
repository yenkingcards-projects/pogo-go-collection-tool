// Entry point for the always-on Mac server (run by launchd at login).
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from './store.js';
import { startServer, PORT } from './server.js';
import { DEFAULT_CACHE_DIR, refreshCache, dataInfo } from './data.js';
import { createSpeciesResolver } from './species.js';
import { createRankEngine } from './rank.js';
import { readScreenshot } from './screen/read.js';
import { nameFromNumbers } from './index.js';
import { createCollection, loadMeta, loadFacts, type Collection } from './collection.js';
import { loadBuildFacts } from './build.js';
import { splitVideo } from './video.js';
import { startAutoRefresh } from './autorefresh.js';
import { loadDexSpecies } from './pokedex.js';
import { look } from './screen/vision.js';
import { dexRead } from './screen/dex.js';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(dataDir, { recursive: true });
if (!existsSync(join(DEFAULT_CACHE_DIR, 'pvpoke-gamemaster.json'))) await refreshCache();

const store = openStore(`${dataDir}lilycove.sqlite`);

// Everything built from PvPoke/ohbem data; rebuilt after each refresh.
function load() {
  const ranks = createRankEngine(DEFAULT_CACHE_DIR);
  return {
    resolver: createSpeciesResolver(DEFAULT_CACHE_DIR),
    ranks,
    collection: createCollection({ store, ranks, meta: loadMeta(DEFAULT_CACHE_DIR), facts: loadFacts(DEFAULT_CACHE_DIR), build: loadBuildFacts(DEFAULT_CACHE_DIR) }),
  };
}
let data = load();
startAutoRefresh({ dir: DEFAULT_CACHE_DIR, onRefreshed: () => { data = load(); console.log(`PvPoke data refreshed (${dataInfo().pvpokeDate})`); } });

function read(path: string, opts: { cp?: number } = {}) {
  const r = readScreenshot(path, data.resolver, opts);
  if (!r.ok) return r;
  let name = '';
  try { name = nameFromNumbers(data.ranks, r.scan.species, r.scan.ivs, r.scan.level, r.scan.nickname).name; } catch { /* forms ohbem can't rank yet */ }
  return { ok: true as const, scan: { ...r.scan, name } };
}
const collection: Collection = { lists: () => data.collection.lists(), place: (id) => data.collection.place(id), entries: () => data.collection.entries() };

await startServer(store, PORT, { read, collection, split: splitVideo, dataInfo: () => dataInfo(), uploadDir: `${dataDir}uploads`, spriteDir: `${DEFAULT_CACHE_DIR}sprites`,
  dexSpecies: () => loadDexSpecies(DEFAULT_CACHE_DIR), dexInbox: `${dataDir}pokedex-inbox`, readDex: (path) => dexRead(look(path)) });
console.log(`Lilycove Co running: http://localhost:${PORT}`);

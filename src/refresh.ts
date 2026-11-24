import { refreshCache, DEFAULT_CACHE_DIR } from './data.js';
await refreshCache();
console.log(`PvPoke + ohbem data saved to ${DEFAULT_CACHE_DIR}`);

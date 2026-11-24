// Usage: npm run rank -- <species> <atk> <def> <sta> <level> [nickname]
import { DEFAULT_CACHE_DIR } from './data.js';
import { createRankEngine } from './rank.js';
import { nameFromNumbers } from './index.js';

const [species, atk, def, sta, level, nickname] = process.argv.slice(2);
if (!level) { console.log('Usage: npm run rank -- <species> <atk> <def> <sta> <level> [nickname]'); process.exit(1); }
const out = nameFromNumbers(createRankEngine(DEFAULT_CACHE_DIR), species, { atk: +atk, def: +def, sta: +sta }, +level, nickname);
for (const [league, list] of Object.entries(out.ranks))
  for (const r of list!) console.log(`${league.padEnd(6)} ${r.species.padEnd(12)} stage ${r.stage}  #${r.rank}  CP ${r.cp} @ L${r.level}`);
console.log(`Rename: ${out.name || '(none: no rank under 250)'}`);

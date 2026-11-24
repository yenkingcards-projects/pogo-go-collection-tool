// Slot Assigner: one keeper per target species x league (x mega). Pure: plain data in, assignment out.
// Order (PRD stories 8-13): L1-L9 first, then meta-league picks, then Great, then Ultra, then other Little.
// Within a pass the best rank claims the slot; a runner-up falls through to later slots; no slot = transfer.
import type { League, Stage } from './namer.js';

/** "Linoone (Galarian)" -> "Linoone": for lookups keyed by plain species (meta picks, XL list). */
export const regionalBase = (n: string) => n.replace(/\s*\((Alolan|Galarian|Hisuian|Paldean)\)/, '');

export interface Entry { league: League; target: string; stage: Stage; rank: number; mega?: boolean }
export interface Candidate { id: number; currentStage: Stage; entries: Entry[] }
export type MetaSets = Record<League, Set<string>>;
export interface Slot extends Entry { key: string }
export type Assignment = Map<number, Slot | null>;

const COUNT_UNDER = 250;
const LETTER: Record<League, string> = { great: 'G', ultra: 'U', little: 'L' };
export const slotKey = (e: Entry) => `${e.league}|${e.target}${e.mega ? '|mega' : ''}`;

function pass(e: Entry, meta: MetaSets): number {
  if (e.league === 'little' && e.rank < 10) return 0;
  if (meta[e.league].has(regionalBase(e.target))) return 1;
  return { great: 2, ultra: 3, little: 4 }[e.league];
}

export function assignSlots(candidates: Candidate[], meta: MetaSets): Assignment {
  const pairs = candidates.flatMap((c) =>
    c.entries.filter((e) => e.rank < COUNT_UNDER).map((e) => ({ id: c.id, e, pass: pass(e, meta) })));
  pairs.sort((a, b) => a.pass - b.pass || a.e.rank - b.e.rank || a.id - b.id);

  const out: Assignment = new Map(candidates.map((c) => [c.id, null]));
  const taken = new Set<string>();
  for (const { id, e } of pairs) {
    const key = slotKey(e);
    if (out.get(id) || taken.has(key)) continue;
    taken.add(key);
    out.set(id, { ...e, key });
  }
  return out;
}

/** "beats your G40": which kept Pokémon lost its slot to the new scan. */
export function beatsMessage(before: Assignment, after: Assignment, newId: number): { text: string; replaced: number[] } {
  const won = after.get(newId);
  if (!won) return { text: '', replaced: [] };
  const replaced = [...before].filter(([id, s]) => id !== newId && s?.key === won.key).map(([id]) => id);
  const old = replaced.length ? before.get(replaced[0])! : null;
  return { text: old ? `beats your ${LETTER[old.league]}${old.rank}` : '', replaced };
}

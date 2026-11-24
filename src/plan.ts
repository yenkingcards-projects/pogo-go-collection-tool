// Planner (Ben, 2026-11-23): type in dust + Elite TMs -> which kept Pokémon to build, and who gets the TMs. Pure.
// Greedy by PvPoke meta place (best first). Candy is shared per family; a count never read doesn't block a build.
import type { Entry } from './collection.js';
import type { League } from './namer.js';

export interface Inventory { dust: number; fastTm: number; chargedTm: number }
export interface PlanMon {
  id: number; family: string; league: League; types: string[]; metaRank?: number;
  /** At its target stage + level. */
  built: boolean; movesDone: boolean;
  /** Still to spend (0 = nothing left). */
  dust: number; candy: number; xl: number;
  candyHave?: number; xlHave?: number;
  /** Elite TMs its recommended moveset needs. */
  eliteFast: number; eliteCharged: number;
}
export interface Plan {
  /** Build these, in this order. */
  build: number[]; dustUsed: number; dustLeft: number;
  /** Builds picked although their candy count was never read. */
  candyUnknown: number[];
  fastTm: number[]; chargedTm: number[];
  /** Builds whose league + typing has no fully built Pokémon yet (Ben, 2026-11-23: highlighted). */
  newTyping: number[];
}

const byMeta = (a: PlanMon, b: PlanMon) => (a.metaRank ?? Infinity) - (b.metaRank ?? Infinity) || a.id - b.id;

export function plan(mons: PlanMon[], inv: Inventory): Plan {
  const candy = new Map<string, number>(), xl = new Map<string, number>();
  for (const m of mons) {
    if (m.candyHave !== undefined) candy.set(m.family, m.candyHave);
    if (m.xlHave !== undefined) xl.set(m.family, m.xlHave);
  }
  const out: Plan = { build: [], dustUsed: 0, dustLeft: Math.max(0, inv.dust || 0), candyUnknown: [], fastTm: [], chargedTm: [], newTyping: [] };

  for (const m of mons.filter((x) => x.dust > 0 || x.candy > 0 || x.xl > 0).sort(byMeta)) {
    if (m.dust > out.dustLeft) continue;
    const c = candy.get(m.family), x = xl.get(m.family);
    if ((c !== undefined && m.candy > c) || (x !== undefined && m.xl > x)) continue;
    if (c !== undefined) candy.set(m.family, c - m.candy);
    if (x !== undefined) xl.set(m.family, x - m.xl);
    if ((c === undefined && m.candy > 0) || (x === undefined && m.xl > 0)) out.candyUnknown.push(m.id);
    out.build.push(m.id);
    out.dustUsed += m.dust;
    out.dustLeft -= m.dust;
  }

  // Typing coverage: a fully built Pokémon (stage + level + moves) covers its league + typing, in any type order.
  const typing = (m: PlanMon) => m.league + '|' + [...m.types].sort().join('/');
  const covered = new Set(mons.filter((m) => m.built && m.movesDone && m.types.length).map(typing));
  const byId = new Map(mons.map((m) => [m.id, m]));
  out.newTyping = out.build.filter((id) => { const m = byId.get(id)!; return m.types.length > 0 && !covered.has(typing(m)); });

  // Elite TMs: built or buildable now first (a TM on a Pokémon you can't build yet waits), then meta place.
  const ready = new Set([...out.build, ...mons.filter((m) => m.built).map((m) => m.id)]);
  const order = (need: (m: PlanMon) => number) =>
    mons.filter((m) => !m.movesDone && need(m) > 0).sort((a, b) => Number(ready.has(b.id)) - Number(ready.has(a.id)) || byMeta(a, b));
  const give = (need: (m: PlanMon) => number, have: number, into: number[]) => {
    for (const m of order(need)) if (need(m) <= have) { into.push(m.id); have -= need(m); }
  };
  give((m) => m.eliteFast, Math.max(0, inv.fastTm || 0), out.fastTm);
  give((m) => m.eliteCharged, Math.max(0, inv.chargedTm || 0), out.chargedTm);
  return out;
}

/** A kept Pokémon with a build -> planner input (no build = nothing to plan). */
export function planMon(e: Entry): PlanMon | undefined {
  const b = e.build;
  if (!b) return undefined;
  return {
    id: e.id, family: e.family, league: b.league, types: b.types ?? [], metaRank: b.metaRank, built: b.built, movesDone: e.movesDone,
    dust: b.total.dust, candy: b.total.candy, xl: b.total.xl, candyHave: e.candyHave, xlHave: e.xlHave,
    eliteFast: b.moves.filter((m) => m.elite && m.fast).length, eliteCharged: b.moves.filter((m) => m.elite && !m.fast).length,
  };
}

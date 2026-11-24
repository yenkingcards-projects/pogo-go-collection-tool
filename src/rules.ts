// Keep / trade rules beyond PvP slots (PRD stories 14-19, 25-26). Pure: plain data in, decisions out.
import type { IVs } from './rank.js';

export interface RuleInput {
  id: number; species: string; ivs: IVs;
  size?: 'XXS' | 'XS' | 'XL' | 'XXL'; heightM?: number; heaviest?: boolean; lightest?: boolean;
  date?: string; location?: string;
  lucky: boolean; buddy: boolean; shiny?: boolean | null; specialBackground?: boolean | null;
  legendary: boolean; mythical: boolean;
  canEvolve: boolean; tradeEvolves: boolean; xlTrade: boolean;
}
export interface RuleResult { keep: string[]; trade?: string; dex: boolean }

// Ben's PvE list, best first (story 14).
const PVE_ORDER = ['15/15/15', '15/15/14', '15/14/14', '14/15/15', '14/15/14', '14/14/15'];
const HOME_STATES = new Set(['CA', 'MI']);
const PROTECT_BEFORE_YEAR = 2018;

const ivKey = (v: IVs) => `${v.atk}/${v.def}/${v.sta}`;
const year = (date?: string) => Number(date?.match(/(\d{4})$/)?.[1]) || new Date().getFullYear();
const yy = (date?: string) => String(year(date)).slice(-2);

/** Caught outside California / Michigan (or outside the US) = distance trade. */
function isDistance(location?: string): boolean {
  if (!location) return false;
  const parts = location.split(',').map((p) => p.trim());
  const country = parts[parts.length - 1];
  if (country !== 'United States') return true;
  return !HOME_STATES.has(parts[parts.length - 2]);
}

export function applyRules(list: RuleInput[], { exceptions }: { exceptions: Set<string> }): Map<number, RuleResult> {
  const out = new Map<number, RuleResult>(list.map((m) => [m.id, { keep: [], dex: false }]));
  const ex = new Set([...exceptions].map((s) => s.toLowerCase()));

  // PvE: one per species, highest on the list.
  const pveBest = new Map<string, RuleInput>();
  for (const m of list) {
    const rank = PVE_ORDER.indexOf(ivKey(m.ivs));
    if (rank < 0) continue;
    const cur = pveBest.get(m.species);
    if (!cur || rank < PVE_ORDER.indexOf(ivKey(cur.ivs))) pveBest.set(m.species, m);
  }
  for (const m of pveBest.values()) out.get(m.id)!.keep.push('PvE');

  // Collection: XXS / XXL (most extreme stays, others -> trade), game's HEAVIEST / LIGHTEST labels.
  for (const size of ['XXS', 'XXL'] as const) {
    const bySpecies = new Map<string, RuleInput[]>();
    for (const m of list.filter((x) => x.size === size)) bySpecies.set(m.species, [...(bySpecies.get(m.species) ?? []), m]);
    for (const group of bySpecies.values()) {
      group.sort((a, b) => (size === 'XXS' ? 1 : -1) * ((a.heightM ?? 0) - (b.heightM ?? 0)));
      out.get(group[0].id)!.keep.push(size);
      for (const m of group.slice(1)) out.get(m.id)!.trade = `trade ${size.toLowerCase()} ${yy(m.date)}`;
    }
  }
  for (const m of list) {
    const r = out.get(m.id)!;
    if (m.heaviest) r.keep.push('heaviest');
    if (m.lightest) r.keep.push('lightest');

    // Protected: never transfer.
    if (m.lucky) r.keep.push('lucky');
    if (m.buddy) r.keep.push('best buddy');
    if (m.legendary) r.keep.push('legendary');
    if (m.mythical) r.keep.push('mythical');
    if (m.shiny) r.keep.push('shiny');
    if (m.date && year(m.date) < PROTECT_BEFORE_YEAR) r.keep.push(`caught ${year(m.date)}`);
    if (ex.has(m.species.toLowerCase())) r.keep.push('your exception');

    // Trade tags (first match wins): special background, distance, trade evolution, candy XL.
    r.trade ??= m.specialBackground ? `trade sbg ${yy(m.date)}`
      : isDistance(m.location) ? `trade d ${yy(m.date)}`
      : m.tradeEvolves ? `trade evo ${yy(m.date)}`
      : m.xlTrade ? `trade ${yy(m.date)}` : undefined;

    // Evolving a lucky registers its evolution in the lucky dex.
    r.dex = m.lucky && m.canEvolve;
  }
  return out;
}

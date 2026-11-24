// Species Resolver: candy family + CP/HP/IV math picks the species (PRD: never trust the nickname).
import { createRequire } from 'node:module';
import { readCache } from './data.js';
import type { IVs } from './rank.js';

const CPM: Record<string, number> = createRequire(import.meta.url)('ohbem/cpm.json');
const LEVELS = Object.keys(CPM).map(Number).filter((l) => l <= 51).sort((a, b) => a - b);

interface Mon { speciesId: string; speciesName: string; types: string[]; family?: { id: string }; baseStats: { atk: number; def: number; hp: number }; tags?: string[] }
export interface ResolveInput {
  candy?: string; caughtAs?: string; nickname?: string; hp: number; ivs: IVs;
  cp?: number;
  /** When the CP is partly hidden: digits that were read, in order, e.g. "27" from "CP27_0". */
  cpDigits?: string;
  /** Type words read from screen, e.g. ["GRASS", "DRAGO"] (partial is fine). Splits regional forms. */
  types?: string[];
}
export interface Resolved { species: string; speciesId: string; level: number; cp: number }
export interface SpeciesResolver {
  resolve(input: ResolveInput): Resolved | null;
  /** Every species + level that fits HP + IVs when the CP can't be read at all (Dynamic Island over it). */
  candidates(input: Omit<ResolveInput, 'cp' | 'cpDigits'>): Resolved[];
  isSpecies(name: string): boolean; isCandy(name: string): boolean;
}

const norm = (s = '') => s.toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '');
// Strip form text: "Minior (Core)" -> "Minior".
const baseName = (m: Mon) => m.speciesName.replace(/\s*\(.*\)$/, '');

export function cpAt(m: Mon, ivs: IVs, level: number): { cp: number; hp: number } {
  const c = CPM[String(level)];
  const a = m.baseStats.atk + ivs.atk, d = m.baseStats.def + ivs.def, s = m.baseStats.hp + ivs.sta;
  return { cp: Math.max(10, Math.floor((a * Math.sqrt(d) * Math.sqrt(s) * c * c) / 10)), hp: Math.max(10, Math.floor(s * c)) };
}

export function createSpeciesResolver(cacheDir: string): SpeciesResolver {
  const mons = (readCache(cacheDir, 'pvpoke-gamemaster.json').pokemon as Mon[])
    .filter((m) => !m.tags?.includes('mega') && !m.tags?.includes('shadow') && !/_(xs|xl|shadow|mega.*)$/.test(m.speciesId));
  const byName = new Map<string, Mon[]>();
  for (const m of mons) byName.set(norm(baseName(m)), [...(byName.get(norm(baseName(m))) ?? []), m]);

  const familyOf = (name?: string): Mon[] => {
    if (!name) return [];
    const key = norm(name);
    const fam = mons.filter((m) => m.family && norm(m.family.id.replace(/^FAMILY_/, '')) === key);
    if (fam.length) return fam;
    const named = byName.get(key) ?? [];
    const famId = named.find((m) => m.family)?.family?.id;
    return famId ? mons.filter((m) => m.family?.id === famId) : named;
  };

  const fitsFor = ({ candy, caughtAs, hp, ivs, types }: ResolveInput, cpOk: (c: number) => boolean) => {
    const pool = familyOf(candy).length ? familyOf(candy) : familyOf(caughtAs);
    const want = (types ?? []).map((w) => w.toLowerCase().replace(/[^a-z]/g, '').slice(0, 4)).filter((w) => w.length >= 3);
    const typed = pool.filter((m) => want.length && want.every((w) => m.types.some((ty) => ty.startsWith(w))));
    const fits: Resolved[] = [];
    for (const m of typed.length ? typed : pool)
      for (const level of LEVELS) {
        const s = cpAt(m, ivs, level);
        if (cpOk(s.cp) && s.hp === hp) fits.push({ species: baseName(m), speciesId: m.speciesId, level, cp: s.cp });
      }
    return fits;
  };
  // Ties (e.g. same stats): prefer the caught-as species, then the plain (non-form) entry.
  const preferred = (fits: Resolved[], caughtAs?: string, nickname?: string) => {
    const hint = norm(caughtAs ?? nickname);
    return fits.find((f) => norm(f.species) === hint && !f.speciesId.includes('_'))
      ?? fits.find((f) => norm(f.species) === hint)
      ?? fits.find((f) => !f.speciesId.includes('_'))
      ?? fits[0];
  };

  return {
    isSpecies: (name) => byName.has(norm(name)),
    isCandy: (name) => familyOf(name).length > 0,
    candidates(input) {
      // Same-stat species at one level (same CP) collapse to the preferred one. If species at a level
      // disagree on CP they all stay, so the caller can see it can't tell them apart.
      const fits = fitsFor(input, () => true);
      return [...new Set(fits.map((f) => f.level))].flatMap((l) => {
        const at = fits.filter((f) => f.level === l);
        return new Set(at.map((f) => f.cp)).size === 1 ? [preferred(at, input.caughtAs, input.nickname)] : at;
      });
    },
    resolve(input) {
      const { cp, cpDigits } = input;
      const cpOk = (c: number) =>
        cp !== undefined ? c === cp : !!cpDigits && new RegExp(cpDigits.split('').join('.*')).test(String(c)) && String(c).length > cpDigits.length;
      const fits = fitsFor(input, cpOk);
      if (!fits.length) return null;
      // A guessed CP must be unambiguous.
      if (cp === undefined && new Set(fits.map((f) => f.cp)).size > 1) return null;
      return preferred(fits, input.caughtAs, input.nickname);
    },
  };
}

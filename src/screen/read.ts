// Screen Reader: appraisal screenshot -> structured fields. Failed reads say why (never dropped).
import { look, type Picture, type TextBox } from './vision.js';
import { readBar } from './ivbars.js';
import { arcDot, pickByDot } from './arc.js';
import { isShadow, isSpecialBackground } from './flags.js';
import type { SpeciesResolver, Resolved } from '../species.js';
import type { IVs } from '../rank.js';

export interface Appraisal {
  species: string; speciesId: string; level: number;
  cp: number; hp: number; ivs: IVs;
  nickname: string; candy: string;
  /** Candy / XL candy Ben owns for this family (row above the candy name). XL only when not hidden by the appraiser. */
  candyCount?: number; xlCount?: number;
  weightKg?: number; heightM?: number;
  size?: 'XXS' | 'XS' | 'XL' | 'XXL'; heaviest?: boolean; lightest?: boolean;
  lucky: boolean; buddy: boolean;
  shiny: null; shadow: boolean; specialBackground: boolean; // shiny: not readable (see screen/flags.ts)
  caughtAs?: string; date?: string; location?: string;
}
export type ReadResult = { ok: true; scan: Appraisal } | { ok: false; reason: string; partial: Partial<Appraisal> };

const find = (texts: TextBox[], re: RegExp) => texts.find((t) => re.test(t.text));

// OCR sometimes returns Cyrillic/Greek look-alikes ("HР" with a Cyrillic Р). Map them to Latin.
const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K', М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', а: 'a', с: 'c', е: 'e', о: 'o', р: 'p', х: 'x', Ρ: 'P', Η: 'H', Κ: 'K' };
const latin = (s: string) => s.replace(/[А-яΑ-ω]/g, (c) => LOOKALIKE[c] ?? c);

/**
 * Owned candy counts: the numbers in the row above "X CANDY" / "X CANDY XL". Layout on Ben's 1320 px screen:
 * stardust (hidden by the appraisal badge) | candy (centre ~0.52w) | XL (right, ~0.80w; the appraiser's head often
 * covers its first digits, so a number starting right of 0.815w is not trusted). Leading zero = cut off = not trusted.
 */
function candyCounts(t: TextBox[], width: number): { candyCount?: number; xlCount?: number } {
  const label = t.filter((b) => /CAN(DY|D|I)?\b|CANDY/i.test(b.text) && b.y > 0.9 * width).sort((a, b) => a.y - b.y)[0];
  if (!label) return {};
  const row = t.filter((b) => /^\d{1,3}(,\d{3})*$/.test(b.text.trim()) && !/^0\d/.test(b.text.trim())
    && label.y - b.y > 0.015 * width && label.y - b.y < 0.11 * width);
  const num = (b?: TextBox) => (b ? Number(b.text.replace(/,/g, '')) : undefined);
  const cx = (b: TextBox) => (b.x + b.w / 2) / width;
  const candy = row.find((b) => cx(b) > 0.4 && cx(b) < 0.62);
  const xl = row.find((b) => cx(b) > 0.74 && b.x / width < 0.815);
  return { ...(candy && { candyCount: num(candy) }), ...(xl && { xlCount: num(xl) }) };
}

/** opts.cp: CP typed by Ben (manual override when the screen hides or garbles it). */
export function parse(pic: Picture, resolver: SpeciesResolver, opts: { cp?: number } = {}): ReadResult {
  const t = pic.texts.map((b) => ({ ...b, text: latin(b.text) }));
  const partial: Partial<Appraisal> = {};
  const cpBox = find(t, /^C\s*P\s*\d+/i);
  // "CP27." means part of the number is hidden (e.g. behind a long neck): solve it from the math later.
  const typed = opts.cp !== undefined;
  const cpDigits = typed ? String(opts.cp) : cpBox?.text.replace(/\D/g, '') ?? '';
  const cpHidden = !typed && !!cpBox && /\d\s*[^\d\s]+\s*\d*$/.test(cpBox.text.replace(/^C\s*P/i, ''));
  const cpClean = typed || (!!cpBox && /^C\s*P\s*\d+$/i.test(cpBox.text.trim()));
  if (typed) partial.cp = opts.cp;
  else if (cpBox && cpDigits) partial.cp = Number(cpDigits); // tried as-is first; hidden-digit solve is the fallback
  const hpBox = find(t, /\d+\s*\/\s*\d+\s*HP/i);
  if (hpBox) partial.hp = Number(hpBox.text.match(/\/\s*(\d+)/)![1]);

  // Nickname: the line right above the HP line.
  const nameBox = hpBox && t.filter((b) => b.y < hpBox.y && hpBox.y - b.y < 260 && b !== cpBox).sort((a, b) => b.y - a.y)[0];
  partial.nickname = nameBox?.text.trim() ?? '';

  const w = find(t, /^[\d.,]+\s*kg$/i), h = find(t, /^[\d.,]+\s*m$/i);
  if (w) partial.weightKg = Number(w.text.replace(/[^\d.]/g, ''));
  if (h) partial.heightM = Number(h.text.replace(/[^\d.]/g, ''));
  // Type line sits between weight and height, e.g. "GRASS / DRAGON".
  const typeBox = w && h && t.find((b) => b.y > w.y && b.y < w.y + w.h + 80 && b.x > w.x + w.w && b.x + b.w < h.x + h.w && /^[A-Z ]+(\/[A-Z ]+)?/i.test(b.text));
  const types = typeBox ? typeBox.text.split('/').map((x) => x.trim()) : undefined;
  if (w && h) {
    const near = pic.zoom?.(h.x - 80, h.y - 160, h.w + 240, h.h + 170) ?? t;
    const badge = near.find((b) => /^X{0,2}[SL]$/i.test(b.text.trim()) && b.y < h.y);
    if (badge) partial.size = (badge.text.trim().toUpperCase() as Appraisal['size']);
    partial.heaviest = t.some((b) => /HEAVIEST/i.test(b.text));
    partial.lightest = t.some((b) => /LIGHTEST/i.test(b.text));
  }

  // Candy name: "BRONZOR CANDY" on one line, or "EXEGGCUTE" with "CANDY" on the line below.
  const candies = t.map((b) => {
    const same = b.text.match(/^([A-Z][A-Z .'\-♀♂é]*?)\s+CAN(DY)?\b/i)?.[1];
    if (same) return same;
    const below = t.find((c) => /^CANDY$/i.test(c.text.trim()) && c.y > b.y && c.y - b.y < 70 && c.x < b.x + b.w && c.x + c.w > b.x);
    return below ? b.text : undefined;
  }).filter((c): c is string => !!c && !/XL/i.test(c) && resolver.isCandy(c));
  partial.candy = candies[0] ?? '';
  Object.assign(partial, candyCounts(t, pic.width));

  const story = t.filter((b) => b.y > (hpBox?.y ?? 0)).map((b) => b.text).join(' ');
  const caught = story.match(/This (.+?) was (?:caught|hatched|obtained|traded)/i);
  if (caught) partial.caughtAs = caught[1];
  partial.date = story.match(/\b(\d{1,2}\/\d{1,2}\/\d{4})\b/)?.[1];
  partial.location = story.match(/around (.+?)\.?\s*$/)?.[1];
  partial.lucky = /\bLUCKY\b/i.test(story);
  partial.buddy = /best buddy/i.test(story);

  // IV bars sit under the Attack / Defense / HP labels in the appraisal box.
  const atkL = find(t, /^Attack\b/i), defL = find(t, /^Defense\b/i);
  const hpL = atkL && t.find((b) => /^HP$/i.test(b.text.trim()) && b.y > atkL.y);
  if (atkL && defL && hpL) {
    const [atk, def, sta] = [readBar(pic, atkL), readBar(pic, defL), readBar(pic, hpL)];
    if (atk !== null && def !== null && sta !== null) partial.ivs = { atk, def, sta };
  }

  if (!atkL || !defL) return { ok: false, reason: 'Open the appraisal first', partial };
  // CP may be missing: the Dynamic Island covers it in live mode. Solved below from HP + IVs + the level arc.
  const missing = (['hp', 'ivs'] as const).filter((k) => partial[k] === undefined);
  if (missing.length) return { ok: false, reason: `Could not read ${missing.join(', ')}`, partial };

  const tryAll = (cp: number | undefined) => {
    for (const candy of [...candies, undefined]) {
      const r = resolver.resolve({ candy, caughtAs: partial.caughtAs, nickname: partial.nickname, cp, cpDigits, types, hp: partial.hp!, ivs: partial.ivs! });
      if (r) return r;
    }
    return null;
  };
  // CP covered: every level that fits HP + IVs, narrowed by any digits read, then by the arc's dot.
  const covered = (): Resolved | null => {
    let cands: Resolved[] = [];
    for (const candy of [...candies, undefined]) {
      cands = resolver.candidates({ candy, caughtAs: partial.caughtAs, nickname: partial.nickname, types, hp: partial.hp!, ivs: partial.ivs! });
      if (cands.length) break;
    }
    const digits = cpDigits ? new RegExp(cpDigits.split('').join('.*')) : null;
    const narrowed = digits ? cands.filter((c) => digits.test(String(c.cp))) : [];
    if (narrowed.length) cands = narrowed;
    const levels = new Set(cands.map((c) => c.level)).size;
    const dot = levels > 1 ? arcDot(pic) : null;
    const pick = levels === 1 ? cands[0] : dot === null ? null : pickByDot(cands, dot);
    if (!pick) return null;
    // Two species at that level with different CP: can't tell which.
    return new Set(cands.filter((c) => c.level === pick.level).map((c) => c.cp)).size === 1 ? pick : null;
  };
  // A typed CP is trusted: no guessing from the arc if it doesn't fit.
  const resolved = typed ? tryAll(partial.cp) : (partial.cp !== undefined ? tryAll(partial.cp) : null) ?? (cpHidden ? tryAll(undefined) : null) ?? covered();
  if (!resolved) return { ok: false, reason: typed ? `CP ${opts.cp} doesn't fit this Pokémon's HP/IVs` : cpClean ? 'No species fits the CP/HP/IVs read' : 'CP covered: try again', partial };

  // Never renamed -> the name line is just the species name: no nickname.
  if (partial.nickname?.toLowerCase() === resolved.species.toLowerCase()) partial.nickname = '';
  return {
    ok: true,
    scan: { ...(partial as Appraisal), ...resolved, candy: partial.candy ?? '', shiny: null, shadow: isShadow(pic), specialBackground: isSpecialBackground(pic) },
  };
}

export const readScreenshot = (path: string, resolver: SpeciesResolver, opts: { cp?: number } = {}): ReadResult => parse(look(path), resolver, opts);

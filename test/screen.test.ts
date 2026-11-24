import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readScreenshot, parse } from '../src/screen/read.js';
import { look } from '../src/screen/vision.js';
import { createSpeciesResolver } from '../src/species.js';

// Ben's real appraisal screenshots (gitignored binaries) vs answers written down once in fixtures/expected.json.
const FIX = fileURLToPath(new URL('../fixtures/', import.meta.url));
const expected: Record<string, any> = JSON.parse(readFileSync(FIX + 'expected.json', 'utf8'));
const present = Object.keys(expected).filter((f) => f.startsWith('screenshots/') && existsSync(FIX + f));
const resolver = createSpeciesResolver(fileURLToPath(new URL('../data/cache/', import.meta.url)));

describe.skipIf(present.length === 0)('read one screenshot (Ben fixtures)', () => {
  it.each(present)('%s', (file) => {
    const want = expected[file];
    const r = readScreenshot(FIX + file, resolver);
    if (want.failed) {
      expect(r.ok).toBe(false); // goes to the Failed scans list, not dropped
      return;
    }
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.scan;
    expect({
      species: s.species, speciesId: s.speciesId, cp: s.cp, hp: s.hp, ivs: [s.ivs.atk, s.ivs.def, s.ivs.sta], level: s.level,
      nickname: s.nickname, weightKg: s.weightKg, heightM: s.heightM, size: s.size, heaviest: s.heaviest || undefined,
      lightest: s.lightest || undefined, date: s.date, location: s.location?.replace(/^[^,]+,\s*(?=[^,]+,)/, ''), // city left out of the public repo
    }).toEqual({ size: undefined, heaviest: undefined, lightest: undefined, ...want });
  }, 20_000);
});

// Issue 10: in live mode the Dynamic Island can cover the CP. Solve from HP + IVs + species + the level arc's dot.
const live = [
  { file: 'live-failures/cp-under-island-bulbasaur-244.png', want: { species: 'Bulbasaur', cp: 244, hp: 53 } },
  { file: 'live-failures/cp-under-island-2.png', want: { species: 'Zigzagoon', speciesId: 'zigzagoon_galarian', cp: 277, hp: 77 } },
].filter((l) => existsSync(FIX + l.file));
const hideCp = (file: string) => {
  const pic = look(FIX + file);
  return parse({ ...pic, texts: pic.texts.filter((t) => !/^C\s*P/i.test(t.text)) }, resolver);
};
const known = present.filter((f) => !expected[f].failed);

describe.skipIf(live.length === 0)('CP covered by the Dynamic Island', () => {
  it.each(live)('$file', ({ file, want }) => {
    const r = readScreenshot(FIX + file, resolver);
    expect(r.ok ? r.scan : r).toMatchObject(want);
  }, 20_000);

  // Hide the CP on every known screenshot: the answer must be right, or say "CP covered: try again". Never wrong.
  it('hidden CP: right answer or "CP covered: try again", never wrong; most still read', () => {
    let ok = 0;
    for (const file of known) {
      const r = hideCp(file);
      if (!r.ok) { expect(r.reason, file).toBe('CP covered: try again'); continue; }
      ok++;
      const w = expected[file];
      expect({ file, cp: r.scan.cp, level: r.scan.level, species: r.scan.species }).toEqual({ file, cp: w.cp, level: w.level, species: w.species });
    }
    expect(ok).toBeGreaterThanOrEqual(15);
  }, 120_000);

  it('no appraisal on screen -> "Open the appraisal first"', () => {
    const pic = look(FIX + known[0]);
    const r = parse({ ...pic, texts: pic.texts.filter((t) => !/^(Attack|Defense)\b/i.test(t.text)) }, resolver);
    expect(r).toMatchObject({ ok: false, reason: 'Open the appraisal first' });
  }, 20_000);
});

describe.skipIf(!existsSync(FIX + 'screenshots/pogo_specialbackground.PNG'))('manual CP override', () => {
  it('Mewtwo on the Earth background reads once Ben types the CP; a wrong CP is refused', () => {
    const pic = look(FIX + 'screenshots/pogo_specialbackground.PNG');
    expect(parse(pic, resolver).ok).toBe(false);
    const wrong = parse(pic, resolver, { cp: 100 });
    expect(wrong).toMatchObject({ ok: false, reason: expect.stringMatching(/doesn't fit/) });
    const levels = resolver.candidates({ caughtAs: 'Mewtwo', hp: 138, ivs: { atk: 15, def: 15, sta: 15 } } as any).filter((c) => c.species === 'Mewtwo');
    const r = parse(pic, resolver, { cp: levels[0].cp });
    expect(r).toMatchObject({ ok: true, scan: { species: 'Mewtwo', cp: levels[0].cp } });
  }, 20_000);
});

// Candy counts (for "do I have enough candy"): XL is often half-hidden by the appraiser's head -> not trusted.
const candyCases: [string, number | undefined, number | undefined][] = [
  ['screenshots/pogo_screenshots1.PNG', 553, 70],
  ['screenshots/pogo_screenshots2.PNG', 892, 1269],
  ['screenshots/pogo_screenshots9.PNG', 183, 162],
  ['screenshots/pogo_screenshots5.PNG', 370, undefined],   // XL "18": first digit under the head
  ['screenshots/pogo_screenshots8.PNG', undefined, 31],    // candy "081": cut off
];
describe.skipIf(!candyCases.every(([f]) => existsSync(FIX + f)))('candy counts', () => {
  it.each(candyCases)('%s', (file, candy, xl) => {
    const r = parse(look(FIX + file), resolver);
    const s = r.ok ? r.scan : r.partial;
    expect([s.candyCount, s.xlCount]).toEqual([candy, xl]);
  }, 20_000);
});

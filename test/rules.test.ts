import { describe, it, expect } from 'vitest';
import { applyRules, type RuleInput } from '../src/rules.js';

let n = 0;
const mon = (o: Partial<RuleInput> = {}): RuleInput => ({
  id: ++n, species: 'Bulbasaur', ivs: { atk: 0, def: 0, sta: 0 }, date: '11/14/2026', location: 'Lansing, MI, United States',
  lucky: false, buddy: false, legendary: false, mythical: false, canEvolve: true, tradeEvolves: false, xlTrade: false, ...o,
});
const run = (list: RuleInput[], exceptions: string[] = []) => applyRules(list, { exceptions: new Set(exceptions) });

describe('PvE keepers', () => {
  it('one per species: the highest on Ben\'s list (15/15/15 > 15/15/14 > ... > 14/14/15)', () => {
    const a = mon({ ivs: { atk: 14, def: 14, sta: 15 } });
    const b = mon({ ivs: { atk: 15, def: 14, sta: 14 } });
    const c = mon({ ivs: { atk: 14, def: 14, sta: 14 } }); // not good enough
    const out = run([a, b, c]);
    expect(out.get(b.id)!.keep).toEqual(['PvE']);
    expect(out.get(a.id)!.keep).toEqual([]);
    expect(out.get(c.id)!.keep).toEqual([]);
  });
});

describe('collection keepers', () => {
  it('keeps XXS / XXL and the game\'s HEAVIEST / LIGHTEST; a second XXS is tagged for trade', () => {
    const small1 = mon({ size: 'XXS', heightM: 0.30 });
    const small2 = mon({ size: 'XXS', heightM: 0.25 }); // more extreme -> stays
    const big = mon({ species: 'Onix', size: 'XXL', heightM: 14 });
    const heavy = mon({ species: 'Onix', heaviest: true });
    const out = run([small1, small2, big, heavy]);
    expect(out.get(small2.id)!.keep).toEqual(['XXS']);
    expect(out.get(small1.id)!).toMatchObject({ keep: [], trade: 'trade xxs 26' });
    expect(out.get(big.id)!.keep).toEqual(['XXL']);
    expect(out.get(heavy.id)!.keep).toEqual(['heaviest']);
  });
});

describe('protected (never transfer)', () => {
  it('lucky, best buddy, legendary, mythical, shiny, caught before 2018, and Ben\'s exceptions', () => {
    const list = [
      mon({ lucky: true }), mon({ buddy: true }), mon({ legendary: true }), mon({ mythical: true }),
      mon({ shiny: true }), mon({ date: '7/10/2016' }), mon({ species: 'Magikarp' }),
    ];
    const out = run(list, ['Magikarp']);
    expect(list.map((m) => out.get(m.id)!.keep)).toEqual([
      ['lucky'], ['best buddy'], ['legendary'], ['mythical'], ['shiny'], ['caught 2016'], ['your exception'],
    ]);
  });
});

describe('trade tags', () => {
  it('distance (caught outside CA/MI), trade evolution, candy XL; year = year caught', () => {
    expect(run([mon({ location: 'Osaka, Japan', date: '3/2/2024' })]).get(n)!.trade).toBe('trade d 24');
    expect(run([mon({ location: 'Austin, TX, United States', date: '3/2/2024' })]).get(n)!.trade).toBe('trade d 24');
    expect(run([mon({ location: 'San Jose, CA, United States' })]).get(n)!.trade).toBeUndefined();
    expect(run([mon({ tradeEvolves: true, date: '1/1/2025' })]).get(n)!.trade).toBe('trade evo 25');
    expect(run([mon({ xlTrade: true })]).get(n)!.trade).toBe('trade 26');
  });
});

describe('evolve-for-dex marker', () => {
  it('a lucky that can evolve is marked (evolving registers a lucky evolution)', () => {
    expect(run([mon({ lucky: true, canEvolve: true })]).get(n)!.dex).toBe(true);
    expect(run([mon({ lucky: true, canEvolve: false })]).get(n)!.dex).toBe(false);
    expect(run([mon({ canEvolve: true })]).get(n)!.dex).toBe(false);
  });
});

describe('special background (issue 09)', () => {
  it('tags "trade sbg yy", ahead of the distance tag', () => {
    const m = mon({ specialBackground: true, location: 'Chicago, IL, United States', date: '6/6/2026' });
    expect(run([m]).get(m.id)!.trade).toBe('trade sbg 26');
  });
});

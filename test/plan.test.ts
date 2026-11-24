import { describe, it, expect } from 'vitest';
import { plan, type PlanMon } from '../src/plan.js';

const mon = (id: number, o: Partial<PlanMon> = {}): PlanMon =>
  ({ id, family: `f${id}`, league: 'great', types: [`t${id}`], metaRank: id, built: false, movesDone: false, dust: 10_000, candy: 10, xl: 0, eliteFast: 0, eliteCharged: 0, ...o });
const inv = (dust: number, fastTm = 0, chargedTm = 0) => ({ dust, fastTm, chargedTm });

describe('dust planner', () => {
  it('builds best PvPoke rank first while the dust lasts, skipping ones that do not fit', () => {
    const p = plan([mon(3, { dust: 5000 }), mon(1, { dust: 30_000 }), mon(2, { dust: 60_000 })], inv(40_000));
    expect(p.build).toEqual([1, 3]);
    expect(p.dustUsed).toBe(35_000);
    expect(p.dustLeft).toBe(5000);
  });

  it('skips a build when its known candy is short; candy is shared across one family', () => {
    const p = plan([
      mon(1, { family: 'a', candy: 80, candyHave: 100 }),
      mon(2, { family: 'a', candy: 30, candyHave: 100 }), // only 20 left after #1
      mon(3, { family: 'b', candy: 999 }), // candy never read: allowed, flagged
      mon(4, { xl: 50, xlHave: 10 }),
    ], inv(1_000_000));
    expect(p.build).toEqual([1, 3]);
    expect(p.candyUnknown).toEqual([3]);
  });

  it('nothing to do for a fully built Pokémon (no cost left)', () => {
    expect(plan([mon(1, { built: true, movesDone: true, dust: 0, candy: 0 })], inv(1_000_000)).build).toEqual([]);
  });

  it('Elite TMs go to built / buildable Pokémon first, then best PvPoke rank', () => {
    const mons = [
      mon(1, { eliteFast: 1, dust: 900_000 }), // can't afford: last
      mon(2, { eliteFast: 1, eliteCharged: 1, built: true, dust: 0, candy: 0 }),
      mon(3, { eliteFast: 1, dust: 1000 }),
      mon(4, { eliteCharged: 2, dust: 1000 }),
      mon(5, { eliteFast: 1, movesDone: true, built: true, dust: 0, candy: 0 }), // moves done: never
    ];
    const p = plan(mons, inv(10_000, 2, 2));
    expect(p.fastTm).toEqual([2, 3]);
    expect(p.chargedTm).toEqual([2]); // #4 needs 2, only 1 left
  });

  it('new typing = no fully built Pokémon with that typing in that league yet (order unchanged)', () => {
    const mons = [
      mon(1, { types: ['water', 'ground'], built: true, movesDone: true, dust: 0, candy: 0 }), // fully built Great water/ground
      mon(2, { types: ['ground', 'water'] }), // same typing, Great: covered
      mon(3, { types: ['water', 'ground'], league: 'ultra' }), // Ultra has none: new
      mon(4, { types: ['fairy'] }), // new
      mon(5, { types: ['fairy'], built: true, movesDone: false, dust: 0, candy: 1 }), // built, moves left: doesn't cover
      mon(6, { types: [] }), // typing unknown: never highlighted
    ];
    const p = plan(mons, inv(1_000_000));
    expect(p.build).toEqual([2, 3, 4, 5, 6]);
    expect(p.newTyping).toEqual([3, 4, 5]);
  });
});

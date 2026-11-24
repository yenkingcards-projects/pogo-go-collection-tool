import { describe, it, expect } from 'vitest';
import { powerUpCost, secondMoveCost } from '../src/cost.js';

describe('power-up cost', () => {
  it('matches the known totals: 1 -> 40 is 270,000 dust + 304 candy; 40 -> 50 is 250,000 dust + 296 XL', () => {
    expect(powerUpCost(1, 40)).toEqual({ dust: 270_000, candy: 304, xl: 0 });
    expect(powerUpCost(40, 50)).toEqual({ dust: 250_000, candy: 0, xl: 296 });
  });

  it('partial ranges, and nothing to pay when already there', () => {
    expect(powerUpCost(20, 21)).toEqual({ dust: 5000, candy: 4, xl: 0 });   // 20, 20.5 -> 2500 dust, 2 candy each
    expect(powerUpCost(39.5, 40.5)).toEqual({ dust: 20_000, candy: 15, xl: 10 });
    expect(powerUpCost(30, 30)).toEqual({ dust: 0, candy: 0, xl: 0 });
    expect(powerUpCost(31, 25)).toEqual({ dust: 0, candy: 0, xl: 0 });
  });

  it('shadow pays 1.2x dust and candy; lucky pays half dust', () => {
    expect(powerUpCost(20, 21, { shadow: true })).toEqual({ dust: 6000, candy: 6, xl: 0 }); // 3000 + 3 per step
    expect(powerUpCost(20, 21, { lucky: true })).toEqual({ dust: 2500, candy: 4, xl: 0 });
  });
});

describe('second charged move', () => {
  it('candy follows the dust tier; shadow 1.2x', () => {
    expect(secondMoveCost(10_000)).toEqual({ dust: 10_000, candy: 25 });
    expect(secondMoveCost(75_000)).toEqual({ dust: 75_000, candy: 75 });
    expect(secondMoveCost(50_000, { shadow: true })).toEqual({ dust: 60_000, candy: 60 });
  });
});

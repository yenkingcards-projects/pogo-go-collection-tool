import { describe, it, expect } from 'vitest';
import { assignSlots, beatsMessage, type Candidate, type Entry } from '../src/slots.js';

// Helpers: a Bulbasaur-line Pokémon with given ranks for target species in leagues.
const e = (league: Entry['league'], target: string, stage: Entry['stage'], rank: number, mega = false): Entry => ({ league, target, stage, rank, mega });
const mon = (id: number, entries: Entry[], currentStage: Entry['stage'] = 0): Candidate => ({ id, currentStage, entries });
const NO_META = { great: new Set<string>(), ultra: new Set<string>(), little: new Set<string>() };

describe('slot assigner', () => {
  it('best rank claims the slot; runner-up tries the next slot (Great -> Ultra) before transfer', () => {
    const a = mon(1, [e('great', 'Venusaur', 2, 40), e('ultra', 'Venusaur', 2, 90)]);
    const b = mon(2, [e('great', 'Venusaur', 2, 12), e('ultra', 'Venusaur', 2, 120)]);
    const c = mon(3, [e('great', 'Venusaur', 2, 70), e('ultra', 'Venusaur', 2, 200)]);
    const out = assignSlots([a, b, c], NO_META);
    expect(out.get(2)).toMatchObject({ league: 'great', target: 'Venusaur', rank: 12 });
    expect(out.get(1)).toMatchObject({ league: 'ultra', target: 'Venusaur', rank: 90 });
    expect(out.get(3)).toBeNull(); // fills no slot -> transfer
  });

  it('other stages are separate slots (GL Ivysaur, GL Venusaur)', () => {
    const a = mon(1, [e('great', 'Venusaur', 2, 5), e('great', 'Ivysaur', 1, 30)]);
    const b = mon(2, [e('great', 'Venusaur', 2, 8), e('great', 'Ivysaur', 1, 60)]);
    const out = assignSlots([a, b], NO_META);
    expect(out.get(1)).toMatchObject({ target: 'Venusaur' });
    expect(out.get(2)).toMatchObject({ target: 'Ivysaur', rank: 60 });
  });

  it('rank 250+ never counts', () => {
    expect(assignSlots([mon(1, [e('great', 'Venusaur', 2, 250)])], NO_META).get(1)).toBeNull();
  });

  it('L1-L9 take top priority over a Great slot', () => {
    const a = mon(1, [e('great', 'Venusaur', 2, 20), e('little', 'Bulbasaur', 0, 4)]);
    expect(assignSlots([a], NO_META).get(1)).toMatchObject({ league: 'little', rank: 4 });
  });

  it('other Little slots only fill with Pokémon that got no Great/Ultra slot', () => {
    const a = mon(1, [e('great', 'Venusaur', 2, 200), e('little', 'Bulbasaur', 0, 20)]);
    const b = mon(2, [e('little', 'Bulbasaur', 0, 30)]);
    const out = assignSlots([a, b], NO_META);
    expect(out.get(1)).toMatchObject({ league: 'great' });
    expect(out.get(2)).toMatchObject({ league: 'little', rank: 30 });
  });

  it('meta-league exception: a species in the Little meta is treated like Great priority', () => {
    const a = mon(1, [e('great', 'Bisharp', 1, 100), e('little', 'Pawniard', 0, 15)]);
    const meta = { ...NO_META, little: new Set(['Pawniard']) };
    // Without meta, Great wins; with Pawniard in the LC meta, the better LC rank wins.
    expect(assignSlots([a], NO_META).get(1)).toMatchObject({ league: 'great' });
    expect(assignSlots([a], meta).get(1)).toMatchObject({ league: 'little', target: 'Pawniard' });
  });

  it('mega forms that stay under the cap get their own Great/Ultra slot', () => {
    const a = mon(1, [e('ultra', 'Venusaur', 2, 10)]);
    const b = mon(2, [e('ultra', 'Venusaur', 2, 20), e('ultra', 'Venusaur', 2, 30, true)]);
    const out = assignSlots([a, b], NO_META);
    expect(out.get(2)).toMatchObject({ league: 'ultra', target: 'Venusaur', mega: true });
  });
});

describe('beats message', () => {
  it('new scan takes a kept one\'s slot -> "beats your G40", old one moves on or goes to transfer', () => {
    const old = mon(1, [e('great', 'Venusaur', 2, 40)], 2);
    const fresh = mon(2, [e('great', 'Venusaur', 2, 12)], 2);
    const before = assignSlots([old], NO_META);
    const after = assignSlots([old, fresh], NO_META);
    expect(beatsMessage(before, after, 2)).toEqual({ text: 'beats your G40', replaced: [1] });
    expect(after.get(1)).toBeNull();
  });

  it('no message when the new scan fills an empty slot', () => {
    const fresh = mon(2, [e('great', 'Venusaur', 2, 12)]);
    expect(beatsMessage(new Map(), assignSlots([fresh], NO_META), 2)).toEqual({ text: '', replaced: [] });
  });
});

import { describe, it, expect } from 'vitest';
import { buildName, type NameInput } from '../src/namer.js';

type Ranks = NameInput['ranks'];

// Ranks per league: best rank for each evolution stage (0 = basic, 1 = stage 1, 2 = stage 2).
describe('buildName (Ben format)', () => {
  it('G7 dubby: Empoleon ranked as itself, no stage code', () => {
    expect(buildName({ currentStage: 2, nickname: 'dubby', ranks: { great: [{ stage: 2, rank: 7 }] } })).toBe('G7 dubby');
  });

  it('G118 1 bark: rank is for stage 1, current form is basic', () => {
    expect(buildName({ currentStage: 0, nickname: 'bark', ranks: { great: [{ stage: 1, rank: 118 }] } })).toBe('G118 1 bark');
  });

  it('G246 b: rank is for basic form, current form evolved, no nickname', () => {
    expect(buildName({ currentStage: 1, ranks: { great: [{ stage: 0, rank: 246 }] } })).toBe('G246 b');
  });

  it('L1 dominator style: single-digit Little beats a good Great rank; nickname capped at 6', () => {
    expect(
      buildName({ currentStage: 0, nickname: 'dominator', ranks: { little: [{ stage: 0, rank: 1 }], great: [{ stage: 0, rank: 80 }] } }),
    ).toBe('L1 domina');
  });

  it('priority Great > Ultra > Little; second league only when under 50', () => {
    const ranks: Ranks = { great: [{ stage: 0, rank: 200 }], ultra: [{ stage: 0, rank: 30 }], little: [{ stage: 0, rank: 12 }] };
    expect(buildName({ currentStage: 0, ranks })).toBe('G200 U30');
    expect(buildName({ currentStage: 0, ranks: { great: [{ stage: 0, rank: 10 }], ultra: [{ stage: 0, rank: 50 }] } })).toBe('G10');
  });

  it('ranks 250+ never count', () => {
    expect(buildName({ currentStage: 0, ranks: { great: [{ stage: 0, rank: 250 }], ultra: [{ stage: 0, rank: 249 }] } })).toBe('U249');
    expect(buildName({ currentStage: 0, nickname: 'bob', ranks: { great: [{ stage: 0, rank: 900 }] } })).toBe('');
  });

  it('uses the best stage within a league', () => {
    expect(buildName({ currentStage: 0, ranks: { great: [{ stage: 0, rank: 300 }, { stage: 2, rank: 15 }] } })).toBe('G15 2');
  });

  it('over 12 chars: drop nickname first, then second league', () => {
    const ranks: Ranks = { great: [{ stage: 1, rank: 118 }], ultra: [{ stage: 2, rank: 42 }] };
    expect(buildName({ currentStage: 0, nickname: 'bark', ranks })).toBe('G118 1 U42 2');
    const ranks2: Ranks = { great: [{ stage: 1, rank: 118 }], ultra: [{ stage: 2, rank: 42 }], little: [] };
    expect(buildName({ currentStage: 2, nickname: 'barkie', ranks: { ...ranks2, great: [{ stage: 0, rank: 118 }] } })).toBe('G118 b U42');
    expect(buildName({ currentStage: 0, ranks: { great: [{ stage: 1, rank: 118 }], ultra: [{ stage: 2, rank: 42 }], little: [{ stage: 1, rank: 13 }] } })).toBe('G118 1 U42 2');
  });

  it('strips old rank codes from an existing nickname', () => {
    expect(buildName({ currentStage: 0, nickname: 'G40 1 U12 bark', ranks: { great: [{ stage: 0, rank: 5 }] } })).toBe('G5 bark');
  });

  it('a trade tag is not a nickname; nickname cut never leaves a trailing space', () => {
    expect(buildName({ currentStage: 0, nickname: 'Trade 26', ranks: { ultra: [{ stage: 1, rank: 153 }] } })).toBe('U153 1');
    expect(buildName({ currentStage: 0, nickname: 'big boy', ranks: { great: [{ stage: 0, rank: 5 }] } })).toBe('G5 big bo');
    expect(buildName({ currentStage: 0, nickname: 'abcde fg', ranks: { great: [{ stage: 0, rank: 5 }] } })).toBe('G5 abcde');
  });

  it('a kept Pokémon is named for the slot it fills (primary), second league still added under 50', () => {
    const ranks: Ranks = { great: [{ stage: 2, rank: 12 }], ultra: [{ stage: 2, rank: 90 }] };
    expect(buildName({ currentStage: 2, ranks, primary: { league: 'ultra', stage: 2, rank: 90 } })).toBe('U90 G12');
  });

  it('mega slot uses stage code m', () => {
    const ranks: Ranks = { ultra: [{ stage: 2, rank: 30, mega: true }] };
    expect(buildName({ currentStage: 2, ranks, primary: { league: 'ultra', stage: 2, rank: 30, mega: true } })).toBe('U30 m');
  });
});

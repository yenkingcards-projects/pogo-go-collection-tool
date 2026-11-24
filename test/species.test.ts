import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { createSpeciesResolver } from '../src/species.js';

const CACHE = fileURLToPath(new URL('../data/cache/', import.meta.url));
const resolver = createSpeciesResolver(CACHE);

describe('species resolver (candy + CP/HP/IV math, never the nickname)', () => {
  it('perfect level-20 Bulbasaur is CP 637 / HP 85 (well-known hundo chart value)', () => {
    const r = resolver.resolve({ candy: 'BULBASAUR', cp: 637, hp: 85, ivs: { atk: 15, def: 15, sta: 15 } });
    expect(r).toMatchObject({ species: 'Bulbasaur', level: 20 });
  });

  it('picks the family member whose stats fit, even with a misleading nickname', () => {
    const r = resolver.resolve({ candy: 'BULBASAUR', nickname: 'Venusaur', cp: 637, hp: 85, ivs: { atk: 15, def: 15, sta: 15 } });
    expect(r?.species).toBe('Bulbasaur');
  });

  it('returns null when nothing fits', () => {
    expect(resolver.resolve({ candy: 'BULBASAUR', cp: 9999, hp: 1, ivs: { atk: 0, def: 0, sta: 0 } })).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { searchString } from '../src/search.js';

describe('Pokémon GO search string', () => {
  it('species name & cp (Ben example)', () => {
    expect(searchString({ species: 'Bulbasaur', dex: 1, cp: 512 })).toBe('bulbasaur&cp512');
  });
  it('uses the dex number when the name has symbols the search box chokes on', () => {
    expect(searchString({ species: 'Mr. Mime', dex: 122, cp: 900 })).toBe('122&cp900');
    expect(searchString({ species: "Farfetch'd", dex: 83, cp: 300 })).toBe('83&cp300');
  });
  it('adds hp when another scan has the same species and cp', () => {
    expect(searchString({ species: 'Bulbasaur', dex: 1, cp: 512, hp: 70 }, true)).toBe('bulbasaur&cp512&hp70');
  });
  it('transfer searches skip shinies and costumes (the reader cannot see those)', () => {
    expect(searchString({ species: 'Bulbasaur', dex: 1, cp: 512 }, false, true)).toBe('bulbasaur&cp512&!shiny&!costume');
  });
});

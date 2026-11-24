import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spriteUrls, getSprite } from '../src/sprites.js';

describe('pixel sprites', () => {
  it('Showdown gen5 name for the form, then the base species, then PokeAPI by dex', () => {
    expect(spriteUrls('zigzagoon_galarian', 263)).toEqual([
      'https://play.pokemonshowdown.com/sprites/gen5/zigzagoon-galar.png',
      'https://play.pokemonshowdown.com/sprites/gen5/zigzagoon.png',
      'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/263.png',
    ]);
    expect(spriteUrls('mr_mime')[0]).toBe('https://play.pokemonshowdown.com/sprites/gen5/mrmime.png');
    expect(spriteUrls('nidoran_female')[0]).toBe('https://play.pokemonshowdown.com/sprites/gen5/nidoranf.png');
    expect(spriteUrls('sableye_shadow')[0]).toBe('https://play.pokemonshowdown.com/sprites/gen5/sableye.png');
  });

  it('downloads once, then serves from the cache; bad ids refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-sp-'));
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    let calls = 0;
    const f = (async (url: string) => { calls++; return url.includes('zigzagoon-galar') ? new Response('nope', { status: 404 }) : new Response(png, { headers: { 'content-type': 'image/png' } }); }) as typeof fetch;
    expect(await getSprite(dir, 'zigzagoon_galarian', 263, f)).toEqual(Buffer.from(png));
    expect(calls).toBe(2);
    expect(await getSprite(dir, 'zigzagoon_galarian', 263, f)).toEqual(Buffer.from(png));
    expect(calls).toBe(2);
    expect(existsSync(join(dir, 'zigzagoon_galarian.png'))).toBe(true);
    expect(await getSprite(dir, '../etc/passwd', 1, f)).toBeNull();
  });

  it('nothing found: remembered, so it is not re-downloaded every page load', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-sp-'));
    let calls = 0;
    const f = (async () => { calls++; return new Response('x', { status: 404 }); }) as typeof fetch;
    expect(await getSprite(dir, 'missingno', undefined, f)).toBeNull();
    const n = calls;
    expect(await getSprite(dir, 'missingno', undefined, f)).toBeNull();
    expect(calls).toBe(n);
  });
});

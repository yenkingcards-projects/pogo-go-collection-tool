import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { look } from '../src/screen/vision.js';
import { dexRead, readDexScreen } from '../src/screen/dex.js';

const FIX = fileURLToPath(new URL('../fixtures/pokedex/', import.meta.url));
const expected = existsSync(FIX + 'expected.json') ? JSON.parse(readFileSync(FIX + 'expected.json', 'utf8')) : {};
const present = Object.keys(expected).filter((f) => existsSync(FIX + f));

// Answers checked by eye against Ben's screenshots (2026-11-23). Tiles behind the header/tab bar are left out.
describe.skipIf(present.length === 0)('Pokédex screenshot reader (Ben fixtures)', () => {
  it.each(present)('%s: every visible tile read right, 0 wrong marks', (f) => {
    expect(dexRead(look(FIX + f))).toEqual({ ok: true, ...expected[f] });
  });
});

// Ben's regular-dex screenshots (2026-11-23) were saved as Shiny: POKÉMON is the first tab, so it sits on the left
// and the unselected SHINY tab ends up near the middle. The selected tab is the filled orange pill.
describe('which Pokédex tab is selected', () => {
  const W = 1320, H = 2868;
  function picture(tabs: { text: string; x: number; on: boolean }[]) {
    const rgba = Buffer.alloc(W * H * 4, 255);
    const y = 2450, h = 50;
    for (const t of tabs) {
      if (!t.on) continue;
      for (let yy = y - 20; yy < y + h + 20; yy++) for (let xx = t.x - 30; xx < t.x + 230; xx++) {
        const i = (yy * W + xx) * 4; rgba[i] = 236; rgba[i + 1] = 160; rgba[i + 2] = 40;
      }
    }
    return { width: W, height: H, rgba, texts: tabs.map((t) => ({ text: t.text, conf: 1, x: t.x, y, w: 200, h })) };
  }
  it('picks the orange pill, not the tab nearest the middle', () => {
    const p = picture([{ text: 'POKÉMON', x: 80, on: true }, { text: 'SHINY', x: 560, on: false }, { text: 'LUCKY', x: 880, on: false }]);
    expect(readDexScreen(p).kind).toBe('normal');
  });
  it('shiny selected in the middle still reads as shiny', () => {
    const p = picture([{ text: 'POKÉMON', x: 80, on: false }, { text: 'SHINY', x: 560, on: true }, { text: 'LUCKY', x: 880, on: false }]);
    expect(readDexScreen(p).kind).toBe('shiny');
  });
  it('no filled pill = dex not known (the page pick is used)', () => {
    const p = picture([{ text: 'POKÉMON', x: 80, on: false }, { text: 'SHINY', x: 560, on: false }]);
    expect(readDexScreen(p).kind).toBeUndefined();
  });
});

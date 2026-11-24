import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { look } from '../src/screen/vision.js';
import { isShadow, isSpecialBackground } from '../src/screen/flags.js';

// Issue 09: Ben's labelled examples (2026-11-23) + a few plain ones. Hatenna = Dynamax (purple swirl, not shadow).
const FIX = fileURLToPath(new URL('../fixtures/', import.meta.url));
const cases = [
  { file: 'screenshots/pogo_shadow.PNG', shadow: true, sbg: false },
  { file: 'screenshots/pogo_shadow_specialbackground.PNG', shadow: true, sbg: true },
  { file: 'screenshots/pogo_specialbackground.PNG', shadow: false, sbg: true },
  { file: 'screenshots/pogo_profilebackground.PNG', shadow: false, sbg: true },
  { file: 'screenshots/pogo_costume.PNG', shadow: false, sbg: false },
  { file: 'screenshots/pogo_screenshots1.PNG', shadow: false, sbg: false },
  { file: 'screenshots/pogo_screenshots4.PNG', shadow: false, sbg: false },
  { file: 'screenshots/pogo_screenshots7.PNG', shadow: false, sbg: false },
  { file: 'live-failures/cp-under-island-bulbasaur-244.png', shadow: true, sbg: false },
].filter((c) => existsSync(FIX + c.file));

describe.skipIf(cases.length === 0)('shadow + special background from pixels', () => {
  it.each(cases)('$file', ({ file, shadow, sbg }) => {
    const p = look(FIX + file);
    expect({ shadow: isShadow(p), sbg: isSpecialBackground(p) }).toEqual({ shadow, sbg });
  }, 20_000);
});

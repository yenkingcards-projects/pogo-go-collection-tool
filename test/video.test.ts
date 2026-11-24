import { describe, it, expect } from 'vitest';
import { pickFrames } from '../src/video.js';

describe('change detector', () => {
  it('one frame per still stretch, taken near its end (bars done filling); swipes skipped', () => {
    // diffs[i] = change between frame i and i+1. Still (0.5) / swipe (30) / still / swipe / still.
    const diffs = [0.5, 0.4, 0.6, 30, 25, 0.3, 0.2, 0.4, 0.1, 40, 0.2, 0.3];
    expect(pickFrames(diffs)).toEqual([2, 8, 11]);
  });

  it('ignores flickers shorter than the minimum still run', () => {
    const diffs = [0.5, 0.5, 0.5, 30, 0.2, 30, 0.5, 0.5, 0.5];
    expect(pickFrames(diffs, { minRun: 3 })).toEqual([2, 8]);
  });
});

import { existsSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitVideo } from '../src/video.js';
import { readScreenshot } from '../src/screen/read.js';
import { createSpeciesResolver } from '../src/species.js';

const FIX = fileURLToPath(new URL('../fixtures/', import.meta.url));
const VIDEO = 'videos/pogo_video.MP4';

describe.skipIf(!existsSync(FIX + VIDEO))('batch video (Ben fixture)', () => {
  it('every Pokémon in the recording comes out once, read correctly', async () => {
    const want = JSON.parse(readFileSync(FIX + 'expected.json', 'utf8'))[VIDEO];
    const resolver = createSpeciesResolver(fileURLToPath(new URL('../data/cache/', import.meta.url)));
    const frames = await splitVideo(FIX + VIDEO, mkdtempSync(join(tmpdir(), 'pg-frames-')));
    const got = frames.map((f) => {
      const r = readScreenshot(f, resolver);
      return r.ok ? { species: r.scan.species, cp: r.scan.cp, ivs: [r.scan.ivs.atk, r.scan.ivs.def, r.scan.ivs.sta] } : { failed: r.reason };
    });
    expect(got).toEqual(want);
  }, 120_000);
});

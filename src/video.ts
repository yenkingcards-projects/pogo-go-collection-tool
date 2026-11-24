// Video Splitter: screen recording -> one still frame per Pokémon (ffmpeg + a simple change detector).
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SAMPLE_FPS = 10;
const SMALL_W = 66, SMALL_H = 144; // tiny grayscale frames for diffing
const STILL_UNDER = 6; // mean abs pixel change (0-255) below this = same screen

/**
 * diffs[i] = change between sampled frame i and i+1. Returns one frame index per still stretch
 * (frames joined by small diffs), the second-to-last frame of it so the IV bars have finished filling.
 */
export function pickFrames(diffs: number[], { minRun = 3, stillUnder = STILL_UNDER } = {}): number[] {
  const picks: number[] = [];
  let start = 0;
  for (let i = 0; i <= diffs.length; i++) {
    if (i < diffs.length && diffs[i] < stillUnder) continue;
    const end = i; // frames start..end are one still stretch
    if (end - start + 1 >= minRun) picks.push(Math.max(start, end - 1));
    start = i + 1;
  }
  return picks;
}

function sampleDiffs(video: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-loglevel', 'error', '-i', video, '-vf', `fps=${SAMPLE_FPS},scale=${SMALL_W}:${SMALL_H},format=gray`, '-f', 'rawvideo', '-']);
    const size = SMALL_W * SMALL_H;
    const diffs: number[] = [];
    let buf = Buffer.alloc(0), prev: Buffer | null = null;
    ff.stdout.on('data', (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= size) {
        const frame = buf.subarray(0, size);
        buf = buf.subarray(size);
        if (prev) {
          let sum = 0;
          for (let i = 0; i < size; i++) sum += Math.abs(frame[i] - prev[i]);
          diffs.push(sum / size);
        }
        prev = Buffer.from(frame);
      }
    });
    ff.on('error', reject);
    ff.on('close', (code) => (code === 0 ? resolve(diffs) : reject(new Error(`ffmpeg exited ${code}`))));
  });
}

/** Writes one full-size PNG per Pokémon into outDir and returns their paths, in video order. */
export async function splitVideo(video: string, outDir: string): Promise<string[]> {
  mkdirSync(outDir, { recursive: true });
  const picks = pickFrames(await sampleDiffs(video));
  return picks.map((frame, n) => {
    const out = join(outDir, `frame-${String(n + 1).padStart(4, '0')}.png`);
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', (frame / SAMPLE_FPS).toFixed(2), '-i', video, '-frames:v', '1', out]);
    return out;
  });
}

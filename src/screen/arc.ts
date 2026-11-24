// Level arc: the white semicircle over the Pokémon. Solid white from the left end up to the dot, faint after it.
import { createRequire } from 'node:module';
import type { Picture } from './vision.js';

const CPM: Record<string, number> = createRequire(import.meta.url)('ohbem/cpm.json');
// Arc geometry as a share of screen width (measured on Ben's iPhone screenshots, 1320 px wide).
const CY = 0.634, R = 0.405;
/** Arc's right end = this level (trainer level 50 cap). */
const ARC_MAX = 50;

const white = (p: Picture, x: number, y: number) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= p.width || y >= p.height) return false;
  const i = (y * p.width + x) * 4;
  return p.rgba[i] > 225 && p.rgba[i + 1] > 225 && p.rgba[i + 2] > 225;
};

/** Dot position along the arc: 0 = left end, 1 = right end. null if no white arc starts at the left end. */
export function arcDot(p: Picture): number | null {
  const cx = p.width / 2, cy = p.width * CY, r = p.width * R;
  const STEPS = 1000;
  const lit = (s: number) => {
    const a = Math.PI * (1 - s / STEPS);
    for (let d = -30; d <= 30; d += 2) if (white(p, cx + Math.cos(a) * (r + d), cy - Math.sin(a) * (r + d))) return true;
    return false;
  };
  let start = -1;
  for (let s = 0; s < 40; s++) if (lit(s)) { start = s; break; }
  if (start < 0) return null;
  // Walk right along the solid part; a short gap (anti-aliasing) doesn't end it.
  // Walk right along the solid part; gaps (anti-aliasing, a Pokémon's head over the arc) don't end it.
  let last = start;
  for (let s = start; s < STEPS && s - last <= 120; s++) if (lit(s)) last = s;
  // The dot is a filled circle, much thicker than the stroke. No thick spot = not the dot.
  const thick = (s: number) => {
    const a = Math.PI * (1 - s / STEPS);
    let run = 0, best = 0;
    for (let d = -30; d <= 30; d++) best = Math.max(best, run = white(p, cx + Math.cos(a) * (r + d), cy - Math.sin(a) * (r + d)) ? run + 1 : 0);
    return best;
  };
  const strokes = Array.from({ length: 20 }, (_, i) => thick(start + 5 + i)).sort((a, b) => a - b);
  const stroke = strokes[10];
  let dot = 0;
  for (let s = Math.max(start, last - 20); s <= last; s++) dot = Math.max(dot, thick(s));
  if (last > start + 30 && dot < stroke * 1.5) return null;
  // Right after the dot the unfilled arc must show (light grey). If not, the Pokémon hides the dot: unknown.
  if (last < STEPS - 30) {
    let faint = 0;
    for (let s = last + 15; s < last + 30; s++) if (faintAt(p, cx, cy, r, Math.PI * (1 - s / STEPS))) faint++;
    if (faint < 10) return null;
  }
  return Math.max(0, last / STEPS - DOT_R);
}

// The solid run ends at the dot's far edge; step back by its radius.
const DOT_R = 0.007;

// Faint arc = a thin line clearly brighter than the background just inside and outside it.
function faintAt(p: Picture, cx: number, cy: number, r: number, a: number) {
  const lum = (d: number) => {
    const x = Math.round(cx + Math.cos(a) * (r + d)), y = Math.round(cy - Math.sin(a) * (r + d));
    if (x < 0 || y < 0 || x >= p.width || y >= p.height) return 0;
    const i = (y * p.width + x) * 4;
    return (p.rgba[i] + p.rgba[i + 1] + p.rgba[i + 2]) / 3;
  };
  let peak = -1, at = 0;
  for (let d = -24; d <= 24; d++) if (lum(d) > peak) { peak = lum(d); at = d; }
  return peak - lum(at - 14) > 20 && peak - lum(at + 14) > 20;
}

/** Where the dot sits for a given level. */
export const dotFor = (level: number) => (CPM[String(level)] - CPM['1']) / (CPM[String(ARC_MAX)] - CPM['1']);

/** Pick the level whose dot position matches; null if none is clearly closest. */
export function pickByDot<T extends { level: number }>(candidates: T[], dot: number): T | null {
  const ranked = candidates.map((c) => ({ c, d: Math.abs(dotFor(c.level) - dot) })).sort((a, b) => a.d - b.d);
  // Measured error on Ben's screenshots: <= 0.004 (0.009 at level 1).
  if (!ranked.length || ranked[0].d > 0.012) return null;
  if (ranked[1] && ranked[1].d - ranked[0].d < 0.004 && dotFor(ranked[1].c.level) !== dotFor(ranked[0].c.level)) return null;
  return ranked[0].c;
}

// Visual-only flags read from pixels (issue 09). Tuned on Ben's 1320 px iPhone screenshots.
// Shiny and costume are NOT read here: shiny only shows a brief sparkle animation and costumes need art
// recognition. Those are protected through the transfer search string instead (search.ts adds !shiny&!costume).
import type { Picture, TextBox } from './vision.js';

const hsv = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s: max ? d / max : 0, v: max / 255 };
};

/** Share of violet "shadow flame" pixels in a box (fractions of width/height). */
function violet(p: Picture, x0: number, x1: number, y0: number, y1: number): number {
  let n = 0, hit = 0;
  for (let y = Math.round(y0 * p.height); y < y1 * p.height; y += 4)
    for (let x = Math.round(x0 * p.width); x < x1 * p.width; x += 4) {
      const i = (y * p.width + x) * 4;
      const { h, s, v } = hsv(p.rgba[i], p.rgba[i + 1], p.rgba[i + 2]);
      n++;
      if (h >= 252 && h <= 306 && s > 0.45 && v > 0.35) hit++;
    }
  return n ? hit / n : 0;
}

/**
 * Shadow: violet flames around the Pokémon (centre) but not across the whole background
 * (a purple-cloud special background fills the edges too). Dynamax Pokémon have a purple swirl, so they're excluded.
 */
export function isShadow(p: Picture, texts: TextBox[] = p.texts): boolean {
  if (texts.some((t) => /dynam|gigant/i.test(t.text))) return false;
  return violet(p, 0.25, 0.75, 0.08, 0.32) > 0.10 && violet(p, 0, 0.12, 0.08, 0.32) < 0.05;
}

/**
 * Special / location background: the normal background is a smooth gradient, these are photos.
 * Split the area above the card into cells and take the 30th-percentile roughness, so the Pokémon,
 * the level arc and small particles don't count.
 */
export function backgroundRoughness(p: Picture): number {
  const W = p.width, H = p.height, cs = Math.floor(W / 12), cells: number[] = [];
  const px = (x: number, y: number) => (y * W + x) * 4;
  for (let y0 = Math.round(0.07 * H); y0 < 0.32 * H - cs; y0 += cs)
    for (let x0 = 0; x0 < W - cs - 2; x0 += cs) {
      if (x0 > W * 0.6 && y0 < 0.22 * H) continue; // white star circle, top right
      let tot = 0, c = 0;
      for (let y = y0; y < y0 + cs; y += 3)
        for (let x = x0; x < x0 + cs; x += 3) {
          const a = px(x, y), b = px(x + 2, y), d = px(x, y + 2);
          for (let k = 0; k < 3; k++) tot += Math.abs(p.rgba[a + k] - p.rgba[b + k]) + Math.abs(p.rgba[a + k] - p.rgba[d + k]);
          c++;
        }
      cells.push(tot / c);
    }
  cells.sort((a, b) => a - b);
  return cells[Math.floor(cells.length * 0.3)] ?? 0;
}

/** Normal backgrounds measured <= 8, special/location ones >= 13. */
export const isSpecialBackground = (p: Picture) => backgroundRoughness(p) > 11;

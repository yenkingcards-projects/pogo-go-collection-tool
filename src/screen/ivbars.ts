// IV bars read straight from pixels: filled (orange, or red at 15) vs empty (grey), 3 segments of 5.
import type { Picture, TextBox } from './vision.js';

type Kind = 'fill' | 'empty' | 'white' | 'other';
function kind(p: Picture, x: number, y: number): Kind {
  const i = (y * p.width + x) * 4;
  const r = p.rgba[i], g = p.rgba[i + 1], b = p.rgba[i + 2];
  if (r > 247 && g > 247 && b > 247) return 'white';
  if (r > 200 && r - b > 50) return 'fill';
  if (Math.max(r, g, b) - Math.min(r, g, b) < 16 && r > 195 && r < 240) return 'empty';
  return 'other';
}
const isBar = (k: Kind) => k === 'fill' || k === 'empty';

/** Reads one bar under its label. Returns 0-15, or null if no bar found. */
export function readBar(p: Picture, label: TextBox): number | null {
  const probeX = label.x + Math.round(label.w / 2);
  // Walk down from the label to the bar, then take the bar's vertical middle.
  // Small gaps (anti-aliased edges, video compression) don't end the bar.
  let top = -1, bottom = -1;
  for (let y = label.y + label.h; y < Math.min(p.height, label.y + label.h + 140); y++) {
    if (isBar(kind(p, probeX, y))) { if (top < 0) top = y; bottom = y; } else if (top >= 0 && y - bottom > 3) break;
  }
  if (top < 0 || bottom - top < 8) return null;
  const y = Math.round((top + bottom) / 2);
  // Find the bar's left edge, then walk right across segment gaps until a long white run.
  let x = probeX;
  while (x > 0 && kind(p, x - 1, y) !== 'white' || (x > 0 && isBar(kind(p, x - 2, y)))) x--;
  const left = x;
  let right = left, fillEnd = left - 1, whiteRun = 0;
  for (; x < p.width && whiteRun < 20; x++) {
    const k = kind(p, x, y);
    if (k === 'white' || k === 'other') { whiteRun++; continue; }
    whiteRun = 0; right = x;
    if (k === 'fill') fillEnd = x;
  }
  const width = right - left + 1;
  if (width < 100) return null;
  return Math.round((15 * (fillEnd - left + 1)) / width);
}

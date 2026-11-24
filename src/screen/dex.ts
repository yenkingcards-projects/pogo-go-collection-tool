// Pokédex screenshot reader (issue 12). Tuned on Ben's 1320 px iPhone shiny-dex screenshots.
// Every tile shows its 4-digit national dex number. Caught = coloured sprite above the number.
// Not caught = flat orange silhouette, or the number alone (centred, no sprite).
// Tiles behind the header, the tab bar or the bottom buttons are left out (never guessed).
import type { Picture, TextBox } from './vision.js';
import type { DexRead } from '../pokedex.js';

const hsv = (r: number, g: number, b: number) => {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: ((h * 60) + 360) % 360, s: max ? d / max : 0 };
};

/** The tab bar label in the middle of the screen is the selected dex. */
const TAB_KIND: Record<string, string> = {
  'POKÉMON': 'normal', POKEMON: 'normal', SHINY: 'shiny', LUCKY: 'lucky', XXL: 'xxl', XXS: 'xxs', SHADOW: 'shadow', PURIFIED: 'purified',
  PERFECT: 'hundo', '100%': 'hundo', MEGA: 'mega', GIGANTAMAX: 'gmax', 'G-MAX': 'gmax', GMAX: 'gmax',
};

/** Share of sprite pixels (not tile background, not silhouette orange) in the area above a number. */
function spriteShare(p: Picture, t: TextBox, y0: number, y1: number, x1: number): number {
  const px = (x: number, y: number) => { const i = (Math.round(y) * p.width + Math.round(x)) * 4; return [p.rgba[i], p.rgba[i + 1], p.rgba[i + 2]]; };
  const u = p.width / 1320, cx = t.x + t.w / 2;
  const area: number[][] = [];
  for (let y = y0; y < y1; y += 3)
    for (let x = cx - 120 * u; x < Math.min(cx + 120 * u, x1); x += 3) area.push(px(x, y));
  // Tile background = the most common colour in the tile (sprites are many colours; the gradient changes down the screen).
  const count = new Map<number, number>();
  const side: number[][] = [];
  for (let y = t.y + 5; y < t.y + t.h - 5; y += 3) for (let x = cx - 125 * u; x < cx - 90 * u; x += 3) side.push(px(x, y));
  for (const [r, g, b] of [...area, ...side]) { const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3); count.set(k, (count.get(k) ?? 0) + 1); }
  const top = [...count].sort((a, b) => b[1] - a[1])[0][0];
  const bg = [((top >> 10) & 31) * 8 + 4, ((top >> 5) & 31) * 8 + 4, (top & 31) * 8 + 4];
  const bgS = hsv(bg[0], bg[1], bg[2]).s;
  let n = 0, sprite = 0;
  for (const [r, g, b] of area) {
    n++;
    if (Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < 35) continue;
    const { h, s } = hsv(r, g, b);
    if (h >= 22 && h <= 42 && s >= 0.3 && s < 0.62) continue; // silhouette orange
    if (h >= 35 && h <= 60 && s <= bgS && Math.min(r, g, b) >= Math.min(...bg)) continue; // tile border highlight (lighter cream)
    sprite++;
  }
  return n ? sprite / n : 0;
}

export interface DexScreen { kind?: string; tiles: { dex: number; status: 'have' | 'missing' | 'unsure'; sprite: number; y0?: number; y1?: number }[] }

export function readDexScreen(p: Picture): DexScreen {
  const u = p.height / 2868;
  const nums = p.texts.filter((t) => /^\d{4}$/.test(t.text.trim()) && Number(t.text) > 0);
  const tabs = p.texts.filter((t) => t.y > p.height * 0.75 && TAB_KIND[t.text.trim().toUpperCase()]);
  const tabTop = tabs.length ? Math.min(...tabs.map((t) => t.y)) - 45 * u : p.height * 0.83;
  // Selected tab = the filled orange pill (white text). Not "nearest the middle": POKÉMON is the first tab, so when it's
  // selected it sits on the left and the unselected SHINY tab is near the middle (Ben's regular dex went into Shiny).
  const pill = (t: TextBox) => {
    let n = 0, orange = 0;
    for (let y = t.y; y < t.y + t.h; y += 3) for (let x = t.x; x < t.x + t.w; x += 3) {
      const i = (Math.round(y) * p.width + Math.round(x)) * 4, { h, s } = hsv(p.rgba[i], p.rgba[i + 1], p.rgba[i + 2]);
      n++; if (h >= 20 && h <= 50 && s >= 0.55 && Math.max(p.rgba[i], p.rgba[i + 1], p.rgba[i + 2]) >= 150) orange++;
    }
    return n ? orange / n : 0;
  };
  const sel = tabs.map((t) => ({ t, o: pill(t) })).sort((a, b) => b.o - a.o)[0];
  const kind = sel && sel.o >= 0.3 ? TAB_KIND[sel.t.text.trim().toUpperCase()] : undefined;
  // Header card (region name, count, "Recently registered" sprites) covers the top tiles.
  const top = p.texts.filter((t) => t.y > 150 * u && t.y < p.height * 0.3 && !/^\d{4}$/.test(t.text.trim()));
  const recent = top.find((t) => /recently/i.test(t.text));
  const hdr = recent ? recent.y + 200 * u : top.length ? Math.max(...top.map((t) => t.y + t.h)) + 70 * u : 0;
  const x1 = p.width * 0.915; // scroll handle on the right edge

  // A misread number must agree with a neighbour (dex ±1 beside it, ±4 above/below) or it's dropped.
  const pitchX = 305 * (p.width / 1320), pitchY = 410 * u;
  const agrees = (t: TextBox) => nums.length < 2 || nums.some((o) => {
    if (o === t) return false;
    const dx = Math.round((o.x - t.x) / pitchX), dy = Math.round((o.y - t.y) / pitchY), d = Number(o.text) - Number(t.text);
    return (dy === 0 && Math.abs(dx) === 1 && d === dx) || (dx === 0 && Math.abs(dy) === 1 && d === 4 * dy);
  });

  const tiles: DexScreen['tiles'] = [];
  for (const t of nums) {
    const y0 = Math.max(t.y - 200 * u, hdr), y1 = t.y - 10 * u;
    if (y1 >= tabTop || y1 - y0 < 80 * u || !agrees(t)) continue;
    const sprite = spriteShare(p, t, y0, y1, x1);
    tiles.push({ dex: Number(t.text), sprite, y0, y1, status: sprite >= 0.02 ? 'have' : sprite < 0.005 ? 'missing' : 'unsure' });
  }
  return { kind, tiles: tiles.sort((a, b) => a.dex - b.dex) };
}

/** Adapter for the server: screenshot -> have / missing (unsure tiles left out). */
export function dexRead(p: Picture): DexRead & { kind?: string } {
  const s = readDexScreen(p);
  if (!s.tiles.length) return { ok: false, reason: 'No Pokédex numbers found. Is this a Pokédex screenshot?' };
  return {
    ok: true, kind: s.kind,
    have: s.tiles.filter((t) => t.status === 'have').map((t) => t.dex),
    missing: s.tiles.filter((t) => t.status === 'missing').map((t) => t.dex),
  };
}

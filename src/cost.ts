// Power-up and second-move costs (Pokémon GO tables). Pure.
// Checked against the known totals: 1 -> 40 = 270,000 dust + 304 candy; 40 -> 50 = 250,000 dust + 296 XL candy.

export interface Cost { dust: number; candy: number; xl: number }
export interface Mods { shadow?: boolean; lucky?: boolean }

// Cost of ONE power-up starting at `level` (half levels).
function dustAt(level: number): number {
  if (level >= 39) return 10_000 + 1000 * Math.floor((level - 39) / 2);   // 39-40.5: 10k, 41-42.5: 11k ... 49-49.5: 15k
  const band = Math.floor((level - 1) / 2);                                  // 1-2.5, 3-4.5, ...
  return [200, 400, 600, 800, 1000, 1300, 1600, 1900, 2200, 2500, 3000, 3500, 4000, 4500, 5000, 6000, 7000, 8000, 9000][band];
}
function candyAt(level: number): { candy: number; xl: number } {
  if (level >= 40) return { candy: 0, xl: [10, 12, 15, 17, 20][Math.floor((level - 40) / 2)] }; // 40-41.5, 42-43.5 ...
  if (level >= 39) return { candy: 15, xl: 0 };
  if (level >= 31) return { candy: [6, 8, 10, 12][Math.floor((level - 31) / 2)], xl: 0 };
  return { candy: level >= 26 ? 4 : level >= 21 ? 3 : level >= 11 ? 2 : 1, xl: 0 };
}

const up = (n: number, f: number) => Math.ceil(n * f - 1e-9);

/** Dust + candy + XL candy to power up from `from` to `to`. */
export function powerUpCost(from: number, to: number, { shadow = false, lucky = false }: Mods = {}): Cost {
  const out = { dust: 0, candy: 0, xl: 0 };
  const m = shadow ? 1.2 : 1;
  for (let l = from; l < to - 1e-9; l += 0.5) {
    const c = candyAt(l);
    out.dust += up(dustAt(l) * (lucky ? 0.5 : 1), m);
    out.candy += up(c.candy, m);
    out.xl += up(c.xl, m);
  }
  return out;
}

const MOVE_CANDY: Record<number, number> = { 10_000: 25, 50_000: 50, 75_000: 75, 100_000: 100 };

/** Unlocking a second charged move. dust = PvPoke's thirdMoveCost. */
export function secondMoveCost(dust: number, { shadow = false }: Mods = {}): { dust: number; candy: number } {
  const m = shadow ? 1.2 : 1;
  return { dust: up(dust, m), candy: up(MOVE_CANDY[dust] ?? Math.round(dust / 1000), m) };
}

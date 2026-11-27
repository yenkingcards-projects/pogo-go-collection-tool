// Keeps PvPoke/ohbem data fresh: refresh every time the app starts (Ben 2026-11-26), then on a schedule. Failures are logged, never fatal.
import { refreshCache } from './data.js';

export const DAY_MS = 86_400_000;

export function startAutoRefresh({
  dir, everyMs = DAY_MS, refresh = (d: string) => refreshCache(d), onRefreshed, log = console.error,
}: { dir: string; everyMs?: number; refresh?: (dir: string) => Promise<void>; onRefreshed: () => void; log?: (msg: string) => void }): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await refresh(dir); onRefreshed(); } catch (e) { log(`PvPoke refresh failed: ${(e as Error).message}`); }
    running = false;
  };
  void run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

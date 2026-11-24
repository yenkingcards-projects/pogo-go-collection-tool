// Keeps PvPoke/ohbem data fresh: refresh at start if stale, then on a schedule. Failures are logged, never fatal.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { refreshCache, CACHE_FILES } from './data.js';

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
  const oldest = Math.min(...Object.keys(CACHE_FILES).map((n) => { try { return statSync(join(dir, n)).mtimeMs; } catch { return 0; } }));
  if (Date.now() - oldest >= everyMs) void run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}

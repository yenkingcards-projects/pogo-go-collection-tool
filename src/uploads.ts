// Upload cleanup (issue 11): screenshots/videos are deleted once used; failed scans stay 1 day (Ben, 2026-11-23).
// Every delete goes through removeUpload, which refuses anything outside the uploads folder.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

export const KEEP_FAILED_MS = 86_400_000;
/** Files no failed scan points to (leftovers, crashes) go after 2 h; a running video job is younger than that. */
export const ORPHAN_MS = 2 * 3_600_000;

/** Deletes a file or folder only if it sits inside uploadDir (never uploadDir itself). */
export function removeUpload(uploadDir: string, path: string): boolean {
  const rel = relative(resolve(uploadDir), resolve(path));
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return false;
  rmSync(resolve(path), { recursive: true, force: true });
  return true;
}

const entries = (dir: string) => { try { return readdirSync(dir); } catch { return []; } };

/** Deletes top-level uploads older than maxAge, except paths in keep. Returns the names removed. */
export function sweepUploads(uploadDir: string, now = Date.now(), maxAge = ORPHAN_MS, keep: Set<string> = new Set()): string[] {
  return entries(uploadDir).filter((name) => {
    const p = join(uploadDir, name);
    if (keep.has(resolve(p))) return false;
    try { return now - statSync(p).mtimeMs > maxAge && removeUpload(uploadDir, p); } catch { return false; }
  });
}

/** UTC "YYYY-MM-DD HH:MM:SS" (SQLite datetime) -> ms. */
export const sqlTime = (s: string) => Date.parse(s.replace(' ', 'T') + 'Z');

/** Total bytes under uploadDir. */
export function uploadsSize(dir: string): number {
  return entries(dir).reduce((sum, name) => {
    try { const s = statSync(join(dir, name)); return sum + (s.isDirectory() ? uploadsSize(join(dir, name)) : s.size); } catch { return sum; }
  }, 0);
}

export function formatBytes(n: number): string {
  if (n >= 1e9) return `${+(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)} MB`;
  return `${+(n / 1e3).toFixed(1)} KB`;
}

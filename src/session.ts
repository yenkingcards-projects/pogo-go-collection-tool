// "This session" (Ben, 2026-11-23): a session ends when an hour passes with no upload, or when the app is closed and
// opened again (the Lilycove server restarts). Pure.
export const SESSION_GAP_MS = 3_600_000;

/** Start time of the current session, or null if nothing has been uploaded in it yet. times = upload times (ms). */
export function sessionStart(times: number[], now: number, appStart: number, gap = SESSION_GAP_MS): number | null {
  const t = times.filter((x) => x >= appStart).sort((a, b) => a - b);
  if (!t.length || now - t[t.length - 1] > gap) return null;
  let start = t[t.length - 1];
  for (let i = t.length - 2; i >= 0 && start - t[i] <= gap; i--) start = t[i];
  return start;
}

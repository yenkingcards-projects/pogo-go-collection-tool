import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshCache, CACHE_FILES, OPTIONAL_FILES, dataInfo } from '../src/data.js';
import { startAutoRefresh } from '../src/autorefresh.js';

const names = Object.keys(CACHE_FILES);
const fill = (dir: string, text: string) => names.forEach((n) => writeFileSync(join(dir, n), text));

describe('refresh is all-or-nothing', () => {
  it('a failed download leaves the old data untouched', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    fill(dir, '{"old":true}');
    let calls = 0;
    const flaky = (async (url: string) => (++calls === 3 ? new Response('nope', { status: 500 }) : new Response(JSON.stringify({ url })))) as typeof fetch;
    await expect(refreshCache(dir, flaky)).rejects.toThrow(/500/);
    for (const n of names) expect(readFileSync(join(dir, n), 'utf8')).toBe('{"old":true}');
  });

  it('rejects a download that is not valid JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    fill(dir, '{"old":true}');
    const html = (async () => new Response('<html>rate limited</html>')) as typeof fetch;
    await expect(refreshCache(dir, html)).rejects.toThrow();
    expect(readFileSync(join(dir, names[0]), 'utf8')).toBe('{"old":true}');
  });
});

describe('optional files', () => {
  it('a failed evolution-cost download keeps the old copy and does not block the PvPoke refresh', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    fill(dir, '{"old":true}');
    const opt = Object.keys(OPTIONAL_FILES)[0];
    writeFileSync(join(dir, opt), '[1]');
    const f = (async (url: string) => (Object.values(OPTIONAL_FILES).includes(url) ? new Response('down', { status: 503 }) : new Response('{"new":true}'))) as typeof fetch;
    await refreshCache(dir, f);
    expect(readFileSync(join(dir, names[0]), 'utf8')).toBe('{"new":true}');
    expect(readFileSync(join(dir, opt), 'utf8')).toBe('[1]');
  });
});

describe('data date', () => {
  it('shows PvPoke gamemaster timestamp and when it was downloaded', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    fill(dir, '{}');
    writeFileSync(join(dir, 'pvpoke-gamemaster.json'), JSON.stringify({ timestamp: '2026-11-20 17:36:49', pokemon: [] }));
    const when = new Date('2026-11-22T08:00:00Z');
    utimesSync(join(dir, 'pvpoke-gamemaster.json'), when, when);
    expect(dataInfo(dir)).toEqual({ pvpokeDate: '2026-11-20', downloadedAt: when.toISOString() });
  });
});

describe('auto refresh', () => {
  it('refreshes at every start (Ben 2026-11-26), then on schedule, and reloads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    fill(dir, '{}');
    let refreshes = 0, reloads = 0; // data is brand new: still refreshed at start
    const stop = startAutoRefresh({
      dir, everyMs: 40,
      refresh: async (d) => { refreshes++; fill(d, '{}'); },
      onRefreshed: () => { reloads++; },
    });
    await new Promise((r) => setTimeout(r, 110));
    stop();
    expect(refreshes).toBeGreaterThanOrEqual(2); // at start + at least one tick
    expect(reloads).toBe(refreshes);
  });

  it('a failed refresh is logged and the schedule keeps going', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pg-'));
    fill(dir, '{}');
    const errors: string[] = [];
    let n = 0;
    const stop = startAutoRefresh({
      dir, everyMs: 30, refresh: async () => { n++; throw new Error('offline'); }, onRefreshed: () => {}, log: (m) => errors.push(m),
    });
    await new Promise((r) => setTimeout(r, 100));
    stop();
    expect(n).toBeGreaterThanOrEqual(2);
    expect(errors[0]).toMatch(/offline/);
  });
});

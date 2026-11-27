import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { startServer } from '../src/server.js';
import { removeUpload, sweepUploads, uploadsSize, formatBytes } from '../src/uploads.js';

const fresh = () => mkdtempSync(join(tmpdir(), 'pg-up-'));


describe('upload cleanup helpers', () => {
  it('only deletes paths inside the uploads folder', () => {
    const dir = fresh(), outside = fresh();
    writeFileSync(join(dir, 'a.png'), 'x');
    writeFileSync(join(outside, 'b.png'), 'x');
    expect(removeUpload(dir, join(dir, 'a.png'))).toBe(true);
    expect(existsSync(join(dir, 'a.png'))).toBe(false);
    expect(removeUpload(dir, join(outside, 'b.png'))).toBe(false);
    expect(removeUpload(dir, join(dir, '..', outside.split('/').pop()!, 'b.png'))).toBe(false);
    expect(removeUpload(dir, dir)).toBe(false); // never the folder itself
    expect(existsSync(join(outside, 'b.png'))).toBe(true);
  });

  it('sweep deletes stray files and folders older than 2 h, keeps newer ones and kept paths', () => {
    const dir = fresh(), now = Date.now();
    writeFileSync(join(dir, 'old.png'), 'x');
    writeFileSync(join(dir, 'new.png'), 'x');
    mkdirSync(join(dir, 'old-frames'));
    writeFileSync(join(dir, 'old-frames', 'f.png'), 'x');
    writeFileSync(join(dir, 'failed.png'), 'x');
    const old = new Date(now - 3 * 3_600_000);
    for (const f of ['old.png', 'old-frames', 'failed.png']) utimesSync(join(dir, f), old, old);
    expect(sweepUploads(dir, now, undefined, new Set([join(dir, 'failed.png')])).sort()).toEqual(['old-frames', 'old.png']);
    expect(readdirSync(dir).sort()).toEqual(['failed.png', 'new.png']);
    expect(sweepUploads(join(dir, 'missing'), now)).toEqual([]);
  });

  it('measures and formats space used', () => {
    const dir = fresh();
    writeFileSync(join(dir, 'a'), Buffer.alloc(1000));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'b'), Buffer.alloc(500));
    expect(uploadsSize(dir)).toBe(1500);
    expect(uploadsSize(join(dir, 'missing'))).toBe(0);
    expect(formatBytes(0)).toBe('0 KB');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(2_500_000)).toBe('2.5 MB');
    expect(formatBytes(3_200_000_000)).toBe('3.2 GB');
  });
});

describe('server deletes uploads after use', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;
  const okScan = { ok: true as const, scan: { species: 'Bronzor', cp: 245, hp: 82, ivs: { atk: 13, def: 13, sta: 11 }, level: 15, nickname: '' } as any };
  const bad = { ok: false as const, reason: 'Could not read cp', partial: {} };

  it('successful scan: screenshot deleted; failed scan: kept and listed', async () => {
    const dir = fresh(), store = openStore(':memory:');
    let call = 0;
    server = await startServer(store, 0, { read: () => (call++ === 0 ? okScan : bad), uploadDir: dir });
    await fetch(url(server, '/scan?name=ok.png'), { method: 'POST', body: new Uint8Array([1]) });
    expect(readdirSync(dir)).toEqual([]);
    await fetch(url(server, '/live'), { method: 'POST', body: new Uint8Array([1]) });
    expect(readdirSync(dir)).toHaveLength(1);
    expect(existsSync(store.failed()[0].file)).toBe(true);
  });

  it('footer shows space used by uploads', async () => {
    const dir = fresh();
    writeFileSync(join(dir, 'x.png'), Buffer.alloc(2_500_000));
    server = await startServer(openStore(':memory:'), 0, { uploadDir: dir });
    expect(await (await fetch(url(server, '/'))).text()).toContain('Uploads: 2.5 MB');
  });

  it('at startup: stray uploads deleted; failed scans older than a day deleted (image + row); newer ones kept', async () => {
    const dir = fresh(), store = openStore(':memory:');
    const old = new Date(Date.now() - 3 * 3_600_000);
    for (const f of ['stray.png', 'fresh-fail.png', 'old-fail.png']) { writeFileSync(join(dir, f), 'x'); utimesSync(join(dir, f), old, old); }
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString().slice(0, 19).replace('T', ' ');
    store.saveFailed({ file: join(dir, 'fresh-fail.png'), reason: 'Could not read cp', at: ago(3 * 3_600_000) });
    store.saveFailed({ file: join(dir, 'old-fail.png'), reason: 'Could not read cp', at: ago(25 * 3_600_000) });
    server = await startServer(store, 0, { uploadDir: dir });
    expect(readdirSync(dir)).toEqual(['fresh-fail.png']);
    expect(store.failed().map((f) => f.file)).toEqual([join(dir, 'fresh-fail.png')]);
  });
});

describe('transfers go away the next calendar day', () => {
  const save = (store: ReturnType<typeof openStore>) => store.save({ species: 'Bronzor', atk: 1, def: 1, sta: 1, level: 10 }, { species: 'Bronzor' });

  it('hidden the day after first listed; un-listed ones are un-marked; scan count unchanged', () => {
    const store = openStore(':memory:');
    const [a, b, c] = [save(store), save(store), save(store)];
    expect(store.expireTransfers([a, b], '2026-11-23')).toEqual([]);
    expect(store.expireTransfers([a, b], '2026-11-23')).toEqual([]); // same day: still listed
    // b moved off the Transfer list (e.g. Ben added it to never-transfer) before midnight.
    expect(store.expireTransfers([a, c], '2026-11-24')).toEqual([a]);
    expect(store.details().map((d) => d.id)).toEqual([b, c]);
    expect(store.count()).toBe(3);
    expect(store.expireTransfers([c], '2026-11-25')).toEqual([c]);
    expect(store.details().map((d) => d.id)).toEqual([b]);
  });
});

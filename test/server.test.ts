import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from '../src/store.js';
import { startServer } from '../src/server.js';

describe('store', () => {
  it('saves every scan and counts them', () => {
    const store = openStore(':memory:');
    expect(store.count()).toBe(0);
    store.save({ species: 'Empoleon', atk: 0, def: 15, sta: 15, level: 20, cp: 1491, name: 'G7 dubby' });
    store.save({ species: 'Piplup', atk: 1, def: 2, sta: 3, level: 5 });
    expect(store.count()).toBe(2);
    expect(store.list().map((s) => s.species)).toEqual(['Piplup', 'Empoleon']); // newest first
    expect(store.list()[1]).toMatchObject({ name: 'G7 dubby', cp: 1491 });
  });
});

describe('web page', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));

  it('home page shows today\'s scans with a refresh button, plus the lifetime total', async () => {
    const store = openStore(':memory:');
    store.save({ species: 'Piplup', atk: 1, def: 2, sta: 3, level: 5 });
    store.save({ species: 'Piplup', atk: 4, def: 5, sta: 6, level: 5 });
    store.save({ species: 'Piplup', atk: 7, def: 8, sta: 9, level: 5 });
    server = await startServer(store, 0);
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Pokémon scanned today: 3');
    expect(html).toContain('Lifetime: 3');
    expect(html).toContain('id="reload"');
    expect(html).not.toContain('screen recording');
  });
});

describe('failed scans + upload', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;

  it('failed reads are kept and listed on the page with the reason', async () => {
    const store = openStore(':memory:');
    store.saveFailed({ file: 'IMG_1.PNG', reason: 'Could not read ivs' });
    expect(store.failed()).toEqual([expect.objectContaining({ file: 'IMG_1.PNG', reason: 'Could not read ivs' })]);
    server = await startServer(store, 0);
    const html = await (await fetch(url(server, '/'))).text();
    expect(html).toContain('Failed scans');
    expect(html).toContain('Could not read ivs');
  });

  it('POST /scan reads the uploaded screenshot and saves it (or files it as failed)', async () => {
    const store = openStore(':memory:');
    let call = 0;
    const read = () =>
      call++ === 0
        ? { ok: true as const, scan: { species: 'Bronzor', cp: 245, hp: 82, ivs: { atk: 13, def: 13, sta: 11 }, level: 15, nickname: 'Trade 26' } as any }
        : { ok: false as const, reason: 'Could not read cp', partial: {} };
    server = await startServer(store, 0, { read });
    const ok = await (await fetch(url(server, '/scan'), { method: 'POST', body: new Uint8Array([1, 2, 3]) })).json();
    expect(ok).toMatchObject({ ok: true, scan: { species: 'Bronzor' } });
    const bad = await (await fetch(url(server, '/scan'), { method: 'POST', body: new Uint8Array([4]) })).json();
    expect(bad).toMatchObject({ ok: false, reason: 'Could not read cp' });
    expect(store.count()).toBe(1);
    expect(store.list()[0]).toMatchObject({ species: 'Bronzor', cp: 245 });
    expect(store.failed()).toHaveLength(1);
  });

  it('POST /retry re-reads a failed scan with the CP Ben typed; success moves it out of Failed scans', async () => {
    const store = openStore(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'retry-'));
    const img = join(dir, 'a.png'); writeFileSync(img, 'x');
    const id = store.saveFailed({ file: img, reason: 'CP covered: try again' });
    const seen: (number | undefined)[] = [];
    const read = (_: string, o?: { cp?: number }) => {
      seen.push(o?.cp);
      return o?.cp === 244
        ? { ok: true as const, scan: { species: 'Bulbasaur', cp: 244, hp: 53, ivs: { atk: 14, def: 11, sta: 14 }, level: 8, nickname: '' } as any }
        : { ok: false as const, reason: `CP ${o?.cp} doesn't fit this Pokémon's HP/IVs`, partial: {} };
    };
    server = await startServer(store, 0, { read, uploadDir: dir });
    const post = (q: string) => fetch(url(server!, '/retry?' + q), { method: 'POST' }).then((r) => r.json());
    expect(await post(`id=${id}&cp=abc`)).toMatchObject({ ok: false, reason: expect.stringMatching(/number/) });
    expect(await post(`id=${id}&cp=999`)).toMatchObject({ ok: false });
    expect(store.failed()).toHaveLength(1); // wrong CP: still listed, image kept
    expect(existsSync(img)).toBe(true);
    expect(await post(`id=${id}&cp=244`)).toMatchObject({ ok: true, scan: { species: 'Bulbasaur', cp: 244 } });
    expect(seen).toEqual([999, 244]);
    expect(store.failed()).toHaveLength(0);
    expect(store.count()).toBe(1);
    expect(existsSync(img)).toBe(false);
  });
});

describe('live mode endpoint (iPhone Shortcut)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;

  it('POST /live returns a notification line and the rename to copy', async () => {
    const store = openStore(':memory:');
    let call = 0;
    const read = () =>
      call++ === 0
        ? { ok: true as const, scan: { species: 'Bronzor', cp: 245, hp: 82, ivs: { atk: 13, def: 13, sta: 11 }, level: 15, nickname: '', name: 'U153 1' } as any }
        : { ok: false as const, reason: 'Could not read ivs', partial: {} };
    server = await startServer(store, 0, { read });
    const hit = await (await fetch(url(server, '/live'), { method: 'POST', body: new Uint8Array([1]) })).json();
    expect(hit).toEqual({ ok: true, notify: 'Bronzor 13/13/11 CP245: U153 1', rename: 'U153 1' });
    const miss = await (await fetch(url(server, '/live'), { method: 'POST', body: new Uint8Array([1]) })).json();
    expect(miss).toEqual({ ok: false, notify: 'Scan failed: Could not read ivs', rename: '' });
    expect(store.count()).toBe(1);
    expect(store.failed()).toHaveLength(1);
  });

  it('friendly reasons go straight to the notification', async () => {
    const reasons = ['CP covered: try again', 'Open the appraisal first'];
    let call = 0;
    server = await startServer(openStore(':memory:'), 0, { read: () => ({ ok: false as const, reason: reasons[call++], partial: {} }) });
    for (const reason of reasons) {
      const r = await (await fetch(url(server, '/live'), { method: 'POST', body: new Uint8Array([1]) })).json();
      expect(r).toEqual({ ok: false, notify: reason, rename: '' });
    }
  });
});

describe('keep / trade / transfer on the page and in live mode', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;
  const item = (id: number, species: string, name: string, search: string, slot: any) =>
    ({ id, species, dex: 1, cp: 500, ivs: { atk: 1, def: 2, sta: 3 }, name, search, slot, why: slot ? 'G40 Venusaur' : 'fills no keep slot' });

  it('lists show rename + search string; live notify gives verdict and "beats your"', async () => {
    const store = openStore(':memory:');
    const collection = {
      lists: () => ({ keep: [item(1, 'Bulbasaur', 'G12 2', 'bulbasaur&cp512', { league: 'great' })], trade: [], transfer: [item(2, 'Ivysaur', '', 'ivysaur&cp700', null)] }),
      place: () => ({ verdict: 'keep' as const, name: 'G12 2', search: 'bulbasaur&cp512', beats: 'beats your G40', slot: { league: 'great' } as any }),
      entries: () => [],
    };
    const read = () => ({ ok: true as const, scan: { species: 'Bulbasaur', cp: 512, hp: 70, ivs: { atk: 1, def: 15, sta: 15 }, level: 20, nickname: '' } as any });
    server = await startServer(store, 0, { read, collection });
    const html = await (await fetch(url(server, '/'))).text();
    for (const text of ['Keep (1)', 'Trade (0)', 'Transfer (1)', 'bulbasaur&amp;cp512', 'ivysaur&amp;cp700', 'G12 2']) expect(html).toContain(text);
    const live = await (await fetch(url(server, '/live'), { method: 'POST', body: new Uint8Array([1]) })).json();
    expect(live).toEqual({ ok: true, notify: 'KEEP Bulbasaur 1/15/15: G12 2, beats your G40', rename: 'G12 2' });
  });
});

describe('never-transfer list on the page', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;

  it('add and remove species from the page form', async () => {
    const store = openStore(':memory:');
    server = await startServer(store, 0);
    const form = (body: string) => fetch(url(server!, '/exceptions'), { method: 'POST', body, headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' });
    expect((await form('species=Magikarp&action=add')).status).toBe(303);
    expect(store.exceptions()).toEqual(['Magikarp']);
    expect(await (await fetch(url(server, '/'))).text()).toContain('Magikarp');
    await form('species=Magikarp&action=remove');
    expect(store.exceptions()).toEqual([]);
  });
});

describe('data date on the page', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  it('footer shows the PvPoke data date', async () => {
    server = await startServer(openStore(':memory:'), 0, { dataInfo: () => ({ pvpokeDate: '2026-11-20', downloadedAt: '2026-11-22T08:00:00.000Z' }) });
    const html = await (await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)).text();
    expect(html).toContain('PvPoke data: 2026-11-20');
  });
});

describe('Collection tab', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;

  it('page has tabs, sort/search/generation controls and every entry; transfers past today are gone', async () => {
    const entry = { id: 7, species: 'Kingler <b>', speciesId: 'kingler', dex: 99, gen: { n: 1, region: 'Kanto' }, verdict: 'keep', cp: 711, ivs: { atk: 0, def: 4, sta: 3 } };
    const gone = { ...entry, id: 8, speciesId: 'krabby', verdict: 'transfer' };
    const collection = { lists: () => ({ keep: [], trade: [], transfer: [] }), place: () => ({}) as any, entries: () => [entry, gone] as any };
    server = await startServer(openStore(':memory:'), 0, { collection });
    const html = await (await fetch(url(server, '/collection'))).text();
    for (const t of ['href="/collection" class="on"', 'data-sort="dex"', 'data-sort="recent"', 'data-sort="dust"', 'data-sort="dustnoelite"', 'data-sort="meta"', 'This session', 'SESSION = null', 'Search species', '"speciesId":"kingler"', 'Kanto']) expect(html).toContain(t);
    expect(html).not.toContain('"speciesId":"krabby"'); // Collection = Keep list only
    expect(html).not.toContain('Kingler <b>'); // JSON in the page can't break out of its script tag
    expect(await (await fetch(url(server, '/api/collection'))).json()).toEqual([entry, gone]);
    expect(await (await fetch(url(server, '/'))).text()).toContain('href="/collection"');
  });

  it('"this session" starts at the latest upload run since the app opened', async () => {
    const store = openStore(':memory:');
    server = await startServer(store, 0);
    expect(await (await fetch(url(server, '/collection'))).text()).toContain('SESSION = null');
    store.saveFailed({ file: '/nowhere.png', reason: 'Could not read cp' });
    const html = await (await fetch(url(server, '/collection'))).text();
    const start = Number(html.match(/SESSION = (\d+)/)![1]);
    expect(Math.abs(Date.now() - start)).toBeLessThan(5000);
  });

  it('serves sprites from the cache folder', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response(png); }) as typeof fetch;
    server = await startServer(openStore(':memory:'), 0, { spriteDir: mkdtempSync(join(tmpdir(), 'pg-sp-')), fetchImpl });
    const r = await fetch(url(server, '/sprite/kingler?dex=99'));
    expect(r.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(png);
    await fetch(url(server, '/sprite/kingler?dex=99'));
    expect(calls).toBe(1);
    expect((await fetch(url(server, '/sprite/..%2Fx'))).status).toBe(404);
  });
});

describe('store: delete scans, candy, moves, inventory', () => {
  it('a deleted scan is hidden everywhere and can be restored', () => {
    const s = openStore(':memory:');
    const id = s.save({ species: 'Bulbasaur', atk: 1, def: 2, sta: 3, level: 10 }, { species: 'Bulbasaur' });
    s.removeScan(id);
    expect([s.count(), s.details().length, s.list().length]).toEqual([0, 0, 0]);
    s.restoreScan(id);
    expect([s.count(), s.details().length]).toEqual([1, 1]);
  });

  it('inventory and moves-done marks are saved', () => {
    const s = openStore(':memory:');
    expect(s.inventory()).toEqual({ dust: 0, fastTm: 0, chargedTm: 0 });
    s.setInventory({ dust: 500_000, fastTm: 1, chargedTm: 2 });
    expect(s.inventory()).toEqual({ dust: 500_000, fastTm: 1, chargedTm: 2 });
    s.setMovesDone('k', true);
    expect(s.movesDone().has('k')).toBe(true);
    s.setMovesDone('k', false);
    expect(s.movesDone().has('k')).toBe(false);
  });
});

describe('Scan page X + Collection edits (Ben, 2026-11-23)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;
  const postJson = (s: Server, p: string, d: unknown) => fetch(url(s, p), { method: 'POST', body: JSON.stringify(d) }).then((r) => r.json());

  it('X deletes a scan (and Undo restores it); X on a failed scan removes it', async () => {
    const store = openStore(':memory:');
    const id = store.save({ species: 'Bulbasaur', atk: 1, def: 2, sta: 3, level: 10 }, { species: 'Bulbasaur' });
    const fid = store.saveFailed({ file: '/nowhere.png', reason: 'Could not read cp' });
    server = await startServer(store, 0);
    expect(await (await fetch(url(server, `/api/scans/${id}/delete`), { method: 'POST' })).json()).toEqual({ ok: true });
    expect(store.count()).toBe(0);
    await fetch(url(server, `/api/scans/${id}/restore`), { method: 'POST' });
    expect(store.count()).toBe(1);
    await fetch(url(server, `/api/failed/${fid}/delete`), { method: 'POST' });
    expect(store.failed()).toEqual([]);
  });

  it('candy, moves done and dust/Elite TMs are saved and answer with fresh keepers + plan', async () => {
    const store = openStore(':memory:');
    const collection = { lists: () => ({ keep: [], trade: [], transfer: [] }), place: () => ({}) as any, entries: () => [] };
    server = await startServer(store, 0, { collection });
    expect(await postJson(server, '/api/inventory', { dust: 1_200_000, fastTm: 2, chargedTm: -1 }))
      .toMatchObject({ entries: [], inventory: { dust: 1_200_000, fastTm: 2, chargedTm: 0 }, plan: { build: [], dustLeft: 1_200_000 } });
    await postJson(server, '/api/candy', { family: 'FAMILY_PIPLUP', candy: 250 });
    expect(store.typedCandy().get('FAMILY_PIPLUP')).toMatchObject({ candy: 250 });
    await postJson(server, '/api/moves', { key: 'k', done: true });
    expect(store.movesDone().has('k')).toBe(true);
    expect((await fetch(url(server, '/api/candy'), { method: 'POST', body: '{}' })).status).toBe(400);
    const page = await (await fetch(url(server, '/collection'))).text();
    for (const t of ['data-f="when"', 'data-f="kind"', '>PvP<', 'Fully built', 'Built, moves left', 'What can I build?', 'Elite Charged TMs']) expect(page).toContain(t);
  });
});

describe('replaced bests + Pokédex (Ben, 2026-11-23)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;

  it('store keeps replaced pairs until dismissed', () => {
    const s = openStore(':memory:');
    s.addReplaced(3, 4); s.addReplaced(3, 4);
    expect(s.replaced()).toEqual([{ oldId: 3, newId: 4, at: expect.any(String) }]);
    s.dismissReplaced(3);
    expect(s.replaced()).toEqual([]);
  });

  it('scan page shows "Better one found" with the old search string while the old one is not kept', async () => {
    const store = openStore(':memory:');
    const mk = (id: number, species: string, name: string, search: string, slot: any) =>
      ({ id, species, dex: 115, cp: 1000, ivs: { atk: 1, def: 14, sta: 15 }, name, search, slot, why: '' });
    const collection = {
      lists: () => ({ keep: [mk(4, 'Kangaskhan', 'U2', 'kangaskhan&cp1003', { league: 'ultra', rank: 2 })], trade: [], transfer: [mk(3, 'Kangaskhan', '', 'kangaskhan&cp1002&!shiny&!costume', null)] }),
      place: () => ({ verdict: 'keep' as const, name: 'U2', search: 'kangaskhan&cp1003', beats: 'beats your U36', slot: { league: 'ultra', rank: 2 } as any, replaced: [{ id: 3, species: 'Kangaskhan', verdict: 'transfer' as const, search: 'kangaskhan&cp1002&!shiny&!costume' }] }),
      entries: () => [],
    };
    const read = () => ({ ok: true as const, scan: { species: 'Kangaskhan', cp: 1003, hp: 103, ivs: { atk: 1, def: 14, sta: 15 }, level: 20, nickname: '' } as any });
    server = await startServer(store, 0, { read, collection });
    const r = await (await fetch(url(server, '/scan'), { method: 'POST', body: new Uint8Array([1]) })).json();
    expect(r.replaced[0].search).toBe('kangaskhan&cp1002&!shiny&!costume');
    const live = await (await fetch(url(server, '/live'), { method: 'POST', body: new Uint8Array([1]) })).json();
    expect(live.notify).toContain('get rid of old: kangaskhan&cp1002');
    const html = await (await fetch(url(server, '/'))).text();
    expect(html).toContain('Better one found');
    expect(html).toContain('data-dismiss="3"');
    expect(html).toContain('class="row top"'); // single-digit rank gets the highlight
    await fetch(url(server, '/api/replaced/3/dismiss'), { method: 'POST' });
    expect(await (await fetch(url(server, '/'))).text()).not.toContain('Better one found');
  });

  it('Pokédex: tap marks have/missing per dex; screenshots go to the inbox for the reader', async () => {
    const store = openStore(':memory:');
    const inbox = mkdtempSync(join(tmpdir(), 'pg-dex-'));
    server = await startServer(store, 0, { dexInbox: inbox, dexSpecies: () => [{ dex: 1, name: 'Bulbasaur', id: 'bulbasaur' }, { dex: 4, name: 'Charmander', id: 'charmander' }] });
    await fetch(url(server, '/api/dex'), { method: 'POST', body: JSON.stringify({ kind: 'shiny', dex: 4, status: 'missing' }) });
    expect(store.dexMarks('shiny')).toEqual(new Map([[4, 'missing']]));
    const html = await (await fetch(url(server, '/pokedex'))).text();
    for (const t of ['href="/pokedex" class="on"', 'data-kind="shiny"', 'data-kind="lucky"', 'data-kind="hundo"', 'data-kind="xxl"', '"Charmander"']) expect(html).toContain(t);
    const up = await (await fetch(url(server, '/pokedex/upload?kind=shiny&name=a.png'), { method: 'POST', body: new Uint8Array([1, 2]) })).json();
    expect(up.ok).toBe(true);
    expect(readdirSync(join(inbox, 'shiny'))).toHaveLength(1);
    expect((await fetch(url(server, '/pokedex/upload?kind=..&name=a.png'), { method: 'POST', body: new Uint8Array([1]) })).status).toBe(400);
  });
});

describe('Pokédex reader hookup + Scan views (Ben, 2026-11-23)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;

  it('waiting screenshots are read at start; the dex shown in the screenshot wins; read ones are deleted', async () => {
    const store = openStore(':memory:');
    const inbox = mkdtempSync(join(tmpdir(), 'pg-dex-'));
    mkdirSync(join(inbox, 'shiny'));
    writeFileSync(join(inbox, 'shiny', 'a.png'), 'x');
    const readDex = (path: string) => (path.endsWith('bad.png') ? { ok: false as const, reason: 'No Pokédex numbers found' } : { ok: true as const, have: [1, 2], missing: [3], kind: path.includes('lucky-shot') ? 'lucky' : 'shiny' });
    server = await startServer(store, 0, { dexInbox: inbox, readDex });
    expect(store.dexMarks('shiny')).toEqual(new Map([[1, 'have'], [2, 'have'], [3, 'missing']]));
    expect(readdirSync(join(inbox, 'shiny'))).toEqual([]);
    const r = await (await fetch(url(server, '/pokedex/upload?kind=shiny&name=lucky-shot.png'), { method: 'POST', body: new Uint8Array([1]) })).json();
    expect(r.note).toContain('this was the Lucky Pokédex');
    expect(store.dexMarks('lucky').get(3)).toBe('missing');
    const bad = await (await fetch(url(server, '/pokedex/upload?kind=xxl&name=bad.png'), { method: 'POST', body: new Uint8Array([1]) })).json();
    expect(bad).toEqual({ ok: false, reason: 'No Pokédex numbers found' });
    expect(readdirSync(join(inbox, 'xxl'))).toHaveLength(1); // kept to retry
    const page = await (await fetch(url(server, '/pokedex'))).text();
    for (const t of ['data-kind="normal"', 'data-kind="mega"', 'data-kind="gmax"', '"gmax":"known"']) expect(page).toContain(t);
  });

  it('Scan page has a Recent view and collapsible Keep / Trade / Transfer', async () => {
    const mk = (id: number, species: string) => ({ id, species, dex: 1, cp: 500, ivs: { atk: 1, def: 2, sta: 3 }, name: '', search: `${species.toLowerCase()}&cp500`, slot: null, why: '' });
    const collection = { lists: () => ({ keep: [mk(2, 'Ivysaur')], trade: [], transfer: [mk(5, 'Pidgey')] }), place: () => ({}) as any, entries: () => [] };
    server = await startServer(openStore(':memory:'), 0, { collection });
    const html = await (await fetch(url(server, '/'))).text();
    for (const t of ['data-view="recent"', 'data-view="lists" hidden', 'Recent scans', 'details class="card fold" data-fold="keep"', 'data-fold="transfer"', '<span class="tag transfer">transfer</span>']) expect(html).toContain(t);
    expect(html.indexOf('Pidgey')).toBeLessThan(html.indexOf('Ivysaur')); // newest first in Recent
  });

  it('every copy string has a square copy icon next to it (shown on phone widths, Ben 2026-11-24)', async () => {
    const mk = (id: number, species: string) => ({ id, species, dex: 1, cp: 500, ivs: { atk: 1, def: 2, sta: 3 }, name: 'IVY', search: `${species.toLowerCase()}&cp500`, slot: null, why: '' });
    const collection = { lists: () => ({ keep: [mk(2, 'Ivysaur')], trade: [], transfer: [] }), place: () => ({}) as any, entries: () => [] };
    server = await startServer(openStore(':memory:'), 0, { collection });
    const html = await (await fetch(url(server, '/'))).text();
    expect(html).toContain('<button class="copy cpi" data-copy="ivysaur&amp;cp500" aria-label="Copy ivysaur&amp;cp500"');
    expect(html).toContain('data-copy="IVY" aria-label="Copy IVY"');
    expect(html).toContain('@media (max-width:700px){.cpi{display:inline-flex}}');
  });

  it('every page links to the Ready Set Ink Ko-fi; Settings has a Support card (Ben 2026-11-24)', async () => {
    server = await startServer(openStore(':memory:'), 0, { collection: { lists: () => ({ keep: [], trade: [], transfer: [] }), place: () => ({}) as any, entries: () => [] } });
    for (const p of ['/', '/collection', '/pokedex', '/meta', '/teams', '/settings']) expect(await (await fetch(url(server, p))).text(), p).toContain('<footer class="support"><a href="https://ko-fi.com/J2E225ZV4T"');
    expect(await (await fetch(url(server, '/settings'))).text()).toContain('<h2>Support</h2>');
  });

  it('every page script parses (no broken quote escapes)', async () => {
    server = await startServer(openStore(':memory:'), 0, { collection: { lists: () => ({ keep: [], trade: [], transfer: [] }), place: () => ({}) as any, entries: () => [] } });
    for (const p of ['/', '/collection', '/pokedex', '/meta', '/teams', '/settings']) {
      const html = await (await fetch(url(server, p))).text();
      for (const [, code] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        expect(() => new Function(code), p).not.toThrow();
        // window.top, location... can't be redeclared: "let top" at the top of a page script kills the whole script.
        expect(code, p).not.toMatch(/^(let|const) (.*?[\s,])?(top|window|document|location)\s*=(?!=)/m);
      }
    }
  });

  it('Collection has List / Grid views, league colour bars and a PvPoke rank filter (Ben 2026-11-24)', async () => {
    server = await startServer(openStore(':memory:'), 0, { collection: { lists: () => ({ keep: [], trade: [], transfer: [] }), place: () => ({}) as any, entries: () => [] } });
    const html = await (await fetch(url(server, '/collection'))).text();
    for (const t of ['data-m="list"', 'data-m="grid"', 'id="rankf"', 'data-top="25"', 'data-lg="master"', '.lg-little{--c:', '.lbar i.have']) expect(html).toContain(t);
  });
});

describe('Settings: clear all my Pokémon (Ben, 2026-11-23)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;

  it('deletes every scan, failed scan and picture; keeps the Pokédex, never-transfer list, candy and dust', async () => {
    const store = openStore(':memory:');
    const uploads = mkdtempSync(join(tmpdir(), 'pg-up-'));
    const id = store.save({ species: 'Piplup', atk: 1, def: 2, sta: 3, level: 5 });
    writeFileSync(join(uploads, 'fail.png'), 'x'); mkdirSync(join(uploads, 'vid-frames')); writeFileSync(join(uploads, 'vid-frames', '1.png'), 'x');
    store.saveFailed({ file: join(uploads, 'fail.png'), reason: 'CP covered' });
    store.removeScan(store.save({ species: 'Pidgey', atk: 0, def: 0, sta: 0, level: 1 }));
    store.addReplaced(id, id + 5); store.setMovesDone('piplup|1/2/3', true);
    store.setDexMark('shiny', 4, 'have'); store.addException('Magikarp'); store.setCandy('piplup', { candy: 50 }); store.setInventory({ dust: 1000, fastTm: 1, chargedTm: 0 });
    server = await startServer(store, 0, { uploadDir: uploads });

    expect(await (await fetch(url(server, '/settings'))).text()).toContain('Clear all my Pokémon');
    expect((await fetch(url(server, '/api/clear-pokemon'), { method: 'POST', body: '{}' })).status).toBe(400); // needs the confirm word
    expect(store.count()).toBe(1);

    const r = await (await fetch(url(server, '/api/clear-pokemon'), { method: 'POST', body: JSON.stringify({ confirm: 'clear' }) })).json();
    expect(r).toMatchObject({ ok: true, scans: 2, pictures: 2 });
    expect(store.count()).toBe(0);
    expect(store.details()).toEqual([]);
    expect(store.failed()).toEqual([]);
    expect(store.replaced()).toEqual([]);
    expect(store.movesDone().size).toBe(0);
    expect(readdirSync(uploads)).toEqual([]);
    expect(store.dexMarks('shiny').get(4)).toBe('have');
    expect(store.exceptions()).toEqual(['Magikarp']);
    expect(store.typedCandy().get('piplup')?.candy).toBe(50);
    expect(store.inventory().dust).toBe(1000);
  });
});

describe('phone conveniences (Ben, 2026-11-23)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;

  it('tapping "Lilycove Co" reloads the page on every tab; Pokédex has a Missing only filter', async () => {
    server = await startServer(openStore(':memory:'), 0);
    for (const p of ['/', '/collection', '/pokedex', '/meta', '/teams', '/settings']) expect(await (await fetch(url(server, p))).text()).toContain('class="brand" onclick="location.reload()');
    const dex = await (await fetch(url(server, '/pokedex'))).text();
    expect(dex).toContain('data-v="missing">Missing only</button>');
  });
});

describe('daily + lifetime scan count (Ben, 2026-11-26)', () => {
  it('today counts scans since local midnight; lifetime never goes down, not even after Clear all', () => {
    const store = openStore(':memory:');
    store.save({ species: 'Piplup', atk: 1, def: 2, sta: 3, level: 5 });
    store.save({ species: 'Piplup', atk: 1, def: 2, sta: 4, level: 5 });
    expect(store.scanStats()).toEqual({ today: 2, lifetime: 2 });
    store.clearPokemon();
    expect(store.scanStats()).toEqual({ today: 2, lifetime: 2 });
    store.save({ species: 'Piplup', atk: 1, def: 2, sta: 5, level: 5 });
    expect(store.scanStats()).toEqual({ today: 3, lifetime: 3 });
  });
  it('a day that is over only adds to lifetime', () => {
    const store = openStore(':memory:');
    store.save({ species: 'Piplup', atk: 1, def: 2, sta: 3, level: 5 }, undefined, '2020-01-01');
    store.save({ species: 'Piplup', atk: 1, def: 2, sta: 4, level: 5 });
    expect(store.scanStats()).toEqual({ today: 1, lifetime: 2 });
  });
});

describe('Pokédex: tap to mark + Meta tab (Ben, 2026-11-26)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;

  it('Pokédex filters are All / Have / Missing', async () => {
    server = await startServer(openStore(':memory:'), 0);
    const dex = await (await fetch(url(server, '/pokedex'))).text();
    for (const t of ['data-v="all"', 'data-v="have"', 'data-v="missing">Missing only</button>']) expect(dex).toContain(t);
    expect(dex).not.toContain('Not known yet');
  });

  it('Meta tab: top picks per league, greyed when not had, with league + have filters', async () => {
    const store = openStore(':memory:');
    store.setDexMark('normal', 308, 'have');
    const metaTop = () => ({ great: [{ rank: 1, id: 'medicham', name: 'Medicham', dex: 308, shadow: false }, { rank: 2, id: 'lanturn', name: 'Lanturn', dex: 171, shadow: false }], ultra: [], master: [], little: [] });
    server = await startServer(store, 0, { metaTop });
    const html = await (await fetch(url(server, '/meta'))).text();
    for (const t of ['href="/meta" class="on"', 'data-lg="great"', 'data-lg="ultra"', 'data-lg="master"', 'data-lg="little"', 'data-v="have"', 'data-v="missing"', '"Medicham"']) expect(html).toContain(t);
    const meta = JSON.parse(html.match(/<script id="data" type="application\/json">(.*?)<\/script>/)![1]);
    expect(meta.top.great.map((m: any) => [m.name, m.have])).toEqual([['Medicham', true], ['Lanturn', false]]);
  });
});

describe('Teams tab + meta alerts (Ben, 2026-11-26)', () => {
  let server: Server | undefined;
  afterEach(() => new Promise<void>((done) => (server ? server.close(() => done()) : done())));
  const url = (s: Server, p: string) => `http://127.0.0.1:${(s.address() as AddressInfo).port}${p}`;
  const change = { from: '2026-10-01', to: '2026-11-01', leagues: { great: { up: [{ id: 'lanturn', name: 'Lanturn', from: 40, to: 3 }], down: [{ id: 'medicham', name: 'Medicham', from: 2, to: 30 }] } }, moves: [{ id: 'ICE_PUNCH', name: 'Ice Punch', changes: [{ field: 'power', from: 50, to: 55 }] }] };

  it('meta change alert on the Scan page and Teams tab until Got it', async () => {
    const store = openStore(':memory:');
    const id = store.addMetaChange(change as any);
    server = await startServer(store, 0);
    const home = await (await fetch(url(server, '/'))).text();
    for (const t of ['Meta changed', 'Lanturn', 'Medicham', 'Ice Punch', `data-metadismiss="${id}"`, 'href="/teams"']) expect(home).toContain(t);
    const teams = await (await fetch(url(server, '/teams'))).text();
    for (const t of ['href="/teams" class="on"', 'Boosted ▲', 'Fell ▼', '#40 → #3', 'damage 50 → 55', 'data-v="rec"', 'aria-pressed="false">Off-meta<']) expect(teams).toContain(t);
    await fetch(url(server, `/api/meta-changes/${id}/dismiss`), { method: 'POST' });
    expect(await (await fetch(url(server, '/'))).text()).not.toContain('Meta changed');
  });

  it('Collection has a Recommended / Off-meta build switch', async () => {
    server = await startServer(openStore(':memory:'), 0, { collection: { lists: () => ({ keep: [], trade: [], transfer: [] }), place: () => ({}) as any, entries: () => [] } });
    const html = await (await fetch(url(server, '/collection'))).text();
    for (const t of ['data-b="rec"', 'data-b="off"', 'Off-meta build']) expect(html).toContain(t);
  });
});

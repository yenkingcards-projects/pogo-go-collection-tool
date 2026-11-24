// Local web server: opened on the Mac and iPhone. Home page: scan count, upload, Keep/Trade/Transfer, Failed scans.
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import type { Store } from './store.js';
import type { ReadResult, Appraisal } from './screen/read.js';
import type { Collection, Item, Entry } from './collection.js';
import type { Inventory } from './store.js';
import { plan, planMon, type Plan } from './plan.js';
import { DEX_KINDS, DEX_SPOTS, isDexKind, type DexKind, type DexRead, type DexSpecies } from './pokedex.js';
import { getSprite } from './sprites.js';
import { GENERATIONS } from './build.js';
import { sessionStart } from './session.js';
import { removeUpload, sweepUploads, uploadsSize, formatBytes, sqlTime, KEEP_FAILED_MS } from './uploads.js';

export interface ServerOptions {
  /** Reads a saved screenshot file. main.ts wires in the real Screen Reader + Namer. */
  read?: (path: string, opts?: { cp?: number }) => Extract<ReadResult, { ok: false }> | { ok: true; scan: Appraisal & { name?: string } };
  uploadDir?: string;
  /** Keep slots + lists (issue 05). Without it the page just shows recent scans. */
  collection?: Collection;
  /** Splits a recording into one image per Pokémon (src/video.ts). */
  split?: (video: string, outDir: string) => Promise<string[]>;
  /** PvPoke data date for the footer (issue 08). */
  dataInfo?: () => { pvpokeDate: string; downloadedAt: string };
  /** Sprite cache folder (Collection tab). */
  spriteDir?: string;
  fetchImpl?: typeof fetch;
  /** Pokédex tab: species list, screenshot inbox, and (issue 12) the screenshot reader. */
  dexSpecies?: () => DexSpecies[];
  dexInbox?: string;
  readDex?: (path: string, kind: DexKind) => DexRead;
}

interface Job { total: number; processed: number; failed: number; done: boolean; error?: string; results: unknown[] }

export const PORT = 4242;
/** Ko-fi (Ben, 2026-11-24): bottom of every page + a card on Settings. */
export const KOFI = 'https://ko-fi.com/J2E225ZV4T';
const SUPPORT = `<footer class="support"><a href="${KOFI}" target="_blank" rel="noopener">Support Ready Set Ink on Ko-fi ☕</a></footer>`;

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ENT[c]);

// Copy string + a square copy icon beside it (icon shown on phone widths only, Ben 2026-11-24). Same markup in SHARED_JS.
const COPY_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/></svg>';
const copyBtn = (text: string, cls: string, title: string) =>
  `<span class="cpr"><button class="copy ${cls}" data-copy="${esc(text)}" title="${title}">${esc(text)}</button><button class="copy cpi" data-copy="${esc(text)}" aria-label="Copy ${esc(text)}" title="${title}">${COPY_ICON}</button></span>`;

// One row on the Scan page. Search string sits on top of the rename (Ben copies the search first).
const itemRow = (i: Item, kept: boolean, oldBest = false, verdict?: string) =>
  `<li class="row${i.slot && i.slot.rank < 10 ? ' top' : ''}${oldBest ? ' oldbest' : ''}" data-row="${i.id}"><div class="who"><span class="sp">${esc(i.species)}</span>${verdict ? `<span class="tag ${verdict}">${verdict}</span>` : ''}${oldBest ? '<span class="tag alert">old best</span>' : ''}<span class="meta">${i.ivs.atk}/${i.ivs.def}/${i.ivs.sta} · CP ${esc(i.cp)}</span>` +
  `<button class="del" data-del="${i.id}" data-sp="${esc(i.species)}" aria-label="Delete ${esc(i.species)} scan" title="Delete this scan">×</button></div>` +
  `<div class="acts stack">${copyBtn(i.search, 'sec', 'Copy search')}${i.name ? copyBtn(i.name, 'util', 'Copy rename') : ''}</div>` +
  (kept ? `<details class="more" data-id="${i.id}"><summary>${esc(i.why)}</summary><ul class="facts"></ul></details>` : `<p class="why">${esc(i.why)}</p>`) + '</li>';

function listsHtml(c: Collection, store: Store): string {
  const { keep, trade, transfer } = c.lists();
  // Old bests a better scan pushed off the Keep list (still around, not dismissed): big card on top + tag in their list.
  const gone = new Map([...trade, ...transfer].map((i) => [i.id, i]));
  const all = new Map([...keep, ...trade, ...transfer].map((i) => [i.id, i]));
  const old = store.replaced().filter((r) => gone.has(r.oldId));
  const oldIds = new Set(old.map((r) => r.oldId));
  const alert = old.length ? `<section class="card alertcard" aria-labelledby="better"><h2 id="better">Better one found (${old.length})</h2>` +
    `<p class="why">Copy the search, find the old one in Pokémon GO, then ${old.length > 1 ? 'transfer or trade them' : 'transfer or trade it'}. Tap Done when it's gone.</p><ul class="list">` +
    old.map((r) => {
      const o = gone.get(r.oldId)!, n = all.get(r.newId);
      return `<li class="row"><div class="who"><span class="sp">Old ${esc(o.species)} <span class="meta">${o.ivs.atk}/${o.ivs.def}/${o.ivs.sta} · CP ${esc(o.cp)}</span></span><button class="mv" data-dismiss="${r.oldId}">Done</button></div>` +
        `<div class="acts stack">${copyBtn(o.search, 'sec big', 'Copy search for the old one')}</div>` +
        `<p class="why">${n ? `Beaten by your ${esc(n.species)} ${n.ivs.atk}/${n.ivs.def}/${n.ivs.sta}${n.name ? ` (${esc(n.name)})` : ''}` : 'Beaten by a better scan'} · now on the ${trade.includes(o) ? 'Trade' : 'Transfer'} list</p></li>`;
    }).join('') + '</ul></section>' : '';
  // Two views (Ben, 2026-11-23): Recent = scans as they come in, newest first; Lists = Keep / Trade / Transfer, each collapsible.
  const section = (key: string, title: string, items: Item[], kept = false) =>
    `<details class="card fold" data-fold="${key}"><summary><h2>${title} (${items.length})</h2></summary>${items.length ? `<ul class="list">${items.map((i) => itemRow(i, kept, oldIds.has(i.id))).join('')}</ul>` : '<p class="empty">None yet.</p>'}</details>`;
  const verdictOf = (i: Item) => (keep.includes(i) ? 'keep' : trade.includes(i) ? 'trade' : 'transfer');
  const recent = [...keep, ...trade, ...transfer].sort((a, b) => b.id - a.id).slice(0, 60);
  const recentHtml = `<section class="card"><h2>Recent scans</h2>${recent.length ? `<ul class="list">${recent.map((i) => itemRow(i, verdictOf(i) === 'keep', oldIds.has(i.id), verdictOf(i))).join('')}</ul>` : '<p class="empty">No scans yet.</p>'}</section>`;
  return alert +
    '<div class="seg viewseg" id="view" role="group" aria-label="Scan view"><button data-v="recent" class="on" aria-pressed="true">Recent</button><button data-v="lists" aria-pressed="false">Keep / Trade / Transfer</button></div>' +
    `<div data-view="recent">${recentHtml}</div><div data-view="lists" hidden>${section('keep', 'Keep', keep, true) + section('trade', 'Trade', trade) + section('transfer', 'Transfer', transfer)}</div>`;
}

/** Kept Pokémon + planner for the Collection tab (and the Scan page's collapsed facts). */
export interface Keepers { entries: Entry[]; inventory: Inventory; plan: Plan }
function keepers(store: Store, c?: Collection): Keepers {
  const entries = c ? c.entries().filter((e) => e.verdict === 'keep') : [];
  const inventory = store.inventory();
  return { entries, inventory, plan: plan(entries.map(planMon).filter((m) => m !== undefined), inventory) };
}
const pageJson = (d: unknown) => JSON.stringify(d).replace(/</g, '\\u003c');

// Shared by both pages: build facts, click-to-type candy, moves done. Each page defines refresh(data?).
const SHARED_JS = String.raw`
const LEAGUE = { great: 'Great', ultra: 'Ultra', little: 'Little' }, L = { great: 'G', ultra: 'U', little: 'L' };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const num = (n) => Number(n).toLocaleString('en-US');
const short = (n) => n >= 1e6 ? (Math.round(n / 1e4) / 100) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
const known = (n) => n !== undefined && n !== null;
let PLAN = { build: [], fastTm: [], chargedTm: [], candyUnknown: [] };
function editBtn(e, kind, have) {
  return '<button class="edit" data-fam="' + esc(e.family) + '" data-kind="' + kind + '" data-val="' + (known(have) ? have : '') + '" title="Tap to type">' + (known(have) ? num(have) : 'tap to type') + '</button>';
}
function candyLine(e, kind, need) {
  const have = kind === 'xl' ? e.xlHave : e.candyHave, word = kind === 'xl' ? 'XL candy' : 'Candy';
  if (!need) return kind === 'xl' && !known(have) ? '' : '<li>' + word + ': have ' + editBtn(e, kind, have) + '</li>';
  const st = !known(have) ? '' : have >= need ? ' <span class="ok">enough</span>' : ' <span class="short">' + num(need - have) + ' short</span>';
  return '<li>' + word + ': have ' + editBtn(e, kind, have) + ' · need <b>' + num(need) + '</b>' + st + '</li>';
}
function planTags(e) {
  return (PLAN.build.includes(e.id) ? '<span class="tag go">can build</span>' : '') + (PLAN.fastTm.includes(e.id) ? '<span class="tag elite">use Fast TM</span>' : '') + (PLAN.chargedTm.includes(e.id) ? '<span class="tag elite">use Charged TM</span>' : '');
}
function buildTag(e) {
  const b = e.build; if (!b || !b.built) return '';
  return e.movesDone ? '<span class="tag keep">fully built</span>' : '<span class="tag">moves left</span>';
}
function factsHtml(e) {
  const b = e.build; let f = '';
  if (b) {
    f += '<li><b>' + L[b.league] + b.ivRank + ' ' + esc(b.target) + (b.mega ? ' (mega)' : '') + '</b> · ' + (b.metaRank ? '#' + b.metaRank + ' in ' + LEAGUE[b.league] + ' League meta' : 'not in PvPoke ' + LEAGUE[b.league] + ' rankings') + '</li>';
    if (b.moves.length) f += '<li>Moves: ' + b.moves.map((m) => esc(m.name) + (m.elite ? ' <span class="tag elite">Elite ' + (m.fast ? 'Fast' : 'Charged') + ' TM</span>' : '')).join(' · ') +
      ' <button class="mv" data-key="' + esc(e.movesKey) + '" aria-pressed="' + !!e.movesDone + '">' + (e.movesDone ? 'Moves done' : 'Mark moves done') + '</button></li>';
    if (!b.stageDone && b.evolveCandy) f += '<li>Evolve: ' + num(b.evolveCandy) + ' candy</li>';
    f += b.powerUp.dust ? '<li>Power up to L' + b.level + ' (CP ' + num(b.cp) + '): <b>' + num(b.powerUp.dust) + ' dust</b> · ' + num(b.powerUp.candy) + ' candy' + (b.powerUp.xl ? ' · ' + num(b.powerUp.xl) + ' XL' : '') + '</li>'
      : '<li>At its build level (L' + b.level + ', CP ' + num(b.cp) + ')</li>';
    if (b.secondMove && !e.movesDone) f += '<li>2nd attack: <b>' + num(b.secondMove.dust) + ' dust</b> · ' + num(b.secondMove.candy) + ' candy</li>';
    f += '<li>Total: <b>' + num(b.total.dust) + ' dust</b></li>';
    f += candyLine(e, 'candy', b.total.candy) + candyLine(e, 'xl', b.total.xl);
  } else {
    if (e.best) f += '<li>Best: ' + L[e.best.league] + e.best.rank + ' ' + esc(e.best.target) + '</li>';
    f += '<li>' + esc(e.why) + '</li>' + candyLine(e, 'candy', 0) + candyLine(e, 'xl', 0);
  }
  return f;
}
// One line for the Scan page's collapsed view.
function summary(e) {
  const b = e.build; if (!b) return esc(e.why);
  return [L[b.league] + b.ivRank + ' ' + esc(b.target), b.metaRank ? '#' + b.metaRank + ' meta' : '', b.built ? (e.movesDone ? 'fully built' : 'moves left') : short(b.total.dust) + ' dust',
    b.moves.some((m) => m.elite) ? 'Elite TM' : ''].filter(Boolean).join(' · ');
}
async function post(url, data) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  return r.json();
}
const COPY_ICON = ${JSON.stringify(COPY_ICON)};
function copyBtn(text, cls, title) {
  return '<span class="cpr"><button class="copy ' + cls + '" data-copy="' + esc(text) + '" title="' + title + '">' + esc(text) + '</button><button class="copy cpi" data-copy="' + esc(text) + '" aria-label="Copy ' + esc(text) + '" title="' + title + '">' + COPY_ICON + '</button></span>';
}
// The iPhone opens the page over plain http (Tailscale), where navigator.clipboard doesn't exist.
// Fallback = clipboard.js's iOS-proven way: on-screen readonly textarea, focus + select, execCommand('copy'), all inside the tap.
function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => copyOld(text));
  return Promise.resolve(copyOld(text));
}
function copyOld(text) {
  const a = document.createElement('textarea');
  a.value = text; a.setAttribute('readonly', '');
  a.style.cssText = 'position:absolute;left:-9999px;top:' + (window.pageYOffset || document.documentElement.scrollTop) + 'px;font-size:12pt;border:0;padding:0;margin:0';
  document.body.append(a);
  a.focus({ preventScroll: true }); a.select(); a.setSelectionRange(0, text.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  a.remove(); getSelection().removeAllRanges();
  return ok;
}
// Last resort: the text in a sheet, already selected, so a long-press -> Copy works.
function copySheet(text) {
  document.querySelector('.cpsheet')?.remove();
  const d = document.createElement('div'); d.className = 'cpsheet'; d.setAttribute('role', 'dialog');
  d.innerHTML = '<p>Copy didn\'t go through. Press and hold the text, then tap Copy.</p><textarea readonly></textarea><button class="btn pri">Done</button>';
  const t = d.querySelector('textarea'); t.value = text;
  d.querySelector('button').onclick = () => d.remove();
  document.body.append(d); t.focus(); t.select(); t.setSelectionRange(0, text.length);
}
document.addEventListener('click', async (ev) => {
  const c = ev.target.closest('.copy');
  if (c) {
    const ok = await copyText(c.dataset.copy), html = c.innerHTML, icon = c.classList.contains('cpi');
    if (!ok) return copySheet(c.dataset.copy);
    c.classList.add('copied'); c.textContent = icon ? '✓' : 'Copied ✓';
    return setTimeout(() => { c.innerHTML = html; c.classList.remove('copied'); }, 1200);
  }
  const ed = ev.target.closest('.edit');
  if (ed) {
    ev.preventDefault();
    const i = document.createElement('input');
    Object.assign(i, { className: 'editin', type: 'text', inputMode: 'numeric', value: ed.dataset.val, enterKeyHint: 'done' });
    i.setAttribute('aria-label', ed.dataset.kind === 'xl' ? 'XL candy you have' : 'Candy you have');
    i.dataset.fam = ed.dataset.fam; i.dataset.kind = ed.dataset.kind;
    ed.replaceWith(i); i.focus(); i.select();
    return;
  }
  const mv = ev.target.closest('.mv');
  if (mv) refresh(await post('/api/moves', { key: mv.dataset.key, done: mv.getAttribute('aria-pressed') !== 'true' }));
});
async function saveEdit(i) {
  if (i.dataset.saving) return;
  i.dataset.saving = '1';
  const n = parseInt(i.value.replace(/[^0-9]/g, ''), 10);
  if (Number.isNaN(n)) return refresh();
  refresh(await post('/api/candy', { family: i.dataset.fam, [i.dataset.kind]: n }));
}
document.addEventListener('keydown', (ev) => {
  const i = ev.target.closest && ev.target.closest('.editin'); if (!i) return;
  if (ev.key === 'Enter') { ev.preventDefault(); saveEdit(i); }
  if (ev.key === 'Escape') { i.dataset.saving = '1'; refresh(); }
});
document.addEventListener('focusout', (ev) => { const i = ev.target.closest && ev.target.closest('.editin'); if (i) saveEdit(i); });
`;

// Ben's AI-apps design system (ben-app-design): Inter, one accent (--primary), parchment sections, 18px cards, pill actions.
const STYLE = `
:root{--primary:#5b5bd6;--primary-focus:#7070e8;--ink:#1d1d1f;--ink-muted-80:#333;--ink-muted-48:#7a7a7a;
--divider-soft:#f0f0f0;--hairline:#e0e0e0;--canvas:#fff;--canvas-parchment:#f5f5f7;--font:Inter,system-ui,sans-serif;
--r-sm:8px;--r-lg:18px;--r-pill:9999px;--s-xs:8px;--s-sm:12px;--s-md:17px;--s-lg:24px;--s-xl:32px;--s-xxl:48px}
*{box-sizing:border-box}
body{margin:0;font:400 17px/1.47 var(--font);letter-spacing:-0.374px;color:var(--ink);background:var(--canvas-parchment)}
.bar{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;height:52px;padding:0 var(--s-md);
background:rgba(245,245,247,.8);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);border-bottom:1px solid var(--hairline)}
.bar b{font-weight:600;font-size:17px}
.brand{border:0;background:transparent;font:600 17px/1 var(--font);letter-spacing:-0.374px;color:var(--ink);padding:12px 8px;margin-left:-8px;cursor:pointer;min-height:44px}.bar span{font-size:12px;color:var(--ink-muted-48)}
main{max-width:760px;margin:0 auto;padding:var(--s-lg) var(--s-md) var(--s-xxl)}
.hero{background:var(--canvas);border:1px solid var(--hairline);border-radius:var(--r-lg);padding:var(--s-lg);margin-bottom:var(--s-lg)}
.label{font-size:14px;line-height:1.43;letter-spacing:-0.224px;color:var(--ink-muted-48);margin:0}
.count{font-size:56px;font-weight:600;line-height:1.07;letter-spacing:-0.28px;margin:4px 0 var(--s-lg)}
.btns{display:flex;flex-wrap:wrap;gap:var(--s-xs)}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:11px 22px;border-radius:var(--r-pill);font:400 17px/1.24 var(--font);letter-spacing:-0.374px;cursor:pointer;border:1px solid var(--primary)}
.btn.pri{background:var(--primary);color:#fff}.btn.sec2{background:transparent;color:var(--primary)}
.btn input{display:none}
button:active,.btn:active{transform:scale(.95)}
button:focus-visible,.btn:focus-within,input:focus-visible{outline:2px solid var(--primary-focus);outline-offset:2px}
progress{width:100%;margin-top:var(--s-sm);accent-color:var(--primary)}
#msg{font-size:14px;color:var(--ink-muted-80);margin:var(--s-sm) 0 0;min-height:20px}
.card{background:var(--canvas);border:1px solid var(--hairline);border-radius:var(--r-lg);padding:var(--s-lg);margin-bottom:var(--s-lg)}
h2{font-size:21px;font-weight:600;line-height:1.19;letter-spacing:.231px;margin:0 0 var(--s-sm)}
.list{list-style:none;margin:0;padding:0}
.row{padding:var(--s-sm) 0;border-top:1px solid var(--divider-soft)}.row:first-child{border-top:0}
.who{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s-xs)}
.sp{font-weight:600}.meta,.why{font-size:14px;letter-spacing:-0.224px;color:var(--ink-muted-48)}
.why{margin:4px 0 0}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-xs);margin-top:var(--s-xs)}
.copy{font:400 14px/1.29 var(--font);letter-spacing:-0.224px;cursor:pointer;min-height:44px;word-break:break-all;text-align:left;-webkit-user-select:text;user-select:text;touch-action:manipulation}
.copy.copied{background:#1b7a3a;border-color:#1b7a3a;color:#fff}
.cpr{display:inline-flex;gap:6px;align-items:stretch;max-width:100%}
.cpi{display:none;flex:none;width:44px;min-height:44px;border:1px solid var(--hairline);border-radius:var(--r-sm);background:#fff;color:var(--ink);align-items:center;justify-content:center;padding:0}
@media (max-width:700px){.cpi{display:inline-flex}}
.cpsheet{position:fixed;left:12px;right:12px;bottom:12px;z-index:10;background:#fff;border:1px solid var(--hairline);border-radius:var(--r-lg);padding:var(--s-md);box-shadow:0 8px 30px rgba(0,0,0,.18);display:flex;flex-direction:column;gap:var(--s-sm)}
.cpsheet p{margin:0;font-size:14px;color:var(--ink-muted-80)}
.cpsheet textarea{font:400 17px/1.4 var(--font);border:1px solid var(--primary);border-radius:var(--r-sm);padding:10px;min-height:64px;-webkit-user-select:text;user-select:text}
.util{background:var(--ink);color:#fff;border:0;border-radius:var(--r-sm);padding:8px 15px}
.sec{background:transparent;color:var(--primary);border:1px solid var(--primary);border-radius:var(--r-pill);padding:8px 15px}
.empty{color:var(--ink-muted-48);margin:0}
.failrow{display:flex;gap:var(--s-sm);align-items:flex-start}.fbody{flex:1;min-width:0}
.thumb{width:64px;height:139px;object-fit:cover;object-position:top;border-radius:var(--r-sm);border:1px solid var(--hairline);display:block}
.retry{display:flex;gap:var(--s-xs);margin-top:var(--s-xs)}
.retry input{flex:1;min-width:0;max-width:200px;height:44px;padding:0 var(--s-md);border:1px solid rgba(0,0,0,.08);border-radius:var(--r-pill);font:inherit;background:#fff}
.ex-add{display:flex;gap:var(--s-xs);margin-bottom:var(--s-sm)}
.ex-add input{flex:1;min-width:0;height:44px;padding:0 var(--s-md);border:1px solid rgba(0,0,0,.08);border-radius:var(--r-pill);font:inherit;background:#fff}
.chips{display:flex;flex-wrap:wrap;gap:var(--s-xs)}
.chip{display:inline-flex;align-items:center;gap:6px;background:#fff;border:1px solid var(--hairline);border-radius:var(--r-pill);padding:6px 8px 6px 16px;font-size:14px;margin:0}
.chip button{border:0;background:transparent;color:var(--primary);font:inherit;cursor:pointer;min-height:32px;padding:0 8px}
.failed td{padding:var(--s-xs) 0;border-top:1px solid var(--divider-soft);font-size:14px;vertical-align:top;word-break:break-all}
.failed{width:100%;border-collapse:collapse}
.tabs{display:flex;gap:4px}.tabs a{font-size:14px;color:var(--ink-muted-80);text-decoration:none;padding:6px 14px;border-radius:var(--r-pill)}
.tabs a.on{background:var(--ink);color:#fff}
.tools{display:flex;flex-direction:column;gap:var(--s-sm)}
.search{height:44px;padding:0 var(--s-md);border:1px solid rgba(0,0,0,.08);border-radius:var(--r-pill);font:inherit;background:#fff;width:100%}
.seg{display:inline-flex;background:var(--divider-soft);border-radius:var(--r-pill);padding:3px;gap:2px;flex-wrap:wrap}
.seg button{border:0;background:transparent;font:400 14px/1 var(--font);padding:10px 14px;border-radius:var(--r-pill);cursor:pointer;color:var(--ink-muted-80);min-height:36px}
.seg button.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.gens{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;-webkit-overflow-scrolling:touch}
.gens button{flex:none;border:1px solid var(--hairline);background:#fff;border-radius:var(--r-pill);font:400 14px/1 var(--font);padding:9px 12px;cursor:pointer;min-height:36px}
.gens button b{color:var(--primary);margin-right:4px}
.gens button:disabled{opacity:.35;cursor:default}
.genh{font-size:14px;font-weight:600;color:var(--ink-muted-48);margin:var(--s-lg) 0 var(--s-xs);scroll-margin-top:64px}
.mon{display:flex;gap:var(--s-sm);padding:var(--s-sm) 0;border-top:1px solid var(--divider-soft)}
.mon:first-child{border-top:0}
.spr{flex:none;width:96px;height:96px;margin:-8px -4px -8px -8px;image-rendering:pixelated;background:var(--canvas-parchment);border-radius:var(--r-sm)}
.mbody{flex:1;min-width:0}
.sprs{flex:none;display:flex;flex-direction:column;align-items:center}
.evo{font-size:20px;line-height:1;color:var(--ink-muted-48);margin:6px 0 2px}
.spr.next{width:72px;height:72px;margin:0;filter:grayscale(1);opacity:.4}
.mon.top .spr.next{box-shadow:none}
.tags{display:inline-flex;gap:4px;flex-wrap:wrap}
.tag{font-size:12px;line-height:1;padding:4px 8px;border-radius:var(--r-pill);background:var(--divider-soft);color:var(--ink-muted-80)}
.tag.keep{background:#e8f5ec;color:#1b7a3a}.tag.trade{background:#eef0ff;color:var(--primary)}.tag.transfer{background:#fdecec;color:#b42318}
.tag.elite{background:#fff4e0;color:#9a5b00}
.facts{margin:6px 0 0;padding:0;list-style:none;font-size:14px;line-height:1.45;letter-spacing:-0.224px;color:var(--ink-muted-80)}
.facts b{font-weight:600;color:var(--ink)}
.ok{color:#1b7a3a}.short{color:#b42318}
.filt{border:1px solid var(--primary);background:transparent;color:var(--primary);border-radius:var(--r-pill);font:400 14px/1 var(--font);padding:10px 16px;cursor:pointer;min-height:36px}
.filt[aria-pressed=true]{background:var(--primary);color:#fff}
.count2{font-size:14px;color:var(--ink-muted-48);margin:0}
.acts.stack{flex-direction:column;align-items:flex-start}
.del{flex:none;align-self:center;width:32px;height:32px;border:0;border-radius:var(--r-pill);background:transparent;color:var(--ink-muted-48);font:400 22px/1 var(--font);cursor:pointer;margin-left:auto}
.del:hover{background:#fdecec;color:#b42318}
.who .meta{margin-left:auto}.who .del{margin-left:0}
.more{margin-top:6px}.more summary{font-size:14px;letter-spacing:-0.224px;color:var(--ink-muted-48);cursor:pointer;list-style-position:outside}
.more[open] summary{color:var(--ink)}.more .facts{margin-top:4px}
.edit{border:0;border-bottom:1px dashed var(--primary);background:transparent;color:var(--primary);font:inherit;padding:0 2px;cursor:pointer;min-height:28px}
.editin{width:90px;height:32px;padding:0 10px;border:1px solid var(--primary);border-radius:var(--r-sm);font:inherit;background:#fff}
.mv{border:1px solid var(--hairline);background:#fff;color:var(--ink-muted-80);border-radius:var(--r-pill);font:400 12px/1 var(--font);padding:6px 10px;cursor:pointer;min-height:28px;margin-left:4px}
.mv[aria-pressed=true]{background:#e8f5ec;border-color:#e8f5ec;color:#1b7a3a}
.tag.go{background:#e8f5ec;color:#1b7a3a}
.viewseg{margin-bottom:var(--s-lg)}
.fold>summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between}
.fold>summary::-webkit-details-marker{display:none}
.fold>summary h2{margin:0}
.fold>summary::after{content:'';width:10px;height:10px;border-right:2px solid var(--ink-muted-48);border-bottom:2px solid var(--ink-muted-48);transform:rotate(45deg);margin:-4px 6px 0}
.fold[open]>summary::after{transform:rotate(225deg);margin-top:6px}
.fold[open]>summary{margin-bottom:var(--s-sm)}
.row.top .util,.mon.top .util,.mon.top .spr{box-shadow:0 0 0 2px var(--canvas),0 0 0 4px var(--primary)}
.alertcard{border:2px solid var(--primary);background:#f3f3ff}
.alertcard h2{color:var(--primary)}
.copy.big{font-size:17px;padding:11px 20px;min-height:44px;background:var(--primary);color:#fff}
.tag.alert{background:var(--primary);color:#fff}
.row.oldbest{background:#f3f3ff;margin:0 calc(-1*var(--s-sm));padding-left:var(--s-sm);padding-right:var(--s-sm);border-radius:var(--r-sm)}
.dexkinds{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px}
.dexkinds button{flex:none;border:1px solid var(--hairline);background:#fff;border-radius:var(--r-pill);font:400 14px/1 var(--font);padding:10px 14px;cursor:pointer;min-height:36px}
.dexkinds button.on{background:var(--ink);border-color:var(--ink);color:#fff}
.dexgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px}
.tile{position:relative;aspect-ratio:1;border:1px solid var(--hairline);border-radius:var(--r-sm);background:#fff;cursor:pointer;padding:0;font:600 13px/1 var(--font);color:var(--ink-muted-48)}
.tile img{width:100%;height:100%;image-rendering:pixelated}
.tile span{position:absolute;left:4px;bottom:3px;font-size:10px;font-weight:400}
.tile.unknown{opacity:.45}
.tile.missing{border:1px dashed #c8c8c8;background:#fafafa}
.tile.missing img{filter:grayscale(1);opacity:.3}
.tile.have{background:var(--canvas-parchment)}
.frow{display:flex;flex-wrap:wrap;gap:var(--s-xs)}
.inv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--s-xs)}
.inv label{font-size:12px;color:var(--ink-muted-48);display:flex;flex-direction:column;gap:4px}
.inv input{height:44px;padding:0 var(--s-sm);border:1px solid rgba(0,0,0,.08);border-radius:var(--r-pill);font:inherit;background:#fff;width:100%;min-width:0}
.pl{margin:var(--s-sm) 0 6px;font-size:14px}.names{display:flex;flex-wrap:wrap;gap:6px}
.jump.new{border-color:var(--primary);box-shadow:0 0 0 1px var(--primary)}
.lgh{margin:var(--s-sm) 0 6px;font-size:13px;font-weight:600;color:var(--ink-muted-48);text-transform:uppercase;letter-spacing:.04em}
#plann{font-weight:400;font-size:14px;color:var(--ink-muted-48);margin-left:8px}
.jump{border:1px solid var(--hairline);background:#fff;border-radius:var(--r-pill);font:400 14px/1 var(--font);padding:8px 12px;cursor:pointer;min-height:32px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:#fff;border-radius:var(--r-pill);padding:10px 12px 10px 20px;font-size:14px;display:flex;gap:12px;align-items:center;z-index:9}
.toast button{border:0;background:#fff;color:var(--ink);border-radius:var(--r-pill);padding:6px 14px;font:inherit;cursor:pointer}
.tabs a.gear{font-size:17px;padding:4px 10px}
.hold{position:relative;overflow:hidden;width:100%;min-height:52px;margin-top:var(--s-sm);border:1px solid #b42318;border-radius:var(--r-pill);background:#fff;color:#b42318;font:600 17px/1 var(--font);cursor:pointer;
-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none}
.hold .fill{position:absolute;inset:0;width:0;background:#b42318}
.hold.on .fill{width:100%;transition:width 3s linear}
.hold .lbl{position:relative}
.hold.on .lbl{color:#fff;text-shadow:0 0 3px #b42318,0 0 6px #b42318}
.hold:active{transform:none}
.mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px}
.mtile{position:relative;display:flex;flex-direction:column;align-items:center;border:1px solid var(--hairline);border-radius:var(--r-sm);background:#fff;padding:4px 0 0;cursor:pointer;overflow:hidden;font:inherit;color:inherit;min-width:0}
.mtile img{width:72px;height:72px;image-rendering:pixelated}
.mtile .tn{font-size:11px;line-height:1.2;color:var(--ink-muted-80);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;padding:0 4px 5px}
.mtile .tr{position:absolute;top:3px;right:5px;font-size:11px;font-weight:600;color:var(--primary)}
.mtile .td{position:absolute;top:3px;left:5px;font-size:10px;color:var(--ink-muted-48)}
.lbar{display:flex;width:100%;height:10px;border-top:1px solid var(--divider-soft)}
.lbar i{flex:1;border-left:1px solid var(--divider-soft)}.lbar i:first-child{border-left:0}
.lbar i.built,.sw.built{background:var(--c)}
.lbar i.have,.sw.have{background:repeating-linear-gradient(180deg,var(--c) 0 2px,transparent 2px 4px)}
.lg-little{--c:#f2c230}.lg-great{--c:#a9aeb8}.lg-ultra{--c:#1d1d1f}.lg-master{--c:#2e9e5b}
.legend{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--ink-muted-48);margin:0 0 var(--s-sm)}
.legend span{display:inline-flex;align-items:center;gap:5px}
.sw{display:inline-block;flex:none;width:28px;height:12px;border:1px solid var(--hairline);border-radius:3px}
.dhead{display:flex;align-items:center;gap:var(--s-sm);margin-bottom:var(--s-sm)}
.dhead img{width:96px;height:96px;image-rendering:pixelated;background:var(--canvas-parchment);border-radius:var(--r-sm)}
.dhead h2{margin:0}
.lrows{list-style:none;margin:0 0 var(--s-md);padding:0;font-size:14px}
.lrows li{display:flex;align-items:center;gap:var(--s-xs);padding:6px 0;border-top:1px solid var(--divider-soft)}
.lrows li:first-child{border-top:0}.lrows b{width:64px;flex:none}.lrows b+span{white-space:nowrap}.lrows .meta{margin-left:auto;text-align:right}
.back{border:0;background:transparent;color:var(--primary);font:400 17px/1 var(--font);padding:10px 0;cursor:pointer;min-height:44px;margin-bottom:4px}
[data-only][hidden]{display:none!important}
body.detail .tools,body.detail #plan{display:none}
.support a{color:var(--primary);text-decoration:none}.support a:hover{text-decoration:underline}
a.btn{text-decoration:none}
footer{font-size:12px;line-height:1.5;letter-spacing:-0.12px;color:var(--ink-muted-48);text-align:center;margin-top:var(--s-xl)}
`;

const nav = (on: 'scan' | 'collection' | 'pokedex' | 'settings') =>
  `<header class="bar"><button class="brand" onclick="location.reload()" title="Tap to refresh" aria-label="Lilycove Co, tap to refresh">Lilycove Co</button><nav class="tabs"><a href="/"${on === 'scan' ? ' class="on" aria-current="page"' : ''}>Scan</a>` +
  `<a href="/collection"${on === 'collection' ? ' class="on" aria-current="page"' : ''}>Collection</a>` +
  `<a href="/pokedex"${on === 'pokedex' ? ' class="on" aria-current="page"' : ''}>Pokédex</a>` +
  `<a href="/settings" class="gear${on === 'settings' ? ' on" aria-current="page' : ''}" aria-label="Settings" title="Settings">⚙︎</a></nav></header>`;

const head = (title: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600&display=swap">
<style>${STYLE}</style></head><body>`;

function homePage(store: Store, uploadDir: string, collection?: Collection, dataInfo?: ServerOptions['dataInfo']): string {
  const kept = collection ? keepers(store, collection) : undefined;
  const recent = store.list(20).map((s) =>
    `<li class="row"><div class="who"><span class="sp">${esc(s.species)}</span><span class="meta">${s.atk}/${s.def}/${s.sta} · CP ${esc(s.cp)}</span></div><p class="why">${esc(s.name)}</p></li>`).join('');
  const body = collection ? listsHtml(collection, store) : `<section class="card"><h2>Recent</h2>${recent ? `<ul class="list">${recent}</ul>` : '<p class="empty">No scans yet.</p>'}</section>`;
  const failed = store.failed(50).map((f) => {
    const kept = !!f.file && existsSync(f.file);
    return `<li class="row failrow" data-frow="${f.id}">${kept ? `<a href="/failed-image/${f.id}" target="_blank"><img class="thumb" src="/failed-image/${f.id}" alt="Failed screenshot" loading="lazy"></a>` : ''}<div class="fbody"><div class="who"><span class="sp">${esc(f.reason)}</span><span class="meta">${esc(f.failedAt.slice(5, 16))}</span><button class="del" data-delf="${f.id}" aria-label="Delete failed scan" title="Delete">×</button></div>` +
      `<p class="why">${esc((f.file ?? '').split('/').pop())}</p>` +
      (kept ? `<form class="retry" data-id="${f.id}"><input name="cp" inputmode="numeric" pattern="[0-9]*" placeholder="Type the CP" aria-label="CP" required><button class="btn pri">Retry</button></form>`
        : '<p class="why">Image deleted, scan it again</p>') + '</div></li>';
  }).join('');
  const count = store.count();
  return `${head('Lilycove Co')}
${nav('scan')}
<main>
<section class="hero">
<p class="label">Pokémon scanned</p>
<p class="count" aria-label="Pokémon scanned: ${count}">${count}</p>
<div class="btns">
<label class="btn pri" id="up">Add screenshots<input type="file" name="f" accept="image/*" multiple></label>
<label class="btn sec2" id="vid">Add screen recording<input type="file" name="v" accept="video/*"></label>
</div>
<progress id="bar" max="1" value="0" hidden></progress>
<p id="msg" aria-live="polite"></p>
</section>
${body}
<section class="card"><h2>Never transfer</h2>
<form method="post" action="/exceptions" class="ex-add"><input name="species" placeholder="Species, e.g. Magikarp" required aria-label="Species"><input type="hidden" name="action" value="add"><button class="btn pri">Add</button></form>
<div class="chips">${store.exceptions().map((sp) => `<form method="post" action="/exceptions" class="chip">${esc(sp)}<input type="hidden" name="species" value="${esc(sp)}"><input type="hidden" name="action" value="remove"><button aria-label="Remove ${esc(sp)}">Remove</button></form>`).join('')}</div>
</section>
<section class="card"><h2>Failed scans</h2>
${failed ? `<p class="why">CP hidden or misread? Type it in and retry.</p><ul class="list">${failed}</ul>` : '<p class="empty">None.</p>'}
</section>
<footer>${dataInfo ? (() => { const d = dataInfo(); return `PvPoke data: ${esc(d.pvpokeDate)} · downloaded ${esc(d.downloadedAt.slice(0, 16).replace('T', ' '))} UTC · `; })() : ''}Uploads: ${formatBytes(uploadsSize(uploadDir))}</footer>
${SUPPORT}</main>
<script id="data" type="application/json">${pageJson(kept ?? null)}</script>
<script>${SHARED_JS}
let DATA = JSON.parse(document.getElementById('data').textContent);
// Collapsed build facts under each kept Pokémon.
function refresh(d) {
  if (d) DATA = d;
  if (!DATA) return;
  PLAN = DATA.plan;
  const by = new Map(DATA.entries.map((e) => [e.id, e]));
  document.querySelectorAll('details.more').forEach((el) => {
    const e = by.get(Number(el.dataset.id)); if (!e) return;
    el.querySelector('summary').innerHTML = summary(e);
    el.querySelector('.facts').innerHTML = factsHtml(e);
  });
}
refresh();
// Recent vs Keep/Trade/Transfer, and which lists are open: remembered on this device.
const mem = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
function setView(v) {
  document.querySelectorAll('[data-view]').forEach((el) => (el.hidden = el.dataset.view !== v));
  document.querySelectorAll('#view button').forEach((b) => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', String(b.dataset.v === v)); });
  mem.set('scanView', v);
}
const viewSeg = document.getElementById('view');
if (viewSeg) {
  viewSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); });
  setView(mem.get('scanView') === 'lists' ? 'lists' : 'recent');
  document.querySelectorAll('details.fold').forEach((d) => {
    d.open = mem.get('fold-' + d.dataset.fold) === '1';
    d.addEventListener('toggle', () => mem.set('fold-' + d.dataset.fold, d.open ? '1' : '0'));
  });
}
// X: hide the scan right away; Undo for a few seconds; lists refresh once you stop deleting.
let reloadTimer, toast;
function showToast(text, undo) {
  toast?.remove();
  toast = document.createElement('div'); toast.className = 'toast'; toast.setAttribute('role', 'status');
  toast.innerHTML = '<span></span>' + (undo ? '<button>Undo</button>' : '');
  toast.firstChild.textContent = text;
  if (undo) toast.querySelector('button').onclick = undo;
  document.body.append(toast);
  clearTimeout(reloadTimer); reloadTimer = setTimeout(() => location.reload(), 8000);
}
document.addEventListener('click', async (e) => {
  const x = e.target.closest('[data-dismiss]');
  if (x) { await fetch('/api/replaced/' + x.dataset.dismiss + '/dismiss', { method: 'POST' }); x.closest('.row').remove(); if (!document.querySelector('.alertcard .row')) document.querySelector('.alertcard')?.remove(); return; }
  const d = e.target.closest('.del'); if (!d) return;
  if (d.dataset.del) {
    const id = d.dataset.del;
    await fetch('/api/scans/' + id + '/delete', { method: 'POST' });
    d.closest('.row').remove();
    showToast('Deleted ' + d.dataset.sp, async () => { await fetch('/api/scans/' + id + '/restore', { method: 'POST' }); location.reload(); });
  } else if (d.dataset.delf) {
    await fetch('/api/failed/' + d.dataset.delf + '/delete', { method: 'POST' });
    d.closest('.row').remove();
    showToast('Failed scan deleted');
  }
});
document.addEventListener('submit', async (e) => {
  const f = e.target.closest('.retry'); if (!f) return;
  e.preventDefault();
  const msg = document.getElementById('msg'), cp = f.cp.value.trim();
  msg.textContent = 'Retrying with CP ' + cp + '…';
  const r = await (await fetch('/retry?id=' + f.dataset.id + '&cp=' + encodeURIComponent(cp), { method: 'POST' })).json();
  if (r.ok) { msg.textContent = [r.verdict?.toUpperCase(), r.scan.species, r.scan.name, r.beats].filter(Boolean).join(' '); setTimeout(() => location.reload(), 1200); }
  else { msg.textContent = 'Failed: ' + r.reason; msg.scrollIntoView({ block: 'center' }); }
});
document.querySelector('#up input').onchange = async (e) => {
  const msg = document.getElementById('msg');
  for (const file of e.target.files) {
    msg.textContent = 'Reading ' + file.name + '…';
    const r = await (await fetch('/scan?name=' + encodeURIComponent(file.name), { method: 'POST', body: file })).json();
    msg.textContent = r.ok ? [r.verdict?.toUpperCase(), r.scan.species, r.scan.name, r.beats, ...(r.replaced || []).map((o) => 'get rid of old: ' + o.search)].filter(Boolean).join(' ') : 'Failed: ' + r.reason;
  }
  location.reload();
};
document.querySelector('#vid input').onchange = async (e) => {
  const file = e.target.files[0]; if (!file) return;
  const msg = document.getElementById('msg'), bar = document.getElementById('bar');
  msg.textContent = 'Uploading ' + file.name + '…'; bar.hidden = false; bar.removeAttribute('value');
  const { job } = await (await fetch('/video?name=' + encodeURIComponent(file.name), { method: 'POST', body: file })).json();
  for (;;) {
    const s = await (await fetch('/video/' + job)).json();
    if (s.total) { bar.max = s.total; bar.value = s.processed; msg.textContent = 'Pokémon ' + s.processed + ' of ' + s.total + (s.failed ? ' (' + s.failed + ' failed)' : ''); }
    else msg.textContent = 'Finding Pokémon in the video…';
    if (s.done) { msg.textContent = s.error ? 'Video failed: ' + s.error : 'Done: ' + s.processed + ' Pokémon, ' + s.failed + ' failed'; break; }
    await new Promise((r) => setTimeout(r, 700));
  }
  setTimeout(() => location.reload(), 1200);
};
</script>
</body></html>`;
}

// Collection tab: Pokémon on the Keep list, with sprite, PvP rank, build cost, moves, candy + the dust/Elite TM planner.
// Filters/sorting/search/jump run in the page. session = start of "this session" (ms) or null when nothing was uploaded in it yet.
function collectionPage(data: Keepers, session: number | null): string {
  const gens = JSON.stringify(GENERATIONS);
  const seg = (f: string, label: string, opts: [string, string][]) =>
    `<div class="seg" data-f="${f}" role="group" aria-label="${label}">${opts.map(([v, t], i) => `<button data-v="${v}"${i ? '' : ' class="on"'} aria-pressed="${!i}">${t}</button>`).join('')}</div>`;
  return `${head('Collection · Lilycove Co')}
${nav('collection')}
<main>
<section class="card tools">
<div class="seg" id="mode" role="group" aria-label="View"><button data-m="list" class="on" aria-pressed="true">List</button><button data-m="grid" aria-pressed="false">Grid</button></div>
<div class="frow">${seg('when', 'When scanned', [['all', 'All'], ['session', 'This session']])}${seg('kind', 'Which', [['all', 'All'], ['pvp', 'PvP']])}</div>
${seg('build', 'Build', [['all', 'Any build'], ['built', 'Fully built'], ['moves', 'Built, moves left']])}
<input class="search" id="q" type="search" placeholder="Search species" aria-label="Search species" autocomplete="off">
<div class="frow" id="rankf" data-only="grid" hidden>
<div class="seg" id="rlg" role="group" aria-label="PvPoke rank in"><button data-lg="any" class="on">Any league</button><button data-lg="little">Little</button><button data-lg="great">Great</button><button data-lg="ultra">Ultra</button><button data-lg="master">Master</button></div>
<div class="seg" id="rtop" role="group" aria-label="PvPoke rank"><button data-top="0" class="on">Any rank</button><button data-top="10">Top 10</button><button data-top="25">Top 25</button><button data-top="50">Top 50</button><button data-top="100">Top 100</button></div>
</div>
<div class="seg" id="sort" data-only="list" role="group" aria-label="Sort">
<button data-sort="dex" class="on">Pokédex</button><button data-sort="recent">Recent</button><button data-sort="dust">Dust needed</button><button data-sort="dustnoelite">Dust, no Elite TM / Shadow</button><button data-sort="meta">PvPoke rank</button>
</div>
<div class="gens" id="gens" aria-label="Jump to generation"></div>
<p class="count2" id="n"></p>
</section>
<details class="card fold" id="plan"><summary><h2>What can I build?<span class="count2" id="plann"></span></h2></summary>
<div class="inv">
<label>Stardust<input id="dust" inputmode="numeric" autocomplete="off" placeholder="e.g. 1.2m"></label>
<label>Elite Fast TMs<input id="fastTm" inputmode="numeric" autocomplete="off" placeholder="0"></label>
<label>Elite Charged TMs<input id="chargedTm" inputmode="numeric" autocomplete="off" placeholder="0"></label>
</div>
<div id="planout"></div>
</details>
<section class="card" id="list"></section>
${SUPPORT}</main>
<script id="data" type="application/json">${pageJson(data)}</script>
<script>${SHARED_JS}
let DATA = JSON.parse(document.getElementById('data').textContent), all = DATA.entries;
const GENS = ${gens}, SESSION = ${session ?? 'null'};
const F = { when: 'all', kind: 'all', build: 'all' };
let sort = 'dex', desc = false;
PLAN = DATA.plan;
// List / Grid view (Ben, 2026-11-24). Grid = one tile per species, bottom bar = Little / Great / Ultra / Master.
const mem = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const LG = ['little', 'great', 'ultra', 'master'], LGNAME = { little: 'Little Cup', great: 'Great League', ultra: 'Ultra League', master: 'Master League' };
let MODE = mem.get('colMode') === 'grid' ? 'grid' : 'list', RLG = 'any', RTOP = 0, pushed = false;
// Merge each Pokémon's grid spots into species tiles. built beats have.
function tilesOf(list) {
  const m = new Map();
  for (const e of list) for (const s of e.grid || []) {
    let t = m.get(s.name);
    if (!t) m.set(s.name, t = { key: s.name, name: s.name, id: s.id, dex: s.dex, pvpoke: s.pvpoke || {}, lg: {}, ids: [] });
    if (!t.ids.includes(e.id)) t.ids.push(e.id);
    if (s.league) t.lg[s.league] = t.lg[s.league] === 'built' || s.built ? 'built' : 'have';
  }
  return [...m.values()].sort((a, b) => a.dex - b.dex || a.name.localeCompare(b.name));
}
const bestRank = (t) => { const v = RLG === 'any' ? Object.values(t.pvpoke) : [t.pvpoke[RLG]]; const n = v.filter((x) => x).sort((a, b) => a - b)[0]; return n; };
const lbar = (t) => '<span class="lbar" aria-hidden="true">' + LG.map((l) => '<i class="lg-' + l + (t.lg[l] ? ' ' + t.lg[l] : '') + '"></i>').join('') + '</span>';
const stateWord = (st) => st === 'built' ? 'built' : st === 'have' ? 'have one, not built' : 'no build';
function tileHtml(t) {
  const r = RTOP ? bestRank(t) : undefined;
  const label = '#' + t.dex + ' ' + t.name + ': ' + LG.map((l) => LGNAME[l] + ' ' + stateWord(t.lg[l])).join(', ');
  return '<button class="mtile" data-tile="' + esc(t.key) + '" title="' + esc(label) + '" aria-label="' + esc(label) + '"><span class="td">' + t.dex + '</span>' + (r ? '<span class="tr">#' + r + '</span>' : '') +
    '<img src="/sprite/' + encodeURIComponent(t.id) + '?dex=' + t.dex + '" alt="" loading="lazy" onerror="this.style.visibility=\\'hidden\\'"><span class="tn">' + esc(t.name) + '</span>' + lbar(t) + '</button>';
}
const LEGEND = '<p class="legend">' + LG.map((l) => '<span><i class="sw lg-' + l + ' built"></i>' + LGNAME[l].split(' ')[0] + '</span>').join('') + '<span><i class="sw lg-great have"></i>striped = have one, not built</span><span><i class="sw"></i>empty = none</span></p>';
function gridHtml(list) {
  let ts = tilesOf(list);
  if (RTOP) ts = ts.filter((t) => { const r = bestRank(t); return r && r <= RTOP; });
  let html = LEGEND, gen = 0, open = false;
  for (const t of ts) {
    const g = [...GENS].reverse().find((x) => t.dex >= x.first) || GENS[0];
    if (g.n !== gen) { if (open) html += '</div>'; gen = g.n; html += '<h3 class="genh" id="gen' + gen + '">' + gen + ' ' + g.region + '</h3><div class="mgrid">'; open = true; }
    html += tileHtml(t);
  }
  if (open) html += '</div>';
  return { html: ts.length ? html : '<p class="empty">' + (all.length ? 'No match.' : 'No Pokémon saved yet.') + '</p>', n: ts.length, gens: new Set(ts.map((t) => ([...GENS].reverse().find((x) => t.dex >= x.first) || GENS[0]).n)) };
}
// Tap a tile: its league rows (built / not built / none + PvPoke place) and the list cards for every Pokémon on it.
function detailHtml(key) {
  const t = tilesOf(all).find((x) => x.key === key);
  if (!t) return '<button class="back" data-back>‹ Grid</button><p class="empty">Not in your collection any more.</p>';
  const rows = LG.map((l) => '<li><i class="sw lg-' + l + (t.lg[l] ? ' ' + t.lg[l] : '') + '"></i><b>' + LGNAME[l].split(' ')[0] + '</b><span>' + stateWord(t.lg[l]) + '</span><span class="meta">' + (t.pvpoke[l] ? 'PvPoke #' + t.pvpoke[l] : 'not in PvPoke rankings') + '</span></li>').join('');
  const mons = all.filter((e) => t.ids.includes(e.id));
  return '<button class="back" data-back>‹ Grid</button><div class="dhead"><img src="/sprite/' + encodeURIComponent(t.id) + '?dex=' + t.dex + '" alt=""><div><h2>' + esc(t.name) + '</h2><p class="meta" style="margin:0">#' + t.dex + ' · ' + mons.length + ' saved</p></div></div>' +
    '<ul class="lrows">' + rows + '</ul>' + mons.map(card).join('');
}
const tileFromHash = () => { const m = location.hash.match(/^#tile=(.+)$/); return m ? decodeURIComponent(m[1]) : null; };
function setMode(m) {
  MODE = m; mem.set('colMode', m);
  document.querySelectorAll('#mode button').forEach((b) => { b.classList.toggle('on', b.dataset.m === m); b.setAttribute('aria-pressed', String(b.dataset.m === m)); });
  document.querySelectorAll('[data-only]').forEach((el) => (el.hidden = el.dataset.only !== m));
}

function card(e) {
  const ivs = e.ivs.atk + '/' + e.ivs.def + '/' + e.ivs.sta;
  const tags = '<span class="tag ' + e.verdict + '">' + e.verdict + '</span>' + (e.shadow ? '<span class="tag">shadow</span>' : '') + (e.lucky ? '<span class="tag">lucky</span>' : '') + buildTag(e) + planTags(e);
  // Needs to evolve for its build: arrow down to the target stage, greyed out until it's evolved.
  const evo = e.build && !e.build.stageDone ? '<span class="evo" aria-hidden="true">↓</span><img class="spr next" src="/sprite/' + encodeURIComponent(e.build.targetId) + '?dex=' + e.build.targetDex + '" alt="Evolve to ' + esc(e.build.target) + '" title="Evolve to ' + esc(e.build.target) + '" loading="lazy">' : '';
  return '<article class="mon' + (e.slot && e.slot.rank < 10 ? ' top' : '') + '" id="mon-' + e.id + '" data-gen="' + e.gen.n + '"><div class="sprs"><img class="spr" src="/sprite/' + encodeURIComponent(e.speciesId) + '?dex=' + e.dex + '" alt="" loading="lazy" onerror="this.style.visibility=\\'hidden\\'">' + evo + '</div>' +
    '<div class="mbody"><div class="who"><span class="sp">' + esc(e.species) + ' <span class="meta">#' + e.dex + '</span></span><span class="tags">' + tags + '</span></div>' +
    '<p class="meta" style="margin:2px 0 0">' + ivs + ' · CP ' + num(e.cp) + ' · L' + e.level + '</p>' +
    '<div class="acts stack">' + copyBtn(e.search, 'sec', 'Copy search') + (e.name ? copyBtn(e.name, 'util', 'Copy rename') : '') + '</div>' +
    '<ul class="facts">' + factsHtml(e) + '</ul></div></article>';
}
function render() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const elite = (e) => !!e.build && e.build.moves.some((m) => m.elite);
  let list = all.filter((e) => (!q || e.species.toLowerCase().includes(q))
    && (F.when === 'all' || (SESSION !== null && e.scannedAt >= SESSION))
    && (F.kind === 'all' || !!e.slot)
    && (F.build === 'all' || (!!e.build && e.build.built && (F.build === 'built' ? e.movesDone : !e.movesDone)))
    && !(sort === 'dustnoelite' && (elite(e) || e.shadow)));
  // Pokémon without a build / PvPoke rank always go last, whichever direction.
  const by = (key) => (a, b) => { const x = key(a), y = key(b); return (x === undefined) - (y === undefined) || (desc ? y - x : x - y) || a.dex - b.dex; };
  if (sort === 'dex') list.sort((a, b) => a.dex - b.dex || a.species.localeCompare(b.species) || b.id - a.id);
  if (sort === 'recent') list.sort((a, b) => b.id - a.id);
  if (sort === 'dust' || sort === 'dustnoelite') list.sort(by((e) => e.build?.total.dust));
  if (sort === 'meta') list.sort(by((e) => e.build?.metaRank));
  if (desc && (sort === 'dex' || sort === 'recent')) list.reverse();
  const key = MODE === 'grid' ? tileFromHash() : null;
  document.body.classList.toggle('detail', !!key);
  if (MODE === 'grid') {
    const since = F.when === 'session' ? (SESSION === null ? ' · nothing scanned this session yet' : ' · since ' + new Date(SESSION).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : '';
    if (key) { document.getElementById('list').innerHTML = detailHtml(key); document.getElementById('n').textContent = ''; document.getElementById('gens').innerHTML = ''; return; }
    const g = gridHtml(list);
    document.getElementById('list').innerHTML = g.html;
    document.getElementById('n').textContent = g.n + ' Pokémon' + since + (RTOP ? ' · PvPoke top ' + RTOP + (RLG === 'any' ? ' in any league' : ' in ' + LGNAME[RLG]) : '');
    document.getElementById('gens').innerHTML = GENS.map((x) => '<button data-gen="' + x.n + '"' + (g.gens.has(x.n) ? '' : ' disabled') + '><b>' + x.n + '</b>' + x.region + '</button>').join('');
    return;
  }
  let html = '', gen = 0;
  for (const e of list) {
    if (sort === 'dex' && e.gen.n !== gen) { gen = e.gen.n; html += '<h3 class="genh" id="gen' + gen + '">' + gen + ' ' + e.gen.region + '</h3>'; }
    html += card(e);
  }
  document.getElementById('list').innerHTML = html || '<p class="empty">' + (all.length ? 'No match.' : 'No Pokémon saved yet.') + '</p>';
  const order = { dust: ['least dust first', 'most dust first'], dustnoelite: ['least dust first, no Elite TM or Shadow', 'most dust first, no Elite TM or Shadow'], meta: ['best PvPoke rank first', 'worst PvPoke rank first'] }[sort];
  const since = F.when === 'session' ? (SESSION === null ? ' · nothing scanned this session yet' : ' · since ' + new Date(SESSION).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })) : '';
  document.getElementById('n').textContent = list.length + ' kept Pokémon' + since + (order ? ' · ' + order[desc ? 1 : 0] + ' (tap again to flip)' : '');
  const have = new Set(list.map((e) => e.gen.n));
  document.getElementById('gens').innerHTML = GENS.map((g) => '<button data-gen="' + g.n + '"' + (have.has(g.n) ? '' : ' disabled') + '><b>' + g.n + '</b>' + g.region + '</button>').join('');
}
function renderPlan() {
  const p = PLAN, inv = DATA.inventory, by = new Map(all.map((e) => [e.id, e]));
  // Blue ring = a typing you don't have fully built in that league yet.
  const fresh = new Set(p.newTyping || []);
  const names = (ids, hl) => '<div class="names">' + ids.map((id) => { const e = by.get(id), b = e?.build; return e ? '<button class="jump' + (hl && fresh.has(id) ? ' new' : '') + '" data-id="' + id + '"' + (b?.types?.length ? ' title="' + esc(b.types.join('/')) + '"' : '') + '>' + esc(e.species) + (b ? ' ' + L[b.league] + b.ivRank + (b.metaRank ? ' · #' + b.metaRank + ' meta' : '') + ' · ' + short(b.total.dust) : '') + '</button>' : ''; }).join('') + '</div>';
  let h = '';
  if (!inv.dust) h += '<p class="pl">Type your stardust to see what you can build.</p>';
  else {
    h += '<p class="pl"><b>Can build ' + p.build.length + '</b> · uses ' + num(p.dustUsed) + ' of ' + num(inv.dust) + ' dust (' + num(p.dustLeft) + ' left) · best PvPoke rank first' + (fresh.size ? ' · <span style="color:var(--primary)">blue</span> = typing not fully built yet' : '') + '</p>';
    for (const lg of ['great', 'ultra', 'little']) {
      const ids = p.build.filter((id) => by.get(id)?.build?.league === lg);
      if (ids.length) h += '<h3 class="lgh">' + (lg === 'little' ? 'Little Cup' : LEAGUE[lg] + ' League') + ' (' + ids.length + ')</h3>' + names(ids, true);
    }
  }
  document.getElementById('plann').textContent = inv.dust ? '· ' + p.build.length + ' to build' : '';
  if (p.candyUnknown.length) h += '<p class="why">Candy count not known for ' + [...new Set(p.candyUnknown.map((id) => by.get(id)?.species))].map(esc).join(', ') + '. Tap "tap to type" on its card.</p>';
  if (inv.fastTm) h += '<p class="pl"><b>Elite Fast TM (' + inv.fastTm + ')</b> → ' + (p.fastTm.length ? '' : 'none of your PvP Pokémon need one') + '</p>' + (p.fastTm.length ? names(p.fastTm) : '');
  if (inv.chargedTm) h += '<p class="pl"><b>Elite Charged TM (' + inv.chargedTm + ')</b> → ' + (p.chargedTm.length ? '' : 'none of your PvP Pokémon need one') + '</p>' + (p.chargedTm.length ? names(p.chargedTm) : '');
  document.getElementById('planout').innerHTML = h;
}
function refresh(d) { if (d) { DATA = d; all = d.entries; PLAN = d.plan; } render(); renderPlan(); }

// Planner inputs: "1.2m", "300k", "1,200,000" all work. Saved on the Mac so the iPhone sees the same numbers.
const amount = (s) => { const m = String(s).toLowerCase().replace(/[, ]/g, '').match(/^(\\d*\\.?\\d+)([km]?)$/); return m ? Math.round(parseFloat(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1)) : 0; };
const INV = ['dust', 'fastTm', 'chargedTm'];
INV.forEach((k) => { const v = DATA.inventory[k]; document.getElementById(k).value = v ? (k === 'dust' ? num(v) : v) : ''; });
let invTimer;
INV.forEach((k) => document.getElementById(k).addEventListener('input', () => {
  clearTimeout(invTimer);
  invTimer = setTimeout(async () => refresh(await post('/api/inventory', Object.fromEntries(INV.map((x) => [x, amount(document.getElementById(x).value)])))), 400);
}));

document.querySelectorAll('.seg[data-f]').forEach((g) => g.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  F[g.dataset.f] = b.dataset.v;
  g.querySelectorAll('button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  render();
}));
document.getElementById('sort').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  desc = b.dataset.sort === sort ? !desc : false; sort = b.dataset.sort;
  document.querySelectorAll('#sort button').forEach((x) => x.classList.toggle('on', x === b));
  render();
});
document.getElementById('gens').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (MODE === 'list' && (sort !== 'dex' || desc)) { sort = 'dex'; desc = false; document.querySelectorAll('#sort button').forEach((x) => x.classList.toggle('on', x.dataset.sort === 'dex')); render(); }
  document.getElementById('gen' + b.dataset.gen)?.scrollIntoView({ block: 'start' });
});
document.getElementById('planout').addEventListener('click', (e) => {
  const b = e.target.closest('.jump'); if (!b) return;
  if (MODE === 'grid') { setMode('list'); render(); }
  let el = document.getElementById('mon-' + b.dataset.id);
  if (!el) { // hidden by a filter: clear filters + search
    document.getElementById('q').value = '';
    document.querySelectorAll('.seg[data-f]').forEach((g) => { F[g.dataset.f] = 'all'; g.querySelectorAll('button').forEach((x, i) => { x.classList.toggle('on', !i); x.setAttribute('aria-pressed', String(!i)); }); });
    render(); el = document.getElementById('mon-' + b.dataset.id);
  }
  el?.scrollIntoView({ block: 'center' });
});
document.getElementById('q').addEventListener('input', render);
document.getElementById('mode').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (tileFromHash()) history.replaceState(null, '', location.pathname + location.search);
  setMode(b.dataset.m); render();
});
const pick = (id, attr, set) => document.getElementById(id).addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  set(b.dataset[attr]); document.querySelectorAll('#' + id + ' button').forEach((x) => x.classList.toggle('on', x === b)); render();
});
pick('rlg', 'lg', (v) => (RLG = v));
pick('rtop', 'top', (v) => (RTOP = Number(v)));
document.getElementById('list').addEventListener('click', (e) => {
  const t = e.target.closest('.mtile');
  if (t) { pushed = true; location.hash = 'tile=' + encodeURIComponent(t.dataset.tile); window.scrollTo(0, 0); return; }
  if (e.target.closest('[data-back]')) { if (pushed) history.back(); else { history.replaceState(null, '', location.pathname + location.search); render(); } }
});
window.addEventListener('hashchange', () => { if (!tileFromHash()) pushed = false; render(); });
if (tileFromHash()) MODE = 'grid';
setMode(MODE);
refresh();
</script>
</body></html>`;
}

// Pokédex tab: one grid per special dex. Tap a spot: not known -> have -> missing -> not known.
// Screenshots go to the inbox; once issue 12's reader is wired in (readDex) they fill the marks automatically.
function pokedexPage(species: DexSpecies[], marks: Record<string, Record<number, string>>, inboxCount: Record<string, number>, reader: boolean): string {
  return `${head('Pokédex · Lilycove Co')}
${nav('pokedex')}
<main>
<section class="card tools">
<div class="dexkinds" id="kinds" role="group" aria-label="Which Pokédex">${DEX_KINDS.map((k, i) => `<button data-kind="${k.key}"${i ? '' : ' class="on"'}>${k.label}</button>`).join('')}</div>
<p class="count2" id="n"></p>
<div class="seg" id="show" role="group" aria-label="Show"><button data-v="all" class="on">All</button><button data-v="missing">Missing only</button><button data-v="unknown">Not known yet</button></div>
<div class="btns"><label class="btn sec2" id="up">Add Pokédex screenshots<input type="file" accept="image/*" multiple></label></div>
<p id="msg" class="why" aria-live="polite"></p>
</section>
<section class="card" id="grid"></section>
${SUPPORT}</main>
<script id="data" type="application/json">${pageJson({ species, marks, inboxCount, reader, spots: DEX_SPOTS, generations: GENERATIONS })}</script>
<script>
const D = JSON.parse(document.getElementById('data').textContent);
const LABEL = ${JSON.stringify(Object.fromEntries(DEX_KINDS.map((k) => [k.key, k.label])))};
let kind = '${DEX_KINDS[0].key}', show = 'all';
// Which dex + filter: remembered on this device, so a refresh (tap Lilycove Co) keeps Missing only.
const mem = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
if (LABEL[mem.get("dexKind")]) kind = mem.get("dexKind");
if (["all", "missing", "unknown"].includes(mem.get("dexShow"))) show = mem.get("dexShow");
function mark() {
  document.querySelectorAll("#kinds button").forEach((x) => x.classList.toggle("on", x.dataset.kind === kind));
  document.querySelectorAll("#show button").forEach((x) => { x.classList.toggle("on", x.dataset.v === show); x.setAttribute("aria-pressed", String(x.dataset.v === show)); });
}
mark();
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const gen = (dex) => [...D.generations].reverse().find((g) => dex >= g.first);
function spots() {
  const m = D.marks[kind] || {};
  if (D.spots[kind] === 'mega') return D.species.filter((s) => s.mega || m[s.dex]);
  if (D.spots[kind] === 'known') return D.species.filter((s) => m[s.dex]);
  return D.species;
}
function render() {
  const m = D.marks[kind] || {}, list = spots();
  const st = (s) => m[s.dex] || 'unknown';
  const have = list.filter((s) => st(s) === 'have').length, missing = list.filter((s) => st(s) === 'missing').length;
  const waiting = D.inboxCount[kind] || 0;
  document.getElementById('n').textContent = LABEL[kind] + ' Pokédex · ' + have + ' have · ' + missing + ' missing' + (D.spots[kind] === 'known' ? '' : ' · ' + (list.length - have - missing) + ' not known yet') +
    (waiting ? ' · ' + waiting + ' screenshot' + (waiting > 1 ? 's' : '') + ' waiting for the reader' : '');
  document.querySelector('#up').firstChild.textContent = 'Add ' + LABEL[kind] + ' Pokédex screenshots';
  let html = '', g = 0, open = false;
  for (const s of list) {
    const k = st(s);
    if (show !== 'all' && k !== show) continue;
    const gg = gen(s.dex);
    if (gg.n !== g) { if (open) html += '</div>'; g = gg.n; html += '<h3 class="genh">' + g + ' ' + gg.region + '</h3><div class="dexgrid">'; open = true; }
    html += '<button class="tile ' + k + '" data-dex="' + s.dex + '" title="#' + s.dex + ' ' + esc(s.name) + ': ' + (k === 'unknown' ? 'not known yet' : k) + '" aria-label="#' + s.dex + ' ' + esc(s.name) + ', ' + (k === 'unknown' ? 'not known yet' : k) + '">' +
      (k === 'unknown' ? s.dex : '<img src="/sprite/' + encodeURIComponent(s.id) + '?dex=' + s.dex + '" alt="" loading="lazy"><span>' + s.dex + '</span>') + '</button>';
  }
  if (open) html += '</div>';
  document.getElementById('grid').innerHTML = html || '<p class="empty">' + (D.spots[kind] === 'known' && !list.length ? 'The ' + LABEL[kind] + ' Pokédex fills in from your screenshots.' : 'Nothing here.') + '</p>';
}
document.getElementById('kinds').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  kind = b.dataset.kind; mem.set("dexKind", kind); mark(); render();
});
document.getElementById('show').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  show = b.dataset.v; mem.set("dexShow", show); mark(); render();
});
const NEXT = { unknown: 'have', have: 'missing', missing: null };
document.getElementById('grid').addEventListener('click', async (e) => {
  const t = e.target.closest('.tile'); if (!t) return;
  const dex = Number(t.dataset.dex), m = (D.marks[kind] = D.marks[kind] || {}), status = NEXT[m[dex] || 'unknown'];
  if (status) m[dex] = status; else delete m[dex];
  render();
  await fetch('/api/dex', { method: 'POST', body: JSON.stringify({ kind, dex, status }) });
});
document.querySelector('#up input').onchange = async (e) => {
  const msg = document.getElementById('msg');
  for (const f of e.target.files) {
    msg.textContent = 'Saving ' + f.name + '…';
    const r = await (await fetch('/pokedex/upload?kind=' + kind + '&name=' + encodeURIComponent(f.name), { method: 'POST', body: f })).json();
    msg.textContent = r.ok ? r.note : 'Failed: ' + r.reason;
  }
  setTimeout(() => location.reload(), 1500);
};
render();
</script>
</body></html>`;
}

// Settings (Ben, 2026-11-23): Clear all my Pokémon, behind a 3-second hold. The Pokédex is never touched.
function settingsPage(count: number, failed: number): string {
  return `${head('Settings · Lilycove Co')}
${nav('settings')}
<main>
<section class="card"><h2>Clear all my Pokémon</h2>
<p class="why">Erases all ${count} scanned Pokémon, ${failed} failed scan${failed === 1 ? '' : 's'} and every saved picture. This can't be undone.</p>
<p class="why">Kept: your Pokédex, Never transfer list, candy counts and stardust.</p>
<button class="hold" id="clear" aria-describedby="holdmsg"><span class="fill"></span><span class="lbl">Hold 3 seconds to clear</span></button>
<p id="holdmsg" class="why" aria-live="polite"></p>
</section>
<section class="card"><h2>Support</h2>
<p class="why">Free and open source. If it helps you, a coffee keeps it going.</p>
<div class="btns"><a class="btn pri" href="${KOFI}" target="_blank" rel="noopener">Support Ready Set Ink on Ko-fi</a></div>
</section>
${SUPPORT}</main>
<script>
const b = document.getElementById("clear"), fill = b.querySelector(".fill"), lbl = b.querySelector(".lbl"), msg = document.getElementById("holdmsg");
let timer, busy = false;
function stop() { clearTimeout(timer); b.classList.remove("on"); if (!busy) lbl.textContent = "Hold 3 seconds to clear"; }
b.addEventListener("pointerdown", (e) => {
  if (busy) return;
  e.preventDefault(); b.setPointerCapture?.(e.pointerId);
  b.classList.add("on"); lbl.textContent = "Keep holding…"; msg.textContent = "";
  timer = setTimeout(async () => {
    busy = true; lbl.textContent = "Clearing…";
    const r = await (await fetch("/api/clear-pokemon", { method: "POST", body: JSON.stringify({ confirm: "clear" }) })).json();
    b.classList.remove("on"); lbl.textContent = r.ok ? "Cleared" : "Failed";
    msg.textContent = r.ok ? "Erased " + r.scans + " Pokémon and " + r.pictures + " pictures. Your Pokédex is untouched." : "Failed: " + r.reason;
  }, 3000);
});
["pointerup", "pointercancel", "pointerleave"].forEach((t) => b.addEventListener(t, stop));
b.addEventListener("contextmenu", (e) => e.preventDefault());
b.addEventListener("keydown", (e) => { if (e.key === " " || e.key === "Enter") msg.textContent = "Press and hold with the mouse or a finger."; });
</script>
</body></html>`;
}

const body = (req: IncomingMessage) =>
  new Promise<Buffer>((ok, bad) => { const parts: Buffer[] = []; req.on('data', (c) => parts.push(c)).on('end', () => ok(Buffer.concat(parts))).on('error', bad); });

export function startServer(store: Store, port = PORT, { read, collection, split, dataInfo, uploadDir = join(tmpdir(), 'lilycove-uploads'), spriteDir = join(tmpdir(), 'lilycove-sprites'), fetchImpl,
  dexSpecies = () => [], dexInbox = join(tmpdir(), 'lilycove-pokedex-inbox'), readDex }: ServerOptions = {}, host = '0.0.0.0'): Promise<Server> {
  const jobs = new Map<string, Job>();
  // Closing + opening the app (server restart) starts a new session. Whole seconds: upload times are stored to the second.
  const startedAt = Math.floor(Date.now() / 1000) * 1000;

  /**
   * Ben's cleanup rules (2026-11-23): a failed scan not fixed within a day is deleted (image + row);
   * stray upload files are deleted; Pokémon on the Transfer list go away the next calendar day.
   * Runs at start, every hour, and before each page.
   */
  function cleanup(now = Date.now()) {
    const keep = new Set<string>();
    for (const f of store.failed(100_000)) {
      if (now - sqlTime(f.failedAt) > KEEP_FAILED_MS) { if (f.file) removeUpload(uploadDir, f.file); store.removeFailed(f.id); }
      else if (f.file) keep.add(resolve(f.file));
    }
    sweepUploads(uploadDir, now, undefined, keep);
    if (collection) try {
      store.expireTransfers(collection.lists().transfer.map((i) => i.id), new Date(now).toLocaleDateString('en-CA'));
    } catch (e) { console.error('transfer expiry failed', e); }
  }
  cleanup();
  const sweeper = setInterval(() => cleanup(), 3_600_000).unref();

  /**
   * One Pokédex screenshot -> marks. The dex tab shown in the screenshot wins over the one picked on the page.
   * Read screenshots are deleted; unreadable ones stay in the inbox.
   */
  function readDexFile(path: string, picked: DexKind): { ok: true; note: string } | { ok: false; reason: string } {
    let r: DexRead;
    try { r = readDex!(path, picked); } catch (e) { r = { ok: false, reason: `Reader error: ${(e as Error).message}` }; }
    if (!r.ok) return r;
    const kind = isDexKind(r.kind) ? r.kind : picked;
    for (const n of r.have) store.setDexMark(kind, n, 'have');
    for (const n of r.missing) store.setDexMark(kind, n, 'missing');
    rmSync(path, { force: true });
    const label = DEX_KINDS.find((k) => k.key === kind)!.label;
    return { ok: true, note: `${label}: ${r.have.length} caught, ${r.missing.length} missing${kind !== picked ? ` (this was the ${label} Pokédex, saved there)` : ''}.` };
  }
  // Screenshots that waited for the reader (uploaded before it existed) are read at start.
  if (readDex) for (const k of DEX_KINDS) {
    const dir = join(dexInbox, k.key);
    if (existsSync(dir)) for (const f of readdirSync(dir).filter((f) => !f.startsWith('.')).sort()) {
      const r = readDexFile(join(dir, f), k.key);
      console.log(`Pokédex inbox ${k.key}/${f}: ${r.ok ? r.note : r.reason}`);
    }
  }

  /**
   * One image through the whole pipeline: read -> save (or Failed scans) -> keep slot.
   * Success deletes the image; failure keeps it (moved to keepFailedAs if given) for the 7-day sweep.
   */
  function ingest(path: string, keepFailedAs?: string, opts: { cp?: number; retryOf?: number } = {}) {
    let result;
    try { result = read!(path, opts.cp === undefined ? undefined : { cp: opts.cp }); } catch (e) { result = { ok: false as const, reason: `Reader error: ${(e as Error).message}`, partial: {} }; }
    if (!result.ok) {
      if (opts.retryOf !== undefined) return { result, placed: undefined, rename: '' }; // stays in Failed scans as it was
      if (keepFailedAs) try { renameSync(path, keepFailedAs); path = keepFailedAs; } catch { /* missing file: keep the old path */ }
      store.saveFailed({ file: path, reason: result.reason });
      return { result, placed: undefined, rename: '' };
    }
    removeUpload(uploadDir, path);
    if (opts.retryOf !== undefined) store.removeFailed(opts.retryOf);
    const s = result.scan;
    const id = store.save({ species: s.species, atk: s.ivs.atk, def: s.ivs.def, sta: s.ivs.sta, level: s.level, cp: s.cp, name: s.name }, s);
    let placed;
    try { placed = collection?.place(id); } catch (e) { console.error('place failed', s.species, e); }
    for (const o of placed?.replaced ?? []) store.addReplaced(o.id, id);
    return { result, placed, rename: placed ? placed.name : s.name ?? '' };
  }

  async function saveUpload(req: IncomingMessage) {
    mkdirSync(uploadDir, { recursive: true });
    const original = new URL(req.url ?? '/', 'http://x').searchParams.get('name') ?? 'upload';
    const path = join(uploadDir, `${Date.now()}-${original.replace(/[^\w.-]/g, '_')}`);
    writeFileSync(path, await body(req));
    return path;
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e) => {
      console.error('request failed', req.url, e);
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: false, notify: `Error: ${(e as Error).message}`, rename: '' }));
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const json = (data: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(data));
    const post = (route: string) => req.method === 'POST' && req.url?.startsWith(route);

    if (post('/scan') || post('/live')) {
      if (!read) return json({ ok: false, reason: 'Screen reader not set up' }, 503);
      const { result, placed, rename } = ingest(await saveUpload(req));
      if (post('/scan')) return json(result.ok ? { ...result, scan: { ...result.scan, name: rename }, ...placed } : result);
      // Shortcut-friendly: one line for the notification, one string for the clipboard.
      if (!result.ok) {
        const friendly = ['CP covered: try again', 'Open the appraisal first'].includes(result.reason);
        return json({ ok: false, notify: friendly ? result.reason : `Scan failed: ${result.reason}`, rename: '' });
      }
      const s = result.scan, ivs = `${s.ivs.atk}/${s.ivs.def}/${s.ivs.sta}`;
      const notify = placed
        ? [`${placed.verdict.toUpperCase()} ${s.species} ${ivs}${rename ? `: ${rename}` : ''}`, placed.beats, ...(placed.replaced ?? []).map((o) => `get rid of old: ${o.search}`)].filter(Boolean).join(', ')
        : `${s.species} ${ivs} CP${s.cp}: ${rename || 'no rank under 250'}`;
      return json({ ok: true, notify, rename });
    }

    if (post('/video')) {
      if (!read || !split) return json({ ok: false, reason: 'Video mode not set up' }, 503);
      const video = await saveUpload(req);
      const id = String(Date.now());
      const job: Job = { total: 0, processed: 0, failed: 0, done: false, results: [] };
      jobs.set(id, job);
      json({ job: id });
      // Runs after the response; the page polls GET /video/<id>.
      const framesDir = `${video}-frames`;
      try {
        const frames = await split(video, framesDir);
        job.total = frames.length;
        for (const f of frames) {
          await new Promise((r) => setImmediate(r)); // keep the server responsive between frames
          const { result, placed, rename } = ingest(f, `${video}-${basename(f)}`);
          if (!result.ok) job.failed++;
          job.results.push(result.ok ? { ok: true, species: result.scan.species, cp: result.scan.cp, name: rename, verdict: placed?.verdict, beats: placed?.beats } : { ok: false, reason: result.reason });
          job.processed++;
        }
      } catch (e) { job.error = (e as Error).message; }
      removeUpload(uploadDir, video);
      removeUpload(uploadDir, framesDir);
      job.done = true;
      return;
    }

    // Manual CP override: re-read a failed scan's kept image with the CP Ben typed.
    if (post('/retry')) {
      if (!read) return json({ ok: false, reason: 'Screen reader not set up' }, 503);
      const q = new URL(req.url ?? '/', 'http://x').searchParams;
      const f = store.failedById(Number(q.get('id'))), cp = Number(q.get('cp'));
      if (!f) return json({ ok: false, reason: 'No such failed scan' }, 404);
      if (!Number.isInteger(cp) || cp < 10 || cp > 10000) return json({ ok: false, reason: 'Type the CP as a number (10 to 10000)' }, 400);
      if (!f.file || !existsSync(f.file)) return json({ ok: false, reason: 'The image was already deleted (kept 1 day)' }, 410);
      const { result, placed, rename } = ingest(f.file, undefined, { cp, retryOf: f.id });
      return json(result.ok ? { ...result, scan: { ...result.scan, name: rename }, ...placed } : result);
    }

    if (post('/exceptions')) {
      const f = new URLSearchParams((await body(req)).toString());
      const species = f.get('species')?.trim();
      if (species) f.get('action') === 'remove' ? store.removeException(species) : store.addException(species);
      return void res.writeHead(303, { location: '/' }).end();
    }

    // Failed scan's kept image (only files still in the uploads folder).
    const imgMatch = req.method === 'GET' && req.url?.match(/^\/failed-image\/(\d+)$/);
    if (imgMatch) {
      const f = store.failedById(Number(imgMatch[1]));
      const inside = f?.file && resolve(f.file).startsWith(resolve(uploadDir) + sep) && existsSync(f.file);
      if (!inside) return void res.writeHead(404).end('Not found');
      return void res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' }).end(readFileSync(f!.file));
    }

    const spriteMatch = req.method === 'GET' && req.url?.match(/^\/sprite\/([a-z0-9_]+)(?:\?dex=(\d+))?$/);
    if (spriteMatch) {
      const png = await getSprite(spriteDir, spriteMatch[1], spriteMatch[2] ? Number(spriteMatch[2]) : undefined, fetchImpl);
      if (!png) return void res.writeHead(404).end('No sprite');
      return void res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=604800' }).end(png);
    }

    if (req.method === 'GET' && req.url === '/collection') {
      cleanup();
      const session = sessionStart(store.uploadTimes().map(sqlTime), Date.now(), startedAt);
      return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(collectionPage(keepers(store, collection), session));
    }
    if (req.method === 'GET' && req.url === '/api/keepers') return json(keepers(store, collection));
    const dismiss = req.method === 'POST' && req.url?.match(/^\/api\/replaced\/(\d+)\/dismiss$/);
    if (dismiss) { store.dismissReplaced(Number(dismiss[1])); return json({ ok: true }); }

    if (req.method === 'GET' && req.url === '/settings')
      return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(settingsPage(store.count(), store.failed(100_000).length));
    if (post('/api/clear-pokemon')) {
      let d: any;
      try { d = JSON.parse((await body(req)).toString() || '{}'); } catch { d = {}; }
      if (d.confirm !== 'clear') return json({ ok: false, reason: 'Not confirmed' }, 400);
      const scans = store.clearPokemon();
      // Every picture in the uploads folder (failed-scan images, leftover frames). The Pokédex inbox is a different folder.
      let pictures = 0;
      for (const f of existsSync(uploadDir) ? readdirSync(uploadDir) : []) if (removeUpload(uploadDir, join(uploadDir, f))) pictures++;
      console.log(`Cleared all Pokémon: ${scans} scans, ${pictures} pictures`);
      return json({ ok: true, scans, pictures });
    }
    if (req.method === 'GET' && req.url === '/pokedex') {
      const marks = Object.fromEntries(DEX_KINDS.map((k) => [k.key, Object.fromEntries(store.dexMarks(k.key))]));
      const inbox = Object.fromEntries(DEX_KINDS.map((k) => [k.key, existsSync(join(dexInbox, k.key)) ? readdirSync(join(dexInbox, k.key)).filter((f) => !f.startsWith('.')).length : 0]));
      return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pokedexPage(dexSpecies(), marks, inbox, !!readDex));
    }
    if (post('/api/dex')) {
      let d: any;
      try { d = JSON.parse((await body(req)).toString() || '{}'); } catch { return json({ ok: false, reason: 'Bad JSON' }, 400); }
      if (!isDexKind(d.kind) || !Number.isInteger(d.dex) || d.dex < 1 || d.dex > 2000 || ![null, 'have', 'missing'].includes(d.status)) return json({ ok: false, reason: 'Bad mark' }, 400);
      store.setDexMark(d.kind, d.dex, d.status);
      return json({ ok: true });
    }
    // Pokédex screenshots: kept in the inbox per dex until the reader (issue 12) reads them; read ones are deleted.
    if (post('/pokedex/upload')) {
      const q = new URL(req.url ?? '/', 'http://x').searchParams, kind = q.get('kind');
      if (!isDexKind(kind)) return json({ ok: false, reason: 'Unknown Pokédex' }, 400);
      const dir = join(dexInbox, kind);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, `${Date.now()}-${(q.get('name') ?? 'dex.png').replace(/[^\w.-]/g, '_')}`);
      writeFileSync(path, await body(req));
      if (!readDex) return json({ ok: true, note: 'Saved. Reading Pokédex screenshots is coming next, so you can tap spots by hand for now.' });
      const r = readDexFile(path, kind);
      return json(r.ok ? { ok: true, note: r.note } : { ok: false, reason: r.reason });
    }
    // Edits from the Collection tab / Scan page. Each answers with fresh keepers + plan.
    if (post('/api/candy') || post('/api/moves') || post('/api/inventory')) {
      let d: any;
      try { d = JSON.parse((await body(req)).toString() || '{}'); } catch { return json({ ok: false, reason: 'Bad JSON' }, 400); }
      const count = (n: unknown) => (Number.isInteger(n) && (n as number) >= 0 && (n as number) < 1e7 ? (n as number) : undefined);
      if (post('/api/candy')) {
        if (typeof d.family !== 'string' || !d.family) return json({ ok: false, reason: 'No family' }, 400);
        store.setCandy(d.family, { candy: count(d.candy), xl: count(d.xl) });
      } else if (post('/api/moves')) {
        if (typeof d.key !== 'string' || !d.key) return json({ ok: false, reason: 'No key' }, 400);
        store.setMovesDone(d.key, !!d.done);
      } else store.setInventory(d);
      return json(keepers(store, collection));
    }
    const del = req.method === 'POST' && req.url?.match(/^\/api\/scans\/(\d+)\/(delete|restore)$/);
    if (del) {
      del[2] === 'delete' ? store.removeScan(Number(del[1])) : store.restoreScan(Number(del[1]));
      return json({ ok: true });
    }
    const delFailed = req.method === 'POST' && req.url?.match(/^\/api\/failed\/(\d+)\/delete$/);
    if (delFailed) {
      const f = store.failedById(Number(delFailed[1]));
      if (f) { if (f.file) removeUpload(uploadDir, f.file); store.removeFailed(f.id); }
      return json({ ok: true });
    }
    if (req.method === 'GET' && req.url === '/api/collection') return json(collection ? collection.entries() : []);

    const jobMatch = req.method === 'GET' && req.url?.match(/^\/video\/(\w+)$/);
    if (jobMatch) {
      const job = jobs.get(jobMatch[1]);
      return job ? json(job) : json({ error: 'No such job' }, 404);
    }

    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      cleanup();
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(homePage(store, uploadDir, collection, dataInfo));
    } else if (req.url === '/api/count') {
      json({ scanned: store.count() });
    } else res.writeHead(404).end('Not found');
  }
  server.on('close', () => clearInterval(sweeper));
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

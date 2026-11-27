// Store: every scan saved to a local SQLite file (Node's built-in node:sqlite, no extra deps).
import { DatabaseSync } from 'node:sqlite';
import type { MetaChange, Snapshot } from './metawatch.js';

export interface Scan {
  species: string; atk: number; def: number; sta: number; level: number;
  cp?: number; name?: string;
}
export interface SavedScan extends Scan { id: number; scannedAt: string }
export interface FailedScan { id: number; file: string; reason: string; failedAt: string }
export interface Store {
  /** day: local "YYYY-MM-DD" the scan counts for (tests); default today. */
  save(scan: Scan, detail?: unknown, day?: string): number; count(): number; list(limit?: number): SavedScan[];
  /** Ben 2026-11-26: scans today (resets at local midnight) + lifetime. Never goes down (not on × or Clear all). */
  scanStats(): { today: number; lifetime: number };
  /** Every scan's full appraisal (as saved), oldest first. */
  details(): { id: number; detail: any; scannedAt: string }[];
  /** Every upload's time (scans incl. transferred-away + failed scans), UTC "YYYY-MM-DD HH:MM:SS". */
  uploadTimes(): string[];
  /** at: UTC "YYYY-MM-DD HH:MM:SS" (tests); default now. */
  saveFailed(f: { file: string; reason: string; at?: string }): number; failed(limit?: number): FailedScan[];
  failedById(id: number): FailedScan | undefined; removeFailed(id: number): void;
  /** Ben's never-transfer list (species names). */
  exceptions(): string[]; addException(species: string): void; removeException(species: string): void;
  /**
   * Transfers go away the calendar day after they were first listed for transfer (Ben transfers them that day).
   * ids = scans on the Transfer list now; today = local "YYYY-MM-DD". Scans no longer on the list are un-marked.
   * Hidden scans drop out of details() but are not deleted (scan count stays).
   */
  expireTransfers(ids: number[], today: string): number[];
  /** X on the Scan page: hide a scan (not deleted from the file, so Undo works). Hidden scans don't count. */
  removeScan(id: number): void; restoreScan(id: number): void;
  /** Candy Ben typed per family. at: UTC "YYYY-MM-DD HH:MM:SS" (tests); default now. */
  setCandy(family: string, counts: { candy?: number; xl?: number }, at?: string): void;
  typedCandy(): Map<string, { candy?: number; candyAt?: string; xl?: number; xlAt?: string }>;
  /** Ben marked the recommended moves as done (key = Entry.movesKey). */
  movesDone(): Set<string>; setMovesDone(key: string, done: boolean): void;
  /** Dust + Elite TMs Ben has (planner). */
  inventory(): Inventory; setInventory(inv: Inventory): void;
  /** A better scan pushed an old best off the Keep list: shown on the Scan page until Ben dismisses it. */
  addReplaced(oldId: number, newId: number): void; replaced(): { oldId: number; newId: number; at: string }[]; dismissReplaced(oldId: number): void;
  /** Pokédex marks per dex kind (shiny, lucky, ...): dex number -> have / missing. No mark = not known yet. */
  dexMarks(kind: string): Map<number, DexStatus>; setDexMark(kind: string, dex: number, status: DexStatus | null): void;
  /**
   * Settings > Clear all my Pokémon (Ben, 2026-11-23): every scan, failed scan and per-Pokémon mark is erased for good.
   * Kept: Pokédex marks, never-transfer list, typed candy, dust/TMs. Returns how many scans were erased.
   */
  clearPokemon(): number;
  /** Meta watch (Ben 2026-11-26): last PvPoke snapshot + the changes found, newest first. Survives Clear all. */
  metaSnapshot(): Snapshot | undefined; setMetaSnapshot(s: Snapshot): void;
  addMetaChange(c: MetaChange): number; metaChanges(): { id: number; at: string; change: MetaChange; dismissed: boolean }[]; dismissMetaChange(id: number): void;
}
export type DexStatus = 'have' | 'missing';
export interface Inventory { dust: number; fastTm: number; chargedTm: number }

export function openStore(path: string): Store {
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scanned_at TEXT NOT NULL DEFAULT (datetime('now')),
    species TEXT NOT NULL, atk INTEGER, def INTEGER, sta INTEGER, level REAL, cp INTEGER, name TEXT, detail TEXT);
    CREATE TABLE IF NOT EXISTS never_transfer (species TEXT PRIMARY KEY COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS failed_scans (
    id INTEGER PRIMARY KEY AUTOINCREMENT, failed_at TEXT NOT NULL DEFAULT (datetime('now')), file TEXT, reason TEXT);
    CREATE TABLE IF NOT EXISTS transfer_marks (scan_id INTEGER PRIMARY KEY, day TEXT NOT NULL, gone INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS removed_scans (scan_id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS typed_candy (family TEXT PRIMARY KEY, candy INTEGER, xl INTEGER, candy_at TEXT, xl_at TEXT);
    CREATE TABLE IF NOT EXISTS moves_done (key TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS replaced (old_id INTEGER PRIMARY KEY, new_id INTEGER NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), dismissed INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS dex_marks (kind TEXT NOT NULL, dex INTEGER NOT NULL, status TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (kind, dex));
    CREATE TABLE IF NOT EXISTS scan_days (day TEXT PRIMARY KEY, n INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS meta_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL DEFAULT (datetime('now')), change TEXT NOT NULL, dismissed INTEGER NOT NULL DEFAULT 0)`);
  // First run with scan_days: count the scans already saved, per local day.
  if (!db.prepare("SELECT 1 FROM settings WHERE key = 'scan_days_seeded'").get()) db.exec(`BEGIN;
    INSERT OR IGNORE INTO scan_days (day, n) SELECT date(scanned_at, 'localtime'), COUNT(*) FROM scans GROUP BY 1;
    INSERT INTO settings (key, value) VALUES ('scan_days_seeded', '1'); COMMIT;`);
  const today = () => (db.prepare("SELECT date('now', 'localtime') AS d").get() as { d: string }).d;
  const bump = db.prepare('INSERT INTO scan_days (day, n) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET n = n + 1');
  const live = 'id NOT IN (SELECT scan_id FROM removed_scans)';
  const insert = db.prepare('INSERT INTO scans (species, atk, def, sta, level, cp, name, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  return {
    save: (s, detail, day) => {
      const id = Number(insert.run(s.species, s.atk, s.def, s.sta, s.level, s.cp ?? null, s.name ?? null, detail === undefined ? null : JSON.stringify(detail)).lastInsertRowid);
      bump.run(day ?? today());
      return id;
    },
    scanStats: () => {
      const r = db.prepare('SELECT COALESCE(SUM(n), 0) AS life, COALESCE(SUM(CASE WHEN day = ? THEN n END), 0) AS today FROM scan_days').get(today()) as { life: number; today: number };
      return { today: Number(r.today), lifetime: Number(r.life) };
    },
    details: () =>
      (db.prepare('SELECT id, detail, scanned_at FROM scans WHERE detail IS NOT NULL AND ' + live + ' AND id NOT IN (SELECT scan_id FROM transfer_marks WHERE gone = 1) ORDER BY id').all() as any[])
        .map((r) => ({ id: r.id, detail: JSON.parse(r.detail), scannedAt: r.scanned_at })),
    uploadTimes: () =>
      (db.prepare('SELECT scanned_at AS t FROM scans UNION ALL SELECT failed_at FROM failed_scans').all() as { t: string }[]).map((r) => r.t),
    exceptions: () => (db.prepare('SELECT species FROM never_transfer ORDER BY species').all() as any[]).map((r) => r.species),
    addException: (species) => void db.prepare('INSERT OR IGNORE INTO never_transfer (species) VALUES (?)').run(species.trim()),
    removeException: (species) => void db.prepare('DELETE FROM never_transfer WHERE species = ?').run(species.trim()),
    saveFailed: ({ file, reason, at }) =>
      Number(db.prepare("INSERT INTO failed_scans (file, reason, failed_at) VALUES (?, ?, COALESCE(?, datetime('now')))").run(file, reason, at ?? null).lastInsertRowid),
    expireTransfers: (ids, today) => {
      const keep = new Set(ids);
      const marks = db.prepare('SELECT scan_id, day FROM transfer_marks WHERE gone = 0').all() as { scan_id: number; day: string }[];
      for (const m of marks) if (!keep.has(m.scan_id)) db.prepare('DELETE FROM transfer_marks WHERE scan_id = ?').run(m.scan_id);
      const add = db.prepare('INSERT OR IGNORE INTO transfer_marks (scan_id, day) VALUES (?, ?)');
      for (const id of ids) add.run(id, today);
      const old = (db.prepare('SELECT scan_id FROM transfer_marks WHERE gone = 0 AND day < ?').all(today) as { scan_id: number }[]).map((r) => r.scan_id);
      db.prepare('UPDATE transfer_marks SET gone = 1 WHERE gone = 0 AND day < ?').run(today);
      return old;
    },
    removeScan: (id) => void db.prepare('INSERT OR IGNORE INTO removed_scans (scan_id) VALUES (?)').run(id),
    restoreScan: (id) => void db.prepare('DELETE FROM removed_scans WHERE scan_id = ?').run(id),
    setCandy: (family, { candy, xl }, at) => {
      db.prepare('INSERT OR IGNORE INTO typed_candy (family) VALUES (?)').run(family);
      const now = at ?? (db.prepare("SELECT datetime('now') AS t").get() as { t: string }).t;
      if (candy !== undefined) db.prepare('UPDATE typed_candy SET candy = ?, candy_at = ? WHERE family = ?').run(candy, now, family);
      if (xl !== undefined) db.prepare('UPDATE typed_candy SET xl = ?, xl_at = ? WHERE family = ?').run(xl, now, family);
    },
    typedCandy: () => new Map((db.prepare('SELECT * FROM typed_candy').all() as any[]).map((r) =>
      [r.family, { ...(r.candy != null && { candy: r.candy, candyAt: r.candy_at }), ...(r.xl != null && { xl: r.xl, xlAt: r.xl_at }) }])),
    movesDone: () => new Set((db.prepare('SELECT key FROM moves_done').all() as { key: string }[]).map((r) => r.key)),
    setMovesDone: (key, done) => void (done ? db.prepare('INSERT OR IGNORE INTO moves_done (key) VALUES (?)') : db.prepare('DELETE FROM moves_done WHERE key = ?')).run(key),
    inventory: () => {
      const r = db.prepare("SELECT value FROM settings WHERE key = 'inventory'").get() as { value: string } | undefined;
      return { dust: 0, fastTm: 0, chargedTm: 0, ...(r ? JSON.parse(r.value) : {}) };
    },
    setInventory: (inv) => {
      const clean = (n: unknown) => Math.max(0, Math.floor(Number(n) || 0));
      const v = JSON.stringify({ dust: clean(inv.dust), fastTm: clean(inv.fastTm), chargedTm: clean(inv.chargedTm) });
      db.prepare("INSERT INTO settings (key, value) VALUES ('inventory', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(v);
    },
    addReplaced: (oldId, newId) => void db.prepare('INSERT INTO replaced (old_id, new_id) VALUES (?, ?) ON CONFLICT(old_id) DO UPDATE SET new_id = excluded.new_id, dismissed = 0').run(oldId, newId),
    replaced: () => (db.prepare('SELECT old_id, new_id, at FROM replaced WHERE dismissed = 0 ORDER BY at DESC, old_id DESC').all() as any[]).map((r) => ({ oldId: r.old_id, newId: r.new_id, at: r.at })),
    dismissReplaced: (oldId) => void db.prepare('UPDATE replaced SET dismissed = 1 WHERE old_id = ?').run(oldId),
    dexMarks: (kind) => new Map((db.prepare('SELECT dex, status FROM dex_marks WHERE kind = ?').all(kind) as any[]).map((r) => [r.dex, r.status])),
    setDexMark: (kind, dex, status) => void (status
      ? db.prepare("INSERT INTO dex_marks (kind, dex, status) VALUES (?, ?, ?) ON CONFLICT(kind, dex) DO UPDATE SET status = excluded.status, at = datetime('now')").run(kind, dex, status)
      : db.prepare('DELETE FROM dex_marks WHERE kind = ? AND dex = ?').run(kind, dex)),
    clearPokemon: () => {
      const n = Number((db.prepare('SELECT COUNT(*) AS n FROM scans').get() as { n: number }).n);
      db.exec(`BEGIN; DELETE FROM scans; DELETE FROM failed_scans; DELETE FROM transfer_marks; DELETE FROM removed_scans;
        DELETE FROM replaced; DELETE FROM moves_done; COMMIT;`);
      return n;
    },
    metaSnapshot: () => {
      const r = db.prepare("SELECT value FROM settings WHERE key = 'meta_snapshot'").get() as { value: string } | undefined;
      return r ? JSON.parse(r.value) : undefined;
    },
    setMetaSnapshot: (snap) => void db.prepare("INSERT INTO settings (key, value) VALUES ('meta_snapshot', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(snap)),
    addMetaChange: (c) => Number(db.prepare('INSERT INTO meta_changes (change) VALUES (?)').run(JSON.stringify(c)).lastInsertRowid),
    metaChanges: () => (db.prepare('SELECT * FROM meta_changes ORDER BY id DESC LIMIT 20').all() as any[]).map((r) => ({ id: r.id, at: r.at, change: JSON.parse(r.change), dismissed: !!r.dismissed })),
    dismissMetaChange: (id) => void db.prepare('UPDATE meta_changes SET dismissed = 1 WHERE id = ?').run(id),
    failedById: (id) => {
      const r = db.prepare('SELECT * FROM failed_scans WHERE id = ?').get(id) as any;
      return r ? { id: r.id, file: r.file, reason: r.reason, failedAt: r.failed_at } : undefined;
    },
    removeFailed: (id) => void db.prepare('DELETE FROM failed_scans WHERE id = ?').run(id),
    failed: (limit = 100) =>
      (db.prepare('SELECT * FROM failed_scans ORDER BY id DESC LIMIT ?').all(limit) as any[]).map((r) => ({ id: r.id, file: r.file, reason: r.reason, failedAt: r.failed_at })),
    count: () => Number((db.prepare(`SELECT COUNT(*) AS n FROM scans WHERE ${live}`).get() as { n: number }).n),
    list: (limit = 100) =>
      (db.prepare(`SELECT * FROM scans WHERE ${live} ORDER BY id DESC LIMIT ?`).all(limit) as any[]).map((r) => ({
        id: r.id, scannedAt: r.scanned_at, species: r.species, atk: r.atk, def: r.def, sta: r.sta, level: r.level,
        ...(r.cp != null && { cp: r.cp }), ...(r.name != null && { name: r.name }),
      })),
  };
}

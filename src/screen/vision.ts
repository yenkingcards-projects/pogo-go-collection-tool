// Adapter around the Swift Vision helper (bin/vision, built from helper/vision.swift on first use).
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface TextBox { text: string; conf: number; x: number; y: number; w: number; h: number }
export interface Picture {
  width: number; height: number; texts: TextBox[]; rgba: Buffer;
  /** OCR one region again, upscaled (for tiny text like the XS/XXL badge). */
  zoom?: (x: number, y: number, w: number, h: number) => TextBox[];
}

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BIN = join(ROOT, 'bin/vision');

function ensureHelper() {
  if (existsSync(BIN)) return;
  mkdirSync(join(ROOT, 'bin'), { recursive: true });
  execFileSync('swiftc', ['-O', join(ROOT, 'helper/vision.swift'), '-o', BIN]);
}

export function look(imagePath: string): Picture {
  ensureHelper();
  const dir = mkdtempSync(join(tmpdir(), 'pg-vision-'));
  try {
    const out = JSON.parse(execFileSync(BIN, [imagePath, join(dir, 'px.rgba')], { encoding: 'utf8', maxBuffer: 1 << 24 }));
    const zoom = (x: number, y: number, w: number, h: number): TextBox[] =>
      JSON.parse(execFileSync(BIN, [imagePath, '-', ...[x, y, w, h].map((n) => String(Math.max(0, Math.round(n))))], { encoding: 'utf8' })).texts;
    return { ...out, rgba: readFileSync(join(dir, 'px.rgba')), zoom };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

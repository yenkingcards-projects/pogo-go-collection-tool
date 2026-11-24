import { describe, it, expect } from 'vitest';
import { sessionStart } from '../src/session.js';

const M = 60_000, H = 60 * M;

describe('this session', () => {
  const appStart = 0;
  it('starts at the first upload after the last gap of over an hour', () => {
    const t = [10 * M, 20 * M, 3 * H, 3 * H + 50 * M, 4 * H + 40 * M];
    expect(sessionStart(t, 4 * H + 45 * M, appStart)).toBe(3 * H);
  });
  it('over an hour since the last upload: a new session with nothing in it yet', () => {
    expect(sessionStart([10 * M, 20 * M], 20 * M + H + 1, appStart)).toBeNull();
  });
  it('closing and opening the app starts a new session', () => {
    expect(sessionStart([10 * M, 20 * M, 40 * M], 45 * M, 30 * M)).toBe(40 * M);
    expect(sessionStart([10 * M, 20 * M], 25 * M, 22 * M)).toBeNull();
  });
  it('order does not matter; no scans = null', () => {
    expect(sessionStart([40 * M, 10 * M, 30 * M], 45 * M, appStart)).toBe(10 * M);
    expect(sessionStart([], 0, appStart)).toBeNull();
  });
});

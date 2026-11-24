// Namer: builds Ben's rename string. Format (PRD story 20-24):
// (league)(rank) (stage) (2nd league)(2nd rank) (2nd stage) (nickname)
export type League = 'great' | 'ultra' | 'little';
export type Stage = 0 | 1 | 2;
export interface StageRank { stage: Stage; rank: number; mega?: boolean }
export type LeagueRank = StageRank & { league: League };
export interface NameInput {
  currentStage: Stage;
  ranks: Partial<Record<League, StageRank[]>>;
  nickname?: string;
  /** The keep slot this Pokémon fills (from the Slot Assigner). Without it, the best league by priority is used. */
  primary?: LeagueRank;
}

const MAX_NAME = 12;
const MAX_NICK = 6;
const COUNT_UNDER = 250;
const SECOND_UNDER = 50;
const PRIORITY: League[] = ['great', 'ultra', 'little'];
const LETTER: Record<League, string> = { great: 'G', ultra: 'U', little: 'L' };
const STAGE_CODE = ['b', '1', '2'];

// Megas only appear when they are the slot being filled (primary).
const best = (list: StageRank[] = []) =>
  list.filter((r) => !r.mega).reduce<StageRank | undefined>((a, r) => (!a || r.rank < a.rank ? r : a), undefined);

export function cleanNickname(raw = ''): string {
  if (/^\s*trade\b/i.test(raw)) return ''; // "trade d 24", "Trade 26" are tags, not nicknames
  return raw
    .split(/\s+/)
    .filter((t) => t && !/^[GUL]\d+$/i.test(t) && !/^[b12]$/i.test(t))
    .join(' ')
    .slice(0, MAX_NICK)
    .trim();
}

export function buildName({ currentStage, ranks, nickname, primary }: NameInput): string {
  const picks = PRIORITY.map((league) => ({ league, ...best(ranks[league]) }))
    .filter((p): p is LeagueRank => p.rank !== undefined && p.rank < COUNT_UNDER);
  // Single-digit Little Cup ranks take top priority.
  picks.sort((a, b) => Number(b.league === 'little' && b.rank < 10) - Number(a.league === 'little' && a.rank < 10));
  const [first, ...rest] = primary ? [primary, ...picks.filter((p) => p.league !== primary.league)] : picks;
  if (!first) return '';
  const second = rest.find((p) => p.rank < SECOND_UNDER);

  const label = (p: LeagueRank) =>
    [LETTER[p.league] + p.rank, p.mega ? 'm' : p.stage !== currentStage ? STAGE_CODE[p.stage] : ''].filter(Boolean).join(' ');
  const nick = cleanNickname(nickname);
  const tries = [
    [label(first), second && label(second), nick],
    [label(first), second && label(second)],
    [label(first)],
  ].map((parts) => parts.filter(Boolean).join(' '));
  return tries.find((n) => n.length <= MAX_NAME) ?? tries[tries.length - 1];
}

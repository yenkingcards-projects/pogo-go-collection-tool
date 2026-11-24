import { buildName } from './namer.js';
import type { RankEngine, IVs } from './rank.js';

export function nameFromNumbers(engine: RankEngine, species: string, ivs: IVs, level: number, nickname?: string) {
  const result = engine.rank(species, ivs, level);
  return { ...result, name: buildName({ currentStage: result.currentStage, ranks: result.ranks, nickname }) };
}

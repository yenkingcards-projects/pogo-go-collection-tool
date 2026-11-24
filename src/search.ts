// Pokémon GO search string that finds one exact Pokémon, e.g. "bulbasaur&cp512".
export interface Findable { species: string; dex: number; cp: number; hp?: number }

// Transfer searches skip shinies and costumes: the screen reader can't see those, but the game can.
export const PROTECT = '!shiny&!costume';

export function searchString(p: Findable, needHp = false, forTransfer = false): string {
  const name = /^[a-z-]+$/i.test(p.species) ? p.species.toLowerCase() : String(p.dex);
  return [name, `cp${p.cp}`, needHp && p.hp ? `hp${p.hp}` : '', forTransfer ? PROTECT : ''].filter(Boolean).join('&');
}

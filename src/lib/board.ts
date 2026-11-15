import type { Character } from "../characters";

export const BOARD_SIZE = 48;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Picks a random board of distinct faces from the full dataset.
 * Prefers cards with a photo, and never puts the same person on the board twice
 * (the dataset has both "actor" and "role" cards that share one portrait).
 */
export function pickBoardIds(pool: Character[], size = BOARD_SIZE): string[] {
  const withPhoto = shuffle(pool.filter((c) => c.tmdb?.profilePath));
  const withoutPhoto = shuffle(pool.filter((c) => !c.tmdb?.profilePath));
  const seenPeople = new Set<number>();
  const board: string[] = [];

  for (const character of [...withPhoto, ...withoutPhoto]) {
    if (board.length >= size) break;
    const personId = character.tmdb?.personId;
    if (personId !== undefined) {
      if (seenPeople.has(personId)) continue;
      seenPeople.add(personId);
    }
    board.push(character.id);
  }
  return board;
}

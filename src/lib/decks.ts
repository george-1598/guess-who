import type { Character } from "../characters";
import type { Deck, SecretMode } from "./room";

/** Both actor pools, loaded from public/data at startup. */
export type Decks = Record<Deck, Character[]>;

// Display names for the room options. Rename freely: only these strings change.
export const POOL_NAMES: Record<Deck, string> = { famous: "Famous", random: "Random" };
export const SECRET_NAMES: Record<SecretMode, string> = { random: "Classic", choose: "Director's Cut" };

/** "Famous", "Random", "Famous Director's Cut", "Random Director's Cut". */
export function modeLabel(deck: Deck | undefined, secretMode: SecretMode | undefined) {
  const pool = POOL_NAMES[deck ?? "famous"];
  return secretMode === "choose" ? `${pool} ${SECRET_NAMES.choose}` : pool;
}

export const BOARD_SIZES = [
  { size: 24, label: "Easy" },
  { size: 36, label: "Medium" },
  { size: 48, label: "Hard" },
] as const;

/** "Easy · 24 cards" — picks the nearest label for any board size. */
export function difficultyLabel(cards: number) {
  const level = cards <= 24 ? "Easy" : cards <= 36 ? "Medium" : "Hard";
  return `${level} · ${cards} cards`;
}

/** The pool a room deals from; falls back to the famous list if the random one isn't available. */
export function deckPool(decks: Decks, deck: Deck | undefined): Character[] {
  return deck === "random" && decks.random.length > 0 ? decks.random : decks.famous;
}

function isCharacter(value: unknown): value is Character {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Character>;
  return typeof item.id === "string"
    && typeof item.name === "string"
    && typeof item.subtitle === "string"
    && typeof item.initials === "string"
    && typeof item.color === "string"
    && !!item.tmdb
    && Number.isInteger(item.tmdb.personId);
}

export async function loadDeck(file: string, signal?: AbortSignal): Promise<Character[]> {
  // "no-cache" = always ask the server if there's a newer list (cheap when nothing changed),
  // so phones don't keep playing with an outdated copy after an import.
  const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { signal, cache: "no-cache" });
  if (!response.ok) throw new Error(`Could not load ${file} (HTTP ${response.status}).`);
  const data: unknown = await response.json();
  if (!Array.isArray(data) || data.length === 0 || !data.every(isCharacter)) {
    throw new Error(`${file} is empty or contains records with an invalid shape.`);
  }
  return data;
}

export async function loadDecks(signal?: AbortSignal): Promise<Decks> {
  const [famous, random] = await Promise.all([
    loadDeck("characters.json", signal),
    // The random pool is optional: until it's imported, only "Famous" is offered.
    loadDeck("random-actors.json", signal).catch((error: unknown) => {
      if (signal?.aborted) throw error;
      return [] as Character[];
    }),
  ]);
  return { famous, random };
}

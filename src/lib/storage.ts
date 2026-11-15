// localStorage keys used by the app.
export const ROOM_KEY = "guesswho:room";
export const NAME_KEY = "guesswho:name";
export const SIZE_KEY = "guesswho:boardSize";
export const ALERTS_KEY = "guesswho:alerts";
export const eliminatedKey = (roomId: string, round: number) => `guesswho:elim:${roomId}:${round}`;

export function storageGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function storageSet(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private browsing etc. — the game still works, it just won't remember.
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

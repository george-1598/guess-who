import { useCallback, useState } from "react";
import { storageGet, storageSet } from "../lib/storage";

/** The cards this player has flipped down, remembered per room and round on this device. */
export function useEliminated(storageKey: string) {
  const [eliminated, setEliminated] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(storageGet(storageKey) || "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  const update = useCallback((change: (next: Set<string>) => void) => {
    setEliminated((current) => {
      const next = new Set(current);
      change(next);
      storageSet(storageKey, JSON.stringify([...next]));
      return next;
    });
  }, [storageKey]);

  const toggle = useCallback((id: string) => {
    update((next) => { if (next.has(id)) next.delete(id); else next.add(id); });
  }, [update]);

  /** Flip a whole group down (out = true) or back up (out = false). */
  const setMany = useCallback((ids: string[], out: boolean) => {
    update((next) => { for (const id of ids) { if (out) next.add(id); else next.delete(id); } });
  }, [update]);

  const reset = useCallback(() => update((next) => next.clear()), [update]);

  return { eliminated, toggle, setMany, reset };
}

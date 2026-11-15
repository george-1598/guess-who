import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchSnapshot, subscribeToRoom, type RoomSnapshot } from "../lib/room";
import { errorMessage } from "../lib/storage";

/** Keeps a live copy of everything this player may see in a room, via Supabase Realtime. */
export function useRoomSnapshot(client: SupabaseClient, roomId: string) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef(0);
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const next = await fetchSnapshot(client, roomId);
      if (id !== requestId.current) return; // a newer request already started
      if (next) {
        setSnapshot(next);
        setError("");
      } else {
        setMissing(true);
      }
    } catch (e) {
      if (id === requestId.current) setError(errorMessage(e));
    }
  }, [client, roomId]);

  // Several rows change per move, so coalesce bursts of notifications into one fetch.
  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void refresh(), 120);
  }, [refresh]);

  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeToRoom(client, roomId, scheduleRefresh);

    // Phones drop websockets when the screen locks: catch up when we come back,
    // and poll slowly as a safety net while the page is visible.
    const onVisible = () => { if (document.visibilityState === "visible") scheduleRefresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", scheduleRefresh);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 10_000);

    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", scheduleRefresh);
      window.clearInterval(poll);
      window.clearTimeout(timer.current);
    };
  }, [client, roomId, refresh, scheduleRefresh]);

  return { snapshot, missing, error, refresh };
}

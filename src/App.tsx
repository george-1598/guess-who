import { useCallback, useEffect, useMemo, useState } from "react";
import { Shell, StateMessage } from "./components/Shell";
import { loadDecks as fetchDecks, type Decks } from "./lib/decks";
import { ROOM_KEY, errorMessage, storageGet, storageSet } from "./lib/storage";
import { ensureSession, supabase } from "./lib/supabase";
import { Home } from "./screens/Home";
import { RoomView } from "./screens/RoomView";

/**
 * Loads the actor lists, signs in anonymously, and routes between the home screen and a room.
 *
 * Where things live:
 *   screens/     Home, Lobby, RoomView, Game
 *   components/  panels and pieces used by the screens
 *   hooks/       reusable React state (room sync, long-press, flipped cards, pop-up panels)
 *   lib/         Supabase calls, actor data, filters, localStorage
 */
function App() {
  const [decks, setDecks] = useState<Decks | null>(null);
  const [userId, setUserId] = useState("");
  const [fatalError, setFatalError] = useState("");
  const [roomId, setRoomId] = useState(() => storageGet(ROOM_KEY));

  const loadDecks = useCallback(async (signal?: AbortSignal) => {
    const loaded = await fetchDecks(signal);
    if (!signal?.aborted) setDecks(loaded);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadDecks(controller.signal).catch((error) => {
      if (!controller.signal.aborted) setFatalError(errorMessage(error));
    });
    return () => controller.abort();
  }, [loadDecks]);

  useEffect(() => {
    if (!supabase) return;
    ensureSession(supabase)
      .then(setUserId)
      .catch((error) => setFatalError(`Could not sign in: ${errorMessage(error)}`));
  }, []);

  const byId = useMemo(
    () => new Map([...(decks?.famous ?? []), ...(decks?.random ?? [])].map((c) => [c.id, c])),
    [decks],
  );

  const enterRoom = useCallback((id: string) => {
    storageSet(ROOM_KEY, id);
    setRoomId(id);
    // Drop ?room=CODE from the address bar once we're in.
    window.history.replaceState(null, "", import.meta.env.BASE_URL);
  }, []);

  const leaveRoom = useCallback(() => {
    storageSet(ROOM_KEY, "");
    setRoomId("");
  }, []);

  if (!supabase) {
    return (
      <Shell pill="SETUP NEEDED">
        <StateMessage eyebrow="CONFIGURATION" title="Supabase isn't connected yet.">
          <p>
            The site was built without <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>.
            Add them as GitHub repository variables and re-run the deploy workflow.
          </p>
        </StateMessage>
      </Shell>
    );
  }

  if (fatalError) {
    return (
      <Shell pill="ERROR">
        <StateMessage eyebrow="SOMETHING WENT WRONG" title="We couldn't start the game.">
          <p>{fatalError}</p>
        </StateMessage>
      </Shell>
    );
  }

  if (!decks || !userId) {
    return (
      <Shell pill="LOADING">
        <StateMessage eyebrow="GETTING THE BOARD READY" title="Loading…" />
      </Shell>
    );
  }

  if (!roomId) {
    return (
      <Shell pill="MULTIPLAYER">
        <Home client={supabase} decks={decks} onEnter={enterRoom} />
      </Shell>
    );
  }

  return (
    <RoomView
      key={roomId}
      client={supabase}
      roomId={roomId}
      userId={userId}
      decks={decks}
      byId={byId}
      onReloadDecks={loadDecks}
      onLeave={leaveRoom}
    />
  );
}

export default App;

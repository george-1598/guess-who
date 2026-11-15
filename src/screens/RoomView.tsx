import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LogOut } from "lucide-react";
import type { Character } from "../characters";
import { Shell, StateMessage } from "../components/Shell";
import { useRoomSnapshot } from "../hooks/useRoomSnapshot";
import { difficultyLabel, modeLabel, type Decks } from "../lib/decks";
import { Game } from "./Game";
import { Lobby } from "./Lobby";

/** A room: loads and live-syncs its state, then shows the lobby or the game. */
export function RoomView({ client, roomId, userId, decks, byId, onReloadDecks, onLeave }: {
  client: SupabaseClient;
  roomId: string;
  userId: string;
  decks: Decks;
  byId: Map<string, Character>;
  onReloadDecks: () => Promise<void>;
  onLeave: () => void;
}) {
  const { snapshot, missing, error, refresh } = useRoomSnapshot(client, roomId);

  // If the room uses actors this device doesn't know (its copy of the lists is older than
  // the other player's), fetch the lists again once; if that doesn't help, ask for a reload.
  const hasUnknownActors = !!snapshot && [
    ...snapshot.room.board_ids,
    ...snapshot.secrets.map((s) => s.character_id),
  ].some((id) => !byId.has(id));
  const [reloadState, setReloadState] = useState<"idle" | "reloading" | "failed">("idle");

  useEffect(() => {
    if (!hasUnknownActors || reloadState !== "idle") return;
    setReloadState("reloading");
    onReloadDecks()
      .catch(() => undefined)
      .finally(() => setReloadState("failed"));
  }, [hasUnknownActors, reloadState, onReloadDecks]);

  if (missing) {
    return (
      <Shell pill="ROOM CLOSED">
        <StateMessage eyebrow="ROOM NOT FOUND" title="This room no longer exists.">
          <p>Rooms are cleared away after a week without play.</p>
          <button className="primary-button" onClick={onLeave}>Back to start</button>
        </StateMessage>
      </Shell>
    );
  }

  if (!snapshot) {
    return (
      <Shell pill="CONNECTING">
        <StateMessage eyebrow="JOINING ROOM" title="Connecting…">
          {error && <p>{error}</p>}
          <button className="text-button" onClick={onLeave}><LogOut size={14} /> Leave room</button>
        </StateMessage>
      </Shell>
    );
  }

  const { room } = snapshot;
  return (
    <Shell pill={`ROOM ${room.code}`}>
      {error && <p className="form-error" role="alert">Connection problem: {error}</p>}
      {hasUnknownActors && reloadState === "failed" && (
        <p className="form-error" role="alert">
          This device has an outdated actor list, so some cards are missing.{" "}
          <button className="text-button" onClick={() => window.location.reload()}>Reload the page</button>
        </p>
      )}
      {room.status === "waiting" ? (
        <Lobby
          code={room.code}
          mode={`${modeLabel(room.deck, room.secret_mode)} · ${difficultyLabel(room.board_ids.length)}`}
          players={snapshot.players.map((p) => p.name)}
          onLeave={onLeave}
        />
      ) : (
        <Game
          key={room.round}
          client={client}
          snapshot={snapshot}
          userId={userId}
          decks={decks}
          byId={byId}
          onChanged={refresh}
          onLeave={onLeave}
        />
      )}
    </Shell>
  );
}

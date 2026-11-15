import type { SupabaseClient } from "@supabase/supabase-js";

export type Deck = "famous" | "random";
/** "random": secrets are dealt at random. "choose": each player picks the actor the opponent must find. */
export type SecretMode = "random" | "choose";

export type Room = {
  id: string;
  code: string;
  host_id: string;
  status: "waiting" | "choosing" | "playing" | "finished";
  phase: "ask" | "answer";
  board_ids: string[];
  deck: Deck;
  secret_mode: SecretMode;
  round: number;
  current_turn: string | null;
  winner_id: string | null;
};

export type Player = {
  room_id: string;
  user_id: string;
  name: string;
  seat: 1 | 2;
  /** Turns this player still has to miss because of wrong out-of-turn guesses. */
  skip_turns?: number;
};

export type RoomEvent = {
  id: number;
  room_id: string;
  round: number;
  user_id: string | null;
  kind: "question" | "answer" | "guess" | "system";
  body: string;
  correct: boolean | null;
  created_at: string;
};

export type Secret = {
  user_id: string;
  character_id: string;
};

export type RoomSnapshot = {
  room: Room;
  players: Player[];
  events: RoomEvent[];
  secrets: Secret[];
};

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

export async function createRoom(
  client: SupabaseClient,
  name: string,
  boardIds: string[],
  code: string,
  deck: Deck,
  secretMode: SecretMode,
) {
  const { data, error } = await client.rpc("create_room", {
    p_name: name,
    p_board_ids: boardIds,
    p_code: code.trim() || null,
    p_deck: deck,
    p_secret_mode: secretMode,
  });
  fail(error);
  return data as string;
}

export async function chooseSecret(client: SupabaseClient, roomId: string, characterId: string) {
  const { error } = await client.rpc("choose_secret", { p_room_id: roomId, p_character_id: characterId });
  fail(error);
}

export async function joinRoom(client: SupabaseClient, code: string, name: string) {
  const { data, error } = await client.rpc("join_room", { p_code: code, p_name: name });
  fail(error);
  return data as string;
}

export async function askQuestion(client: SupabaseClient, roomId: string, question: string) {
  const { error } = await client.rpc("ask_question", { p_room_id: roomId, p_question: question });
  fail(error);
}

export async function answerQuestion(client: SupabaseClient, roomId: string, answer: "yes" | "no" | "unsure") {
  const { error } = await client.rpc("answer_question", { p_room_id: roomId, p_answer: answer });
  fail(error);
}

export async function makeGuess(client: SupabaseClient, roomId: string, characterId: string) {
  const { data, error } = await client.rpc("make_guess", { p_room_id: roomId, p_character_id: characterId });
  fail(error);
  return data as boolean;
}

export async function rematch(client: SupabaseClient, roomId: string, boardIds: string[]) {
  const { error } = await client.rpc("rematch", { p_room_id: roomId, p_board_ids: boardIds });
  fail(error);
}

/** Loads everything the current player is allowed to see. Returns null if the room is gone or not ours. */
export async function fetchSnapshot(client: SupabaseClient, roomId: string): Promise<RoomSnapshot | null> {
  const { data: room, error: roomError } = await client.from("rooms").select("*").eq("id", roomId).maybeSingle();
  fail(roomError);
  if (!room) return null;

  const [players, events, secrets] = await Promise.all([
    client.from("room_players").select("*").eq("room_id", roomId).order("seat"),
    client.from("room_events").select("*").eq("room_id", roomId).eq("round", room.round).order("id"),
    // Row level security only returns your own secret until the game is finished.
    client.from("room_secrets").select("user_id, character_id").eq("room_id", roomId),
  ]);
  fail(players.error);
  fail(events.error);
  fail(secrets.error);

  return {
    room: room as Room,
    players: (players.data ?? []) as Player[],
    events: (events.data ?? []) as RoomEvent[],
    secrets: (secrets.data ?? []) as Secret[],
  };
}

/** Calls onChange whenever anything in the room changes (and once the subscription is live). */
export function subscribeToRoom(client: SupabaseClient, roomId: string, onChange: () => void) {
  const channel = client
    .channel(`room:${roomId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "room_players", filter: `room_id=eq.${roomId}` }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "room_events", filter: `room_id=eq.${roomId}` }, onChange)
    .subscribe((status) => {
      if (status === "SUBSCRIBED") onChange();
    });
  return () => {
    void client.removeChannel(channel);
  };
}

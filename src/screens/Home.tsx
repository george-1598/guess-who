import { useState, type FormEvent, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Clapperboard, Dices, Shuffle, Sparkles, Star, Users } from "lucide-react";
import { pickBoardIds } from "../lib/board";
import { BOARD_SIZES, POOL_NAMES, SECRET_NAMES, deckPool, type Decks } from "../lib/decks";
import { createRoom, joinRoom, type Deck, type SecretMode } from "../lib/room";
import { NAME_KEY, SIZE_KEY, errorMessage, storageGet, storageSet } from "../lib/storage";

/** Start screen: your name, create a room (with its options), or join one by code. */
export function Home({ client, decks, onEnter }: {
  client: SupabaseClient;
  decks: Decks;
  onEnter: (roomId: string) => void;
}) {
  const [deck, setDeck] = useState<Deck>("famous");
  const [secretMode, setSecretMode] = useState<SecretMode>("random");
  const [boardSize, setBoardSize] = useState<number>(() => {
    const saved = Number(storageGet(SIZE_KEY));
    return BOARD_SIZES.some((s) => s.size === saved) ? saved : 36;
  });
  const [name, setName] = useState(() => storageGet(NAME_KEY));
  const [joinCode, setJoinCode] = useState(
    () => (new URLSearchParams(window.location.search).get("room") ?? "").toUpperCase(),
  );
  const [customCode, setCustomCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(action: () => Promise<string>) {
    if (!name.trim()) {
      setError("Enter your name first.");
      return;
    }
    storageSet(NAME_KEY, name.trim());
    setBusy(true);
    setError("");
    try {
      onEnter(await action());
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    storageSet(SIZE_KEY, String(boardSize));
    void run(() => createRoom(
      client, name.trim(), pickBoardIds(deckPool(decks, deck), boardSize), customCode, deck, secretMode,
    ));
  }

  function handleJoin(event: FormEvent) {
    event.preventDefault();
    if (!joinCode.trim()) {
      setError("Enter the room code you were given.");
      return;
    }
    void run(() => joinRoom(client, joinCode.trim(), name.trim()));
  }

  return (
    <>
      <section className="hero">
        <div className="eyebrow"><Sparkles size={14} /> THE MOVIE & POP CULTURE EDITION</div>
        <h1>Who am I <span>thinking of?</span></h1>
        <p>Create a room, send the code, and take turns asking yes/no questions.</p>
      </section>

      <section className="home-grid">
        <label className="panel name-panel">
          <span className="panel-label">YOUR NAME</span>
          <input
            className="text-input"
            value={name}
            maxLength={30}
            placeholder="e.g. George"
            autoComplete="nickname"
            onChange={(event) => setName(event.target.value)}
          />
        </label>

        <form className="panel" onSubmit={handleCreate}>
          <div className="panel-label">NEW GAME</div>
          <h3>Create a room</h3>

          <p>Who's on the board?</p>
          <div className="deck-picker" role="radiogroup" aria-label="Actor pool">
            <OptionButton selected={deck === "famous"} onSelect={() => setDeck("famous")}>
              <Star size={16} />
              <strong>{POOL_NAMES.famous}</strong>
              <span>{decks.famous.length} well-known stars</span>
            </OptionButton>
            <OptionButton selected={deck === "random"} onSelect={() => setDeck("random")} disabled={decks.random.length === 0}>
              <Shuffle size={16} />
              <strong>{POOL_NAMES.random}</strong>
              <span>{decks.random.length > 0 ? `${decks.random.length} actors from top movies` : "Not imported yet"}</span>
            </OptionButton>
          </div>

          <p>Who picks the secret actors?</p>
          <div className="deck-picker" role="radiogroup" aria-label="Secret mode">
            <OptionButton selected={secretMode === "random"} onSelect={() => setSecretMode("random")}>
              <Dices size={16} />
              <strong>{SECRET_NAMES.random}</strong>
              <span>The game deals them at random</span>
            </OptionButton>
            <OptionButton selected={secretMode === "choose"} onSelect={() => setSecretMode("choose")}>
              <Clapperboard size={16} />
              <strong>{SECRET_NAMES.choose}</strong>
              <span>You pick who they hunt for</span>
            </OptionButton>
          </div>

          <p>How many cards on the board?</p>
          <div className="deck-picker cols-3" role="radiogroup" aria-label="Difficulty">
            {BOARD_SIZES.map((option) => (
              <OptionButton key={option.size} selected={boardSize === option.size} onSelect={() => setBoardSize(option.size)}>
                <strong>{option.label}</strong>
                <span>{option.size} cards</span>
              </OptionButton>
            ))}
          </div>

          <p>You'll get a code to send to the other player. Want your own code? Type it here (optional).</p>
          <input
            className="text-input code-input"
            value={customCode}
            maxLength={12}
            placeholder="MOVIE123"
            onChange={(event) => setCustomCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
          <button className="primary-button full-button" type="submit" disabled={busy}>
            Create room <span>→</span>
          </button>
        </form>

        <form className="panel" onSubmit={handleJoin}>
          <div className="panel-label">HAVE A CODE?</div>
          <h3>Join a room</h3>
          <p>Enter the code the other player sent you.</p>
          <input
            className="text-input code-input"
            value={joinCode}
            maxLength={12}
            placeholder="ROOM CODE"
            onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
          />
          <button className="secondary-button full-button" type="submit" disabled={busy}>
            <Users size={16} /> Join room
          </button>
        </form>
      </section>

      {error && <p className="form-error" role="alert">{error}</p>}
    </>
  );
}

/** One choice in a radio-style group of option cards. */
function OptionButton({ selected, onSelect, disabled, children }: {
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`deck-option ${selected ? "is-selected" : ""}`}
      disabled={disabled}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}

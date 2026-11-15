import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Check, CircleHelp, Clapperboard, Copy, Eye, EyeOff, LogOut, RotateCcw, Send, Sparkles, Users } from "lucide-react";
import type { Character } from "./characters";
import { ensureSession, supabase } from "./lib/supabase";
import { pickBoardIds } from "./lib/board";
import {
  answerQuestion,
  askQuestion,
  createRoom,
  fetchSnapshot,
  joinRoom,
  makeGuess,
  rematch,
  subscribeToRoom,
  type RoomEvent,
  type RoomSnapshot,
} from "./lib/room";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const ROOM_KEY = "guesswho:room";
const NAME_KEY = "guesswho:name";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function storageGet(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function storageSet(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private browsing etc. — the game still works, it just won't remember.
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCharacter(value: unknown): value is Character {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Character>;
  return typeof item.id === "string"
    && typeof item.name === "string"
    && (item.kind === "ACTOR" || item.kind === "CHARACTER")
    && typeof item.subtitle === "string"
    && typeof item.initials === "string"
    && typeof item.color === "string"
    && !!item.tmdb
    && Number.isInteger(item.tmdb.personId);
}

function imageUrl(character: Character) {
  const path = character.tmdb?.profilePath;
  return path ? `${TMDB_IMAGE_BASE}${path.startsWith("/") ? path : `/${path}`}` : undefined;
}

function shareLink(code: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}?room=${encodeURIComponent(code)}`;
}

// ---------------------------------------------------------------------------
// Presentational pieces
// ---------------------------------------------------------------------------

function CharacterImage({ character, className }: { character: Character; className: string }) {
  const src = imageUrl(character);
  return (
    <>
      <span className="portrait-initials">{character.initials}</span>
      {src && (
        <img
          className={className}
          src={src}
          alt={`${character.name} portrait`}
          loading="lazy"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      )}
    </>
  );
}

function Avatar({ character, size = "large" }: { character?: Character; size?: "large" | "small" }) {
  return (
    <div
      className={`secret-avatar ${size === "small" ? "secret-avatar-small" : ""}`}
      style={{ background: `linear-gradient(145deg, ${character?.color ?? "#355c7d"}, #182333)` }}
    >
      {character ? <CharacterImage character={character} className="secret-image" /> : <span>?</span>}
    </div>
  );
}

function Shell({ pill, children }: { pill: string; children: ReactNode }) {
  return (
    <main className="page-shell app-state">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Guess Who home">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>guess<span className="brand-accent">who</span></span>
        </a>
        <div className="prototype-pill"><span /> {pill}</div>
      </header>
      <div className="shell-body">{children}</div>
      <footer className="credits-footer">
        <div>MADE FOR TWO MOVIE FANS <span>✦</span></div>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" aria-label="The Movie Database (TMDB)">
          <strong>TMDB</strong> · The Movie Database
        </a>
      </footer>
    </main>
  );
}

function StateMessage({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <section className="load-state" aria-live="polite">
      <div className="eyebrow"><Sparkles size={14} /> {eyebrow}</div>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// App: loads data, signs in, and routes between Home and a Room
// ---------------------------------------------------------------------------

function App() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [userId, setUserId] = useState("");
  const [fatalError, setFatalError] = useState("");
  const [roomId, setRoomId] = useState(() => storageGet(ROOM_KEY));

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/characters.json`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Could not load the character dataset (HTTP ${response.status}).`);
        const data: unknown = await response.json();
        if (!Array.isArray(data) || data.length === 0 || !data.every(isCharacter)) {
          throw new Error("The character dataset is empty or contains records with an invalid shape.");
        }
        setCharacters(data);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setFatalError(errorMessage(error));
      }
    })();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!supabase) return;
    ensureSession(supabase)
      .then(setUserId)
      .catch((error) => setFatalError(`Could not sign in: ${errorMessage(error)}`));
  }, []);

  const byId = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);

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

  if (characters.length === 0 || !userId) {
    return (
      <Shell pill="LOADING">
        <StateMessage eyebrow="GETTING THE BOARD READY" title="Loading…" />
      </Shell>
    );
  }

  if (!roomId) {
    return (
      <Shell pill="MULTIPLAYER">
        <Home client={supabase} characters={characters} onEnter={enterRoom} />
      </Shell>
    );
  }

  return (
    <RoomView
      key={roomId}
      client={supabase}
      roomId={roomId}
      userId={userId}
      characters={characters}
      byId={byId}
      onLeave={leaveRoom}
    />
  );
}

// ---------------------------------------------------------------------------
// Home: create or join a room
// ---------------------------------------------------------------------------

function Home({ client, characters, onEnter }: {
  client: SupabaseClient;
  characters: Character[];
  onEnter: (roomId: string) => void;
}) {
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
    void run(() => createRoom(client, name.trim(), pickBoardIds(characters), customCode));
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
          <p>You'll get a code to send to the other player. Want your own code? Type it here (optional).</p>
          <input
            className="text-input code-input"
            value={customCode}
            maxLength={12}
            placeholder="LOVE2026"
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

// ---------------------------------------------------------------------------
// RoomView: keeps a live snapshot of the room in sync via Supabase Realtime
// ---------------------------------------------------------------------------

function useRoomSnapshot(client: SupabaseClient, roomId: string) {
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

function RoomView({ client, roomId, userId, characters, byId, onLeave }: {
  client: SupabaseClient;
  roomId: string;
  userId: string;
  characters: Character[];
  byId: Map<string, Character>;
  onLeave: () => void;
}) {
  const { snapshot, missing, error, refresh } = useRoomSnapshot(client, roomId);

  if (missing) {
    return (
      <Shell pill="ROOM CLOSED">
        <StateMessage eyebrow="ROOM NOT FOUND" title="This room no longer exists.">
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
      {room.status === "waiting" ? (
        <Lobby code={room.code} players={snapshot.players.map((p) => p.name)} onLeave={onLeave} />
      ) : (
        <Game
          key={room.round}
          client={client}
          snapshot={snapshot}
          userId={userId}
          characters={characters}
          byId={byId}
          onChanged={refresh}
          onLeave={onLeave}
        />
      )}
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Lobby: share the code, wait for player two
// ---------------------------------------------------------------------------

function Lobby({ code, players, onLeave }: { code: string; players: string[]; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const link = shareLink(code);

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Guess Who?", text: `Join my Guess Who game! Room code: ${code}`, url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // User cancelled the share sheet, or clipboard is blocked — the code is still on screen.
    }
  }

  return (
    <section className="lobby">
      <div className="eyebrow"><Users size={14} /> WAITING FOR PLAYER TWO</div>
      <h1>Your room code</h1>
      <div className="room-code">{code}</div>
      <p>Send this code (or the link) to the other player. The game starts automatically when they join.</p>
      <button className="primary-button" onClick={() => void share()}>
        {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? "Link copied" : "Share invite link"}
      </button>
      <ul className="player-list">
        {players.map((name) => <li key={name}><Check size={14} /> {name}</li>)}
        <li className="waiting">Waiting for opponent…</li>
      </ul>
      <button className="text-button" onClick={onLeave}><LogOut size={14} /> Leave room</button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Game: the board plus the turn controls
// ---------------------------------------------------------------------------

function useEliminated(storageKey: string) {
  const [eliminated, setEliminated] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(storageGet(storageKey) || "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  const toggle = useCallback((id: string) => {
    setEliminated((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      storageSet(storageKey, JSON.stringify([...next]));
      return next;
    });
  }, [storageKey]);

  return [eliminated, toggle] as const;
}

function Game({ client, snapshot, userId, characters, byId, onChanged, onLeave }: {
  client: SupabaseClient;
  snapshot: RoomSnapshot;
  userId: string;
  characters: Character[];
  byId: Map<string, Character>;
  onChanged: () => Promise<void>;
  onLeave: () => void;
}) {
  const { room, players, events, secrets } = snapshot;
  const opponent = players.find((p) => p.user_id !== userId);
  const opponentName = opponent?.name ?? "Your opponent";
  const mySecret = byId.get(secrets.find((s) => s.user_id === userId)?.character_id ?? "");
  const theirSecret = byId.get(secrets.find((s) => s.user_id !== userId)?.character_id ?? "");
  const board = useMemo(
    () => room.board_ids.map((id) => byId.get(id)).filter((c): c is Character => !!c),
    [room.board_ids, byId],
  );

  const [eliminated, toggleEliminated] = useEliminated(`guesswho:elim:${room.id}:${room.round}`);
  const [showSecret, setShowSecret] = useState(true);
  const [question, setQuestion] = useState("");
  const [guessId, setGuessId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  const isFinished = room.status === "finished";
  const myTurn = room.current_turn === userId;
  const pendingQuestion = room.phase === "answer"
    ? [...events].reverse().find((e) => e.kind === "question")
    : undefined;
  const remaining = board.filter((c) => !eliminated.has(c.id));

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError("");
    try {
      await action();
      await onChanged();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    void act(async () => {
      await askQuestion(client, room.id, question.trim());
      setQuestion("");
    });
  }

  function submitGuess() {
    const guessed = byId.get(guessId);
    if (!guessed) {
      setActionError("Choose who you want to guess first.");
      return;
    }
    if (!window.confirm(`Guess ${guessed.name}? If you're wrong, your turn ends.`)) return;
    void act(async () => {
      await makeGuess(client, room.id, guessed.id);
      setGuessId("");
    });
  }

  function describe(event: RoomEvent) {
    const who = event.user_id === userId ? "You" : opponentName;
    switch (event.kind) {
      case "question": return <><strong>{who} asked:</strong> {event.body}</>;
      case "answer": return <><strong>{who}:</strong> {event.body}</>;
      case "guess": {
        const name = byId.get(event.body)?.name ?? "someone";
        return <><strong>{who} guessed {name}</strong> — {event.correct ? "correct! 🎉" : "wrong."}</>;
      }
      default: return <em>{event.body}</em>;
    }
  }

  let turnPanel: ReactNode;
  if (isFinished) {
    const iWon = room.winner_id === userId;
    turnPanel = (
      <section className="panel turn-panel finished-panel">
        <div className="panel-label">GAME OVER</div>
        <h3>{iWon ? "You won! 🎉" : `${opponentName} won!`}</h3>
        <div className="reveal-row">
          <div><Avatar character={mySecret} size="small" /><p>You were<br /><strong>{mySecret?.name ?? "?"}</strong></p></div>
          <div><Avatar character={theirSecret} size="small" /><p>{opponentName} was<br /><strong>{theirSecret?.name ?? "?"}</strong></p></div>
        </div>
        <button
          className="primary-button full-button"
          disabled={busy}
          onClick={() => void act(() => rematch(client, room.id, pickBoardIds(characters)))}
        >
          <RotateCcw size={16} /> Play again with a new board
        </button>
      </section>
    );
  } else if (myTurn && room.phase === "ask") {
    turnPanel = (
      <section className="panel turn-panel is-active">
        <div className="panel-label">YOUR TURN</div>
        <h3>Ask a yes/no question</h3>
        <form className="question-form" onSubmit={submitQuestion}>
          <input
            className="text-input"
            value={question}
            maxLength={200}
            placeholder="Is your character a woman?"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="primary-button" type="submit" disabled={busy || !question.trim()} aria-label="Ask question">
            <Send size={16} />
          </button>
        </form>
        <div className="divider">or make your final guess</div>
        <select value={guessId} onChange={(event) => setGuessId(event.target.value)}>
          <option value="">Choose a character…</option>
          {[...remaining].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="secondary-button full-button" disabled={busy || !guessId} onClick={submitGuess}>
          Lock in my guess <span>→</span>
        </button>
      </section>
    );
  } else if (myTurn) {
    turnPanel = (
      <section className="panel turn-panel">
        <div className="panel-label">WAITING</div>
        <h3>{opponentName} is answering…</h3>
        <p>“{pendingQuestion?.body}”</p>
      </section>
    );
  } else if (room.phase === "answer") {
    turnPanel = (
      <section className="panel turn-panel is-active">
        <div className="panel-label">{opponentName.toUpperCase()} ASKS</div>
        <h3>“{pendingQuestion?.body}”</h3>
        <p>Answer about your secret character{mySecret ? `, ${mySecret.name}` : ""}.</p>
        <div className="answer-row">
          <button className="primary-button" disabled={busy} onClick={() => void act(() => answerQuestion(client, room.id, "yes"))}>Yes</button>
          <button className="primary-button" disabled={busy} onClick={() => void act(() => answerQuestion(client, room.id, "no"))}>No</button>
          <button className="secondary-button" disabled={busy} onClick={() => void act(() => answerQuestion(client, room.id, "unsure"))}>Not sure</button>
        </div>
      </section>
    );
  } else {
    turnPanel = (
      <section className="panel turn-panel">
        <div className="panel-label">THEIR TURN</div>
        <h3>{opponentName} is thinking of a question…</h3>
        <p>Use the time to tidy up your board.</p>
      </section>
    );
  }

  return (
    <section className="game-layout">
      <div className="board-column">
        <div className="board-heading">
          <div>
            <div className="section-kicker">ROUND {room.round} · YOU VS {opponentName.toUpperCase()}</div>
            <h2>Meet the suspects</h2>
          </div>
          <div className="remaining-count"><strong>{remaining.length}</strong><span> / {board.length} left</span></div>
        </div>

        <div className="character-grid">
          {board.map((character) => {
            const isOut = eliminated.has(character.id);
            return (
              <button
                className={`character-card ${isOut ? "is-eliminated" : ""}`}
                key={character.id}
                onClick={() => toggleEliminated(character.id)}
                aria-pressed={isOut}
                title={isOut ? "Restore character" : "Eliminate character"}
              >
                <span className="portrait" style={{ background: `linear-gradient(145deg, ${character.color}, #182333)` }}>
                  <CharacterImage character={character} className="portrait-image" />
                  {isOut && <span className="eliminated-overlay"><EyeOff size={23} /></span>}
                </span>
                <span className="card-name">{character.name}</span>
                <span className="card-subtitle">{character.subtitle}</span>
              </button>
            );
          })}
        </div>
        <p className="board-hint"><CircleHelp size={14} /> Tap a card to eliminate it. Tap again to bring it back. Only you see your board.</p>
      </div>

      <aside className="side-column">
        {turnPanel}
        {actionError && <p className="form-error" role="alert">{actionError}</p>}

        {!isFinished && (
          <section className="panel secret-panel">
            <div className="panel-label">YOUR SECRET CHARACTER</div>
            <Avatar character={showSecret ? mySecret : undefined} />
            <h3>{showSecret ? mySecret?.name ?? "Unknown" : "Hidden"}</h3>
            <p>{showSecret ? mySecret?.subtitle : "Tap to peek."}</p>
            <button className="secondary-button full-button" onClick={() => setShowSecret((v) => !v)}>
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              {showSecret ? "Hide" : "Show"}
            </button>
          </section>
        )}

        <section className="panel log-panel">
          <div className="panel-label">GAME LOG</div>
          <ol>
            {[...events].reverse().map((event) => <li key={event.id}>{describe(event)}</li>)}
          </ol>
          <button className="text-button" onClick={onLeave}><LogOut size={14} /> Leave room</button>
        </section>
      </aside>
    </section>
  );
}

export default App;

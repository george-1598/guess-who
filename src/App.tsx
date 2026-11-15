import {
  useCallback, useEffect, useMemo, useRef, useState,
  type FormEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  Cake, Check, CircleHelp, Clapperboard, Copy, Dices, ExternalLink, Eye, EyeOff, Film, Lock, LogOut,
  MapPin, RotateCcw, ScrollText, Send, Shuffle, SlidersHorizontal, Sparkles, Star, Undo2, Users, X,
} from "lucide-react";
import { FiltersSheet } from "./components/FiltersSheet";
import type { Character } from "./characters";
import { ensureSession, supabase } from "./lib/supabase";
import { pickBoardIds } from "./lib/board";
import {
  answerQuestion,
  askQuestion,
  chooseSecret,
  createRoom,
  fetchSnapshot,
  joinRoom,
  makeGuess,
  rematch,
  subscribeToRoom,
  type Deck,
  type RoomEvent,
  type RoomSnapshot,
  type SecretMode,
} from "./lib/room";

type Decks = Record<Deck, Character[]>;

// Display names for the room options. Rename freely: only these strings change.
const POOL_NAMES: Record<Deck, string> = { famous: "Famous", random: "Random" };
const SECRET_NAMES: Record<SecretMode, string> = { random: "Classic", choose: "Director's Cut" };

/** "Famous", "Random", "Famous Director's Cut", "Random Director's Cut". */
function modeLabel(deck: Deck | undefined, secretMode: SecretMode | undefined) {
  const pool = POOL_NAMES[deck ?? "famous"];
  return secretMode === "choose" ? `${pool} ${SECRET_NAMES.choose}` : pool;
}

const BOARD_SIZES = [
  { size: 24, label: "Easy" },
  { size: 36, label: "Medium" },
  { size: 48, label: "Hard" },
] as const;
const SIZE_KEY = "guesswho:boardSize";

/** "Easy · 24 cards" — picks the nearest label for any board size. */
function difficultyLabel(cards: number) {
  const level = cards <= 24 ? "Easy" : cards <= 36 ? "Medium" : "Hard";
  return `${level} · ${cards} cards`;
}

/** The pool a room deals from; falls back to the famous list if the random one isn't available. */
function deckPool(decks: Decks, deck: Deck | undefined): Character[] {
  return deck === "random" && decks.random.length > 0 ? decks.random : decks.famous;
}

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

async function loadDeck(file: string, signal?: AbortSignal): Promise<Character[]> {
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
      style={{ background: `linear-gradient(145deg, ${character?.color ?? "#355c7d"}, #14181c)` }}
    >
      {character ? <CharacterImage character={character} className="secret-image" /> : <span>?</span>}
    </div>
  );
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function formatDate(date: Date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "62 years old · born 2 Sep 1964", or "Born … · died … (aged 28)". */
function lifeText(character: Character) {
  const born = parseDate(character.details?.birthday);
  if (!born) return undefined;
  const died = parseDate(character.details?.deathday);
  const end = died ?? new Date();
  let age = end.getFullYear() - born.getFullYear();
  if (end < new Date(end.getFullYear(), born.getMonth(), born.getDate())) age -= 1;
  return died
    ? `Born ${formatDate(born)} · died ${formatDate(died)} (aged ${age})`
    : `${age} years old · born ${formatDate(born)}`;
}

/** Bottom sheet (phone) / dialog (computer) with an actor's photo and facts. */
function ActorSheet({ character, onClose, action }: {
  character: Character;
  onClose: () => void;
  action?: { label: string; onClick: () => void };
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // keep the board from scrolling behind the sheet
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const details = character.details;
  const life = lifeText(character);
  const knownFor = details?.knownFor?.length ? details.knownFor : [];
  const hasFacts = !!(life || details?.placeOfBirth || knownFor.length || details?.bio);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button ref={closeRef} className="sheet-close" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
        <div className="sheet-photo" style={{ background: `linear-gradient(145deg, ${character.color}, #14181c)` }}>
          <CharacterImage character={character} className="portrait-image" />
        </div>
        <div className="sheet-body">
          <h2 id="sheet-title">{character.name}</h2>
          <ul className="fact-list">
            {life && <li><Cake size={15} /> <span>{life}</span></li>}
            {details?.placeOfBirth && <li><MapPin size={15} /> <span>{details.placeOfBirth}</span></li>}
            {knownFor.length > 0 && <li><Film size={15} /> <span>{knownFor.join(", ")}</span></li>}
          </ul>
          {details?.bio && <p className="sheet-bio">{details.bio}</p>}
          {!hasFacts && <p className="sheet-bio">{character.subtitle}</p>}
          <div className="sheet-actions">
            {action && (
              <button className="primary-button" onClick={action.onClick}>{action.label}</button>
            )}
            <a
              className="secondary-button"
              href={`https://www.themoviedb.org/person/${character.tmdb?.personId ?? ""}`}
              target="_blank"
              rel="noreferrer"
            >
              More on TMDB <ExternalLink size={14} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Press-and-hold (phone) or right-click (computer) opens details; a normal tap still
 * does the card's usual action. One shared timer is enough since only one finger presses.
 */
function useLongPress(onLongPress: (id: string) => void) {
  const state = useRef({ timer: 0, x: 0, y: 0, fired: false });

  const cancel = useCallback(() => window.clearTimeout(state.current.timer), []);

  const bind = useCallback((id: string, onTap: () => void) => ({
    onPointerDown: (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      const s = state.current;
      s.fired = false;
      s.x = event.clientX;
      s.y = event.clientY;
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(() => {
        s.fired = true;
        navigator.vibrate?.(15);
        onLongPress(id);
      }, 450);
    },
    onPointerMove: (event: ReactPointerEvent) => {
      const s = state.current;
      if (Math.hypot(event.clientX - s.x, event.clientY - s.y) > 10) window.clearTimeout(s.timer);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (event: ReactMouseEvent) => {
      event.preventDefault(); // no "save image" menu on phones; right-click opens details on computers
      cancel();
      state.current.fired = true;
      onLongPress(id);
    },
    onClick: () => {
      if (state.current.fired) {
        state.current.fired = false; // this click is the end of a long-press, not a tap
        return;
      }
      onTap();
    },
  }), [cancel, onLongPress]);

  return bind;
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
  const [decks, setDecks] = useState<Decks | null>(null);
  const [userId, setUserId] = useState("");
  const [fatalError, setFatalError] = useState("");
  const [roomId, setRoomId] = useState(() => storageGet(ROOM_KEY));

  const loadDecks = useCallback(async (signal?: AbortSignal) => {
    const [famous, random] = await Promise.all([
      loadDeck("characters.json", signal),
      // The random pool is optional: until it's imported, only "Famous" is offered.
      loadDeck("random-actors.json", signal).catch((error: unknown) => {
        if (signal?.aborted) throw error;
        return [] as Character[];
      }),
    ]);
    if (!signal?.aborted) setDecks({ famous, random });
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

// ---------------------------------------------------------------------------
// Home: create or join a room
// ---------------------------------------------------------------------------

function Home({ client, decks, onEnter }: {
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
            <button
              type="button"
              role="radio"
              aria-checked={deck === "famous"}
              className={`deck-option ${deck === "famous" ? "is-selected" : ""}`}
              onClick={() => setDeck("famous")}
            >
              <Star size={16} />
              <strong>{POOL_NAMES.famous}</strong>
              <span>{decks.famous.length} well-known stars</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={deck === "random"}
              className={`deck-option ${deck === "random" ? "is-selected" : ""}`}
              disabled={decks.random.length === 0}
              onClick={() => setDeck("random")}
            >
              <Shuffle size={16} />
              <strong>{POOL_NAMES.random}</strong>
              <span>{decks.random.length > 0 ? `${decks.random.length} actors from top movies` : "Not imported yet"}</span>
            </button>
          </div>
          <p>Who picks the secret actors?</p>
          <div className="deck-picker" role="radiogroup" aria-label="Secret mode">
            <button
              type="button"
              role="radio"
              aria-checked={secretMode === "random"}
              className={`deck-option ${secretMode === "random" ? "is-selected" : ""}`}
              onClick={() => setSecretMode("random")}
            >
              <Dices size={16} />
              <strong>{SECRET_NAMES.random}</strong>
              <span>The game deals them at random</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={secretMode === "choose"}
              className={`deck-option ${secretMode === "choose" ? "is-selected" : ""}`}
              onClick={() => setSecretMode("choose")}
            >
              <Clapperboard size={16} />
              <strong>{SECRET_NAMES.choose}</strong>
              <span>You pick who they hunt for</span>
            </button>
          </div>
          <p>How many cards on the board?</p>
          <div className="deck-picker cols-3" role="radiogroup" aria-label="Difficulty">
            {BOARD_SIZES.map((option) => (
              <button
                key={option.size}
                type="button"
                role="radio"
                aria-checked={boardSize === option.size}
                className={`deck-option ${boardSize === option.size ? "is-selected" : ""}`}
                onClick={() => setBoardSize(option.size)}
              >
                <strong>{option.label}</strong>
                <span>{option.size} cards</span>
              </button>
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

function RoomView({ client, roomId, userId, decks, byId, onReloadDecks, onLeave }: {
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

// ---------------------------------------------------------------------------
// Lobby: share the code, wait for player two
// ---------------------------------------------------------------------------

function Lobby({ code, mode, players, onLeave }: { code: string; mode: string; players: string[]; onLeave: () => void }) {
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
      <div className="mode-pill">{mode}</div>
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

function Game({ client, snapshot, userId, decks, byId, onChanged, onLeave }: {
  client: SupabaseClient;
  snapshot: RoomSnapshot;
  userId: string;
  decks: Decks;
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

  const { eliminated, toggle: toggleEliminated, setMany, reset: resetBoard } = useEliminated(`guesswho:elim:${room.id}:${room.round}`);
  const genderGroups = useMemo(() => ([
    { key: "women", label: "women", ids: board.filter((c) => c.attributes?.gender === "WOMAN").map((c) => c.id) },
    { key: "men", label: "men", ids: board.filter((c) => c.attributes?.gender === "MAN").map((c) => c.id) },
  ]).filter((group) => group.ids.length > 0), [board]);
  const [showSecret, setShowSecret] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [guessId, setGuessId] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  // Director's Cut: the actor currently highlighted (not yet locked in).
  const [pickedId, setPickedId] = useState("");
  // Actor whose details panel is open.
  const [infoId, setInfoId] = useState("");
  const bindPress = useLongPress(setInfoId);
  const closeInfo = useCallback(() => setInfoId(""), []);
  // Filters panel, and the cards the last filter flipped (for "Undo filter").
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [undoIds, setUndoIds] = useState<string[]>([]);
  const closeFilters = useCallback(() => setFiltersOpen(false), []);
  const applyFilter = useCallback((ids: string[]) => {
    setMany(ids, true);
    setUndoIds(ids);
    setFiltersOpen(false);
  }, [setMany]);
  const undoFilter = useCallback(() => {
    setMany(undoIds, false);
    setUndoIds([]);
  }, [setMany, undoIds]);
  const isChoosing = room.status === "choosing";
  const opponentPicked = events.some((e) => e.kind === "system" && !!opponent && e.user_id === opponent.user_id);

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

  // The details panel's main button does the same thing a tap on that card would.
  const infoCharacter = byId.get(infoId);
  let infoAction: { label: string; onClick: () => void } | undefined;
  if (infoCharacter && room.board_ids.includes(infoCharacter.id) && !isFinished) {
    const id = infoCharacter.id;
    infoAction = isChoosing
      ? { label: "Pick as my secret", onClick: () => { setPickedId(id); closeInfo(); } }
      : {
          label: eliminated.has(id) ? "Flip back up" : "Flip down",
          onClick: () => { toggleEliminated(id); closeInfo(); },
        };
  }

  let turnPanel: ReactNode;
  if (isChoosing) {
    const picked = byId.get(pickedId);
    let status: string;
    if (!mySecret) {
      status = `Tap an actor on the board, then lock them in.${opponentPicked ? ` ${opponentName} has already picked.` : ""}`;
    } else if (opponentPicked) {
      status = "Both picked — starting…";
    } else {
      status = `Waiting for ${opponentName} to pick. You can still change yours.`;
    }
    turnPanel = (
      <section className="panel turn-panel is-active">
        <div className="panel-label">{SECRET_NAMES.choose.toUpperCase()}</div>
        <h3>{mySecret ? `You picked ${mySecret.name}` : `Pick who ${opponentName} has to find`}</h3>
        <p>{status}</p>
        <button
          className="primary-button full-button"
          disabled={busy || !picked || picked.id === mySecret?.id}
          onClick={() => {
            if (!picked) return;
            void act(async () => {
              await chooseSecret(client, room.id, picked.id);
              setPickedId("");
            });
          }}
        >
          <Lock size={16} /> {picked ? `Lock in ${picked.name}` : "Tap an actor first"}
        </button>
      </section>
    );
  } else if (isFinished) {
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
          onClick={() => void act(() => rematch(
            client, room.id, pickBoardIds(deckPool(decks, room.deck), room.board_ids.length),
          ))}
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
    <div className="game">
      {/* Your secret actor, always at the top of the page */}
      {!isFinished && (
        <section className="secret-bar" aria-label="Your secret actor">
          <Avatar character={showSecret ? mySecret : undefined} size="small" />
          <div className="secret-bar-text">
            <span className="panel-label">Your secret actor</span>
            <strong>{showSecret ? mySecret?.name ?? (isChoosing ? "Not picked yet" : "Unknown") : "Hidden"}</strong>
            {showSecret && mySecret && <span>{mySecret.subtitle}</span>}
          </div>
          <div className="secret-bar-actions">
            {showSecret && mySecret && (
              <button className="tool-chip" onClick={() => setInfoId(mySecret.id)}>
                <CircleHelp size={14} /> About
              </button>
            )}
            <button className="tool-chip" onClick={() => setShowSecret((v) => !v)}>
              {showSecret ? <EyeOff size={14} /> : <Eye size={14} />} {showSecret ? "Hide" : "Show"}
            </button>
          </div>
        </section>
      )}

    <section className="game-layout">
      <div className="board-column">
        <div className="board-heading">
          <div>
            <div className="section-kicker">
              ROUND {room.round} · {modeLabel(room.deck, room.secret_mode).toUpperCase()} · YOU VS {opponentName.toUpperCase()}
            </div>
            <h2>{isChoosing ? "Pick your secret actor" : "Meet the suspects"}</h2>
          </div>
          <div className="remaining-count"><strong>{remaining.length}</strong><span> / {board.length} left</span></div>
        </div>

        {!isChoosing && <div className="board-tools" aria-label="Board shortcuts">
          <button className="tool-chip tool-chip-primary" onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal size={14} /> Filters
          </button>
          {genderGroups.map((group) => {
            const allOut = group.ids.every((id) => eliminated.has(id));
            return (
              <button
                key={group.key}
                className={`tool-chip ${allOut ? "is-on" : ""}`}
                aria-pressed={allOut}
                onClick={() => setMany(group.ids, !allOut)}
              >
                {allOut ? <Eye size={14} /> : <EyeOff size={14} />}
                {allOut ? `Show ${group.label}` : `Hide ${group.label}`} ({group.ids.length})
              </button>
            );
          })}
          {undoIds.some((id) => eliminated.has(id)) && (
            <button className="tool-chip" onClick={undoFilter}>
              <Undo2 size={14} /> Undo filter
            </button>
          )}
          <button
            className="tool-chip"
            onClick={() => { resetBoard(); setUndoIds([]); }}
            disabled={eliminated.size === 0}
          >
            <RotateCcw size={14} /> Reset board
          </button>
        </div>}

        <div className="character-grid">
          {board.map((character) => {
            const isOut = !isChoosing && eliminated.has(character.id);
            const isPicked = isChoosing && (pickedId ? pickedId === character.id : mySecret?.id === character.id);
            return (
              <button
                className={`character-card ${isOut ? "is-eliminated" : ""} ${isPicked ? "is-picked" : ""}`}
                key={character.id}
                {...bindPress(character.id, () => (isChoosing ? setPickedId(character.id) : toggleEliminated(character.id)))}
                aria-pressed={isChoosing ? isPicked : isOut}
                title={isChoosing ? `Pick ${character.name}` : isOut ? "Restore character" : "Eliminate character"}
              >
                <span className="portrait" style={{ background: `linear-gradient(145deg, ${character.color}, #14181c)` }}>
                  <CharacterImage character={character} className="portrait-image" />
                  {isOut && <span className="eliminated-overlay"><EyeOff size={23} /></span>}
                </span>
                <span className="card-name">{character.name}</span>
                <span className="card-subtitle">{character.subtitle}</span>
              </button>
            );
          })}
        </div>
        <p className="board-hint">
          <CircleHelp size={14} />
          <span>
            {isChoosing
              ? `Tap the actor ${opponentName} will have to find. They can't see your pick.`
              : "Tap a card to eliminate it. Tap again to bring it back. Only you see your board."}
            {" "}Press and hold a card (right-click on a computer) to see who they are.
          </span>
        </p>
      </div>

      <aside className="side-column">
        {turnPanel}
        {actionError && <p className="form-error" role="alert">{actionError}</p>}
      </aside>
    </section>

      {/* Bottom of the page: game log (folded by default) and leave room */}
      <section className="game-footer">
        <div className="game-footer-buttons">
          <button className="secondary-button" aria-expanded={logOpen} onClick={() => setLogOpen((v) => !v)}>
            <ScrollText size={16} /> {logOpen ? "Hide game log" : `Game log (${events.length})`}
          </button>
          <button
            className="danger-button"
            onClick={() => {
              if (window.confirm("Leave this room? You can come back later with the same room code.")) onLeave();
            }}
          >
            <LogOut size={16} /> Leave room
          </button>
        </div>
        {logOpen && (
          <ol className="log-list">
            {[...events].reverse().map((event) => <li key={event.id}>{describe(event)}</li>)}
          </ol>
        )}
      </section>

      {infoCharacter && (
        <ActorSheet character={infoCharacter} onClose={closeInfo} action={infoAction} />
      )}
      {filtersOpen && (
        <FiltersSheet board={board} eliminated={eliminated} onFlipDown={applyFilter} onClose={closeFilters} />
      )}
    </div>
  );
}

export default App;

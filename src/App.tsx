import { useEffect, useMemo, useState } from "react";
import { RotateCcw, Sparkles, Eye, EyeOff, CircleHelp, Clapperboard } from "lucide-react";
import type { Character } from "./characters";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

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

function App() {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [secretId, setSecretId] = useState("");
  const [eliminated, setEliminated] = useState<Set<string>>(() => new Set());
  const [guessId, setGuessId] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [message, setMessage] = useState("Pick a character in your head, then start eliminating cards.");

  useEffect(() => {
    const controller = new AbortController();

    async function loadCharacters() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/characters.json`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Could not load the character dataset (HTTP ${response.status}).`);
        }
        const data: unknown = await response.json();
        if (!Array.isArray(data) || data.length === 0 || !data.every(isCharacter)) {
          throw new Error("The character dataset is empty or contains records with an invalid shape.");
        }
        const loadedCharacters = data as Character[];
        setCharacters(loadedCharacters);
        setSecretId(pickSecret(loadedCharacters).id);
        setLoadError("");
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
        setLoadError(error instanceof Error ? error.message : "An unknown error occurred while loading characters.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }

    void loadCharacters();
    return () => controller.abort();
  }, []);

  const secret = useMemo(
    () => characters.find((character) => character.id === secretId),
    [characters, secretId],
  );
  const remaining = characters.length - eliminated.size;

  function toggleEliminated(id: string) {
    setEliminated((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function newGame() {
    if (characters.length === 0) return;
    setSecretId(pickSecret(characters).id);
    setEliminated(new Set());
    setGuessId("");
    setShowSecret(false);
    setMessage("New round started. Your secret character has changed.");
  }

  function submitGuess() {
    if (!guessId) {
      setMessage("Choose a character first.");
      return;
    }
    const guessed = characters.find((character) => character.id === guessId);
    if (guessId === secretId) {
      setMessage(`You got it! The character was ${secret?.name}. 🎉`);
    } else {
      setMessage(`${guessed?.name ?? "That character"} isn't the secret character. Keep investigating!`);
    }
  }

  if (isLoading || loadError || !secret) {
    return (
      <main className="page-shell app-state">
        <header className="topbar">
          <a className="brand" href="./" aria-label="Guess Who home">
            <span className="brand-mark"><Clapperboard size={19} /></span>
            <span>guess<span className="brand-accent">who</span></span>
          </a>
          <div className="prototype-pill"><span /> DATA-DRIVEN PROTOTYPE</div>
        </header>
        <section className="load-state" aria-live="polite">
          {isLoading ? (
            <>
              <div className="eyebrow"><Sparkles size={14} /> GETTING THE BOARD READY</div>
              <h1>Loading characters…</h1>
              <p>Fetching the imported character dataset.</p>
            </>
          ) : (
            <>
              <div className="eyebrow"><CircleHelp size={14} /> CHARACTER DATASET NEEDED</div>
              <h1>We couldn't load the board.</h1>
              <p>{loadError || "No valid character data was found."}</p>
              <p>From your project folder, run the TMDB importer and refresh this page:</p>
              <pre>set -a && source .env.local && set +a
npm run import:tmdb</pre>
            </>
          )}
        </section>
        <footer>MADE FOR TWO MOVIE FANS <span>✦</span> MULTIPLAYER COMING NEXT</footer>
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="topbar">
        <a className="brand" href="./" aria-label="Guess Who home">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>guess<span className="brand-accent">who</span></span>
        </a>
        <div className="prototype-pill"><span /> TMDB DATASET</div>
      </header>

      <section className="hero">
        <div className="eyebrow"><Sparkles size={14} /> THE MOVIE & POP CULTURE EDITION</div>
        <h1>Who am I <span>thinking of?</span></h1>
        <p>Ask clever questions. Narrow down the possibilities. Make the guess.</p>
      </section>

      <section className="game-layout">
        <div className="board-column">
          <div className="board-heading">
            <div>
              <div className="section-kicker">YOUR CHARACTER BOARD</div>
              <h2>Meet the suspects</h2>
            </div>
            <div className="remaining-count"><strong>{remaining}</strong><span> / {characters.length} left</span></div>
          </div>

          <div className="character-grid">
            {characters.map((character) => {
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
                    <span className="portrait-kind">{character.kind === "ACTOR" ? "ACTOR" : "CHARACTER"}</span>
                    {isOut && <span className="eliminated-overlay"><EyeOff size={23} /></span>}
                  </span>
                  <span className="card-name">{character.name}</span>
                  <span className="card-subtitle">{character.subtitle}</span>
                </button>
              );
            })}
          </div>
          <p className="board-hint"><CircleHelp size={14} /> Tap a card to eliminate it. Tap again to bring it back.</p>
        </div>

        <aside className="side-column">
          <section className="panel secret-panel">
            <div className="panel-label">YOUR SECRET CHARACTER</div>
            <div className="secret-avatar" style={{ background: `linear-gradient(145deg, ${secret.color}, #182333)` }}>
              {showSecret ? <CharacterImage character={secret} className="secret-image" /> : <span>?</span>}
            </div>
            {showSecret ? (
              <>
                <h3>{secret.name}</h3>
                <p>{secret.subtitle}</p>
              </>
            ) : (
              <>
                <h3>It's a mystery</h3>
                <p>Your secret character is hidden.</p>
              </>
            )}
            <button className="secondary-button full-button" onClick={() => setShowSecret((value) => !value)}>
              {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
              {showSecret ? "Hide character" : "Reveal for testing"}
            </button>
            <p className="testing-note">Reveal is only here while we build the prototype.</p>
          </section>

          <section className="panel guess-panel">
            <div className="panel-label">READY TO GUESS?</div>
            <h3>Make your final guess</h3>
            <p>Select who you think the secret character is.</p>
            <select value={guessId} onChange={(event) => setGuessId(event.target.value)}>
              <option value="">Choose a character…</option>
              {characters.map((character) => <option key={character.id} value={character.id}>{character.name}</option>)}
            </select>
            <button className="primary-button full-button" onClick={submitGuess}>Lock in my guess <span>→</span></button>
          </section>

          <section className="panel status-panel">
            <div className="panel-label">ROUND STATUS</div>
            <p>{message}</p>
            <button className="text-button" onClick={newGame}><RotateCcw size={14} /> Start a new round</button>
          </section>
        </aside>
      </section>

      <footer className="credits-footer">
        <div>MADE FOR TWO MOVIE FANS <span>✦</span> MULTIPLAYER COMING NEXT</div>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" aria-label="The Movie Database (TMDB)">
          <strong>TMDB</strong> · The Movie Database
        </a>
      </footer>
    </main>
  );
}

function pickSecret(pool: Character[]) {
  return pool[Math.floor(Math.random() * pool.length)];
}

export default App;

import { useState, type FormEvent, type ReactNode } from "react";
import { Lock, RotateCcw, Send, Target } from "lucide-react";
import type { Character } from "../characters";
import { SECRET_NAMES } from "../lib/decks";
import type { Room, RoomEvent } from "../lib/room";
import { Avatar } from "./CharacterImage";

/**
 * The "what do I do now?" panel. Each action returns true when it succeeded
 * (errors are shown by the Game screen).
 */
export function TurnPanel({
  room, userId, opponentName, mySecret, theirSecret, opponentPicked, pendingQuestion, remaining, picked, busy,
  mySkips, opponentSkips, onLockIn, onAsk, onAnswer, onGuess, onRematch,
}: {
  room: Room;
  userId: string;
  opponentName: string;
  mySecret?: Character;
  theirSecret?: Character;
  /** Director's Cut: the opponent has locked in their pick. */
  opponentPicked: boolean;
  pendingQuestion?: RoomEvent;
  /** Face-up cards, offered in the guess list. */
  remaining: Character[];
  /** Director's Cut: the card currently highlighted on the board. */
  picked?: Character;
  busy: boolean;
  /** Turns each player still has to miss after wrong out-of-turn guesses. */
  mySkips: number;
  opponentSkips: number;
  onLockIn: (character: Character) => Promise<boolean>;
  onAsk: (question: string) => Promise<boolean>;
  onAnswer: (answer: "yes" | "no" | "unsure") => Promise<boolean>;
  onGuess: (character: Character) => Promise<boolean>;
  onRematch: () => Promise<boolean>;
}) {
  const [question, setQuestion] = useState("");
  const myTurn = room.current_turn === userId;
  const canAsk = myTurn && room.phase === "ask";

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (question.trim() && await onAsk(question.trim())) setQuestion("");
  }

  if (room.status === "choosing") {
    let status: string;
    if (!mySecret) {
      status = `Tap an actor on the board, then lock them in.${opponentPicked ? ` ${opponentName} has already picked.` : ""}`;
    } else if (opponentPicked) {
      status = "Both picked — starting…";
    } else {
      status = `Waiting for ${opponentName} to pick. You can still change yours.`;
    }
    return (
      <section className="panel turn-panel is-active">
        <div className="panel-label">{SECRET_NAMES.choose}</div>
        <h3>{mySecret ? `You picked ${mySecret.name}` : `Pick who ${opponentName} has to find`}</h3>
        <p>{status}</p>
        <button
          className="primary-button full-button"
          disabled={busy || !picked || picked.id === mySecret?.id}
          onClick={() => { if (picked) void onLockIn(picked); }}
        >
          <Lock size={16} /> {picked ? `Lock in ${picked.name}` : "Tap an actor first"}
        </button>
      </section>
    );
  }

  if (room.status === "finished") {
    const iWon = room.winner_id === userId;
    return (
      <section className="panel turn-panel finished-panel">
        <div className="panel-label">Game over</div>
        <h3>{iWon ? "You won! 🎉" : `${opponentName} won!`}</h3>
        <div className="reveal-row">
          <div><Avatar character={mySecret} size="small" /><p>You were<br /><strong>{mySecret?.name ?? "?"}</strong></p></div>
          <div><Avatar character={theirSecret} size="small" /><p>{opponentName} was<br /><strong>{theirSecret?.name ?? "?"}</strong></p></div>
        </div>
        <button className="primary-button full-button" disabled={busy} onClick={() => void onRematch()}>
          <RotateCcw size={16} /> Play again with a new board
        </button>
      </section>
    );
  }

  // ---- Playing: what this turn is about ----
  let label: string;
  let body: ReactNode;
  let active = false;

  if (canAsk) {
    active = true;
    label = "Your turn";
    body = (
      <>
        <h3>Ask a yes/no question</h3>
        <form className="question-form" onSubmit={(event) => void submitQuestion(event)}>
          <input
            className="text-input"
            value={question}
            maxLength={200}
            placeholder="Is your actor a woman?"
            onChange={(event) => setQuestion(event.target.value)}
          />
          <button className="primary-button" type="submit" disabled={busy || !question.trim()} aria-label="Ask question">
            <Send size={16} />
          </button>
        </form>
      </>
    );
  } else if (myTurn) {
    label = "Waiting";
    body = (
      <>
        <h3>{opponentName} is answering…</h3>
        <p>“{pendingQuestion?.body}”</p>
      </>
    );
  } else if (room.phase === "answer") {
    active = true;
    label = `${opponentName} asks`;
    body = (
      <>
        <h3>“{pendingQuestion?.body}”</h3>
        <p>Answer about your secret actor{mySecret ? `, ${mySecret.name}` : ""}.</p>
        <div className="answer-row">
          <button className="primary-button" disabled={busy} onClick={() => void onAnswer("yes")}>Yes</button>
          <button className="primary-button" disabled={busy} onClick={() => void onAnswer("no")}>No</button>
          <button className="secondary-button" disabled={busy} onClick={() => void onAnswer("unsure")}>Not sure</button>
        </div>
      </>
    );
  } else {
    label = "Their turn";
    body = (
      <>
        <h3>{opponentName} is thinking of a question…</h3>
        <p>Use the time to tidy up your board.</p>
      </>
    );
  }

  return (
    <section className={`panel turn-panel ${active ? "is-active" : ""}`}>
      <div className="panel-label">{label}</div>
      {body}

      {(mySkips > 0 || opponentSkips > 0) && (
        <div className="penalty-note">
          {mySkips > 0 && <p>⏭ You'll miss your next {mySkips === 1 ? "turn" : `${mySkips} turns`} (wrong guess).</p>}
          {opponentSkips > 0 && (
            <p>⏭ {opponentName} will miss their next {opponentSkips === 1 ? "turn" : `${opponentSkips} turns`} (wrong guess).</p>
          )}
        </div>
      )}

      <GuessBox
        remaining={remaining}
        busy={busy}
        // On your own turn, guessing is part of the normal choice; otherwise it's tucked away.
        startOpen={canAsk}
        penalty={canAsk ? "If you're wrong, your turn ends." : "If you're wrong, you'll miss your next turn."}
        onGuess={onGuess}
      />
    </section>
  );
}

/** "I know who it is!" — pick a face-up actor and lock in a guess, at any time during play. */
function GuessBox({ remaining, busy, startOpen, penalty, onGuess }: {
  remaining: Character[];
  busy: boolean;
  startOpen: boolean;
  penalty: string;
  onGuess: (character: Character) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [guessId, setGuessId] = useState("");
  const isOpen = open || startOpen;

  async function submit() {
    const guessed = remaining.find((c) => c.id === guessId);
    if (!guessed) return;
    if (!window.confirm(`Guess ${guessed.name}? ${penalty}`)) return;
    if (await onGuess(guessed)) {
      setGuessId("");
      setOpen(false);
    }
  }

  if (!isOpen) {
    return (
      <button className="secondary-button full-button guess-toggle" onClick={() => setOpen(true)}>
        <Target size={16} /> I know who it is — guess now
      </button>
    );
  }

  return (
    <div className="guess-box">
      <div className="divider">{startOpen ? "or make your final guess" : "make your guess"}</div>
      <select value={guessId} onChange={(event) => setGuessId(event.target.value)} aria-label="Your guess">
        <option value="">Choose an actor…</option>
        {[...remaining].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      <p className="guess-warning">{penalty}</p>
      <div className="guess-actions">
        {!startOpen && (
          <button className="text-button" onClick={() => { setOpen(false); setGuessId(""); }}>Cancel</button>
        )}
        <button className="secondary-button" disabled={busy || !guessId} onClick={() => void submit()}>
          <Target size={16} /> Lock in my guess
        </button>
      </div>
    </div>
  );
}

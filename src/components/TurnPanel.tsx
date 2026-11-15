import { useState, type FormEvent } from "react";
import { Lock, RotateCcw, Send } from "lucide-react";
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
  onLockIn, onAsk, onAnswer, onGuess, onRematch,
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
  onLockIn: (character: Character) => Promise<boolean>;
  onAsk: (question: string) => Promise<boolean>;
  onAnswer: (answer: "yes" | "no" | "unsure") => Promise<boolean>;
  onGuess: (character: Character) => Promise<boolean>;
  onRematch: () => Promise<boolean>;
}) {
  const [question, setQuestion] = useState("");
  const [guessId, setGuessId] = useState("");
  const myTurn = room.current_turn === userId;

  async function submitQuestion(event: FormEvent) {
    event.preventDefault();
    if (question.trim() && await onAsk(question.trim())) setQuestion("");
  }

  async function submitGuess() {
    const guessed = remaining.find((c) => c.id === guessId);
    if (!guessed) return;
    if (!window.confirm(`Guess ${guessed.name}? If you're wrong, your turn ends.`)) return;
    if (await onGuess(guessed)) setGuessId("");
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

  if (myTurn && room.phase === "ask") {
    return (
      <section className="panel turn-panel is-active">
        <div className="panel-label">Your turn</div>
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
        <div className="divider">or make your final guess</div>
        <select value={guessId} onChange={(event) => setGuessId(event.target.value)}>
          <option value="">Choose an actor…</option>
          {[...remaining].sort((a, b) => a.name.localeCompare(b.name)).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="secondary-button full-button" disabled={busy || !guessId} onClick={() => void submitGuess()}>
          Lock in my guess <span>→</span>
        </button>
      </section>
    );
  }

  if (myTurn) {
    return (
      <section className="panel turn-panel">
        <div className="panel-label">Waiting</div>
        <h3>{opponentName} is answering…</h3>
        <p>“{pendingQuestion?.body}”</p>
      </section>
    );
  }

  if (room.phase === "answer") {
    return (
      <section className="panel turn-panel is-active">
        <div className="panel-label">{opponentName} asks</div>
        <h3>“{pendingQuestion?.body}”</h3>
        <p>Answer about your secret actor{mySecret ? `, ${mySecret.name}` : ""}.</p>
        <div className="answer-row">
          <button className="primary-button" disabled={busy} onClick={() => void onAnswer("yes")}>Yes</button>
          <button className="primary-button" disabled={busy} onClick={() => void onAnswer("no")}>No</button>
          <button className="secondary-button" disabled={busy} onClick={() => void onAnswer("unsure")}>Not sure</button>
        </div>
      </section>
    );
  }

  return (
    <section className="panel turn-panel">
      <div className="panel-label">Their turn</div>
      <h3>{opponentName} is thinking of a question…</h3>
      <p>Use the time to tidy up your board.</p>
    </section>
  );
}

import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CircleHelp, Eye, EyeOff, RotateCcw, SlidersHorizontal, Target, Undo2 } from "lucide-react";
import type { Character } from "../characters";
import { ActorSheet, type ActorSheetAction } from "../components/ActorSheet";
import { CharacterImage } from "../components/CharacterImage";
import { FiltersSheet } from "../components/FiltersSheet";
import { GameFooter } from "../components/GameFooter";
import { SecretBar } from "../components/SecretBar";
import { TurnPanel } from "../components/TurnPanel";
import { useEliminated } from "../hooks/useEliminated";
import { useLongPress } from "../hooks/useLongPress";
import { pickBoardIds } from "../lib/board";
import { deckPool, modeLabel, type Decks } from "../lib/decks";
import {
  answerQuestion, askQuestion, chooseSecret, makeGuess, rematch,
  type RoomEvent, type RoomSnapshot,
} from "../lib/room";
import { eliminatedKey, errorMessage } from "../lib/storage";

/** The game screen: secret bar, turn panel, board with tools, and footer. */
export function Game({ client, snapshot, userId, decks, byId, onChanged, onLeave }: {
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

  const isChoosing = room.status === "choosing";
  const isFinished = room.status === "finished";
  const opponentPicked = events.some((e) => e.kind === "system" && !!opponent && e.user_id === opponent.user_id);
  const pendingQuestion = room.phase === "answer"
    ? [...events].reverse().find((e) => e.kind === "question")
    : undefined;

  // ---- Your board ----
  const { eliminated, toggle, setMany, reset } = useEliminated(eliminatedKey(room.id, room.round));
  const remaining = board.filter((c) => !eliminated.has(c.id));
  const genderGroups = useMemo(() => ([
    { key: "women", label: "women", ids: board.filter((c) => c.attributes?.gender === "WOMAN").map((c) => c.id) },
    { key: "men", label: "men", ids: board.filter((c) => c.attributes?.gender === "MAN").map((c) => c.id) },
  ]).filter((group) => group.ids.length > 0), [board]);

  // Director's Cut: the card currently highlighted (not yet locked in).
  const [pickedId, setPickedId] = useState("");

  // Actor details panel (press and hold a card).
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

  // ---- Server actions ----
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");

  async function act(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setActionError("");
    try {
      await action();
      await onChanged();
      return true;
    } catch (e) {
      setActionError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
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

  // Guessing (from the turn panel or the details panel). A wrong guess shows a short message.
  const [guessResult, setGuessResult] = useState("");
  useEffect(() => {
    if (!guessResult) return;
    const timer = window.setTimeout(() => setGuessResult(""), 6000);
    return () => window.clearTimeout(timer);
  }, [guessResult]);

  async function guess(character: Character) {
    let correct = false;
    const ok = await act(async () => { correct = await makeGuess(client, room.id, character.id); });
    if (ok && !correct) setGuessResult(`${character.name} isn't their actor.`);
    return ok;
  }

  const canAsk = room.current_turn === userId && room.phase === "ask";
  const guessPenalty = canAsk ? "If you're wrong, your turn ends." : "If you're wrong, you'll miss your next turn.";

  // Details panel (press and hold a card): pick your secret in Director's Cut, or guess during play.
  const infoCharacter = byId.get(infoId);
  let infoAction: ActorSheetAction | undefined;
  if (infoCharacter && room.board_ids.includes(infoCharacter.id)) {
    const target = infoCharacter;
    if (isChoosing) {
      infoAction = { label: "Pick as my secret", onClick: () => { setPickedId(target.id); closeInfo(); } };
    } else if (room.status === "playing" && target.id !== mySecret?.id) {
      infoAction = {
        label: <><Target size={16} /> That's my guess!</>,
        confirm: {
          message: <>You're guessing <b>{target.name}</b>. {guessPenalty}</>,
          confirmLabel: `Yes, guess ${target.name}`,
          cancelLabel: "Not yet",
        },
        onClick: async () => {
          await guess(target);
          closeInfo();
        },
      };
    }
  }

  return (
    <div className="game">
      {!isFinished && <SecretBar secret={mySecret} isChoosing={isChoosing} onAbout={setInfoId} />}

      <section className="game-layout">
        <div className="board-column">
          <div className="board-heading">
            <div>
              <div className="section-kicker">
                Round {room.round} · {modeLabel(room.deck, room.secret_mode)} · You vs {opponentName}
              </div>
              <h2>{isChoosing ? "Pick your secret actor" : "Meet the suspects"}</h2>
            </div>
            <div className="remaining-count"><strong>{remaining.length}</strong><span> / {board.length} left</span></div>
          </div>

          {!isChoosing && (
            <div className="board-tools" aria-label="Board shortcuts">
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
                <button className="tool-chip" onClick={() => { setMany(undoIds, false); setUndoIds([]); }}>
                  <Undo2 size={14} /> Undo filter
                </button>
              )}
              <button className="tool-chip" onClick={() => { reset(); setUndoIds([]); }} disabled={eliminated.size === 0}>
                <RotateCcw size={14} /> Reset board
              </button>
            </div>
          )}

          <div className="character-grid">
            {board.map((character) => {
              const isOut = !isChoosing && eliminated.has(character.id);
              const isPicked = isChoosing && (pickedId ? pickedId === character.id : mySecret?.id === character.id);
              return (
                <button
                  className={`character-card ${isOut ? "is-eliminated" : ""} ${isPicked ? "is-picked" : ""}`}
                  key={character.id}
                  {...bindPress(character.id, () => (isChoosing ? setPickedId(character.id) : toggle(character.id)))}
                  aria-pressed={isChoosing ? isPicked : isOut}
                  title={isChoosing ? `Pick ${character.name}` : isOut ? "Restore actor" : "Eliminate actor"}
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
          <TurnPanel
            room={room}
            userId={userId}
            opponentName={opponentName}
            mySecret={mySecret}
            theirSecret={theirSecret}
            opponentPicked={opponentPicked}
            pendingQuestion={pendingQuestion}
            remaining={remaining}
            picked={byId.get(pickedId)}
            busy={busy}
            mySkips={players.find((p) => p.user_id === userId)?.skip_turns ?? 0}
            opponentSkips={opponent?.skip_turns ?? 0}
            onLockIn={(character) => act(async () => {
              await chooseSecret(client, room.id, character.id);
              setPickedId("");
            })}
            onAsk={(question) => act(() => askQuestion(client, room.id, question))}
            onAnswer={(answer) => act(() => answerQuestion(client, room.id, answer))}
            onGuess={guess}
            onRematch={() => act(() => rematch(
              client, room.id, pickBoardIds(deckPool(decks, room.deck), room.board_ids.length),
            ))}
          />
          {guessResult && <p className="guess-result" role="status">❌ {guessResult}</p>}
          {actionError && <p className="form-error" role="alert">{actionError}</p>}
        </aside>
      </section>

      <GameFooter
        entries={[...events].reverse().map((event) => ({ id: event.id, content: describe(event) }))}
        onLeave={onLeave}
      />

      {infoCharacter && <ActorSheet character={infoCharacter} onClose={closeInfo} action={infoAction} />}
      {filtersOpen && (
        <FiltersSheet board={board} eliminated={eliminated} onFlipDown={applyFilter} onClose={closeFilters} />
      )}
    </div>
  );
}

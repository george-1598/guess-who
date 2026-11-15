import { useEffect, useRef } from "react";
import type { RoomSnapshot } from "../lib/room";

export type TurnAlert = { key: string; title: string };

/**
 * Does this player need to do something right now? Returns a key that changes every time
 * a *new* action is needed (so each one alerts once), or null when it's someone else's move.
 */
export function turnAlertFor(snapshot: RoomSnapshot | null, userId: string): TurnAlert | null {
  if (!snapshot) return null;
  const { room, events, secrets } = snapshot;
  const last = events.at(-1)?.id ?? 0;
  const myTurn = room.current_turn === userId;

  if (room.status === "choosing" && !secrets.some((s) => s.user_id === userId)) {
    return { key: `${room.round}:choose`, title: "Pick your secret actor" };
  }
  if (room.status === "playing" && myTurn && room.phase === "ask") {
    return { key: `${room.round}:ask:${last}`, title: "Your turn" };
  }
  if (room.status === "playing" && !myTurn && room.phase === "answer") {
    return { key: `${room.round}:answer:${last}`, title: "Answer the question" };
  }
  if (room.status === "finished") {
    return { key: `${room.round}:finished`, title: room.winner_id === userId ? "You won!" : "Game over" };
  }
  return null;
}

// ---- Sound: a soft two-note chime made with Web Audio (no sound file needed) ----

let audio: AudioContext | null = null;

/** Browsers only allow sound after the player has touched the page once. */
function unlockAudio() {
  try {
    const Ctx = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    // No audio on this device — alerts still change the title and vibrate.
  }
}

function chime() {
  if (!audio || audio.state !== "running") return;
  const start = audio.currentTime;
  [659.25, 880].forEach((frequency, i) => {
    const ctx = audio!;
    const at = start + i * 0.16;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.22, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.5);
  });
}

const BASE_TITLE = document.title;

/**
 * Alerts once whenever a new action is needed: chime + vibration (if enabled), and the
 * tab title shows "🔔 …" while it's your move (flashing when the tab is in the background).
 */
export function useTurnAlert(alert: TurnAlert | null, soundOn: boolean, ready: boolean) {
  // undefined = room not loaded yet. The state we open the room on doesn't chime.
  const lastKey = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    window.addEventListener("pointerdown", unlockAudio);
    return () => window.removeEventListener("pointerdown", unlockAudio);
  }, []);

  // Chime + vibrate on each new action.
  useEffect(() => {
    if (!ready) return;
    const key = alert?.key ?? null;
    if (lastKey.current === undefined) {
      lastKey.current = key;
      return;
    }
    if (key === lastKey.current) return;
    lastKey.current = key;
    if (!key || !soundOn) return;
    chime();
    navigator.vibrate?.([120, 80, 120]);
  }, [alert?.key, soundOn, ready]);

  // Tab title.
  const title = alert?.title;
  useEffect(() => {
    if (!title) {
      document.title = BASE_TITLE;
      return;
    }
    const alertTitle = `🔔 ${title} — Guess Who`;
    document.title = alertTitle;
    let flip = false;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        document.title = alertTitle;
        return;
      }
      flip = !flip;
      document.title = flip ? alertTitle : BASE_TITLE;
    }, 1000);
    return () => {
      window.clearInterval(timer);
      document.title = BASE_TITLE;
    };
  }, [title]);
}

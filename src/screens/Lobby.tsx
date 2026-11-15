import { useState } from "react";
import { Check, Copy, LogOut, Users } from "lucide-react";

function shareLink(code: string) {
  return `${window.location.origin}${import.meta.env.BASE_URL}?room=${encodeURIComponent(code)}`;
}

/** Waiting room: shows the code and an invite link until player two joins. */
export function Lobby({ code, mode, players, onLeave }: {
  code: string;
  mode: string;
  players: string[];
  onLeave: () => void;
}) {
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

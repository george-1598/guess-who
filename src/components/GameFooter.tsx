import { useState, type ReactNode } from "react";
import { Bell, BellOff, LogOut, ScrollText } from "lucide-react";

/** Bottom of the game page: game log (folded by default), alert sound toggle, and "Leave room". */
export function GameFooter({ entries, alertsOn, onToggleAlerts, onLeave }: {
  /** Log lines, newest first. */
  entries: { id: number; content: ReactNode }[];
  alertsOn: boolean;
  onToggleAlerts: () => void;
  onLeave: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <section className="game-footer">
      <div className="game-footer-buttons">
        <button className="secondary-button" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          <ScrollText size={16} /> {open ? "Hide game log" : `Game log (${entries.length})`}
        </button>
        <button
          className="secondary-button"
          aria-pressed={alertsOn}
          title="Chime and vibrate when it's your move"
          onClick={onToggleAlerts}
        >
          {alertsOn ? <Bell size={16} /> : <BellOff size={16} />} {alertsOn ? "Alerts on" : "Alerts off"}
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
      {open && (
        <ol className="log-list">
          {entries.map((entry) => <li key={entry.id}>{entry.content}</li>)}
        </ol>
      )}
    </section>
  );
}

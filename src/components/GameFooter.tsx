import { useState, type ReactNode } from "react";
import { LogOut, ScrollText } from "lucide-react";

/** Bottom of the game page: the game log (folded by default) and "Leave room". */
export function GameFooter({ entries, onLeave }: {
  /** Log lines, newest first. */
  entries: { id: number; content: ReactNode }[];
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

import { useState } from "react";
import { CircleHelp, Eye, EyeOff } from "lucide-react";
import type { Character } from "../characters";
import { Avatar } from "./CharacterImage";

/** Slim bar at the top of the game showing your own secret actor (hideable). */
export function SecretBar({ secret, isChoosing, onAbout }: {
  secret?: Character;
  isChoosing: boolean;
  onAbout: (id: string) => void;
}) {
  const [show, setShow] = useState(true);
  const visible = show ? secret : undefined;

  return (
    <section className="secret-bar" aria-label="Your secret actor">
      <Avatar character={visible} size="small" />
      <div className="secret-bar-text">
        <span className="panel-label">Your secret actor</span>
        <strong>{show ? secret?.name ?? (isChoosing ? "Not picked yet" : "Unknown") : "Hidden"}</strong>
        {visible && <span>{visible.subtitle}</span>}
      </div>
      <div className="secret-bar-actions">
        {visible && (
          <button className="tool-chip" onClick={() => onAbout(visible.id)}>
            <CircleHelp size={14} /> About
          </button>
        )}
        <button className="tool-chip" onClick={() => setShow((v) => !v)}>
          {show ? <EyeOff size={14} /> : <Eye size={14} />} {show ? "Hide" : "Show"}
        </button>
      </div>
    </section>
  );
}

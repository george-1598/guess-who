import { Cake, ExternalLink, Film, MapPin, X } from "lucide-react";
import type { Character } from "../characters";
import { useSheet } from "../hooks/useSheet";
import { CharacterImage } from "./CharacterImage";

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
export function ActorSheet({ character, onClose, action }: {
  character: Character;
  onClose: () => void;
  /** Main button, e.g. "Flip down" or "Pick as my secret". */
  action?: { label: string; onClick: () => void };
}) {
  const closeRef = useSheet(onClose);
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
          <CharacterImage character={character} className="portrait-image" size="large" />
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
              href={`https://www.themoviedb.org/person/${character.tmdb.personId}`}
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

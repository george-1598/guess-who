import { useState, type ReactNode } from "react";
import { Cake, Film, MapPin, X } from "lucide-react";
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

export type ActorSheetAction = {
  label: ReactNode;
  /** When set, the first tap asks "Are you sure?" and only the confirm button runs onClick. */
  confirm?: { message: ReactNode; confirmLabel: string; cancelLabel: string };
  onClick: () => void | Promise<void>;
};

/** Bottom sheet (phone) / dialog (computer) with an actor's photo and facts. */
export function ActorSheet({ character, onClose, action }: {
  character: Character;
  onClose: () => void;
  /** Optional main button, e.g. "That's my guess!" or "Pick as my secret". */
  action?: ActorSheetAction;
}) {
  const closeRef = useSheet(onClose);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run() {
    if (!action) return;
    setBusy(true);
    try {
      await action.onClick();
    } finally {
      setBusy(false);
    }
  }
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
          {action && !confirming && (
            <button
              className="primary-button full-button sheet-main-action"
              disabled={busy}
              onClick={() => (action.confirm ? setConfirming(true) : void run())}
            >
              {action.label}
            </button>
          )}
          {action?.confirm && confirming && (
            <div className="sheet-confirm" role="alertdialog" aria-labelledby="confirm-title">
              <strong id="confirm-title">Are you sure?</strong>
              <p>{action.confirm.message}</p>
              <div className="sheet-actions">
                <button className="primary-button" disabled={busy} onClick={() => void run()}>
                  {action.confirm.confirmLabel}
                </button>
                <button className="secondary-button" disabled={busy} onClick={() => setConfirming(false)}>
                  {action.confirm.cancelLabel}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

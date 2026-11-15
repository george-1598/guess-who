import type { Character } from "../characters";

// TMDB serves several widths. Cards and avatars only need the small one (~10 KB each);
// the large one is for the details panel.
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
const IMAGE_WIDTHS = { small: "w185", large: "w500" } as const;

function imageUrl(character: Character, size: keyof typeof IMAGE_WIDTHS) {
  const path = character.tmdb.profilePath;
  if (!path) return undefined;
  return `${TMDB_IMAGE_BASE}/${IMAGE_WIDTHS[size]}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Actor photo with the initials underneath as a fallback if the photo is missing or fails. */
export function CharacterImage({ character, className, size = "small" }: {
  character: Character;
  className: string;
  size?: keyof typeof IMAGE_WIDTHS;
}) {
  const src = imageUrl(character, size);
  return (
    <>
      <span className="portrait-initials">{character.initials}</span>
      {src && (
        <img
          className={className}
          src={src}
          alt={`${character.name} portrait`}
          loading="lazy"
          decoding="async"
          onError={(event) => { event.currentTarget.style.display = "none"; }}
        />
      )}
    </>
  );
}

/** Round photo used for secrets. Shows "?" when there's no actor (hidden or not picked yet). */
export function Avatar({ character, size = "large" }: { character?: Character; size?: "large" | "small" }) {
  return (
    <div
      className={`secret-avatar ${size === "small" ? "secret-avatar-small" : ""}`}
      style={{ background: `linear-gradient(145deg, ${character?.color ?? "#355c7d"}, #14181c)` }}
    >
      {character ? <CharacterImage character={character} className="secret-image" /> : <span>?</span>}
    </div>
  );
}

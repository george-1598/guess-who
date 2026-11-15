export type CharacterKind = "ACTOR" | "CHARACTER";

export type CharacterAttributes = {
  // From the actor's TMDB person record (the importer stores only female/male).
  gender?: "WOMAN" | "MAN";
  // The fields below aren't imported; only populate them when manually curated.
  hair?: "DARK" | "BLONDE" | "RED" | "BROWN" | "OTHER";
  fictional?: boolean;
  universe?: "MATRIX" | "MARVEL" | "DC" | "HARRY_POTTER" | "OTHER";
};

export type Character = {
  id: string;
  name: string;
  kind: CharacterKind;
  subtitle: string;
  initials: string;
  color: string;
  // TMDB does not provide most Guess Who attributes. Imported records omit this
  // field until values have been manually curated.
  attributes?: CharacterAttributes;
  tmdb?: {
    personId: number;
    profilePath?: string;
    mediaType?: "movie" | "tv";
    mediaId?: number;
    mediaTitle?: string;
  };
};

// Small hand-curated examples retained as reference data. The app loads the
// generated public/data/characters.json dataset at runtime instead.
export const characters: Character[] = [
  { id: "neo", name: "Neo", kind: "CHARACTER", subtitle: "The Matrix", initials: "N", color: "#355c7d", attributes: { gender: "MAN", hair: "DARK", fictional: true, universe: "MATRIX" } },
  { id: "trinity", name: "Trinity", kind: "CHARACTER", subtitle: "The Matrix", initials: "T", color: "#6c5b7b", attributes: { gender: "WOMAN", hair: "DARK", fictional: true, universe: "MATRIX" } },
  { id: "morpheus", name: "Morpheus", kind: "CHARACTER", subtitle: "The Matrix", initials: "M", color: "#355c7d", attributes: { gender: "MAN", hair: "DARK", fictional: true, universe: "MATRIX" } },
  { id: "keanu", name: "Keanu Reeves", kind: "ACTOR", subtitle: "Actor · John Wick", initials: "KR", color: "#4b6584", attributes: { gender: "MAN", hair: "DARK", fictional: false, universe: "OTHER" } },
  { id: "scarlett", name: "Scarlett Johansson", kind: "ACTOR", subtitle: "Actor · Black Widow", initials: "SJ", color: "#a66a5b", attributes: { gender: "WOMAN", hair: "BLONDE", fictional: false, universe: "OTHER" } },
  { id: "iron-man", name: "Iron Man", kind: "CHARACTER", subtitle: "Marvel", initials: "IM", color: "#9b3c38", attributes: { gender: "MAN", hair: "DARK", fictional: true, universe: "MARVEL" } },
  { id: "black-widow", name: "Black Widow", kind: "CHARACTER", subtitle: "Marvel", initials: "BW", color: "#744b54", attributes: { gender: "WOMAN", hair: "RED", fictional: true, universe: "MARVEL" } },
  { id: "batman", name: "Batman", kind: "CHARACTER", subtitle: "DC", initials: "B", color: "#414b5b", attributes: { gender: "MAN", hair: "DARK", fictional: true, universe: "DC" } },
  { id: "wonder-woman", name: "Wonder Woman", kind: "CHARACTER", subtitle: "DC", initials: "WW", color: "#92613d", attributes: { gender: "WOMAN", hair: "DARK", fictional: true, universe: "DC" } },
  { id: "hermione", name: "Hermione Granger", kind: "CHARACTER", subtitle: "Harry Potter", initials: "HG", color: "#806344", attributes: { gender: "WOMAN", hair: "BROWN", fictional: true, universe: "HARRY_POTTER" } },
  { id: "harry", name: "Harry Potter", kind: "CHARACTER", subtitle: "Harry Potter", initials: "HP", color: "#4f6d58", attributes: { gender: "MAN", hair: "DARK", fictional: true, universe: "HARRY_POTTER" } },
  { id: "emma", name: "Emma Watson", kind: "ACTOR", subtitle: "Actor · Harry Potter", initials: "EW", color: "#9a795e", attributes: { gender: "WOMAN", hair: "BROWN", fictional: false, universe: "OTHER" } }
];

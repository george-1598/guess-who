import type { Character } from "../characters";

// Everything here returns `undefined` when the data is missing, and filters never
// flip a card whose value is unknown — so a filter can't wrongly remove the secret actor.

type Day = { y: number; m: number; d: number };

function parseDay(value?: string): Day | undefined {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  return match ? { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) } : undefined;
}

/** Current age, or age at death. */
export function ageOf(character: Character, today = new Date()): number | undefined {
  const born = parseDay(character.details?.birthday);
  if (!born) return undefined;
  const end = parseDay(character.details?.deathday)
    ?? { y: today.getFullYear(), m: today.getMonth() + 1, d: today.getDate() };
  let age = end.y - born.y;
  if (end.m < born.m || (end.m === born.m && end.d < born.d)) age -= 1;
  return age >= 0 && age <= 110 ? age : undefined;
}

// ---------------------------------------------------------------------------
// Alive / deceased
// ---------------------------------------------------------------------------

export type LifeStatus = "alive" | "deceased";

export const LIFE_OPTIONS: { value: LifeStatus; label: string }[] = [
  { value: "alive", label: "Alive" },
  { value: "deceased", label: "Deceased" },
];

export function lifeStatusOf(character: Character): LifeStatus | undefined {
  if (character.details?.deathday) return "deceased";
  // A birthday with no death date means alive — unless they'd be implausibly old (missing data).
  return ageOf(character) !== undefined ? "alive" : undefined;
}

// ---------------------------------------------------------------------------
// Star signs
// ---------------------------------------------------------------------------

export const ZODIAC = [
  { value: "aries", name: "Aries", symbol: "♈", dates: "Mar 21 – Apr 19", start: 321, end: 419 },
  { value: "taurus", name: "Taurus", symbol: "♉", dates: "Apr 20 – May 20", start: 420, end: 520 },
  { value: "gemini", name: "Gemini", symbol: "♊", dates: "May 21 – Jun 20", start: 521, end: 620 },
  { value: "cancer", name: "Cancer", symbol: "♋", dates: "Jun 21 – Jul 22", start: 621, end: 722 },
  { value: "leo", name: "Leo", symbol: "♌", dates: "Jul 23 – Aug 22", start: 723, end: 822 },
  { value: "virgo", name: "Virgo", symbol: "♍", dates: "Aug 23 – Sep 22", start: 823, end: 922 },
  { value: "libra", name: "Libra", symbol: "♎", dates: "Sep 23 – Oct 22", start: 923, end: 1022 },
  { value: "scorpio", name: "Scorpio", symbol: "♏", dates: "Oct 23 – Nov 21", start: 1023, end: 1121 },
  { value: "sagittarius", name: "Sagittarius", symbol: "♐", dates: "Nov 22 – Dec 21", start: 1122, end: 1221 },
  { value: "capricorn", name: "Capricorn", symbol: "♑", dates: "Dec 22 – Jan 19", start: 1222, end: 119 },
  { value: "aquarius", name: "Aquarius", symbol: "♒", dates: "Jan 20 – Feb 18", start: 120, end: 218 },
  { value: "pisces", name: "Pisces", symbol: "♓", dates: "Feb 19 – Mar 20", start: 219, end: 320 },
] as const;

export function zodiacOf(character: Character): string | undefined {
  const born = parseDay(character.details?.birthday);
  if (!born) return undefined;
  const md = born.m * 100 + born.d;
  const sign = ZODIAC.find((z) => (z.start <= z.end ? md >= z.start && md <= z.end : md >= z.start || md <= z.end));
  return sign?.value;
}

// ---------------------------------------------------------------------------
// Country and region of birth (from TMDB's free-text "place of birth")
// ---------------------------------------------------------------------------

export const REGIONS = [
  { value: "north-america", label: "North America" },
  { value: "latin-america", label: "Latin America & Caribbean" },
  { value: "europe", label: "Europe" },
  { value: "asia", label: "Asia & Middle East" },
  { value: "africa", label: "Africa" },
  { value: "oceania", label: "Australia & Oceania" },
] as const;

type Region = (typeof REGIONS)[number]["value"];

const COUNTRY_ALIASES: Record<string, string> = {
  usa: "United States", us: "United States", "united states": "United States",
  "united states of america": "United States", america: "United States",
  uk: "United Kingdom", "united kingdom": "United Kingdom", "great britain": "United Kingdom",
  england: "United Kingdom", scotland: "United Kingdom", wales: "United Kingdom", "northern ireland": "United Kingdom",
  "west germany": "Germany", "east germany": "Germany", "federal republic of germany": "Germany",
  ussr: "Soviet Union", "soviet union": "Soviet Union", "russian federation": "Russia", "russian empire": "Russia",
  korea: "South Korea", "republic of korea": "South Korea",
  "the netherlands": "Netherlands", holland: "Netherlands",
  czechia: "Czech Republic", türkiye: "Turkey", turkiye: "Turkey",
  "people's republic of china": "China", prc: "China", "british hong kong": "Hong Kong",
  uae: "United Arab Emirates", "republic of ireland": "Ireland", eire: "Ireland",
  "british india": "India", "mandatory palestine": "Israel",
  ontario: "Canada", quebec: "Canada", "british columbia": "Canada", alberta: "Canada", "nova scotia": "Canada", manitoba: "Canada",
  "new south wales": "Australia", victoria: "Australia", queensland: "Australia",
};

const US_STATES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida",
  "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine",
  "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska",
  "nevada", "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
  "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas",
  "utah", "vermont", "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia",
  "washington dc", "washington d c",
]);

const COUNTRY_REGIONS: Record<string, Region> = {
  "United States": "north-america", Canada: "north-america",
  Mexico: "latin-america", Brazil: "latin-america", Argentina: "latin-america", Chile: "latin-america",
  Colombia: "latin-america", Peru: "latin-america", Venezuela: "latin-america", Uruguay: "latin-america",
  Ecuador: "latin-america", Bolivia: "latin-america", Paraguay: "latin-america", Cuba: "latin-america",
  "Puerto Rico": "latin-america", "Dominican Republic": "latin-america", Jamaica: "latin-america",
  "Trinidad and Tobago": "latin-america", Bahamas: "latin-america", Barbados: "latin-america", Haiti: "latin-america",
  Guatemala: "latin-america", "Costa Rica": "latin-america", Panama: "latin-america", Honduras: "latin-america",
  "El Salvador": "latin-america", Nicaragua: "latin-america", Guyana: "latin-america",
  "United Kingdom": "europe", Ireland: "europe", France: "europe", Germany: "europe", Italy: "europe",
  Spain: "europe", Portugal: "europe", Netherlands: "europe", Belgium: "europe", Luxembourg: "europe",
  Switzerland: "europe", Austria: "europe", Sweden: "europe", Norway: "europe", Denmark: "europe",
  Finland: "europe", Iceland: "europe", Poland: "europe", "Czech Republic": "europe", Czechoslovakia: "europe",
  Slovakia: "europe", Hungary: "europe", Romania: "europe", Bulgaria: "europe", Greece: "europe",
  Serbia: "europe", Croatia: "europe", Slovenia: "europe", "Bosnia and Herzegovina": "europe",
  Yugoslavia: "europe", "North Macedonia": "europe", Albania: "europe", Montenegro: "europe", Moldova: "europe",
  Ukraine: "europe", Belarus: "europe", Russia: "europe", "Soviet Union": "europe", Lithuania: "europe",
  Latvia: "europe", Estonia: "europe", Malta: "europe", Cyprus: "europe", Monaco: "europe", Turkey: "europe",
  Georgia: "europe", Armenia: "europe",
  Israel: "asia", Lebanon: "asia", Iran: "asia", Iraq: "asia", Syria: "asia", Jordan: "asia",
  "Saudi Arabia": "asia", "United Arab Emirates": "asia", Kuwait: "asia", Qatar: "asia", Palestine: "asia",
  India: "asia", Pakistan: "asia", Bangladesh: "asia", "Sri Lanka": "asia", Nepal: "asia", Afghanistan: "asia",
  China: "asia", "Hong Kong": "asia", Taiwan: "asia", Japan: "asia", "South Korea": "asia", "North Korea": "asia",
  Philippines: "asia", Thailand: "asia", Vietnam: "asia", Malaysia: "asia", Singapore: "asia",
  Indonesia: "asia", Cambodia: "asia", Myanmar: "asia", Mongolia: "asia", Kazakhstan: "asia", Uzbekistan: "asia",
  "South Africa": "africa", Nigeria: "africa", Kenya: "africa", Ethiopia: "africa", Ghana: "africa",
  Zimbabwe: "africa", Egypt: "africa", Morocco: "africa", Algeria: "africa", Tunisia: "africa",
  Senegal: "africa", Uganda: "africa", Tanzania: "africa", Cameroon: "africa", Zambia: "africa",
  "Ivory Coast": "africa", "Democratic Republic of the Congo": "africa", Somalia: "africa", Sudan: "africa",
  Australia: "oceania", "New Zealand": "oceania", Fiji: "oceania", Samoa: "oceania", "Papua New Guinea": "oceania",
};

const COUNTRY_BY_LOWER = new Map(Object.keys(COUNTRY_REGIONS).map((name) => [name.toLowerCase(), name]));
const countryCache = new Map<string, string | undefined>();

function parseCountry(place: string): string | undefined {
  // "Kyiv, Ukrainian SSR, USSR [now Ukraine]" → prefer the modern name.
  const now = /\[\s*now\s+([^\]]+)\]/i.exec(place);
  const text = now ? now[1] : place.replace(/\[[^\]]*\]|\([^)]*\)/g, "");
  const parts = text.split(",").map((part) => part.trim()).filter(Boolean);
  const last = parts.at(-1);
  if (!last) return undefined;
  const key = last.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return COUNTRY_ALIASES[key]
    ?? (US_STATES.has(key) ? "United States" : undefined)
    ?? COUNTRY_BY_LOWER.get(key)
    ?? last.replace(/\.$/, "");
}

export function countryOf(character: Character): string | undefined {
  const place = character.details?.placeOfBirth;
  if (!place) return undefined;
  if (!countryCache.has(place)) countryCache.set(place, parseCountry(place));
  return countryCache.get(place);
}

export function regionOf(character: Character): string | undefined {
  const country = countryOf(character);
  return country ? COUNTRY_REGIONS[country] : undefined;
}

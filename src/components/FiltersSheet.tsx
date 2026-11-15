import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Cake, ChevronDown, Globe, HeartPulse, MapPin, Sparkles, X } from "lucide-react";
import type { Character } from "../characters";
import { LIFE_OPTIONS, REGIONS, ZODIAC, ageOf, countryOf, lifeStatusOf, regionOf, zodiacOf } from "../lib/filters";

type FlipDown = (ids: string[]) => void;
type SectionKey = "age" | "zodiac" | "life" | "region" | "country";

const SECTIONS: { key: SectionKey; icon: ReactNode; title: string; example: string }[] = [
  { key: "age", icon: <Cake size={18} />, title: "Age", example: "“Is your actor over 50?”" },
  { key: "zodiac", icon: <Sparkles size={18} />, title: "Star sign", example: "“Is your actor a Leo?”" },
  { key: "life", icon: <HeartPulse size={18} />, title: "Alive or deceased", example: "“Is your actor still alive?”" },
  { key: "region", icon: <Globe size={18} />, title: "Region of birth", example: "“Was your actor born in Europe?”" },
  { key: "country", icon: <MapPin size={18} />, title: "Country of birth", example: "“Was your actor born in the USA?”" },
];

/** Panel with fold-out filters. Each filter flips cards down on the player's own board. */
export function FiltersSheet({ board, eliminated, onFlipDown, onClose }: {
  board: Character[];
  eliminated: Set<string>;
  onFlipDown: FlipDown;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<SectionKey | null>("age");
  const closeRef = useRef<HTMLButtonElement>(null);
  // Only cards that are still face-up can be flipped.
  const up = useMemo(() => board.filter((c) => !eliminated.has(c.id)), [board, eliminated]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const countryOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of board) {
      const country = countryOf(c);
      if (country) counts.set(country, (counts.get(country) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([country]) => ({ value: country, label: country }));
  }, [board]);

  function body(key: SectionKey) {
    switch (key) {
      case "age":
        return <AgeFilter up={up} onFlipDown={onFlipDown} />;
      case "zodiac":
        return (
          <ChoiceFilter
            up={up}
            valueOf={zodiacOf}
            columns={3}
            options={ZODIAC.map((z) => ({ value: z.value, label: `${z.symbol} ${z.name}`, sub: z.dates, short: z.name }))}
            onFlipDown={onFlipDown}
          />
        );
      case "life":
        return (
          <ChoiceFilter
            up={up}
            valueOf={lifeStatusOf}
            options={LIFE_OPTIONS.map((o) => ({ ...o, short: o.value === "alive" ? "the living" : "the deceased" }))}
            onFlipDown={onFlipDown}
          />
        );
      case "region":
        return <ChoiceFilter up={up} valueOf={regionOf} options={REGIONS.map((r) => ({ ...r }))} onFlipDown={onFlipDown} />;
      case "country":
        return <ChoiceFilter up={up} valueOf={countryOf} options={countryOptions} onFlipDown={onFlipDown} />;
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet filters-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="filters-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-header">
          <div>
            <h2 id="filters-title">Filters</h2>
            <p>Flip down many cards at once after an answer. Only your board changes.</p>
          </div>
          <button ref={closeRef} className="sheet-close" onClick={onClose} aria-label="Close filters">
            <X size={18} />
          </button>
        </div>

        {SECTIONS.map((section) => {
          const isOpen = open === section.key;
          return (
            <section className="filter-section" key={section.key}>
              <button
                className="filter-head"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : section.key)}
              >
                {section.icon}
                <span className="filter-head-text">
                  <strong>{section.title}</strong>
                  <span>{section.example}</span>
                </span>
                <ChevronDown size={18} className="chevron" />
              </button>
              {isOpen && <div className="filter-body">{body(section.key)}</div>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared action buttons: "Keep only these" (answer was yes) / "Flip these down" (answer was no)
// ---------------------------------------------------------------------------

function FilterActions({ keepLabel, flipLabel, keepIds, flipIds, disabled, unknownCount, onFlipDown }: {
  keepLabel: string;
  flipLabel: string;
  keepIds: string[];
  flipIds: string[];
  disabled: boolean;
  unknownCount: number;
  onFlipDown: FlipDown;
}) {
  return (
    <>
      <div className="filter-actions">
        <button className="primary-button" disabled={disabled || keepIds.length === 0} onClick={() => onFlipDown(keepIds)}>
          {keepLabel}
          <small>flips {keepIds.length} {keepIds.length === 1 ? "card" : "cards"}</small>
        </button>
        <button className="secondary-button" disabled={disabled || flipIds.length === 0} onClick={() => onFlipDown(flipIds)}>
          {flipLabel}
          <small>flips {flipIds.length} {flipIds.length === 1 ? "card" : "cards"}</small>
        </button>
      </div>
      <p className="filter-note">
        Use <strong>Keep only</strong> when the answer was <em>yes</em>, <strong>Flip down</strong> when it was <em>no</em>.
        {unknownCount > 0 && ` ${unknownCount} ${unknownCount === 1 ? "actor has" : "actors have"} no info for this and won't be touched.`}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Age: two-handle range slider with quick presets
// ---------------------------------------------------------------------------

function AgeFilter({ up, onFlipDown }: { up: Character[]; onFlipDown: FlipDown }) {
  const known = useMemo(
    () => up.flatMap((c) => {
      const age = ageOf(c);
      return age === undefined ? [] : [{ id: c.id, age }];
    }),
    [up],
  );
  const minAge = known.length ? Math.min(...known.map((k) => k.age)) : 18;
  const maxAge = known.length ? Math.max(...known.map((k) => k.age)) : 90;
  const [range, setRange] = useState<[number, number] | null>(null);
  const lo = Math.max(minAge, Math.min(range?.[0] ?? minAge, maxAge));
  const hi = Math.min(maxAge, Math.max(range?.[1] ?? maxAge, lo));

  if (known.length === 0) {
    return <p className="filter-note">No age info on this board yet. Run the “Import actors” workflow to add it.</p>;
  }

  const inside = known.filter((k) => k.age >= lo && k.age <= hi).map((k) => k.id);
  const outside = known.filter((k) => k.age < lo || k.age > hi).map((k) => k.id);
  const span = Math.max(1, maxAge - minAge);
  const pct = (value: number) => ((value - minAge) / span) * 100;
  const presets: { label: string; lo: number; hi: number }[] = [
    { label: "Under 30", lo: minAge, hi: 29 },
    { label: "30 – 50", lo: 30, hi: 50 },
    { label: "Over 50", lo: 51, hi: maxAge },
    { label: "Over 70", lo: 71, hi: maxAge },
  ];

  return (
    <>
      <div className="preset-row">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            className={`tool-chip ${lo === Math.max(p.lo, minAge) && hi === Math.min(p.hi, maxAge) ? "is-on" : ""}`}
            onClick={() => setRange([p.lo, p.hi])}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="range-readout">
        <strong>{lo}</strong> to <strong>{hi}</strong> years old · {inside.length} of your face-up cards
      </div>
      <div className="range-slider">
        <div className="range-track">
          <div className="range-fill" style={{ left: `${pct(lo)}%`, right: `${100 - pct(hi)}%` }} />
        </div>
        <input
          type="range"
          min={minAge}
          max={maxAge}
          value={lo}
          aria-label="Minimum age"
          onChange={(event) => setRange([Math.min(Number(event.target.value), hi), hi])}
        />
        <input
          type="range"
          min={minAge}
          max={maxAge}
          value={hi}
          aria-label="Maximum age"
          onChange={(event) => setRange([lo, Math.max(Number(event.target.value), lo)])}
        />
      </div>
      <div className="range-scale"><span>{minAge}</span><span>{maxAge}</span></div>

      <FilterActions
        keepLabel={`Keep only ${lo}–${hi}`}
        flipLabel={`Flip down ${lo}–${hi}`}
        keepIds={outside}
        flipIds={inside}
        disabled={false}
        unknownCount={up.length - known.length}
        onFlipDown={onFlipDown}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Pick-one-or-more chips (star sign, alive/deceased, region, country)
// ---------------------------------------------------------------------------

function ChoiceFilter({ up, valueOf, options, columns = 2, onFlipDown }: {
  up: Character[];
  valueOf: (character: Character) => string | undefined;
  // `short` is used in the button text ("Keep only Leo") when it differs from the chip label.
  options: { value: string; label: string; sub?: string; short?: string }[];
  columns?: 2 | 3;
  onFlipDown: FlipDown;
}) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const known = useMemo(
    () => up.flatMap((c) => {
      const value = valueOf(c);
      return value === undefined ? [] : [{ id: c.id, value }];
    }),
    [up, valueOf],
  );
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const k of known) map.set(k.value, (map.get(k.value) ?? 0) + 1);
    return map;
  }, [known]);

  function toggle(value: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  if (known.length === 0) {
    return <p className="filter-note">No info for this on your face-up cards. Run the “Import actors” workflow if it's missing.</p>;
  }

  const flipIds = known.filter((k) => selected.has(k.value)).map((k) => k.id);
  const keepIds = known.filter((k) => !selected.has(k.value)).map((k) => k.id);
  const single = selected.size === 1 ? options.find((o) => selected.has(o.value)) : undefined;
  const label = single ? (single.short ?? single.label) : "these";

  return (
    <>
      <div className={`choice-grid cols-${columns}`}>
        {options.map((option) => {
          const count = counts.get(option.value) ?? 0;
          const isOn = selected.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              className={`choice-chip ${isOn ? "is-on" : ""}`}
              aria-pressed={isOn}
              disabled={count === 0 && !isOn}
              onClick={() => toggle(option.value)}
            >
              <span className="choice-label">{option.label}</span>
              {option.sub && <span className="choice-sub">{option.sub}</span>}
              <span className="choice-count">{count}</span>
            </button>
          );
        })}
      </div>
      {selected.size === 0 && <p className="filter-note">Select one or more, then choose what to do.</p>}
      <FilterActions
        keepLabel={`Keep only ${label}`}
        flipLabel={`Flip down ${label}`}
        keepIds={keepIds}
        flipIds={flipIds}
        disabled={selected.size === 0}
        unknownCount={up.length - known.length}
        onFlipDown={onFlipDown}
      />
    </>
  );
}

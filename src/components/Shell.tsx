import type { ReactNode } from "react";
import { Clapperboard, Sparkles } from "lucide-react";

/** Page frame: top bar, content, TMDB credits footer. */
export function Shell({ pill, children }: { pill: string; children: ReactNode }) {
  return (
    <main className="page-shell app-state">
      <header className="topbar">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="Guess Who home">
          <span className="brand-mark"><Clapperboard size={19} /></span>
          <span>guess<span className="brand-accent">who</span></span>
        </a>
        <div className="prototype-pill"><span /> {pill}</div>
      </header>
      <div className="shell-body">{children}</div>
      <footer className="credits-footer">
        <div>MADE FOR TWO MOVIE FANS <span>✦</span></div>
        <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer" aria-label="The Movie Database (TMDB)">
          <strong>TMDB</strong> · The Movie Database
        </a>
      </footer>
    </main>
  );
}

/** Full-page message (loading, errors, room closed). */
export function StateMessage({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <section className="load-state" aria-live="polite">
      <div className="eyebrow"><Sparkles size={14} /> {eyebrow}</div>
      <h1>{title}</h1>
      {children}
    </section>
  );
}

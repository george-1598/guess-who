# Guess Who? — the movie actor edition

A two-player, real-time Guess Who game with famous actors. React + TypeScript + Vite, Supabase for rooms and realtime, hosted on GitHub Pages.

## Run locally (macOS)

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually http://localhost:5173). For local multiplayer, put `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in `.env.local` (see `.env.example`).

## GitHub Pages

The Vite base path is `/guess-who/`. Change it in `vite.config.ts` if your repository has a different name.

Deployment runs from `.github/workflows/deploy.yml` on every push to `main` (and after the "Import actors" workflow). It needs two repository **variables** (Settings → Secrets and variables → Actions → Variables): `VITE_SUPABASE_URL` (just `https://<ref>.supabase.co`, no path) and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Multiplayer (Supabase)

- Database schema, security rules and game functions: `supabase/schema.sql`, then `supabase/migrations/003_secret_mode.sql` and `004_fix_random_secrets.sql` (run once each in the Supabase SQL Editor).
- Game modes: **Famous**, **Random**, **Famous Director's Cut**, **Random Director's Cut**. The pool is the curated list (Famous) or the big random pool (Random); in *Director's Cut* each player picks the actor the opponent must find, otherwise ("Classic") secrets are dealt at random. Display names live in `POOL_NAMES` / `SECRET_NAMES` in `src/App.tsx`.
- Anonymous sign-ins must be enabled in Supabase (Authentication → Sign In / Providers).
- Each room deals a random board of 48 distinct faces (`src/lib/board.ts`); each player's secret is readable only by them until the game ends, and guesses are checked in the database.

Never deploy Supabase secret/service-role keys to GitHub Pages. Only the publishable (or legacy anon) key belongs in a browser app.

## The actor list

When creating a room, players choose an actor pool:

- **Famous** — the hand-picked list in `scripts/actors.txt` (one name per line, `#` for comments) → `public/data/characters.json`.
- **Random** — top-billed cast of TMDB's 200 most-voted movies → `public/data/random-actors.json`. Size is controlled by `RANDOM_MOVIE_PAGES` / `RANDOM_CAST_LIMIT` in `scripts/import-tmdb.mjs`.

The room stores its pool (`rooms.deck`), so rematches deal from the same one. Existing Supabase projects need `supabase/migrations/002_deck.sql` run once.

To change it:

1. Edit `scripts/actors.txt` on GitHub and commit.
2. Actions tab → **Import actors** → **Run workflow**.

The workflow (`.github/workflows/import-actors.yml`) runs `scripts/import-tmdb.mjs`, which looks each name up on TMDB for a stable person id, a profile photo path and a "Known for" title, and commits the result to `public/data/characters.json`. The run page lists any names that weren't found, had no photo, or matched a different person. The site then redeploys automatically.

It needs the repository **secret** `TMDB_READ_ACCESS_TOKEN` (your TMDB API Read Access Token). Locally: `set -a && source .env.local && set +a && npm run import:tmdb`.

The deployed site never calls TMDB's API; it only loads photos from TMDB's image CDN and falls back to initials if one is missing.

### TMDB attribution and usage

This product uses the TMDB API but is not endorsed or certified by TMDB. Include the required TMDB attribution in the app's About/Credits area and review the current [TMDB API terms](https://www.themoviedb.org/api-terms-of-use) and [API documentation](https://developer.themoviedb.org/docs) before publishing. TMDB data and images remain subject to TMDB's terms; do not assume that a public API response grants unrestricted redistribution rights. The importer stores TMDB image paths, not copied image files. Keep your API Read Access Token in `.env.local` or GitHub secrets; never commit it or put it in frontend code.

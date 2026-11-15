# Guess Who? — starter prototype

A React + TypeScript + Vite starter for a movie/actor Guess Who game.

## Run locally (macOS)

```bash
npm install
npm run dev
```

Open the local URL printed by Vite (usually http://localhost:5173).

## Current prototype

- Responsive character board
- Random secret character
- Eliminate/restore cards
- Guess selection and feedback
- Small local sample dataset

The portrait blocks are intentional placeholders, not final character photography. The next milestone is a dataset import pipeline (TMDB) and a larger curated pool, followed by Supabase rooms and realtime multiplayer.

## GitHub Pages

The Vite base path is currently `/guess-who/`. Change it in `vite.config.ts` if your repository has a different name.

Deployment runs from `.github/workflows/deploy.yml` on every push to `main`. It needs two repository **variables** (Settings → Secrets and variables → Actions → Variables): `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

## Multiplayer (Supabase)

- Database schema, security rules and game functions: `supabase/schema.sql` (run once in the Supabase SQL Editor).
- Anonymous sign-ins must be enabled in Supabase (Authentication → Sign In / Providers).
- Each room deals a random board of 48 distinct faces (`src/lib/board.ts`); each player's secret is readable only by them until the game ends, and guesses are checked in the database.

Never deploy Supabase secret/service-role keys to GitHub Pages. Only the publishable (or legacy anon) key belongs in a browser app.

## Import a starter character dataset from TMDB

The importer is a local Node.js script. It fetches a bounded set of popular movies and TV shows, reads their cast credits, and writes `public/data/characters.json`. The deployed app does not need a TMDB token and does not call the TMDB API at runtime.

1. Create a TMDB account and obtain an API **Read Access Token** from your TMDB account's API settings.
2. In the project root, copy `.env.example` to `.env.local` and add your token:

   ```bash
   cp .env.example .env.local
   ```

3. Run the importer. On macOS, this loads the local token into the command's environment without adding a dotenv dependency:

   ```bash
   set -a
   source .env.local
   set +a
   npm run import:tmdb
   ```

   The generated file is `public/data/characters.json`. The game fetches this file at runtime using Vite’s configured base path, so the same code works locally and on the GitHub Pages project site. Commit the generated JSON file to your repository so GitHub Pages can serve it; never commit `.env.local`.

After importing, start the app with `npm run dev`. If the board says it cannot load the dataset, check that `public/data/characters.json` exists and is non-empty. The UI validates the record shape before starting a round. TMDB profile images are loaded from TMDB’s image CDN; if an image is missing or unavailable, the card falls back to the character’s initials.

Optional bounds can be changed in `.env.local`:

- `TMDB_MOVIE_PAGES` and `TMDB_TV_PAGES`: 1–5 popular-title pages each (20 titles per page).
- `TMDB_CAST_LIMIT`: 1–30 cast entries per title.
- `TMDB_MAX_CHARACTERS`: maximum output records (1–5000).

The importer retries temporary network, rate-limit, and server errors, requests credits sequentially, and uses stable IDs based on TMDB person/title/role IDs. It emits actor records and credited role records. A role uses the credited performer's `profile_path` as image metadata; this is an actor portrait, not an independently sourced character image.

### Attribute accuracy and curation

TMDB cast credits provide names, role/character credit strings, person IDs, and profile image paths. They do **not** provide reliable hair colour, a character's gender, or a franchise/universe field. Imported records therefore omit `attributes`; the frontend `Character` type makes those attributes optional. Keep manually researched values separate in a curated enrichment file keyed by the generated stable `id`, and merge only verified values. Do not infer a fictional character's attributes from the actor who portrays them.

### TMDB attribution and usage

This product uses the TMDB API but is not endorsed or certified by TMDB. Include the required TMDB attribution in the app's About/Credits area and review the current [TMDB API terms](https://www.themoviedb.org/api-terms-of-use) and [API documentation](https://developer.themoviedb.org/docs) before publishing. TMDB data and images remain subject to TMDB's terms; do not assume that a public API response grants unrestricted redistribution rights. The importer stores TMDB image paths, not copied image files. Keep your API Read Access Token in `.env.local`; never commit it or put it in frontend code.

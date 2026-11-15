#!/usr/bin/env node

/**
 * Builds the two actor pools the game offers:
 *   - public/data/characters.json     "Famous": the curated list in scripts/actors.txt.
 *   - public/data/random-actors.json  "Random": main cast of TMDB's most-voted movies.
 * Each actor gets a stable TMDB person id, a profile photo path and a "Known for" title.
 * The deployed site never calls TMDB's API; only image URLs are used.
 *
 * Usage: TMDB_READ_ACCESS_TOKEN=... node scripts/import-tmdb.mjs
 * (Normally run by the "Import actors" GitHub Actions workflow.)
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_BASE = 'https://api.themoviedb.org/3';
const TOKEN = process.env.TMDB_READ_ACCESS_TOKEN;
const INPUT = resolve(ROOT, 'scripts/actors.txt');
const OUTPUT = resolve(ROOT, 'public/data/characters.json');
const RANDOM_OUTPUT = resolve(ROOT, 'public/data/random-actors.json');
// Random pool: top-billed cast of the most-voted movies (20 movies per page).
const RANDOM_MOVIE_PAGES = 10;
const RANDOM_CAST_LIMIT = 6;
const PALETTE = ['#355c7d', '#6c5b7b', '#4b6584', '#a66a5b', '#9b3c38', '#744b54', '#414b5b', '#92613d', '#806344', '#4f6d58', '#9a795e'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalize(value) {
  return String(value).normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function initials(name) {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts.length === 1 ? parts[0].slice(0, 2) : `${parts[0][0]}${parts.at(-1)[0]}`).toUpperCase();
}

function colorFor(id) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

async function tmdb(path) {
  const url = `${API_BASE}${path}`;
  for (let attempt = 0; attempt <= 4; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(25_000),
      });
    } catch (error) {
      if (attempt === 4) throw new Error(`Network request failed for ${path}: ${error.message}`);
      await sleep(500 * (2 ** attempt));
      continue;
    }

    if (response.ok) return response.json();
    const body = await response.text();
    if ((response.status === 429 || response.status >= 500) && attempt < 4) {
      const retryAfter = Number(response.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 15_000)
        : 500 * (2 ** attempt);
      console.warn(`TMDB returned ${response.status}; retrying in ${waitMs}ms...`);
      await sleep(waitMs);
      continue;
    }
    throw new Error(`TMDB ${response.status} for ${path}: ${body.slice(0, 300)}`);
  }
  throw new Error(`Request failed after retries: ${path}`);
}

async function readNames() {
  const text = await readFile(INPUT, 'utf8');
  const seen = new Set();
  const names = [];
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim();
    if (!name || name.startsWith('#')) continue;
    const key = normalize(name);
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

/** Picks the acting result whose name matches; falls back to the most popular actor result. */
function pickPerson(name, results) {
  const actors = results.filter((p) => p.known_for_department === 'Acting' && !p.adult);
  const wanted = normalize(name);
  const exact = actors.filter((p) => normalize(p.name) === wanted);
  const pool = exact.length > 0 ? exact : actors;
  return { person: [...pool].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))[0], exact: exact.length > 0 };
}

function knownFor(person) {
  const titles = (person.known_for ?? [])
    .filter((item) => item && (item.title || item.name))
    .sort((a, b) => (b.vote_count ?? 0) - (a.vote_count ?? 0));
  const top = titles[0];
  return top ? `Known for ${top.title ?? top.name}` : 'Actor';
}

// TMDB person gender codes: 0 = not set, 1 = female, 2 = male, 3 = non-binary.
// Only 1 and 2 are stored; anyone else is never affected by the "hide women/men" buttons.
const TMDB_GENDERS = { 1: 'WOMAN', 2: 'MAN' };

function makeRecord(personId, name, subtitle, profilePath, tmdbGender) {
  const id = `tmdb:actor:${personId}`;
  const gender = TMDB_GENDERS[tmdbGender];
  return {
    id,
    name,
    kind: 'ACTOR',
    subtitle,
    initials: initials(name),
    color: colorFor(id),
    ...(gender ? { attributes: { gender } } : {}),
    tmdb: { personId, profilePath },
  };
}

async function writeRecords(path, records) {
  records.sort((a, b) => a.name.localeCompare(b.name));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
}

async function buildRandomPool() {
  console.log(`\nBuilding the random pool from ${RANDOM_MOVIE_PAGES * 20} most-voted movies...`);
  const people = new Map();
  for (let page = 1; page <= RANDOM_MOVIE_PAGES; page += 1) {
    const list = await tmdb(`/discover/movie?include_adult=false&sort_by=vote_count.desc&page=${page}`);
    for (const movie of Array.isArray(list.results) ? list.results : []) {
      if (!Number.isInteger(movie.id) || !movie.title) continue;
      const credits = await tmdb(`/movie/${movie.id}/credits`);
      const cast = Array.isArray(credits.cast) ? credits.cast.slice(0, RANDOM_CAST_LIMIT) : [];
      for (const person of cast) {
        if (!Number.isInteger(person.id) || !person.name || !person.profile_path) continue;
        if (person.adult || person.known_for_department !== 'Acting') continue;
        // Movies arrive most-voted first, so the first movie we see is the best "Known for".
        if (!people.has(person.id)) {
          people.set(person.id, makeRecord(person.id, person.name.trim(), `Known for ${movie.title}`, person.profile_path, person.gender));
        }
      }
      await sleep(60);
    }
  }
  return [...people.values()];
}

async function main() {
  if (!TOKEN) throw new Error('Missing TMDB_READ_ACCESS_TOKEN.');

  const names = await readNames();
  console.log(`Looking up ${names.length} actors on TMDB...`);

  const records = [];
  const seenPeople = new Set();
  const problems = [];

  for (const name of names) {
    const data = await tmdb(`/search/person?query=${encodeURIComponent(name)}&include_adult=false&page=1`);
    const { person, exact } = pickPerson(name, Array.isArray(data.results) ? data.results : []);
    await sleep(80);

    if (!person) { problems.push(`${name}: not found on TMDB`); continue; }
    if (!person.profile_path) { problems.push(`${name}: no photo on TMDB, skipped`); continue; }
    if (seenPeople.has(person.id)) { problems.push(`${name}: duplicate of another entry, skipped`); continue; }
    if (!exact) problems.push(`${name}: no exact match on TMDB, used the photo of "${person.name}" — check this is right`);
    seenPeople.add(person.id);

    // Show the name as written in actors.txt (e.g. "Salma Hayek", not TMDB's "Salma Hayek Pinault").
    records.push(makeRecord(person.id, name, knownFor(person), person.profile_path, person.gender));
  }

  if (records.length < 12) throw new Error(`Only ${records.length} actors were found; a board needs at least 12.`);
  await writeRecords(OUTPUT, records);

  const randomRecords = await buildRandomPool();
  if (randomRecords.length < 12) throw new Error(`Only ${randomRecords.length} random actors were found.`);
  await writeRecords(RANDOM_OUTPUT, randomRecords);

  const summary = [
    `## Actor import`,
    ``,
    `- **Famous:** ${records.length} actors → \`public/data/characters.json\``,
    `- **Random:** ${randomRecords.length} actors → \`public/data/random-actors.json\``,
    ``,
    problems.length ? `### Needs a look (${problems.length})` : `No problems found.`,
    ...problems.map((p) => `- ${p}`),
    ``,
  ].join('\n');
  console.log(`\n${summary}`);
  // Shows the summary on the workflow run page in GitHub.
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

main().catch((error) => {
  console.error(`\nTMDB import failed: ${error.message}`);
  process.exitCode = 1;
});

#!/usr/bin/env node

/**
 * Build a static Guess Who dataset from TMDB's popular movie/TV lists and cast credits.
 * No TMDB credentials or API calls are needed by the deployed browser app.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_BASE = 'https://api.themoviedb.org/3';
const TOKEN = process.env.TMDB_READ_ACCESS_TOKEN;
const OUTPUT = resolve(ROOT, 'public/data/characters.json');
const PALETTE = ['#355c7d', '#6c5b7b', '#4b6584', '#a66a5b', '#9b3c38', '#744b54', '#414b5b', '#92613d', '#806344', '#4f6d58', '#9a795e'];

function boundedInteger(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}; received ${raw}`);
  }
  return value;
}

const moviePages = boundedInteger('TMDB_MOVIE_PAGES', 1, 1, 5);
const tvPages = boundedInteger('TMDB_TV_PAGES', 1, 1, 5);
const castLimit = boundedInteger('TMDB_CAST_LIMIT', 10, 1, 30);
const maxCharacters = boundedInteger('TMDB_MAX_CHARACTERS', 500, 1, 5000);

function slug(value) {
  return String(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'unknown';
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

function cleanText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
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
      await new Promise((r) => setTimeout(r, 500 * (2 ** attempt)));
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
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throw new Error(`TMDB ${response.status} for ${path}: ${body.slice(0, 500)}`);
  }
  throw new Error(`Request failed after retries: ${path}`);
}

function assertCharacterRecord(record) {
  const valid = typeof record.id === 'string'
    && typeof record.name === 'string'
    && (record.kind === 'ACTOR' || record.kind === 'CHARACTER')
    && typeof record.subtitle === 'string'
    && typeof record.initials === 'string'
    && typeof record.color === 'string'
    && record.tmdb && Number.isInteger(record.tmdb.personId);
  if (!valid) throw new Error(`Generated record does not match the frontend Character shape: ${JSON.stringify(record)}`);
}

function makeRecord({ id, name, kind, subtitle, profilePath, mediaType, mediaId, mediaTitle, personId }) {
  const record = {
    id,
    name,
    kind,
    subtitle,
    initials: initials(name),
    color: colorFor(id),
    // TMDB paths are retained as metadata. The UI can build image URLs later using
    // https://image.tmdb.org/t/p/w500 + profilePath; no image URL is guessed here.
    tmdb: {
      personId,
      ...(profilePath ? { profilePath } : {}),
      ...(mediaType ? { mediaType, mediaId, mediaTitle } : {}),
    },
  };
  return record;
}

async function popularItems(type, pageCount) {
  const items = [];
  for (let page = 1; page <= pageCount; page += 1) {
    const data = await tmdb(`/discover/${type}?include_adult=false&sort_by=popularity.desc&page=${page}`);
    items.push(...(Array.isArray(data.results) ? data.results : []));
    await new Promise((r) => setTimeout(r, 120));
  }
  return items;
}

async function importMedia(type, items, records, seenActors, seenRoles) {
  for (const media of items) {
    const mediaId = Number(media.id);
    if (!Number.isInteger(mediaId)) continue;
    const title = cleanText(type === 'movie' ? media.title : media.name, 'Untitled');
    const credits = await tmdb(`/${type}/${mediaId}/credits`);
    const cast = Array.isArray(credits.cast) ? credits.cast.slice(0, castLimit) : [];

    for (const person of cast) {
      const personId = Number(person.id);
      const personName = cleanText(person.name);
      if (!Number.isInteger(personId) || !personName) continue;

      const actorId = `tmdb:actor:${personId}`;
      if (!seenActors.has(actorId)) {
        seenActors.add(actorId);
        records.push(makeRecord({
          id: actorId,
          name: personName,
          kind: 'ACTOR',
          subtitle: 'Actor',
          profilePath: cleanText(person.profile_path),
          personId,
        }));
      }

      const roleName = cleanText(person.character);
      if (!roleName) continue;
      const roleId = `tmdb:role:${type}:${mediaId}:${personId}:${slug(roleName)}`;
      if (seenRoles.has(roleId)) continue;
      seenRoles.add(roleId);
      records.push(makeRecord({
        id: roleId,
        name: roleName,
        kind: 'CHARACTER',
        subtitle: `${type === 'movie' ? 'Movie' : 'TV'} · ${title}`,
        profilePath: cleanText(person.profile_path),
        mediaType: type,
        mediaId,
        mediaTitle: title,
        personId,
      }));
    }
    console.log(`Imported cast for ${type}: ${title} (${cast.length} entries)`);
    // Sequential requests plus a small pause keep the importer polite to the API.
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function main() {
  if (!TOKEN) {
    throw new Error('Missing TMDB_READ_ACCESS_TOKEN. Set your TMDB API Read Access Token in .env.local or the shell environment.');
  }

  console.log(`Fetching popular titles (movies: ${moviePages} page(s), TV: ${tvPages} page(s))...`);
  const [movies, shows] = await Promise.all([
    popularItems('movie', moviePages),
    popularItems('tv', tvPages),
  ]);

  const records = [];
  const seenActors = new Set();
  const seenRoles = new Set();
  await importMedia('movie', movies, records, seenActors, seenRoles);
  await importMedia('tv', shows, records, seenActors, seenRoles);

  const limited = records.slice(0, maxCharacters);
  // Runtime contract check mirrors the required fields in src/characters.ts.
  for (const record of limited) assertCharacterRecord(record);
  // Stable ordering makes generated diffs predictable across runs.
  limited.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(limited, null, 2)}\n`, 'utf8');

  const actorCount = limited.filter((item) => item.kind === 'ACTOR').length;
  const roleCount = limited.length - actorCount;
  console.log(`\nWrote ${limited.length} records to ${OUTPUT}`);
  console.log(`Actors: ${actorCount}; character roles: ${roleCount}`);
  if (records.length > maxCharacters) {
    console.warn(`Output capped at ${maxCharacters} records (discovered ${records.length}). Increase TMDB_MAX_CHARACTERS if desired.`);
  }
  console.log('Note: TMDB does not supply hair colour, character gender, or franchise/universe for these credits. Those fields are intentionally omitted for imported records.');
}

main().catch((error) => {
  console.error(`\nTMDB import failed: ${error.message}`);
  process.exitCode = 1;
});

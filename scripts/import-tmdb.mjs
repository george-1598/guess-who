#!/usr/bin/env node

/**
 * Builds public/data/characters.json from the curated actor list in scripts/actors.txt.
 * Each name is looked up on TMDB to get a stable person id, a profile photo path and a
 * "Known for" title. The deployed site never calls TMDB's API; only image URLs are used.
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
    if (!exact) problems.push(`${name}: no exact match, used "${person.name}" — check this is right`);
    seenPeople.add(person.id);

    const id = `tmdb:actor:${person.id}`;
    records.push({
      id,
      name: person.name,
      kind: 'ACTOR',
      subtitle: knownFor(person),
      initials: initials(person.name),
      color: colorFor(id),
      tmdb: { personId: person.id, profilePath: person.profile_path },
    });
  }

  if (records.length < 12) throw new Error(`Only ${records.length} actors were found; a board needs at least 12.`);

  records.sort((a, b) => a.name.localeCompare(b.name));
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(records, null, 2)}\n`, 'utf8');

  const summary = [
    `## Actor import`,
    ``,
    `Wrote **${records.length}** actors to \`public/data/characters.json\`.`,
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

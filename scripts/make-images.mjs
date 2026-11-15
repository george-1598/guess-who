#!/usr/bin/env node

/**
 * Renders the PNG versions of the app icon and link-preview image from their SVG sources.
 * Runs in the deploy workflow before `npm run build`, so no image files need committing.
 *
 *   public/icon.svg       → public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png
 *   assets/og-image.svg   → public/og-image.png (1200×630, shown when the link is shared)
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const icon = await readFile(resolve(ROOT, 'public/icon.svg'));
const og = await readFile(resolve(ROOT, 'assets/og-image.svg'));

const jobs = [
  [icon, 192, 192, 'public/icon-192.png'],
  [icon, 512, 512, 'public/icon-512.png'],
  [icon, 180, 180, 'public/apple-touch-icon.png'],
  [og, 1200, 630, 'public/og-image.png'],
];

for (const [svg, width, height, output] of jobs) {
  // High density renders the SVG sharply before resizing.
  await sharp(svg, { density: 300 }).resize(width, height).png().toFile(resolve(ROOT, output));
  console.log(`Wrote ${output} (${width}×${height})`);
}

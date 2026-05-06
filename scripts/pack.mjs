#!/usr/bin/env node
// Build the extension and zip it into a distributable artifact.
// Usage:
//   node scripts/pack.mjs
//
// Produces: real-stars-{version}.zip (installable via "Load unpacked" or
// drag-and-drop into chrome://extensions in dev mode; for store upload, the
// same zip is what Chrome Web Store accepts).

import { execSync } from 'node:child_process';
import { readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWriteStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DIST = resolve(ROOT, 'dist');
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

console.log('[pack] building extension…');
execSync('pnpm build', { cwd: ROOT, stdio: 'inherit' });

if (!existsSync(DIST)) {
  console.error('[pack] dist/ missing after build — aborting.');
  process.exit(1);
}

const ARTIFACT_DIR = resolve(ROOT, 'artifacts');
mkdirSync(ARTIFACT_DIR, { recursive: true });
const zipPath = resolve(ARTIFACT_DIR, `real-stars-${PKG.version}.zip`);
if (existsSync(zipPath)) rmSync(zipPath);

console.log(`[pack] zipping → ${zipPath}`);

// Use the system zip command — universally available on macOS/Linux, fast,
// and produces Chrome-Web-Store-compatible archives (no extra metadata).
execSync(`zip -r -X "${zipPath}" .`, { cwd: DIST, stdio: 'inherit' });

const sizeBytes = (await stat(zipPath)).size;
const sizeKb = Math.round(sizeBytes / 1024);

const fileCount = await countFiles(DIST);

console.log(`[pack] done. ${fileCount} files, ${sizeKb} KB`);
console.log(`[pack] artifact: ${zipPath}`);

async function countFiles(dir) {
  let total = 0;
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) total += await countFiles(path);
    else total++;
  }
  return total;
}

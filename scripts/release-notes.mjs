#!/usr/bin/env node
// Prints the CHANGELOG.md section for one version (zero dependencies).
// Usage: node scripts/release-notes.mjs 1.1.0   (a leading "v" is accepted)
// Used by release.yml as the GitHub release notes. Exits with status 1 if there is no section.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const version = String(process.argv[2] || '').replace(/^v/, '');
const file = fileURLToPath(new URL('../CHANGELOG.md', import.meta.url));
const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];

const heading = (line) => /^## /.test(line);
const start = lines.findIndex((line) => heading(line) && line.replace(/^## \[?/, '').split(/[\]\s]/)[0] === version);
if (!version || start === -1) {
  console.error(`CHANGELOG.md has no "## ${version}" section`);
  process.exit(1);
}
const rest = lines.slice(start + 1);
const end = rest.findIndex(heading);
console.log((end === -1 ? rest : rest.slice(0, end)).join('\n').trim());

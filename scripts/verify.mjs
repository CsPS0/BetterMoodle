#!/usr/bin/env node
// BetterMoodle verification suite (zero dependencies).
// Usage: node scripts/verify.mjs
//
// Checks:
//   1. JavaScript syntax (`node --check`) for the extension, website and scripts
//   2. manifest.json validity and that every file it references exists
//   3. No school/branding leaks and no raw emoji in extension + website sources
//   4. Every selector in content.css is scoped under html[data-mp-active="true"]
//   5. The website has one download, pointing at the latest GitHub release asset
//   6. No hardcoded "vX.Y.Z" version strings (the version lives only in manifest.json)

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT = join(ROOT, 'extension');
const SITE = join(ROOT, 'website');
const failures = [];
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const fail = (msg) => failures.push(msg);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// 1. Syntax ---------------------------------------------------------------
const jsFiles = [
  ...walk(EXT).filter((p) => extname(p) === '.js'),
  ...walk(SITE).filter((p) => extname(p) === '.js'),
  ...walk(join(ROOT, 'scripts')).filter((p) => ['.js', '.mjs'].includes(extname(p)))
];
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    fail(`Syntax error in ${rel(file)}:\n${String(err.stderr || err.message).trim()}`);
  }
}

// 2. Manifest -------------------------------------------------------------
let manifest = null;
try {
  manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
} catch (err) {
  fail(`extension/manifest.json is not valid JSON: ${err.message}`);
}
if (manifest) {
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  if (manifest.name !== 'BetterMoodle') fail('manifest name must be BetterMoodle');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) fail('manifest version must be x.y.z');
  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.side_panel?.default_path,
    manifest.options_ui?.page,
    ...Object.values(manifest.icons || {}),
    ...Object.values(manifest.action?.default_icon || {}),
    ...(manifest.content_scripts || []).flatMap((cs) => [...(cs.js || []), ...(cs.css || [])])
  ].filter(Boolean);
  for (const ref of referenced) {
    if (!existsSync(join(EXT, ref))) fail(`manifest references missing file: extension/${ref}`);
  }
}

// 3. Leaks & emoji --------------------------------------------------------
const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.html', '.css', '.svg', '.md']);
const forbidden = new RegExp(['neu' + 'mann', 'njsz' + 'ki'].join('|'), 'i');
const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const textFiles = [...walk(EXT), ...walk(SITE)].filter((p) => TEXT_EXT.has(extname(p)));
for (const file of textFiles) {
  const text = readFileSync(file, 'utf8');
  if (forbidden.test(text)) fail(`Branding leak in ${rel(file)}`);
  if (emoji.test(text)) fail(`Raw emoji in ${rel(file)}`);
}

// 4. content.css scoping --------------------------------------------------
function unscopedSelectors(css) {
  const bad = [];
  const stack = [];
  let prelude = '';
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '/' && css[i + 1] === '*') {
      i = css.indexOf('*/', i + 2) + 1;
      continue;
    }
    const top = stack.at(-1);
    if (top === 'rule' || top === 'frame') {
      if (ch === '{') stack.push('rule');
      if (ch === '}') stack.pop();
      continue;
    }
    if (ch === '{') {
      const p = prelude.trim();
      if (p.startsWith('@')) stack.push(/^@(-webkit-)?keyframes/.test(p) ? 'keyframes' : 'block');
      else if (top === 'keyframes') stack.push('frame');
      else {
        let depth = 0;
        let cur = '';
        const parts = [];
        for (const c of p) {
          if (c === '(' || c === '[') depth++;
          if (c === ')' || c === ']') depth--;
          if (c === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += c;
        }
        parts.push(cur);
        for (const sel of parts.map((s) => s.trim())) {
          if (!sel.startsWith('html[data-mp-active="true"]') && !sel.startsWith(':where(html[data-mp-active="true"])')) bad.push(sel);
        }
        stack.push('rule');
      }
      prelude = '';
      continue;
    }
    if (ch === '}') { stack.pop(); prelude = ''; continue; }
    prelude += ch;
  }
  return bad;
}
const contentCss = join(EXT, 'content', 'content.css');
if (existsSync(contentCss)) {
  const bad = unscopedSelectors(readFileSync(contentCss, 'utf8'));
  if (bad.length) fail(`${bad.length} unscoped selector(s) in extension/content/content.css, e.g.:\n  ${bad.slice(0, 5).join('\n  ')}`);
}

// 5. Website download ---------------------------------------------------
const LATEST_ZIP = 'https://github.com/CsPS0/BetterMoodle/releases/latest/download/BetterMoodle.zip';
const siteHtml = readFileSync(join(SITE, 'index.html'), 'utf8');
const downloadLinks = siteHtml.split(LATEST_ZIP).length - 1;
if (downloadLinks !== 1) fail(`website/index.html must link the latest release ZIP exactly once (found ${downloadLinks})`);
if (/href="[^"]*downloads\//.test(siteHtml) || existsSync(join(SITE, 'downloads'))) {
  fail('website must not host extension builds (releases are built by CI)');
}

// 6. Hardcoded versions ---------------------------------------------------
const versionString = /\bv\d+\.\d+\.\d+\b/;
for (const file of textFiles) {
  if (file.endsWith('manifest.json')) continue;
  const m = readFileSync(file, 'utf8').match(versionString);
  if (m) fail(`Hardcoded version "${m[0]}" in ${rel(file)} (read it from the manifest instead)`);
}

if (failures.length) {
  console.error(`Verification FAILED (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Verification passed: ${jsFiles.length} JS files, ${textFiles.length} text files, manifest v${manifest.version}, content.css scoped, website download points at the latest release.`);

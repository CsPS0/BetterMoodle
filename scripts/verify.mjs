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
//   7. The web app (webapp/) gets the same syntax, leak and emoji checks, plus PWA shell checks
//   8. The Android wrapper (android/app/src) gets the same syntax, leak and emoji checks

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT = join(ROOT, 'extension');
const SITE = join(ROOT, 'website');
const WEBAPP = join(ROOT, 'webapp');
const webappFiles = existsSync(WEBAPP) ? walk(WEBAPP) : [];
const ANDROID_SRC = join(ROOT, 'android', 'app', 'src');
const failures = [];
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');
const fail = (msg) => failures.push(msg);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const androidFiles = existsSync(ANDROID_SRC) ? walk(ANDROID_SRC) : [];

// 1. Syntax ---------------------------------------------------------------
const jsFiles = [
  ...walk(EXT).filter((p) => extname(p) === '.js'),
  ...walk(SITE).filter((p) => extname(p) === '.js'),
  ...webappFiles.filter((p) => extname(p) === '.js'),
  ...androidFiles.filter((p) => extname(p) === '.js'),
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
const TEXT_EXT = new Set(['.js', '.mjs', '.json', '.html', '.css', '.svg', '.md', '.webmanifest', '.java', '.xml', '.kts']);
const forbidden = new RegExp(['neu' + 'mann', 'njsz' + 'ki'].join('|'), 'i');
const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const textFiles = [...walk(EXT), ...walk(SITE), ...webappFiles, ...androidFiles].filter((p) => TEXT_EXT.has(extname(p)));
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

// 7. Web app (PWA) shell -------------------------------------------------
if (existsSync(WEBAPP)) {
  const inWebapp = (ref) => join(WEBAPP, ref.replace(/^\.\//, '').split('?')[0] || 'index.html');
  let pwa = null;
  try {
    pwa = JSON.parse(readFileSync(join(WEBAPP, 'manifest.webmanifest'), 'utf8'));
  } catch (err) {
    fail(`webapp/manifest.webmanifest is missing or not valid JSON: ${err.message}`);
  }
  if (pwa) {
    const icons = pwa.icons || [];
    for (const icon of icons) {
      if (!existsSync(inWebapp(icon.src))) fail(`webapp manifest references missing icon: ${icon.src}`);
    }
    for (const size of ['192x192', '512x512']) {
      if (!icons.some((i) => i.sizes === size && i.type === 'image/png')) fail(`webapp manifest needs a ${size} PNG icon to be installable`);
    }
    if (!icons.some((i) => String(i.purpose || '').includes('maskable'))) fail('webapp manifest needs a maskable icon');
    if (pwa.display !== 'standalone') fail('webapp manifest display must be "standalone"');
    if (!pwa.start_url || !pwa.scope || /^\/|^https?:/.test(pwa.start_url + pwa.scope)) fail('webapp manifest start_url and scope must be relative');
  }
  // Every file the service worker precaches must exist, or its install fails.
  const sw = existsSync(join(WEBAPP, 'sw.js')) ? readFileSync(join(WEBAPP, 'sw.js'), 'utf8') : '';
  const shell = /const SHELL = \[([\s\S]*?)\];/.exec(sw);
  if (!shell) fail('webapp/sw.js must define its precache list as const SHELL = [...]');
  else {
    for (const [, ref] of shell[1].matchAll(/'([^']+)'/g)) {
      if (!existsSync(inWebapp(ref))) fail(`webapp/sw.js precaches a missing file: ${ref}`);
    }
  }
  const page = existsSync(join(WEBAPP, 'index.html')) ? readFileSync(join(WEBAPP, 'index.html'), 'utf8') : '';
  if (!/http-equiv="Content-Security-Policy"[^>]*script-src 'self'/.test(page)) fail("webapp/index.html must carry a CSP meta tag with script-src 'self'");
  if (/<script(?![^>]*\ssrc=)[^>]*>/i.test(page)) fail('webapp/index.html must not contain inline scripts');
  // Moodle text is teacher-authored HTML and the token lives on this origin: never inject HTML.
  for (const file of webappFiles.filter((p) => extname(p) === '.js')) {
    if (/\.(innerHTML|outerHTML)\s*=|insertAdjacentHTML|document\.write/.test(readFileSync(file, 'utf8'))) {
      fail(`${rel(file)} injects HTML (use DOM nodes and textContent instead)`);
    }
  }
}

if (failures.length) {
  console.error(`Verification FAILED (${failures.length}):\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`Verification passed: ${jsFiles.length} JS files, ${textFiles.length} text files, manifest v${manifest.version}, content.css scoped, website download points at the latest release${existsSync(WEBAPP) ? ', web app shell complete' : ''}.`);

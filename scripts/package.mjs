#!/usr/bin/env node
// Packages the unpacked extension into a ZIP (zero dependencies, reproducible).
//
//   node scripts/package.mjs                    -> dist/BetterMoodle.zip (+ versioned copy)
//   node scripts/package.mjs --version 1.2.3    -> stamps 1.2.3 into the packaged manifest.json
//
// The release workflow passes the git tag (v1.2.3 -> 1.2.3), so the tag is the single
// source of the release version; the manifest in the repo is only the local default.
// ZIP layout: BetterMoodle/manifest.json, BetterMoodle/content/..., plus LICENSE and
// README.md, so "Load unpacked" can point straight at the extracted folder.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT = join(ROOT, 'extension');
const DIST = join(ROOT, 'dist');

const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));
const versionArg = process.argv.indexOf('--version');
const version = String(versionArg > -1 ? process.argv[versionArg + 1] || '' : manifest.version).replace(/^v/, '');
if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  console.error(`Invalid version "${version}" (expected e.g. 1.0.0)`);
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const entries = [
  ...walk(EXT).map((p) => ({ src: p, name: `BetterMoodle/${relative(EXT, p).replace(/\\/g, '/')}` })),
  { src: join(ROOT, 'LICENSE'), name: 'BetterMoodle/LICENSE' },
  { src: join(ROOT, 'README.md'), name: 'BetterMoodle/README.md' }
]
  .filter((e) => !/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/i.test(e.name))
  .sort((a, b) => a.name.localeCompare(b.name));

// --- minimal ZIP writer (deflate, fixed timestamp => byte-identical builds) ---
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

const locals = [];
const centrals = [];
let offset = 0;
for (const { src, name } of entries) {
  const data = name === 'BetterMoodle/manifest.json'
    ? Buffer.from(`${JSON.stringify({ ...manifest, version }, null, 2)}
`, 'utf8')
    : readFileSync(src);
  const deflated = deflateRawSync(data, { level: 9 });
  const useDeflate = deflated.length < data.length;
  const body = useDeflate ? deflated : data;
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6); // UTF-8 names
  local.writeUInt16LE(useDeflate ? 8 : 0, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  locals.push(local, nameBuf, body);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(useDeflate ? 8 : 0, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(offset, 42);
  centrals.push(central, nameBuf);

  offset += local.length + nameBuf.length + body.length;
}
const centralBuf = Buffer.concat(centrals);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(centralBuf.length, 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...locals, centralBuf, end]);

mkdirSync(DIST, { recursive: true });
const sha = createHash('sha256').update(zip).digest('hex');
for (const name of ['BetterMoodle.zip', `BetterMoodle-v${version}.zip`]) {
  writeFileSync(join(DIST, name), zip);
}
console.log(`Packaged ${entries.length} files (v${version}) -> dist/BetterMoodle.zip, dist/BetterMoodle-v${version}.zip (${(zip.length / 1024).toFixed(1)} KB, sha256 ${sha})`);

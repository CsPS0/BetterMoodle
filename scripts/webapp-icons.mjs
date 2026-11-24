#!/usr/bin/env node
// Renders the BetterMoodle logo (extension/icons/logo.svg) into the PNG icons the
// web app manifest needs, with no dependencies: signed-distance shapes, PNG via zlib.
// Usage: node scripts/webapp-icons.mjs   -> webapp/icons/icon-{192,512}.png, maskable-512.png, apple-touch-icon.png

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../webapp/icons/', import.meta.url));

const BG = [9, 9, 11];
const BORDER = [30, 41, 59];
const WHITE = [244, 244, 245];
const BLUE = [59, 130, 246];

// Logo geometry in the 128x128 SVG coordinate space.
const STROKES = [
  { color: WHITE, width: 11, points: [[26, 80], [26, 38], [50, 62], [74, 38], [74, 80]] },
  { color: BLUE, width: 10, points: [[97, 34], [97, 56]] },
  { color: BLUE, width: 10, points: [[86, 45], [108, 45]] },
  { color: BLUE, width: 6, points: [[26, 97], [102, 97]] }
];

const clamp = (v) => Math.max(0, Math.min(1, v));

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function roundRectSdf(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function over(dst, color, a) {
  // Straight-alpha "source over" compositing.
  const outA = a + dst[3] * (1 - a);
  if (outA <= 0) return [0, 0, 0, 0];
  const mix = (i) => (color[i] * a + dst[i] * dst[3] * (1 - a)) / outA;
  return [mix(0), mix(1), mix(2), outA];
}

function render(size, { maskable }) {
  const px = Buffer.alloc(size * size * 4);
  // Maskable icons are full bleed: the glyph shrinks into the central 80% safe zone.
  const glyphScale = maskable ? 0.8 : 1;
  const unit = size / 128;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x + 0.5) / unit;
      const sy = (y + 0.5) / unit;
      let c = [0, 0, 0, 0];
      if (maskable) {
        c = [...BG, 1];
      } else {
        const d = roundRectSdf(sx, sy, 64, 64, 56, 56, 26);
        c = over(c, BG, clamp(0.5 - d * unit));
        c = over(c, BORDER, clamp(0.5 - (Math.abs(d) - 2) * unit));
      }
      const gx = 64 + (sx - 64) / glyphScale;
      const gy = 64 + (sy - 64) / glyphScale;
      const gUnit = unit * glyphScale;
      for (const s of STROKES) {
        let d = Infinity;
        for (let i = 0; i < s.points.length - 1; i++) {
          const [a, b] = [s.points[i], s.points[i + 1]];
          d = Math.min(d, segDist(gx, gy, a[0], a[1], b[0], b[1]));
        }
        c = over(c, s.color, clamp(0.5 - (d - s.width / 2) * gUnit));
      }
      const o = (y * size + x) * 4;
      px[o] = Math.round(c[0]);
      px[o + 1] = Math.round(c[1]);
      px[o + 2] = Math.round(c[2]);
      px[o + 3] = Math.round(c[3] * 255);
    }
  }
  return png(size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

mkdirSync(OUT, { recursive: true });
const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true]
];
for (const [name, size, maskable] of targets) {
  writeFileSync(join(OUT, name), render(size, { maskable }));
  console.log(`wrote webapp/icons/${name}`);
}

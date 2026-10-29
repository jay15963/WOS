// Generates PWA icons (PNG) procedurally — no dependencies. Run: node tools/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function png(w, h, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const sat = (v) => Math.max(0, Math.min(1, v));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function render(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const pad = maskable ? 0 : 0.06;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    const px = 1 / size;
    // rounded square mask (non-maskable icons)
    let alpha = 1;
    if (!maskable) {
      const r = 0.2, cx = Math.min(Math.max(u, pad + r), 1 - pad - r), cy = Math.min(Math.max(v, pad + r), 1 - pad - r);
      const d = Math.hypot(u - cx, v - cy) - r;
      alpha = sat(0.5 - d / px);
    }
    // sky gradient: dusk
    let col = mix([0.96, 0.62, 0.30], [0.20, 0.16, 0.22], sat((0.62 - v) / 0.55));
    // sun
    const ds = Math.hypot(u - 0.5, v - 0.5) - 0.17;
    col = mix(col, [1.0, 0.86, 0.48], sat(0.5 - ds / px));
    // far mountains
    const m1 = 0.58 - 0.12 * Math.abs(Math.sin(u * 5.2 + 1.3)) - 0.05 * Math.sin(u * 13.0);
    if (v > m1) col = mix(col, [0.36, 0.25, 0.26], sat((v - m1) / px));
    // ground
    const g = 0.7 + 0.03 * Math.sin(u * 7);
    if (v > g) col = mix(col, [0.17, 0.20, 0.12], sat((v - g) / px));
    // pine tree silhouette
    const tx = 0.34, base = 0.78;
    for (let k = 0; k < 3; k++) {
      const yb = base - 0.08 - k * 0.11, w = 0.16 - k * 0.035, top = yb - 0.17;
      if (v < yb && v > top) {
        const half = w * (v - top) / (yb - top);
        const d = Math.abs(u - tx) - half;
        col = mix(col, [0.09, 0.14, 0.09], sat(0.5 - d / px));
      }
    }
    if (Math.abs(u - tx) < 0.018 && v > base - 0.1 && v < base) col = [0.12, 0.09, 0.07];
    // campfire glow
    const dg = Math.hypot((u - 0.66) * 1.0, (v - 0.76) * 1.6);
    col = mix(col, [1.0, 0.72, 0.3], sat(0.16 - dg) * 3.0);
    const df = Math.hypot((u - 0.66) * 2.2, (v - 0.735) * 1.2) - 0.05;
    col = mix(col, [1.0, 0.93, 0.62], sat(0.5 - df / px));
    const i = (y * size + x) * 4;
    buf[i] = sat(col[0]) * 255; buf[i + 1] = sat(col[1]) * 255; buf[i + 2] = sat(col[2]) * 255; buf[i + 3] = alpha * 255;
  }
  return png(size, size, buf);
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true });
writeFileSync(new URL('../icons/icon-192.png', import.meta.url), render(192, false));
writeFileSync(new URL('../icons/icon-512.png', import.meta.url), render(512, false));
writeFileSync(new URL('../icons/icon-maskable-512.png', import.meta.url), render(512, true));
// iOS home screen: opaque, full-bleed (iOS rounds the corners itself)
writeFileSync(new URL('../icons/apple-touch-icon-180.png', import.meta.url), render(180, true));
console.log('icons ok');

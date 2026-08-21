#!/usr/bin/env node
/**
 * Generate HALD-strip LUTs for named looks + LUT-applied reference cards.
 *
 * public/luts/<id>.png          32³ strip (1024×32)
 * docs/looks/<id>-webgpu.png    LUT-graded test chart (stand-in until a
 *                               WebGPU host runs scripts/capture-look-goldens.mjs)
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const LOOKS = {
  clear: { vibrance: 1, saturation: 1, contrast: 1, exposure: 0, temperature: 0, tint: 0 },
  noir: { vibrance: 0.45, saturation: 0.35, contrast: 1.55, exposure: -0.25, temperature: -0.45, tint: 0.15 },
  'teal-orange': { vibrance: 1.35, saturation: 1.25, contrast: 1.18, exposure: 0.12, temperature: 0.42, tint: -0.28 },
  'bleach-bypass': { vibrance: 0.55, saturation: 0.5, contrast: 1.65, exposure: 0.15, temperature: -0.05, tint: 0 },
  'golden-hour': { vibrance: 1.25, saturation: 1.15, contrast: 1.08, exposure: 0.18, temperature: 0.48, tint: -0.18 },
  storm: { vibrance: 0.7, saturation: 0.75, contrast: 1.25, exposure: -0.35, temperature: -0.28, tint: 0.18 },
  arctic: { vibrance: 1.05, saturation: 0.82, contrast: 1.22, exposure: 0.28, temperature: -0.22, tint: 0.05 },
  'neon-rain': { vibrance: 1.15, saturation: 1.05, contrast: 1.28, exposure: -0.15, temperature: -0.35, tint: 0.35 },
};

const SIZE = 32;
const LUMA = { r: 0.2126, g: 0.7152, b: 0.0722 };

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function kelvinToRgb(kelvin) {
  const temp = Math.min(40000, Math.max(1000, kelvin)) / 100;
  let r = 255;
  let g = 255;
  let b = 255;
  if (temp > 66) r = 329.698727446 * (temp - 60) ** -0.1332047592;
  if (temp <= 66) g = 99.4708025861 * Math.log(temp) - 161.1195681661;
  else g = 288.1221695283 * (temp - 60) ** -0.0755148492;
  if (temp < 66) b = temp > 19 ? 138.5177312231 * Math.log(temp - 10) - 305.0447927307 : 0;
  return [clamp01(r / 255), clamp01(g / 255), clamp01(b / 255)];
}

function grade(r, g, b, pack) {
  const vibrance = pack.vibrance - 1;
  const saturation = pack.saturation - 1;
  const contrast = pack.contrast - 1;
  let cr = r;
  let cg = g;
  let cb = b;
  const luma0 = cr * LUMA.r + cg * LUMA.g + cb * LUMA.b;
  const sat = Math.max(cr, cg, cb) - luma0;
  const vMul = vibrance * (1 - sat);
  cr += (cr - luma0) * vMul;
  cg += (cg - luma0) * vMul;
  cb += (cb - luma0) * vMul;
  const luma1 = cr * LUMA.r + cg * LUMA.g + cb * LUMA.b;
  const sAmt = 1 + saturation;
  cr = luma1 + (cr - luma1) * sAmt;
  cg = luma1 + (cg - luma1) * sAmt;
  cb = luma1 + (cb - luma1) * sAmt;
  cr = (cr - 0.5) * (1 + contrast) + 0.5;
  cg = (cg - 0.5) * (1 + contrast) + 0.5;
  cb = (cb - 0.5) * (1 + contrast) + 0.5;
  const kRgb = kelvinToRgb(6500 + pack.temperature * 5000);
  const nRgb = kelvinToRgb(6500);
  cr *= (kRgb[0] / nRgb[0]) * (1 + pack.tint * 0.05);
  cg *= (kRgb[1] / nRgb[1]) * (1 + pack.tint * 0.1);
  cb *= (kRgb[2] / nRgb[2]) * (1 + pack.tint * 0.05);
  const exp = 2 ** pack.exposure;
  return [clamp01(cr * exp), clamp01(cg * exp), clamp01(cb * exp)];
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function writePng(width, height, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    rgb.copy(row, 1, y * width * 3, (y + 1) * width * 3);
    rows.push(row);
  }
  const idat = zlib.deflateSync(Buffer.concat(rows));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function haldStrip(pack, identity) {
  const w = SIZE * SIZE;
  const h = SIZE;
  const rgb = Buffer.alloc(w * h * 3);
  for (let z = 0; z < SIZE; z++) {
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const r = x / (SIZE - 1);
        const g = y / (SIZE - 1);
        const b = z / (SIZE - 1);
        const out = identity ? [r, g, b] : grade(r, g, b, pack);
        const i = (y * w + z * SIZE + x) * 3;
        rgb[i] = Math.round(out[0] * 255);
        rgb[i + 1] = Math.round(out[1] * 255);
        rgb[i + 2] = Math.round(out[2] * 255);
      }
    }
  }
  return writePng(w, h, rgb);
}

function chart(pack, identity) {
  const w = 640;
  const h = 360;
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / (w - 1);
      const v = y / (h - 1);
      let r;
      let g;
      let b;
      if (y < h * 0.22) {
        const band = Math.floor(u * 8);
        const bars = [
          [1, 1, 1], [1, 1, 0], [0, 1, 1], [0, 1, 0],
          [1, 0, 1], [1, 0, 0], [0, 0, 1], [0, 0, 0],
        ];
        [r, g, b] = bars[band] ?? [0, 0, 0];
      } else if (y < h * 0.4) {
        r = g = b = u;
      } else {
        r = 0.35 + 0.45 * u;
        g = 0.42 + 0.2 * (1 - v);
        b = 0.28 + 0.5 * v;
      }
      const out = identity ? [r, g, b] : grade(r, g, b, pack);
      const i = (y * w + x) * 3;
      rgb[i] = Math.round(out[0] * 255);
      rgb[i + 1] = Math.round(out[1] * 255);
      rgb[i + 2] = Math.round(out[2] * 255);
    }
  }
  return writePng(w, h, rgb);
}

const lutDir = path.join(ROOT, 'public', 'luts');
const docDir = path.join(ROOT, 'docs', 'looks');
fs.mkdirSync(lutDir, { recursive: true });
fs.mkdirSync(docDir, { recursive: true });

for (const [id, pack] of Object.entries(LOOKS)) {
  const identity = id === 'clear';
  fs.writeFileSync(path.join(lutDir, `${id}.png`), haldStrip(pack, identity));
  fs.writeFileSync(path.join(docDir, `${id}-webgpu.png`), chart(pack, identity));
  console.log('wrote', id);
}
fs.writeFileSync(path.join(lutDir, 'identity.png'), haldStrip(LOOKS.clear, true));
console.log('done');

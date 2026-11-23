// Generates assets/trayTemplate.png (16px) and trayTemplate@2x.png (32px): a little building, black with alpha
// (a macOS template image). Run: npx tsx tools/make-tray-icon.ts
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const t = Buffer.concat([Buffer.from(type), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(t));
  return Buffer.concat([len, t, c]);
};

/** Drawn on a 16x16 grid, scaled by `s`. 1 = opaque. */
function png(s: number): Buffer {
  const size = 16 * s;
  const px = (gx: number, gy: number): boolean => {
    const body = gx >= 3 && gx <= 12 && gy >= 2 && gy <= 14;
    if (!body) return false;
    const door = gx >= 7 && gx <= 8 && gy >= 11;
    const windows = [5, 8, 10].some((wx) => gx === wx && [4, 7].some((wy) => gy === wy || gy === wy + 1));
    return !door && !windows;
  };
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o + 3] = px(Math.floor(x / s), Math.floor(y / s)) ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'trayTemplate.png'), png(1));
writeFileSync(join(out, 'trayTemplate@2x.png'), png(2));
console.log('tray icons ->', out);

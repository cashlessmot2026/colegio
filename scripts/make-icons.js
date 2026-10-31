// Genera los íconos PNG de la PWA sin dependencias (rasterizado simple + zlib)
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const A = [124, 92, 255], B = [0, 229, 255], BG = [11, 11, 26];

function pixel(x, y) { // coordenadas en espacio 512
  const t = Math.min(1, Math.max(0, (x + y) / 1024));
  const grad = mix(A, B, t);
  const inRound = (x0, y0, x1, y1, r) => {
    const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
  };
  if (Math.abs(x - 256) / 164 + Math.abs(y - 214) / 82 <= 1) return grad;
  if (x >= 160 && x <= 352 && y >= 262 && y <= 340 && y >= 262 + 48 * (1 - Math.abs(x - 256) / 96) - 48) {
    if (y >= 262 + 48 - 48 * 0 - (48 - 48 * Math.abs(x - 256) / 96) || true) return mix(grad, BG, 0.15);
  }
  if ((x - 256) ** 2 / 96 ** 2 + (y - 340) ** 2 / 48 ** 2 <= 1 && y >= 330) return mix(grad, BG, 0.15);
  if (Math.abs(x - 404) <= 7 && y >= 222 && y <= 318) return B;
  if ((x - 404) ** 2 + (y - 330) ** 2 <= 256) return B;
  if (inRound(24, 24, 488, 488, 96) && !inRound(40, 40, 472, 472, 82)) return grad;
  return BG;
}

function png(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const s = 512 / size;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      // supersampling 2x2 para bordes suaves
      let acc = [0, 0, 0];
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const p = pixel((x + dx) * s, (y + dy) * s); acc = acc.map((v, i) => v + p[i] / 4);
      }
      acc.forEach((v, i) => (raw[y * (size * 3 + 1) + 1 + x * 3 + i] = Math.round(v)));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const size of [192, 512]) writeFileSync(`public/icons/icon-${size}.png`, png(size));
console.log('Íconos generados');

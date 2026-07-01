// Genera iconos PNG PLACEHOLDER para la PWA sin dependencias externas.
// Dibuja un emblema simple (fondo verde + anillo claro + punto) con
// antialiasing por supermuestreo. Reemplázalos por el logo real cuando
// esté listo (ver README → "Reemplazar el logo y los iconos").
//
// Uso:  npm run gen:icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });

// --- Codificador PNG mínimo (RGBA, 8 bits) ---
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profundidad de bits
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filtro "none"
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// Dibuja el emblema con supermuestreo 4x para bordes suaves.
function drawIcon(size, { bg, ring, dot, padding = 0 }) {
  const SS = 4;
  const big = size * SS;
  const [br, bgc, bb] = hexToRgb(bg);
  const [rr, rg, rb] = hexToRgb(ring);
  const [dr, dg, dbl] = hexToRgb(dot);
  const cx = big / 2;
  const cy = big / 2;
  const usable = big * (1 - padding * 2);
  const rOuter = usable * 0.34;
  const rInner = usable * 0.19;

  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let R = 0, G = 0, B = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;
          const d = Math.hypot(px - cx, py - cy);
          let r = br, g = bgc, b = bb;
          if (d <= rOuter) { r = rr; g = rg; b = rb; }
          if (d <= rInner) { r = dr; g = dg; b = dbl; }
          R += r; G += g; B += b;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(R / n);
      rgba[i + 1] = Math.round(G / n);
      rgba[i + 2] = Math.round(B / n);
      rgba[i + 3] = 255;
    }
  }
  return encodePNG(size, size, rgba);
}

const palette = { bg: '#1f7862', ring: '#f2faf7', dot: '#2b9678' };

writeFileSync(join(outDir, 'pwa-192x192.png'), drawIcon(192, palette));
writeFileSync(join(outDir, 'pwa-512x512.png'), drawIcon(512, palette));
// El icono "maskable" deja margen de seguridad (padding) para el recorte.
writeFileSync(join(outDir, 'maskable-512x512.png'), drawIcon(512, { ...palette, padding: 0.14 }));
writeFileSync(join(outDir, 'apple-touch-icon.png'), drawIcon(180, palette));

console.log('✓ Iconos PWA placeholder generados en public/.');

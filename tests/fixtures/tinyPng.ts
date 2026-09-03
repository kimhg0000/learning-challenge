import { deflateSync } from 'node:zlib';

// Standard PNG CRC-32 table/algorithm (see the PNG spec, Annex D).
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * A genuinely valid, browser-renderable 4x4 solid-color PNG, built by hand
 * from raw pixel bytes (not a hardcoded/guessed base64 blob) so it is
 * guaranteed structurally correct. Used anywhere a test or seed script needs
 * a real decodable image — unlike a bare magic-bytes placeholder
 * (e.g. `[0xff,0xd8,0xff,0xd9]`), which uploads and satisfies storage.rules'
 * size/content-type checks but is NOT a real image and renders as a broken
 * <img> in any actual browser (see the 2026-09 staging bug report: the E2E
 * seed script used exactly such a placeholder for every test submission).
 */
export function tinyPngBytes(): Buffer {
  const width = 4;
  const height = 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = truecolor (RGB, no alpha)
  ihdr[10] = 0; // compression method
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // interlace method

  const bytesPerRow = 1 + width * 3; // filter-type byte + RGB per pixel
  const raw = Buffer.alloc(height * bytesPerRow);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter type: none
    for (let x = 0; x < width; x++) {
      raw[offset++] = 220;
      raw[offset++] = 38;
      raw[offset++] = 90;
    }
  }
  const idatData = deflateSync(raw);

  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idatData), pngChunk('IEND', Buffer.alloc(0))]);
}

export function tinyPngBlob(): Blob {
  return new Blob([tinyPngBytes()], { type: 'image/png' });
}

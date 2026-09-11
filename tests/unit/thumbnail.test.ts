// @vitest-environment node
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';
import { makeThumbnail, MAX_INPUT_PIXELS } from '../../functions/src/feedPhotos';
import { texturedPixels } from '../fixtures/photographic';
const require = createRequire(new URL('../../functions/package.json', import.meta.url));
const sharp: typeof import('../../functions/node_modules/sharp') = require('sharp');

describe('server JPEG thumbnail', () => {
  it('measures representative synthetic large-image byte reduction', async () => {
    const results = [];
    for (const format of ['jpeg','png','webp'] as const) {
      const width = format === 'png' ? 2000 : 4032, height = format === 'png' ? 1500 : 3024;
      const source = sharp(texturedPixels(width,height), {raw:{width,height,channels:3}});
      const input = await source.toFormat(format, {quality:94}).toBuffer();
      const output = await makeThumbnail(input);
      results.push({format,inputBytes:input.length,outputBytes:output.length});
      expect(output.length).toBeLessThan(input.length);
    }
    console.info('thumbnail-size-measurements', JSON.stringify(results));
  },30000);
  it.each(['jpeg', 'png', 'webp'] as const)('%s -> oriented, bounded JPEG with aspect ratio', async format => {
    const input = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#336699' } }).toFormat(format).toBuffer();
    const output = await makeThumbnail(input);
    const meta = await sharp(output).metadata();
    expect(meta.format).toBe('jpeg'); expect(meta.width).toBe(1200); expect(meta.height).toBe(800);
    expect(meta.exif).toBeUndefined(); expect(meta.icc).toBeUndefined();
  });
  it('never enlarges small images', async () => {
    const input = await sharp({ create: { width: 40, height: 20, channels: 4, background: 'transparent' } }).png().toBuffer();
    const meta = await sharp(await makeThumbnail(input)).metadata();
    expect([meta.width, meta.height]).toEqual([40, 20]);
  });
  it('applies EXIF orientation then strips EXIF including GPS', async () => {
    const input = await sharp({ create: { width: 1600, height: 800, channels: 3, background: 'red' } })
      .withMetadata({ orientation: 6 }).withExifMerge({ IFD0: { Copyright: 'test metadata' } }).jpeg().toBuffer();
    const meta = await sharp(await makeThumbnail(input)).metadata();
    expect([meta.width, meta.height]).toEqual([600, 1200]); expect(meta.exif).toBeUndefined(); expect(meta.orientation).toBeUndefined();
  });
  it('rejects corrupt data and compressed inputs above 20 MiB', async () => {
    await expect(makeThumbnail(Buffer.from([255,216,255,217]))).rejects.toThrow();
    await expect(makeThumbnail(Buffer.alloc(20 * 1024 * 1024 + 1))).rejects.toThrow('input-size');
  });
  it('rejects huge pixel dimensions even when the compressed file is tiny', async () => {
    const input = await sharp({ create: { width: 9000, height: 8000, channels: 3, background: 'white' } }).png().toBuffer();
    expect(9000 * 8000).toBeGreaterThan(MAX_INPUT_PIXELS);
    await expect(makeThumbnail(input)).rejects.toThrow(/pixel limit/i);
  });
  it('reports HEIF decoder capability without assuming HEIC codec support', () => {
    console.info('sharp runtime', { versions: sharp.versions, heif: sharp.format.heif });
    // A libheif entry can be AVIF-only. HEIC is deliberately not advertised.
    expect(sharp.versions.vips).toBeTruthy();
  });
});

import sharp from 'sharp';
import { randomUUID } from 'node:crypto';
import type { File } from '@google-cloud/storage';

export const THUMBNAIL_VERSION = 'jpeg-1200-q78-v1';
export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_INPUT_PIXELS = 64 * 1024 * 1024;

export function errorCode(error: unknown): string {
  return String((error as { code?: unknown } | null)?.code ?? 'unknown');
}

export async function makeThumbnail(input: Buffer): Promise<Buffer> {
  if (!input.length || input.length > MAX_INPUT_BYTES) throw new Error('thumbnail/input-size');
  const pipeline = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', animated: false });
  const metadata = await pipeline.metadata();
  if (!metadata.format || !['jpeg', 'png', 'webp', 'heif'].includes(metadata.format)) {
    throw new Error('thumbnail/unsupported-format');
  }
  if ((metadata.pages ?? 1) > 1) throw new Error('thumbnail/multiple-frames');
  return pipeline.rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' }).toColourspace('srgb')
    .jpeg({ quality: 78, progressive: true })
    .timeout({ seconds: 30 }).toBuffer();
}

export function photoURL(file: File, token: string): string {
  const host = process.env.STORAGE_EMULATOR_HOST
    ? `http://${process.env.STORAGE_EMULATOR_HOST.replace(/^https?:\/\//, '')}`
    : 'https://firebasestorage.googleapis.com';
  return `${host}/v0/b/${file.bucket.name}/o/${encodeURIComponent(file.name)}?alt=media&token=${encodeURIComponent(token)}`;
}

async function existingThumbnail(file: File): Promise<string | null> {
  try {
    const [metadata] = await file.getMetadata();
    if (metadata.metadata?.thumbnailVersion !== THUMBNAIL_VERSION || metadata.contentType !== 'image/jpeg') {
      // Never overwrite an older/unknown object from a normal publish call.
      throw new Error('thumbnail/existing-object-needs-backfill');
    }
    const token = String(metadata.metadata?.firebaseStorageDownloadTokens ?? '').split(',')[0];
    if (!token) throw new Error('thumbnail/missing-token');
    return photoURL(file, token);
  } catch (error) {
    if (errorCode(error) === '404') return null;
    throw error;
  }
}

/** Create-only bytes AND token in one GCS operation. Losers reuse the winner. */
export async function ensureThumbnail(source: File, destination: File): Promise<string> {
  const existing = await existingThumbnail(destination);
  if (existing) return existing;
  const [metadata] = await source.getMetadata();
  if (Number(metadata.size) > MAX_INPUT_BYTES) throw new Error('thumbnail/input-size');
  const [original] = await source.bucket.file(source.name, { generation: metadata.generation }).download();
  const thumbnail = await makeThumbnail(original);
  try {
    await destination.save(thumbnail, {
      resumable: false,
      preconditionOpts: { ifGenerationMatch: 0 },
      metadata: {
        contentType: 'image/jpeg', cacheControl: 'private,max-age=300,must-revalidate',
        metadata: { firebaseStorageDownloadTokens: randomUUID(), thumbnailVersion: THUMBNAIL_VERSION },
      },
    });
  } catch (error) {
    if (errorCode(error) !== '412') throw error;
  }
  const result = await existingThumbnail(destination);
  if (!result) throw new Error('thumbnail/disappeared');
  return result;
}

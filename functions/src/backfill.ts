import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { Bucket, FileMetadata } from '@google-cloud/storage';
import { createHash } from 'node:crypto';
import { makeThumbnail, THUMBNAIL_VERSION, errorCode } from './feedPhotos';

export interface BackupEntry {
  project: string; semester: string; feedId: string; path: string;
  generation: string; metageneration: string; metadata: FileMetadata;
  sha256: string;
}
export interface BackfillOptions {
  project: string; semester: string; apply?: boolean; pageSize?: number; maxRecords?: number;
  // Must durably save both bytes and entry before resolving. No backups on dry-run.
  backup?: (entry: BackupEntry, bytes: Buffer) => Promise<void>;
  report: (entry: Record<string, unknown>) => Promise<void>;
}

export function expectedFeedPath(id: string, data: Record<string, unknown>, bucket: string, semester: string): string {
  if (!/^[a-f0-9]{64}$/.test(id) || data.semesterId !== semester) throw new Error('backfill/identity');
  if (!Number.isInteger(data.week) || Number(data.week) < 1 || Number(data.week) > 15) throw new Error('backfill/week');
  const url = new URL(String(data.photoURL));
  const path = `feedPhotos/${id}.jpg`;
  if (decodeURIComponent(url.pathname) !== `/v0/b/${bucket}/o/${path}` || url.searchParams.get('alt') !== 'media') {
    throw new Error('backfill/path');
  }
  return path;
}

/** Sequential, cursor-paged traversal: never reads/writes a private original. */
export async function backfillFeedPhotos(db: Firestore, bucket: Bucket, options: BackfillOptions) {
  if (!options.project || !/^[a-z0-9-]+$/.test(options.semester)) throw new Error('backfill/explicit-target-required');
  if (options.apply && !options.backup) throw new Error('backfill/backup-required');
  if (options.maxRecords !== undefined && (!Number.isInteger(options.maxRecords) || options.maxRecords < 1)) throw new Error('backfill/invalid-max-records');
  let cursor: QueryDocumentSnapshot | undefined;
  const counts = { scanned: 0, candidates: 0, changed: 0, skipped: 0, failed: 0 };
  for (;;) {
    let query = db.collection('feedPosts').where('semesterId', '==', options.semester).orderBy('__name__').limit(options.pageSize ?? 50);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    for (const post of page.docs) {
      if (options.maxRecords !== undefined && counts.scanned >= options.maxRecords) return counts;
      counts.scanned++;
      try {
        const path = expectedFeedPath(post.id, post.data(), bucket.name, options.semester);
        const file = bucket.file(path);
        const [metadata] = await file.getMetadata(); // 404 is isolated; never recreate.
        if (metadata.metadata?.thumbnailVersion === THUMBNAIL_VERSION && metadata.contentType === 'image/jpeg') {
          counts.skipped++;
          await options.report({ feedId: post.id, status: 'skipped', generation: metadata.generation });
          continue;
        }
        const tokens = String(metadata.metadata?.firebaseStorageDownloadTokens ?? '');
        const urlToken = new URL(String(post.data().photoURL)).searchParams.get('token');
        if (!urlToken || !tokens.split(',').includes(urlToken)) throw new Error('backfill/token-mismatch');
        if (!metadata.generation || !metadata.metageneration || Number(metadata.size) > 20 * 1024 * 1024) throw new Error('backfill/metadata');
        counts.candidates++;
        if (!options.apply) {
          await options.report({ feedId: post.id, status: 'dry-run', path, generation: metadata.generation,
            metageneration: metadata.metageneration, size: metadata.size, md5Hash: metadata.md5Hash, crc32c: metadata.crc32c,
            tokenCount: tokens.split(',').length });
          continue;
        }
        const [bytes] = await bucket.file(path, { generation: metadata.generation }).download();
        const thumbnail = await makeThumbnail(bytes);
        const entry: BackupEntry = { project: options.project, semester: options.semester, feedId: post.id, path,
          generation: String(metadata.generation), metageneration: String(metadata.metageneration), metadata,
          sha256: createHash('sha256').update(bytes).digest('hex') };
        await options.backup!(entry, bytes);
        // Check the post still exists immediately before writing. Object preconditions
        // also reject deletion/replacement or concurrent token metadata changes.
        const freshPost = await post.ref.get();
        if (!freshPost.exists || freshPost.data()?.photoURL !== post.data().photoURL || freshPost.data()?.semesterId !== options.semester) throw new Error('backfill/post-changed');
        await file.save(thumbnail, { resumable: false,
          preconditionOpts: { ifGenerationMatch: metadata.generation, ifMetagenerationMatch: metadata.metageneration },
          metadata: { contentType: 'image/jpeg', cacheControl: 'private,max-age=300,must-revalidate',
            metadata: { ...metadata.metadata, firebaseStorageDownloadTokens: tokens, thumbnailVersion: THUMBNAIL_VERSION,
              backfillSourceGeneration: String(metadata.generation), backfillSourceSha256: entry.sha256 } },
        });
        counts.changed++;
        await options.report({ feedId: post.id, status: 'changed', sourceGeneration: metadata.generation,
          inputBytes: bytes.length, outputBytes: thumbnail.length });
      } catch (error) {
        counts.failed++;
        await options.report({ feedId: post.id, status: 'failed', code: errorCode(error), reason: error instanceof Error ? error.message : 'unknown' });
      }
    }
    cursor = page.docs[page.docs.length - 1];
  }
  return counts;
}

export async function restoreFeedPhoto(bucket: Bucket, entry: BackupEntry, bytes: Buffer) {
  if (entry.path !== `feedPhotos/${entry.feedId}.jpg` || !/^[a-f0-9]{64}$/.test(entry.feedId)) throw new Error('restore/path');
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) throw new Error('restore/checksum');
  const file = bucket.file(entry.path);
  const [current] = await file.getMetadata(); // absent object must stay absent.
  if (current.metadata?.backfillSourceGeneration !== entry.generation || current.metadata?.backfillSourceSha256 !== entry.sha256) throw new Error('restore/not-our-generation');
  await file.save(bytes, { resumable: false,
    preconditionOpts: { ifGenerationMatch: current.generation, ifMetagenerationMatch: current.metageneration },
    metadata: { contentType: entry.metadata.contentType, cacheControl: entry.metadata.cacheControl ?? 'private,no-cache',
      contentDisposition: entry.metadata.contentDisposition, contentEncoding: entry.metadata.contentEncoding,
      metadata: entry.metadata.metadata },
  });
}

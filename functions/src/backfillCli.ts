import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { backfillFeedPhotos, restoreFeedPhoto, BackupEntry } from './backfill';

function durable(path: string, data: string | Buffer, flags: string) {
  const fd = openSync(path, flags, 0o600);
  try { writeFileSync(fd, data); fsyncSync(fd); } finally { closeSync(fd); }
}
async function main() {
  const args = process.argv.slice(2);
  const value = (key: string) => args.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const project = value('project'); const semester = value('semester'); const bucketName = value('bucket');
  const apply = args.includes('--apply'); const restore = value('restore');
  const maxRecords = value('max-records') === undefined ? undefined : Number(value('max-records'));
  if (!project || !semester || !bucketName || !bucketName.startsWith(`${project}.`)) throw new Error('Specify --project= --semester= --bucket= explicitly.');
  if (project === 'week-learning-challenge' && semester !== '2026-fall') throw new Error('Production scope is 2026-fall only.');
  if (apply && value('confirm-project') !== project) throw new Error('--apply also requires --confirm-project=<exact project>.');
  const backupDir = value('backup-dir');
  if (apply && !backupDir) throw new Error('--backup-dir is required. Contains sensitive download tokens; protect it.');
  if (project.startsWith('demo-') && (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.STORAGE_EMULATOR_HOST)) throw new Error('Demo requires both emulator hosts.');
  if (!project.startsWith('demo-') && (process.env.FIRESTORE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST)) throw new Error('Real project with emulator environment rejected.');
  const app = initializeApp({ projectId: project, storageBucket: bucketName });
  const db = getFirestore(app); const bucket = getStorage(app).bucket();
  const dir = backupDir ? resolve(backupDir) : undefined;
  if (apply) mkdirSync(dir!, { recursive: true, mode: 0o700 });
  if (restore) {
    if (!apply) throw new Error('Restore requires explicit --apply and confirmation.');
    const entry = JSON.parse(readFileSync(resolve(restore), 'utf8')) as BackupEntry;
    if (entry.project !== project || entry.semester !== semester || entry.metadata.bucket !== bucket.name) throw new Error('Restore target mismatch.');
    const post = await db.collection('feedPosts').doc(entry.feedId).get();
    if (!post.exists || post.data()?.semesterId !== semester) throw new Error('Restore post missing/wrong semester.');
    await restoreFeedPhoto(bucket, entry, readFileSync(join(dir!, `${entry.feedId}-${entry.generation}.bin`)));
    console.log(JSON.stringify({ status: 'restored', feedId: entry.feedId })); return;
  }
  const counts = await backfillFeedPhotos(db, bucket, { project, semester, apply, maxRecords,
    backup: async (entry, bytes) => {
      const base = join(dir!, `${entry.feedId}-${entry.generation}`);
      if (!existsSync(`${base}.bin`)) durable(`${base}.bin`, bytes, 'wx');
      else if (!readFileSync(`${base}.bin`).equals(bytes)) throw new Error('Backup bytes mismatch.');
      if (!existsSync(`${base}.json`)) durable(`${base}.json`, JSON.stringify(entry, null, 2), 'wx');
    },
    report: async entry => {
      console.log(JSON.stringify(entry));
      if (apply) durable(join(dir!, 'manifest.jsonl'), JSON.stringify(entry) + '\n', 'a');
    },
  });
  console.log(JSON.stringify(counts)); if (counts.failed) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

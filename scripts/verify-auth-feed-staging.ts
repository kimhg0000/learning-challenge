// Real staging only. Creates uniquely named disposable accounts/objects; never
// traverses production or existing staging-semester objects for migration.
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { FirebaseBackend } from '../src/backend/firebaseBackend';
import { firebaseConfig } from '../src/config';
import { SEMESTER_ID } from '../src/constants';
import { getCurrentProgramWeek } from '../src/utils/date';
import { texturedPixels } from '../tests/fixtures/photographic';
const require = createRequire(import.meta.url);
const functionsRequire = createRequire(new URL('../functions/package.json', import.meta.url));

async function main() {
  const project = 'learning-challenge-staging';
  assert(process.argv.includes('--run'), 'Requires --run (creates disposable staging data).');
  assert.equal(firebaseConfig.projectId, project); assert.equal(SEMESTER_ID, 'staging-2026');
  assert.equal(firebaseConfig.storageBucket, `${project}.firebasestorage.app`);
  assert(!process.env.FIRESTORE_EMULATOR_HOST && !process.env.STORAGE_EMULATOR_HOST && !process.env.FIREBASE_AUTH_EMULATOR_HOST);
  const cliAuth = require('firebase-tools/lib/auth');
  const cliApi = require('firebase-tools/lib/api');
  const account = cliAuth.getGlobalDefaultAccount(); assert(account, 'Firebase CLI login required.');
  const { initializeApp, refreshToken } = functionsRequire('firebase-admin/app');
  const credentials={type:'authorized_user',client_id:cliApi.clientId(),client_secret:cliApi.clientSecret(),refresh_token:account.tokens.refresh_token};
  const app = initializeApp({ projectId:project, storageBucket:firebaseConfig.storageBucket,
    credential:refreshToken(credentials) }, 'hotfix-staging-verification');
  const db = new (functionsRequire('@google-cloud/firestore').Firestore)({projectId:project,credentials});
  const auth = functionsRequire('firebase-admin/auth').getAuth(app);
  const bucket = new (functionsRequire('@google-cloud/storage').Storage)({projectId:project,credentials}).bucket(firebaseConfig.storageBucket);
  const sharp = functionsRequire('sharp');
  const { backfillFeedPhotos, restoreFeedPhoto } = functionsRequire('./lib/backfill');
  const { THUMBNAIL_VERSION } = functionsRequire('./lib/feedPhotos');
  const runId = `hotfix-${Date.now()}`;
  const backend = new FirebaseBackend();
  const createdUids:string[]=[]; const disposablePaths:string[]=[]; const disposableDocs:string[]=[];
  const report:Record<string,unknown>={project,runId};
  const artifactDir=join(tmpdir(),'learning-challenge-hotfix',runId); mkdirSync(artifactDir,{recursive:true});
  const instructorEmail=`${runId}-instructor@example.test`;
  const password=randomUUID()+'Aa1!';
  try {
    const studentEmail=`${runId}-student@example.test`;
    await backend.signUpEmail(studentEmail,password);
    const uid=await new Promise<string>(resolve=>{const off=backend.onAuthChange(u=>{if(u){off();resolve(u.uid)}})});
    createdUids.push(uid);
    await backend.signOutUser(); await backend.signInEmail(studentEmail,password);
    report.emailPasswordLogin=true;
    await backend.recordPrivacyConsent(uid,'signup');
    const profile=await backend.completeOnboarding(uid,studentEmail,{name:'스테이징검증',studentId:String(1000000+Math.floor(Math.random()*8000000)),characterType:'rabbit',
      goal:{goalText:'스테이징 환경에서 검증용 학습을 60분 수행합니다.',weekday:3,startTime:'19:00',duration:60}});
    const width=4032,height=3024;
    const bytes:Buffer=await sharp(texturedPixels(width,height),{raw:{width,height,channels:3}}).jpeg({quality:94}).toBuffer();
    const week=getCurrentProgramWeek(new Date()); assert(week);
    const expectedSubId=`${uid}_${SEMESTER_ID}_w${week}`;
    const expectedFeedId=createHash('sha256').update(expectedSubId).digest('hex');
    disposablePaths.push(`feedPhotos/${expectedFeedId}.jpg`,`submissions/${uid}/${SEMESTER_ID}/week${week}.jpg`);
    disposableDocs.push(`submissions/${expectedSubId}`,`feedPosts/${expectedFeedId}`);
    const sub=await backend.submitWeek(uid,profile,{week,photoBlob:new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}),reflection:`${runId} 실제 staging 사진 제출 검증입니다.`});
    const feedId=createHash('sha256').update(sub.id).digest('hex');
    const path=`feedPhotos/${feedId}.jpg`;const privatePath=`submissions/${uid}/${SEMESTER_ID}/week${week}.jpg`;
    const [original]=await bucket.file(privatePath).download(); assert(original.equals(bytes));
    const post=await db.doc(`feedPosts/${feedId}`).get();assert(post.exists);
    const [thumbnail]=await bucket.file(path).download(); const image=await sharp(thumbnail).metadata();
    const [metadata]=await bucket.file(path).getMetadata();
    assert.equal(metadata.contentType,'image/jpeg');assert.equal(metadata.metadata.thumbnailVersion,THUMBNAIL_VERSION);
    assert(Math.max(image.width,image.height)<=1200); assert(thumbnail.length<bytes.length);
    const repeated=await Promise.all(Array.from({length:3},()=>backend.callPublishFeedPost(week)));
    assert(repeated.every(r=>r.photoURL===post.get('photoURL')));
    assert.equal((await bucket.file(path).getMetadata())[0].generation,metadata.generation);
    assert((await backend.getFeedPhotoURLs([sub.id]))[sub.id].includes('feedPhotos'));
    report.submission={privateBytes:bytes.length,thumbnailBytes:thumbnail.length,width:image.width,height:image.height,contentType:metadata.contentType,privatePreserved:true,retryStable:true};
    // Dedicated semester and two disposable objects prove page/cursor traversal,
    // token preservation, idempotency and rollback on actual GCS preconditions.
    const semester=`${runId}-backfill`; const backups:any[]=[];
    for(let i=0;i<2;i++){
      const id=createHash('sha256').update(`${runId}-${i}`).digest('hex'), p=`feedPhotos/${id}.jpg`, token=randomUUID();
      await bucket.file(p).save(bytes,{resumable:false,preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'image/jpeg',metadata:{firebaseStorageDownloadTokens:token}}});
      disposablePaths.push(p);disposableDocs.push(`feedPosts/${id}`);
      await db.doc(`feedPosts/${id}`).create({semesterId:semester,week:1,photoURL:`https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(p)}?alt=media&token=${token}`});
    }
    const events:any[]=[]; const options={project,semester,pageSize:1,report:async(e:any)=>{events.push(e)},backup:async(entry:any,original:Buffer)=>{
      writeFileSync(join(artifactDir,`${entry.feedId}.bin`),original,{flag:'wx'});
      writeFileSync(join(artifactDir,`${entry.feedId}.json`),JSON.stringify(entry),{flag:'wx'});backups.push(entry);
    }};
    const dry=await backfillFeedPhotos(db,bucket,options);assert.equal(dry.candidates,2);assert.equal(backups.length,0);
    const applied=await backfillFeedPhotos(db,bucket,{...options,apply:true});assert.equal(applied.changed,2);assert.equal(applied.failed,0);
    const rerun=await backfillFeedPhotos(db,bucket,{...options,apply:true});assert.equal(rerun.skipped,2);
    for(const entry of backups){
      const m=(await bucket.file(entry.path).getMetadata())[0];assert.equal(m.metadata.firebaseStorageDownloadTokens,entry.metadata.metadata.firebaseStorageDownloadTokens);
      await restoreFeedPhoto(bucket,entry,readFileSync(join(artifactDir,`${entry.feedId}.bin`)));
      assert((await bucket.file(entry.path).download())[0].equals(bytes));
    }
    report.backfill={dry,applied,rerun,restored:backups.length};
    const instructor=await auth.createUser({email:instructorEmail,password,emailVerified:true});createdUids.push(instructor.uid);
    await db.doc(`instructorAllowlist/${instructorEmail}`).create({note:runId});disposableDocs.push(`instructorAllowlist/${instructorEmail}`);
    await backend.signOutUser(); await backend.signInEmail(instructorEmail,password);
    assert(await backend.isInstructor(instructorEmail)); await backend.ensureInstructorProfile(instructor.uid,instructorEmail,'검증교수자');
    assert((await backend.adminListStudents()).some(s=>s.uid===uid));
    assert((await backend.getFeedPhotoURLs([sub.id]))[sub.id].includes('feedPhotos'));
    await backend.adminDeleteStudent(uid);
    assert(!(await db.doc(`users/${uid}/privacyConsent/record`).get()).exists);
    assert(!(await bucket.file(path).exists())[0]);assert(!(await bucket.file(privatePath).exists())[0]);
    report.verifiedEmailInstructor=true;report.deleteRegression=true;
  } finally {
    await backend.signOutUser().catch(()=>{});
    for(const path of disposablePaths)await bucket.file(path).delete({ignoreNotFound:true});
    for(const path of disposableDocs)await db.doc(path).delete();
    for(const uid of createdUids){
      await db.recursiveDelete(db.doc(`users/${uid}`));
      const registry=await db.collection('studentIdRegistry').where('uid','==',uid).get();for(const doc of registry.docs)await doc.ref.delete();
      await auth.deleteUser(uid).catch((error:any)=>{if(error.code!=='auth/user-not-found')throw error});
    }
    writeFileSync(join(artifactDir,'result.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({report,artifactDir},null,2));
  }
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1)});

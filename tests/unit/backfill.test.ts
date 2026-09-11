// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { backfillFeedPhotos, restoreFeedPhoto } from '../../functions/src/backfill';
import { ensureThumbnail, THUMBNAIL_VERSION } from '../../functions/src/feedPhotos';
import { tinyPngBytes } from '../fixtures/tinyPng';
const id = 'a'.repeat(64), path = `feedPhotos/${id}.jpg`, semester = '2026-fall';
function fixture() {
  let bytes = tinyPngBytes();
  let meta: any = { generation: '1', metageneration:'1', size:bytes.length, contentType:'image/png', bucket:'demo.appspot.com', metadata:{firebaseStorageDownloadTokens:'preserve-token,second-token'} };
  const save = vi.fn(async (next:Buffer, options:any) => {
    if (!meta || options.preconditionOpts.ifGenerationMatch !== meta.generation || options.preconditionOpts.ifMetagenerationMatch !== meta.metageneration) throw {code:412};
    bytes=next; meta={...meta,...options.metadata,generation:String(Number(meta.generation)+1),metageneration:'1'};
  });
  const file:any = {name:path, getMetadata:vi.fn(async()=>{if(!meta)throw{code:404};return [structuredClone(meta)];}),download:vi.fn(async()=>[Buffer.from(bytes)]),save};
  const bucket:any={name:'demo.appspot.com',file:vi.fn(()=>file)}; file.bucket=bucket;
  const data={semesterId:semester,week:1,photoURL:`https://firebasestorage.googleapis.com/v0/b/demo.appspot.com/o/feedPhotos%2F${id}.jpg?alt=media&token=preserve-token`};
  const post:any={id,data:()=>data,ref:{get:vi.fn(async()=>({exists:true,data:()=>data}))}};
  let page=0;
  const query:any={where:vi.fn(()=>query),orderBy:vi.fn(()=>query),limit:vi.fn(()=>query),startAfter:vi.fn(()=>query),get:vi.fn(async()=>page++===0?{empty:false,docs:[post]}:{empty:true,docs:[]})};
  const db:any={collection:vi.fn(()=>query)};
  return {file,bucket,db,data,post,query,save, meta:()=>meta, bytes:()=>bytes, reset:()=>{page=0}, conflict:()=>{meta.generation='9'}, remove:()=>{meta=null}};
}
describe('safe backfill',()=>{
  it('bounds a canary run and rejects an invalid limit',async()=>{
    const f=fixture();
    await expect(backfillFeedPhotos(f.db,f.bucket,{project:'demo',semester,maxRecords:0,report:vi.fn()})).rejects.toThrow('invalid-max-records');
    const result=await backfillFeedPhotos(f.db,f.bucket,{project:'demo',semester,maxRecords:1,report:vi.fn()});expect(result.scanned).toBe(1);
  });
  it('default dry-run pages records without downloading, backing up or writing',async()=>{
    const f=fixture(), backup=vi.fn(), report=vi.fn();
    const result=await backfillFeedPhotos(f.db,f.bucket,{project:'demo',semester,backup,report});
    expect(result.candidates).toBe(1); expect(f.file.download).not.toHaveBeenCalled(); expect(f.save).not.toHaveBeenCalled(); expect(backup).not.toHaveBeenCalled();
    expect(f.query.startAfter).toHaveBeenCalled(); expect(f.query.where).toHaveBeenCalledWith('semesterId','==',semester);
  });
  it('preserves all tokens, marks thumbnail, skips rerun and restores exact bytes/metadata',async()=>{
    const f=fixture(), original=Buffer.from(f.bytes()), backup=vi.fn(), report=vi.fn();
    const result=await backfillFeedPhotos(f.db,f.bucket,{project:'demo',semester,apply:true,backup,report});
    expect(result.changed).toBe(1); expect(f.meta().metadata.firebaseStorageDownloadTokens).toBe('preserve-token,second-token');
    expect(f.meta().metadata.thumbnailVersion).toBe(THUMBNAIL_VERSION); expect(f.meta().contentType).toBe('image/jpeg');
    f.reset(); expect((await backfillFeedPhotos(f.db,f.bucket,{project:'demo',semester,apply:true,backup,report})).skipped).toBe(1);
    expect(f.save).toHaveBeenCalledTimes(1);
    await restoreFeedPhoto(f.bucket,backup.mock.calls[0][0],original);
    expect(f.bytes()).toEqual(original); expect(f.meta().contentType).toBe('image/png');
    expect(f.meta().metadata.thumbnailVersion).toBeUndefined();
  });
  it.each(['conflict','remove'] as const)('%s between backup and write never overwrites/recreates',async action=>{
    const f=fixture(); const result=await backfillFeedPhotos(f.db,f.bucket,{project:'demo',semester,apply:true,backup:async()=>{f[action]()},report:vi.fn()});
    expect(result.failed).toBe(1); expect(result.changed).toBe(0);
  });
  it.each(['semester','path','token'])('isolates a mismatched %s',async mode=>{
    const f=fixture(); if(mode==='semester') f.data.semesterId='2027-fall';
    if(mode==='path')f.data.photoURL=f.data.photoURL.replace('feedPhotos','submissions');
    if(mode==='token')f.data.photoURL=f.data.photoURL.replace('preserve-token','wrong');
    const result=await backfillFeedPhotos(f.db,f.bucket,{project:'demo',semester,apply:true,backup:vi.fn(),report:vi.fn()});
    expect(result.failed).toBe(1); expect(f.save).not.toHaveBeenCalled();
  });
  it('backup failure prevents any object change',async()=>{
    const f=fixture(); const result=await backfillFeedPhotos(f.db,f.bucket,{project:'demo',semester,apply:true,backup:async()=>{throw Error('disk full')},report:vi.fn()});
    expect(result.failed).toBe(1); expect(f.save).not.toHaveBeenCalled();
  });
  it('deleted feed post prevents writing the still-existing object',async()=>{
    const f=fixture(); f.post.ref.get.mockResolvedValue({exists:false});
    const result=await backfillFeedPhotos(f.db,f.bucket,{project:'demo',semester,apply:true,backup:vi.fn(),report:vi.fn()});
    expect(result.failed).toBe(1); expect(f.save).not.toHaveBeenCalled();
  });
  it('normal publish reuses an existing optimized object without reading original',async()=>{
    const f=fixture(); f.meta().metadata.thumbnailVersion=THUMBNAIL_VERSION;f.meta().contentType='image/jpeg';
    const source:any={getMetadata:vi.fn()};
    expect(await ensureThumbnail(source,f.file)).toContain('token=preserve-token');expect(source.getMetadata).not.toHaveBeenCalled();
  });
});

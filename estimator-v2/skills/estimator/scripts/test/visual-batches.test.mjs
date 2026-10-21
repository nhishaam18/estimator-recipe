import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRun,inRun,writeJson,readJson,updateRun} from '../lib/store.mjs';
import {prepareDetection} from '../lib/detect.mjs';
import {reserveBatch,settleBatch} from '../lib/visual-batches.mjs';
const cli=fileURLToPath(new URL('../cest.mjs',import.meta.url));
const call=args=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[cli,...args],{env:process.env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>resolve({code,json:JSON.parse(out.trim().split('\n').at(-1)),err}));});
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'estimator-batch-')),prior=process.env.CEST_RUNS_DIR;process.env.CEST_RUNS_DIR=root;
 t.after(async()=>{if(prior===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=prior;await fs.rm(root,{recursive:true,force:true});});
 const run=await createRun({urls:['https://example.test/'],viewports:['desktop'],settings:{tileHeight:100,tileOverlap:20,coordMode:'pixels'}});
 await updateRun(run.id,r=>{r.selection={desktop:r.urls};});
 const slug=run.pages[0].slug;await writeJson(inRun(run.id,'shots/desktop/placeholder.json'),{});
 await fs.writeFile(inRun(run.id,`shots/desktop/${slug}.png`),await sharp({create:{width:120,height:260,channels:3,background:'#eee'}}).png().toBuffer());
 await writeJson(inRun(run.id,`rects/desktop/${slug}.json`),[]);
 await writeJson(inRun(run.id,'discovery-checkpoint.json'),{completed:['scan','group','capture']});
 await prepareDetection(run.id);return run;
}
async function result(run,packet){
 const r=await readJson(inRun(run.id,`analysis-requests/${packet.requestId}/request.json`));
 const value={coordinate_space:{width:120,height:100},inspection:{imageHash:r.imageHash,viewport:r.viewport,tileIndex:r.tile.index,summary:'Inspected this assigned source tile independently.'},components:[{id:'S1',name:'Hero',level:1,parent:null,box:[0,0,100,120],contains:[],reusable:true}]};
 await writeJson(inRun(run.id,packet.resultFile),value);
}
const outcomes=(batch,status='completed')=>batch.packets.map((p,i)=>({requestId:p.requestId,jobId:`job-${batch.batchId}-${i}`,status}));

test('two distinct same-page tiles reserve unique output paths and reuse active assignments',async t=>{
 const run=await fixture(t),batch=await reserveBatch(run.id);
 assert.equal(batch.packets.length,2);assert.equal(new Set(batch.packets.map(p=>p.requestId)).size,2);
 assert.equal(new Set(batch.packets.map(p=>p.resultFile)).size,2);
 assert.notEqual(batch.packets[0].image,batch.packets[1].image);
 const again=await reserveBatch(run.id);assert.equal(again.batchId,batch.batchId);assert.equal(again.reused,true);
 const blocked=await call(['all','--run',run.id]);assert.equal(blocked.code,2);assert.match(blocked.json.reason,/batch still reserved/);
 for(const p of batch.packets)await result(run,p);
 const settled=await settleBatch(run.id,batch.batchId,outcomes(batch));assert.equal(settled.imported,2);assert.equal(settled.status,'settled');
 const next=await reserveBatch(run.id);assert.equal(next.packets.length,1);assert(!batch.packets.some(p=>p.requestId===next.packets[0].requestId));
});

test('unknown/running jobs hold slots and cannot be replaced by another batch',async t=>{
 const run=await fixture(t),batch=await reserveBatch(run.id),o=outcomes(batch,'unknown');
 const held=await settleBatch(run.id,batch.batchId,o);assert.equal(held.status,'awaiting-workers');
 assert.equal((await reserveBatch(run.id)).batchId,batch.batchId);
 await assert.rejects(reserveBatch(run.id,{retryRequest:batch.packets[0].requestId}),/active batch/);
 const wrong=outcomes(batch);wrong[0].jobId='another-job';await assert.rejects(settleBatch(run.id,batch.batchId,wrong),/Job ID differs/);
 for(const p of batch.packets)await result(run,p);
 assert.equal((await settleBatch(run.id,batch.batchId,outcomes(batch))).imported,2);
});

test('one invalid result does not discard a valid sibling or retry it automatically',async t=>{
 const run=await fixture(t),batch=await reserveBatch(run.id);await result(run,batch.packets[0]);
 await writeJson(inRun(run.id,batch.packets[1].resultFile),{invalid:true});
 const settled=await settleBatch(run.id,batch.batchId,outcomes(batch));assert.equal(settled.imported,1);assert.equal(settled.failed,1);
 assert(await fs.stat(inRun(run.id,`analysis-results/${batch.packets[0].requestId}/import.json`)));
 const fresh=await reserveBatch(run.id);assert.equal(fresh.packets.length,1);assert.notEqual(fresh.packets[0].requestId,batch.packets[1].requestId);
 await result(run,fresh.packets[0]);await settleBatch(run.id,fresh.batchId,outcomes(fresh));
 assert.equal((await reserveBatch(run.id)).status,'needs-diagnosis');
 await assert.rejects(reserveBatch(run.id,{retryRequest:batch.packets[1].requestId}),/Validation failures require/);
 const retry=await reserveBatch(run.id,{retryRequest:batch.packets[1].requestId,retryKind:'correction'});
 assert.notEqual(retry.packets[0].resultFile,batch.packets[1].resultFile);
 await result(run,retry.packets[0]);await settleBatch(run.id,retry.batchId,outcomes(retry));
 assert.equal((await reserveBatch(run.id)).status,'complete');
 await writeJson(inRun(run.id,'discovery-checkpoint.json'),{completed:['scan','group','capture','detect','report']});
 const correction=await reserveBatch(run.id,{correctionRequest:retry.packets[0].requestId});await result(run,correction.packets[0]);await settleBatch(run.id,correction.batchId,outcomes(correction));
 assert(!(await readJson(inRun(run.id,'discovery-checkpoint.json'))).completed.includes('report'),'correction imports invalidate reports');
 await assert.rejects(reserveBatch(run.id,{correctionRequest:retry.packets[0].requestId}),/Two visual correction/);
});

test('transient retry is explicit and limited to one',async t=>{
 const run=await fixture(t),batch=await reserveBatch(run.id);await settleBatch(run.id,batch.batchId,outcomes(batch,'failed'));
 const retried=await reserveBatch(run.id,{retryRequest:batch.packets[0].requestId});await settleBatch(run.id,retried.batchId,outcomes(retried,'failed'));
 await assert.rejects(reserveBatch(run.id,{retryRequest:batch.packets[0].requestId}),/One transient retry/);
});

test('concurrent reservation calls cannot create overlapping batches',async t=>{
 const run=await fixture(t),attempts=await Promise.allSettled([reserveBatch(run.id),reserveBatch(run.id)]);
 const successful=attempts.filter(x=>x.status==='fulfilled').map(x=>x.value);
 assert(successful.length>=1);assert.equal(new Set(successful.map(x=>x.batchId)).size,1);
 const active=await readJson(inRun(run.id,'visual-batches/active.json'));assert.equal(active.batchId,successful[0].batchId);
 const history=await readJson(inRun(run.id,'visual-batches/index.json'));assert.equal(Object.keys(history).length,2);assert(Object.values(history).every(v=>v.attempts===1));
});

test('CLI settles the assigned worker files and refuses the retired review command',async t=>{
 const run=await fixture(t),batch=await call(['batch','--run',run.id]);assert.equal(batch.code,0,batch.err);
 for(const p of batch.json.packets)await result(run,p);
 const file=inRun(run.id,'outcomes.json');await writeJson(file,outcomes(batch.json));
 const settled=await call(['settle-batch','--run',run.id,'--batch',batch.json.batchId,'--outcomes-file',file]);assert.equal(settled.code,0,settled.err);assert.equal(settled.json.imported,2);
 const retired=await call(['review','--run',run.id]);assert.equal(retired.code,2);assert.match(retired.json.reason,/Unknown command/);
});

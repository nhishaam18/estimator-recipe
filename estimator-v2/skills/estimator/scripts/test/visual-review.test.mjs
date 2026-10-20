import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRun,inRun,writeJson,readJson} from '../lib/store.mjs';
import {prepareReview,importReview} from '../lib/visual-review.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const cli=fileURLToPath(new URL('../cest.mjs',import.meta.url));
const call=args=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[cli,...args],{env:process.env});let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);child.on('close',code=>resolve({code,json:JSON.parse(out.trim().split('\n').at(-1)),err}));});

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'estimator-review-')),prior=process.env.CEST_RUNS_DIR;
 process.env.CEST_RUNS_DIR=dir;t.after(async()=>{if(prior===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=prior;await fs.rm(dir,{recursive:true,force:true});});
 const run=await createRun({urls:['https://example.test/'],viewports:['desktop'],settings:{tileHeight:120,tileOverlap:20}});
 const paths={screenshot:'shots/desktop/home.png',annotated:'export/annotated/desktop/home.png',annotationData:'export/annotated/desktop/home.json'};
 const raw=await sharp({create:{width:1440,height:260,channels:3,background:'#eee'}}).png().toBuffer();
 await writeJson(inRun(run.id,'shots/desktop/placeholder.json'),{});
 await fs.writeFile(inRun(run.id,paths.screenshot),raw);
 await writeJson(inRun(run.id,paths.annotationData),{source:{sha256:hash(raw)},items:[]});
 await fs.writeFile(inRun(run.id,paths.annotated),raw);
 const requestIds=[0,1,2].map(n=>hash(String(n)));
 for(const [n,id] of requestIds.entries())await writeJson(inRun(run.id,`analysis-requests/${id}/request.json`),{id,tile:{top:[0,100,140][n],height:120}});
 await writeJson(inRun(run.id,'export/discovery.json'),{captures:[{id:'capture-1',viewport:'desktop',paths,nativeAnalysis:{requestIds}}],families:[{name:'Hero'},{name:'Card'}]});
 await writeJson(inRun(run.id,'export/quality.json'),{status:'needs-reanalysis',findings:[{code:'unowned-elements',captureId:'capture-1',reason:'Check missing card',requestIds}]});
 return {run,paths};
}
async function submit(run,packet,status='passed',findings=[]){
 const request=await readJson(inRun(run.id,`review-requests/${packet.requestId}/request.json`));
 const result={requestId:request.id,inspection:{rawImageHash:request.rawImageHash,annotatedImageHash:request.annotatedImageHash,summary:'Compared full-width raw and annotated regions.'},status,findings};
 const file=inRun(run.id,'review-draft.json');await writeJson(file,result);
 return {result,file,done:await importReview(run.id,request.id,file)};
}

test('review pairs preserve width, overlap and evidence while keeping stdout to one packet',async t=>{
 const {run}=await fixture(t),before=await fs.readFile(inRun(run.id,'export/discovery.json'));
 let state=await prepareReview(run.id);assert.equal(state.pending,3);assert(!('requests' in state));
 const first=await readJson(inRun(run.id,`review-requests/${state.next.requestId}/request.json`));
 const image=await sharp(inRun(run.id,first.rawImage)).metadata();assert.equal(image.width,1440);assert.equal(image.height,120);
 const manifest=await readJson(inRun(run.id,state.manifest));assert.equal(manifest.requests[1].region.top,100);
 assert.equal(first.detectionRequestIds.length,2,'overlap includes adjacent source requests');
 while(state.next){const result=await submit(run,state.next);state=result.done;}
 assert.equal(state.status,'passed');assert.equal(state.completed,3);
 assert.equal((await readJson(inRun(run.id,'export/visual-review.json'))).readyForImplementation,false);
 assert.equal((await readJson(inRun(run.id,'export/quality.json'))).status,'needs-reanalysis','visual pass does not override quality');
 assert.deepEqual(await fs.readFile(inRun(run.id,'export/discovery.json')),before,'family inventory is never changed by review');
});

test('changed annotation invalidates affected reviews and reuses unchanged crops',async t=>{
 const {run,paths}=await fixture(t);let state=await prepareReview(run.id),ids=[];
 while(state.next){ids.push(state.next.requestId);state=(await submit(run,state.next)).done;}
 const png=await sharp(inRun(run.id,paths.annotated)).composite([{input:Buffer.from('<svg width="1440" height="260"><rect x="10" y="150" width="30" height="20" fill="blue"/></svg>')}]).png().toBuffer();
 await fs.writeFile(inRun(run.id,paths.annotated),png);
 state=await prepareReview(run.id);assert.equal(state.completed,1);assert.equal(state.pending,2);
 await assert.rejects(importReview(run.id,ids[1],inRun(run.id,'review-draft.json')),/stale/);
 await fs.writeFile(inRun(run.id,paths.screenshot),png);
 await assert.rejects(prepareReview(run.id),/ledger does not match/);
});

test('review rejects false passing status, foreign request IDs, hash mismatch and conflicting replacement',async t=>{
 const {run}=await fixture(t),state=await prepareReview(run.id),packet=state.next;
 const r=await readJson(inRun(run.id,`review-requests/${packet.requestId}/request.json`));
 const value={requestId:r.id,inspection:{rawImageHash:r.rawImageHash,annotatedImageHash:r.annotatedImageHash,summary:'Compared both paired visual evidence regions.'},status:'passed',findings:[{reason:'Missing item',requestIds:r.detectionRequestIds}]};
 const file=inRun(run.id,'invalid.json');await writeJson(file,value);await assert.rejects(importReview(run.id,r.id,file),/Passed review/);
 value.status='needs-correction';value.findings[0].requestIds=['foreign'];await writeJson(file,value);await assert.rejects(importReview(run.id,r.id,file),/source-bound/);
 value.findings[0].requestIds=r.detectionRequestIds;value.inspection.rawImageHash='wrong';await writeJson(file,value);await assert.rejects(importReview(run.id,r.id,file),/both image hashes/);
 value.inspection.rawImageHash=r.rawImageHash;await writeJson(file,value);
 const flagged=await importReview(run.id,r.id,file);assert.equal(flagged.flagged,1);assert(flagged.attention.resultFile);
 assert.equal((await importReview(run.id,r.id,file)).flagged,1,'same result can be reconciled idempotently');
 value.status='passed';value.findings=[];await writeJson(file,value);
 await assert.rejects(importReview(run.id,r.id,file),/Conflicting review/);
 assert.equal((await importReview(run.id,r.id,file,{replace:true})).flagged,0);
 const archived=(await fs.readdir(inRun(run.id,`review-results/${r.id}`))).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));assert.equal(archived.length,2);
});

test('CLI prepares one review job and imports a source-bound child result without changing detections',async t=>{
 const {run}=await fixture(t),prepared=await call(['review','--run',run.id]);
 assert.equal(prepared.code,0,prepared.err);assert.equal(prepared.json.pending,3);
 const packet=prepared.json.next,r=await readJson(inRun(run.id,`review-requests/${packet.requestId}/request.json`));
 const result={requestId:r.id,inspection:{rawImageHash:r.rawImageHash,annotatedImageHash:r.annotatedImageHash,summary:'Compared both images from this assigned review packet.'},status:'passed',findings:[]};
 const file=inRun(run.id,packet.resultFile);await writeJson(file,result);
 const imported=await call(['import-review','--run',run.id,'--request',r.id,'--result-file',file]);
 assert.equal(imported.code,0,imported.err);assert.equal(imported.json.reviewStatus,'passed');assert.equal(imported.json.pending,2);
 assert.equal((await readJson(inRun(run.id,'export/discovery.json'))).families.length,2);
});

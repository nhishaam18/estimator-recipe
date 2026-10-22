import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createRun, inRun, updateRun, writeJson, readJson} from '../lib/store.mjs';
import {prepareDetection, importDetection} from '../lib/detect.mjs';
import {saveWorkState} from '../lib/work-state.mjs';
const cli=fileURLToPath(new URL('../cest.mjs',import.meta.url));
const call=args=>new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[cli,...args],{env:process.env});let out='',err='';
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);
 child.on('close',code=>resolve({code,json:JSON.parse(out.trim().split('\n').at(-1)),err}));
});

async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'estimator-work-'));
 const prior=process.env.CEST_RUNS_DIR;process.env.CEST_RUNS_DIR=root;
 t.after(async()=>{if(prior===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=prior;await fs.rm(root,{recursive:true,force:true});});
 const run=await createRun({urls:['https://example.test/'],viewports:['desktop'],settings:{tileHeight:100,tileOverlap:20,coordMode:'pixels'}});
 await updateRun(run.id,r=>{r.selection={desktop:r.urls};});
 const slug=run.pages[0].slug;
 await writeJson(inRun(run.id,'shots/desktop/placeholder.json'),{});
 await fs.writeFile(inRun(run.id,`shots/desktop/${slug}.png`),await sharp({create:{width:120,height:260,channels:3,background:'#eee'}}).png().toBuffer());
 await writeJson(inRun(run.id,`rects/desktop/${slug}.json`),[]);
 await writeJson(inRun(run.id,'discovery-checkpoint.json'),{completed:['scan','group','capture']});
 const analysis=await prepareDetection(run.id);
 return {run,analysis};
}

test('compact work checkpoint requires reservation instead of advertising an unbound draft path',async t=>{
 const {run,analysis}=await fixture(t);
 const state=await saveWorkState(run.id);
 assert.equal(state.analysis.pending,3);
 assert.equal(state.next.operation,'reserve-visual-batch');
 assert.equal(state.next.command,'batch');
 assert(!Object.hasOwn(state.next,'resultFile'));
 assert(!JSON.stringify(state).includes(analysis.requests[1].id));
 assert(!JSON.stringify(state).includes('Saved DOM hints'));
 assert(JSON.stringify(state).length<3500);
 assert.equal((await readJson(inRun(run.id,'work-state.json'))).runDir,path.dirname(inRun(run.id,'run.json')));
});

test('import returns the next packet and warns on empty analysis without erasing evidence',async t=>{
 const {run,analysis}=await fixture(t),first=analysis.requests[0];
 const request=await readJson(inRun(run.id,first.requestFile));
 const result={coordinate_space:{width:120,height:100},components:[],emptyReason:'Visually checked: a decorative-only area is visible.',inspection:{imageHash:request.imageHash,viewport:'desktop',tileIndex:0,summary:'Inspected this tile showing a decorative-only area.'}};
 const file=inRun(run.id,'reply.json');await writeJson(file,result);
 const receipt=await importDetection(run.id,first.id,file);
 assert.equal(receipt.componentCount,0);
 assert.equal(receipt.reviewRequired,true);
 assert.equal(receipt.next.operation,'reserve-visual-batch');
 assert.equal(receipt.pending,2);
 assert.equal((await readJson(inRun(run.id,'work-state.json'))).analysis.pending,2);
 assert(await fs.stat(inRun(run.id,`analysis-results/${first.id}/response.json`)));
});

test('resume checkpoint prioritizes browser stops and does not clear them',async t=>{
 const {run}=await fixture(t);
 await writeJson(inRun(run.id,'browser-stop.json'),{reason:'HTTP 429; inspect before retry'});
 const state=await saveWorkState(run.id);
 assert.equal(state.status,'blocked');assert.equal(state.next.operation,'inspect-browser-stop');
 assert(await fs.stat(inRun(run.id,'browser-stop.json')));
});

test('CLI rejects unfinished and entirely empty reports and leaves an actionable checkpoint',async t=>{
 const {run,analysis}=await fixture(t);
 const pending=await call(['report','--run',run.id]);
 assert.equal(pending.code,2);assert.match(pending.json.reason,/analyses pending/);
 assert.equal((await readJson(inRun(run.id,'work-state.json'))).next.operation,'inspect-command-error');
 assert.equal(await fs.stat(inRun(run.id,'export/report.md')).catch(()=>null),null);
 for(const item of analysis.requests){
  const r=await readJson(inRun(run.id,item.requestFile));
  const value={coordinate_space:{width:120,height:100},components:[],emptyReason:'Visually checked: a genuinely blank decorative area.',inspection:{imageHash:r.imageHash,viewport:r.viewport,tileIndex:r.tile.index,summary:'Inspected this image; no implementation units visible.'}};
  const file=inRun(run.id,'empty.json');await writeJson(file,value);
  await importDetection(run.id,item.id,file);
 }
 const empty=await call(['report','--run',run.id]);
 assert.equal(empty.code,2);assert.match(empty.json.reason,/all imported screenshot results are empty/);
 assert.equal((await readJson(inRun(run.id,'work-state.json'))).status,'blocked');
 assert.equal(await fs.stat(inRun(run.id,'export/report.md')).catch(()=>null),null);
});

test('next CLI returns a bounded reservation instruction while preserving all manifest records',async t=>{
 const {run,analysis}=await fixture(t);
 const receipt=await call(['detect','--run',run.id]);
 assert.equal(receipt.code,0,receipt.err);assert.equal(receipt.json.pending,3);
 assert.equal(receipt.json.next.operation,'reserve-visual-batch');
 assert(!Object.hasOwn(receipt.json,'requests'));assert(!Object.hasOwn(receipt.json,'pages'));
 const next=await call(['next','--run',run.id]);assert.equal(next.code,0,next.err);
 assert.equal(next.json.next.operation,'reserve-visual-batch');
 assert.equal((await readJson(inRun(run.id,'analysis-requests/manifest.json'))).requests.length,3);
});

// Script-owned serial reservations/imports; Visual Analysis writes only assigned per-attempt drafts.
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {getRun,inRun,runDir,readJson,writeJson} from './store.mjs';
import {prepareDetection,importDetection,loadLlm} from './detect.mjs';
const BATCH_SIZE=2;
const terminal=new Set(['imported','failed','blocked','cancelled']);
const idPattern=/^[a-f0-9]{64}$/;
const batchPattern=/^[a-f0-9-]{36}$/;
const indexFile='visual-batches/index.json';
const activeFile='visual-batches/active.json';
async function locked(id,operation){
 await fs.mkdir(inRun(id,'visual-batches'),{recursive:true});
 let handle;try{handle=await fs.open(inRun(id,'visual-batches/reservation.lock'),'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Visual batch operation already active or interrupted; inspect the lock owner before resuming');throw e;}
 try{await handle.writeFile(JSON.stringify({pid:process.pid}));return await operation();}finally{await handle.close();await fs.unlink(inRun(id,'visual-batches/reservation.lock'));}
}
function receipt(batch,reused=false){
 return {status:batch.closed?'settled':'awaiting-workers',runDir:batch.runDir,batchId:batch.id,batchFile:`visual-batches/${batch.id}.json`,reused,
  imported:batch.items.filter(i=>i.state==='imported').length,failed:batch.items.filter(i=>['failed','blocked','cancelled'].includes(i.state)).length,
  packets:batch.items.map(i=>({requestId:i.requestId,promptFile:i.promptFile,image:i.image,resultFile:i.resultFile,state:i.state,jobId:i.jobId??null,errorFile:i.errorFile??null})),
  next:batch.closed?'Inspect named failures or continue via scripts; no automatic retry':'Orchestrator dispatches new reservations once or reconciles existing jobs; no duplicate dispatch'};
}
export async function reserveBatch(id,{retryRequest,correctionRequest,retryKind='transient'}={}){
 return locked(id,async()=>{
  const active=await readJson(inRun(id,activeFile),null);
  if(active){const batch=await readJson(inRun(id,`visual-batches/${active.batchId}.json`));if(!batch.closed){if(retryRequest||correctionRequest)throw new Error('Settle or reconcile the active batch before a retry/correction');return receipt(batch,true);}}
  if(retryRequest&&correctionRequest)throw new Error('Choose retry-request or correction-request');
  const analysis=await prepareDetection(id),history=await readJson(inRun(id,indexFile),{});
  let candidates=analysis.requests.filter(r=>!history[r.id]),kind='initial';
  const selected=retryRequest??correctionRequest;
  if(selected){
   if(!idPattern.test(selected))throw new Error('Invalid detection request ID');
   const prior=history[selected];if(!prior||!terminal.has(prior.state))throw new Error('Retry requires an existing terminal attempt; never retry active/unknown work');
   if(correctionRequest){
    const request=await readJson(inRun(id,`analysis-requests/${selected}/request.json`));
    const run=await getRun(id),page=run.pages.find(p=>p.slug===request.slug&&p.url===request.url);
    const cache=page?await loadLlm(id,request.viewport,page.slug):null;
    // A multi-tile page can still be pending; unchanged pending requests remain eligible for correction.
    if(!analysis.requests.some(r=>r.id===selected)&&!cache?.analysis?.requestIds.includes(selected))throw new Error('Stale correction request; prepare current evidence');
    if((prior.corrections??0)>=2)throw new Error('Two visual correction passes exhausted; retain unresolved findings');
    candidates=[request];kind='correction';
   }else{
    if(!['transient','correction'].includes(retryKind))throw new Error('retry-kind must be transient or correction');
    if(prior.state==='imported')throw new Error('Use correction-request for an imported result');
    const request=analysis.requests.find(r=>r.id===selected);if(!request)throw new Error('Stale retry request');
    kind=retryKind;
    if(kind==='transient'&&prior.errorCategory==='validation')throw new Error('Validation failures require a visual correction, not a transient retry');
    if(kind==='transient'&&(prior.transientRetries??0)>=1)throw new Error('One transient retry exhausted; diagnose and finish partial/blocked');
    if(kind==='correction'&&(prior.corrections??0)>=2)throw new Error('Two visual correction passes exhausted; retain unresolved findings');
    candidates=[request];
   }
  }
  if(!candidates.length)return {status:analysis.pending?'needs-diagnosis':'complete',pending:analysis.pending,history:indexFile,packets:[]};
  const batch={id:randomUUID(),runDir:runDir(id),createdAt:new Date().toISOString(),closed:false,items:candidates.slice(0,BATCH_SIZE).map(r=>({requestId:r.id,promptFile:r.promptFile,image:r.image,resultFile:'',state:'reserved',kind,replace:kind==='correction'}))};
  for(const item of batch.items){
   item.resultFile=`analysis-results/${item.requestId}/draft-${batch.id}.json`;
   const prior=history[item.requestId]??{};
   history[item.requestId]={...prior,attempts:(prior.attempts??0)+1,corrections:(prior.corrections??0)+(kind==='correction'?1:0),transientRetries:(prior.transientRetries??0)+(kind==='transient'?1:0),state:'reserved',batchId:batch.id};
  }
  // Receipt first, pointer last: uncertain dispatch is never made available to another batch.
  await writeJson(inRun(id,`visual-batches/${batch.id}.json`),batch);
  await writeJson(inRun(id,indexFile),history);await writeJson(inRun(id,activeFile),{batchId:batch.id});
  return receipt(batch);
 });
}
export async function settleBatch(id,batchId,outcomes){
 if(!batchPattern.test(batchId)||!Array.isArray(outcomes)||outcomes.length>BATCH_SIZE)throw new Error('Invalid batch/outcomes');
 return locked(id,async()=>{
  const batch=await readJson(inRun(id,`visual-batches/${batchId}.json`)),history=await readJson(inRun(id,indexFile),{}),seen=new Set();
  if(batch.id!==batchId)throw new Error('Batch identity changed');
  // Validate the whole envelope before accepting any of the provided job statuses.
  for(const o of outcomes){
   const item=batch.items.find(i=>i.requestId===o.requestId);
   if(!item||seen.has(o.requestId)||!['completed','failed','blocked','cancelled','running','unknown'].includes(o.status))throw new Error('Unknown/duplicate packet or invalid job status');
   if(o.status!=='unknown'&&(typeof o.jobId!=='string'||!o.jobId.trim()||o.jobId.length>200))throw new Error('A verified platform job ID is required');
   if(item.jobId&&o.jobId&&item.jobId!==o.jobId)throw new Error('Job ID differs from the saved assignment');
   seen.add(o.requestId);
  }
  for(const o of outcomes){
   const item=batch.items.find(i=>i.requestId===o.requestId);if(terminal.has(item.state))continue;
   item.jobId=o.jobId??item.jobId;item.platformStatus=o.status;
   if(['running','unknown'].includes(o.status)){item.state=o.status;}
   else if(o.status==='completed'){
    await writeJson(inRun(id,`visual-batches/${batchId}.json`),batch);
    try{const imported=await importDetection(id,item.requestId,inRun(id,item.resultFile),{}, {replace:item.replace,binding:{batchId,jobId:item.jobId}});item.state='imported';item.componentCount=imported.componentCount;item.emptyResult=imported.reviewRequired;}
    catch(error){item.state='failed';item.errorCategory='validation';item.errorFile=`visual-batches/${batchId}/errors/${item.requestId}.json`;await writeJson(inRun(id,item.errorFile),{category:'validation',reason:error.message,requestId:item.requestId,resultFile:item.resultFile});}
   }else{
    item.state=o.status;item.errorFile=`visual-batches/${batchId}/errors/${item.requestId}.json`;
    await writeJson(inRun(id,item.errorFile),{category:'worker',status:o.status,reason:typeof o.reason==='string'?o.reason.slice(0,2000):'Inspect the verified platform job result',requestId:item.requestId,jobId:item.jobId});
   }
   history[item.requestId]={...history[item.requestId],state:item.state,errorCategory:item.errorCategory??null};
   await writeJson(inRun(id,indexFile),history);await writeJson(inRun(id,`visual-batches/${batchId}.json`),batch);
  }
  batch.closed=batch.items.every(i=>terminal.has(i.state));
  await writeJson(inRun(id,`visual-batches/${batchId}.json`),batch);
  if(batch.closed){const active=await readJson(inRun(id,activeFile),null);if(active?.batchId===batchId)await fs.unlink(inRun(id,activeFile));}
  return {...receipt(batch),emptyResults:batch.items.filter(i=>i.emptyResult).map(i=>i.requestId)};
 });
}

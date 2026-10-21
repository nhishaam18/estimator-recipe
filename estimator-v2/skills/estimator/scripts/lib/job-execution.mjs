// Bounded deterministic Developer assignments. This module never invokes a model.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../cest.mjs',import.meta.url));
const hash=value=>createHash('sha256').update(value).digest('hex');
async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${randomUUID()}.tmp`;await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,file);}
async function json(file,max=64000){const stat=await fs.stat(file);if(stat.size>max)throw new Error('Job input exceeds its size limit');return JSON.parse(await fs.readFile(file,'utf8'));}
const kinds=new Set(['discover-plan','prepare','advance','settle-batch','recover-capture','report','prepare-consolidation','import-consolidation','prepare-estimates','import-estimates','assemble-estimates']);
const fields=new Set(['schemaVersion','id','kind','runDir','runsDir','planDir','planFingerprint','quotasFile','discoveryFile','url','name','batchId','outcomesFile','reason','diagnosis','resultFile','partsFile','target','rate','currency']);
export function validateOutcomes(value){
 if(!Array.isArray(value)||value.length>2)throw new Error('Outcomes must be a bare array of at most two {requestId,jobId,status,reason?} objects; not {jobs:[...]}');
 const seen=new Set();
 for(const item of value){
  if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Invalid outcome object');
  if(typeof item.requestId!=='string'||!/^[a-f0-9]{64}$/.test(item.requestId)||seen.has(item.requestId))throw new Error('Invalid or duplicate outcome requestId');
  if(!['completed','failed','blocked','cancelled','running','unknown'].includes(item.status))throw new Error('Invalid outcome status; ready is not a platform status');
  if(item.status!=='unknown'&&(typeof item.jobId!=='string'||!item.jobId.trim()||item.jobId.length>200))throw new Error('Use jobId from verified platform results; platformRunId is not accepted');
  if(Object.keys(item).some(k=>!['requestId','jobId','status','reason'].includes(k)))throw new Error('Unexpected outcome field; use only requestId, jobId, status, reason');
  if(item.reason!==undefined&&(typeof item.reason!=='string'||item.reason.length>2000))throw new Error('Outcome reason must be concise');
  seen.add(item.requestId);
 }
 return value;
}
function validateJob(job){
 if(!job||job.schemaVersion!==1||typeof job.id!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(job.id)||!kinds.has(job.kind))throw new Error('Invalid job identity, schemaVersion or kind');
 if(Object.keys(job).some(k=>!fields.has(k)))throw new Error('Unknown job field; use the documented assignment schema');
 const required=job.kind==='discover-plan'?['url','discoveryFile','runsDir']:job.kind==='prepare'?['planDir','planFingerprint','quotasFile','runsDir']:['runDir'];
 if(job.kind==='settle-batch')required.push('batchId','outcomesFile');
 if(job.kind==='recover-capture')required.push('url','reason');
 if(['import-consolidation','import-estimates'].includes(job.kind))required.push('resultFile');
 if(job.kind==='assemble-estimates')required.push('partsFile');
 for(const key of required)if(typeof job[key]!=='string'||!job[key].trim())throw new Error(`Job requires ${key}`);
 for(const key of ['runDir','runsDir','planDir','quotasFile','discoveryFile','outcomesFile','resultFile','partsFile'])if(job[key]!==undefined&&(typeof job[key]!=='string'||!path.isAbsolute(job[key])))throw new Error(`${key} must be an absolute path`);
 if(job.batchId!==undefined&&!/^[a-f0-9-]{36}$/.test(job.batchId))throw new Error('Invalid batchId');
 if(job.reason!==undefined&&(typeof job.reason!=='string'||job.reason.length>2000))throw new Error('Keep the diagnosis reason below 2000 characters');
 if(job.diagnosis!==undefined&&(typeof job.diagnosis!=='string'||job.diagnosis.length>2000))throw new Error('Keep diagnosis below 2000 characters');
 if(job.rate!==undefined&&(!Number.isFinite(job.rate)||job.rate<=0||typeof job.currency!=='string'||!/^[A-Z]{3}$/.test(job.currency)))throw new Error('Explicit rate requires a positive number and ISO currency');
 if(job.currency!==undefined&&job.rate===undefined)throw new Error('Currency requires an explicitly provided rate');
}
async function invokeCommand(command,args,{folder,index}){
 const argv=[cli,command,...Object.entries(args).flatMap(([k,v])=>v===undefined?[]:[`--${k}`,String(v)])];
 const stdoutFile=path.join(folder,`${index}-${command}.stdout.log`),stderrFile=path.join(folder,`${index}-${command}.stderr.log`);
 const out=await fs.open(stdoutFile,'w'),err=await fs.open(stderrFile,'w');
 try{
  const code=await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,argv,{env:process.env,stdio:['ignore',out.fd,err.fd],windowsHide:true});
   const timer=setTimeout(()=>{child.kill();},5*60000);
   child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('close',code=>{clearTimeout(timer);resolve(code);});
  });
  const size=(await out.stat()).size;if(size>1024*1024)throw new Error(`Unexpected large command receipt; inspect ${stdoutFile}`);
  const text=await fs.readFile(stdoutFile,'utf8');let result;
  try{result=JSON.parse(text.trim().split('\n').at(-1));}catch{throw new Error(`Command returned no JSON receipt; inspect ${stdoutFile}`);}
  if(code!==0)throw new Error(`${command}: ${result.reason??'failed'}; log: ${stderrFile}`);
  return result;
 }finally{await out.close();await err.close();}
}
// One durable assignment can execute once. Changed inputs need a new reviewed job ID.
export async function executeJob(file,{invoke=invokeCommand}={}){
 file=path.resolve(file);const job=await json(file);
 if(!job||typeof job.id!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(job.id))throw new Error('Invalid job ID');
 const folder=path.join(path.dirname(file),'receipts',job.id),receiptFile=path.join(folder,'receipt.json');await fs.mkdir(folder,{recursive:true});
 const lockFile=path.join(folder,'execution.lock');let lock;
 try{lock=await fs.open(lockFile,'wx');await lock.writeFile(JSON.stringify({pid:process.pid,jobFile:file}));}catch(e){if(e.code==='EEXIST')throw new Error(`Job already active or interrupted; inspect lock ${lockFile}, do not rerun blindly`);throw e;}
 try{
  // Hash referenced immutable inputs before commands; never include mutable run checkpoints.
  const inputs={};let inputError;for(const key of ['quotasFile','discoveryFile','outcomesFile','resultFile','partsFile'])if(typeof job[key]==='string'&&path.isAbsolute(job[key]))try{inputs[key]=hash(await fs.readFile(job[key]));}catch(e){inputs[key]=`unavailable:${e.code}`;inputError=new Error(`Missing or unreadable ${key}: ${job[key]}`);}
  let plan;if(job.kind==='prepare'&&typeof job.planDir==='string'&&path.isAbsolute(job.planDir))try{const bytes=await fs.readFile(path.join(job.planDir,'plan.json'));inputs.plan=hash(bytes);plan=JSON.parse(bytes);}catch(e){inputs.plan=`unavailable:${e.code??'invalid-json'}`;inputError=new Error('Missing or invalid plan.json');}
  if(job.kind==='assemble-estimates'&&typeof job.partsFile==='string'&&path.isAbsolute(job.runDir??''))try{
   const parts=await json(job.partsFile);if(!Array.isArray(parts)||parts.length>1000)throw new Error('Invalid estimate fragment list');
   inputs.fragments={};for(const rel of parts){
    if(typeof rel!=='string'||path.isAbsolute(rel))throw new Error('Estimate fragments must be run-relative paths');
    const full=path.resolve(job.runDir,rel),relative=path.relative(job.runDir,full);
    if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error('Estimate fragment escapes run');
    inputs.fragments[rel]=hash(await fs.readFile(full));
   }
  }catch(e){inputError=new Error(`Invalid estimate fragments: ${e.message}`);}
  const fingerprint=hash(JSON.stringify({job,inputs}));let prior;
  try{prior=await json(receiptFile,256000);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(prior){if(prior.fingerprint!==fingerprint)throw new Error('Job identity or referenced input changed; reconcile and create a new job ID');return {...prior,replayed:true};}
  let index=0;
  const progressFile=path.join(folder,'progress.json');
  let interrupted=false;try{await fs.stat(progressFile);interrupted=true;}catch(e){if(e.code!=='ENOENT')throw e;}
  const call=async(command,args={})=>{await atomic(progressFile,{jobFile:file,fingerprint,lastCommand:command,commands:index+1,status:'executing'});const value=await invoke(command,{...(job.runsDir?{'runs-dir':job.runsDir}:{}),...args},{folder,index:index++});await atomic(progressFile,{jobFile:file,fingerprint,lastCommand:command,commands:index,status:'returned',result:value});return value;};
  let result;
  try{
   validateJob(job);
   if(inputError)throw inputError;
   if(job.kind==='prepare'){
    (await import('./urlplanning.mjs')).validateUrlPlan(plan);
    if(plan.fingerprint!==job.planFingerprint)throw new Error('Plan differs from the user-reviewed planFingerprint; reconcile scope before preparing');
   }
   if(interrupted)throw new Error('Uncertain prior execution: progress exists without final receipt. Reconcile files/locks before a new diagnosis job; never replay commands automatically');
   if(job.kind==='discover-plan')result=await call('plan',{url:job.url,'discovery-file':job.discoveryFile,'plans-dir':path.join(path.dirname(job.runsDir),'estimator-config','url-plans')});
   else if(job.kind==='settle-batch'){
    validateOutcomes(await json(job.outcomesFile));
    const settled=await call('settle-batch',{run:job.runDir,batch:job.batchId,'outcomes-file':job.outcomesFile});
    result=settled;
    if(settled.status==='settled'){
     if(settled.failed||settled.emptyResults?.length)result={...settled,status:'needs-diagnosis',next:'Read only the named errors; create a separate bounded diagnosis/correction assignment'};
     else result={...await call('batch',{run:job.runDir}),imported:settled.imported,failed:settled.failed??0,settledBatchId:job.batchId};
    }
   }else if(job.kind==='prepare'||job.kind==='advance'){
    let runDir=job.runDir;
    if(job.kind==='prepare'){
     await call('select',{plan:job.planDir,'quotas-file':job.quotasFile});
     runDir=(await call('init',{selection:job.planDir,name:job.name})).runDir;
     if(!runDir||!path.isAbsolute(runDir))throw new Error('Initialization returned no absolute runDir');
    }
    result=await call('all',{run:runDir,through:'detect',minutes:4});
    if(result.status==='awaiting-analysis')result={...await call('batch',{run:runDir}),runDir};
    else result={...result,runDir};
   }else if(job.kind==='recover-capture'){
    result=await call('recover-capture',{run:job.runDir,url:job.url,reason:job.reason,diagnosis:job.diagnosis});
    if(['recovered','unchanged'].includes(result.status))result={...await call('batch',{run:job.runDir}),recovery:result};
   }else{
    const operations={report:['all',{through:'report',minutes:4}],'prepare-consolidation':['consolidate',{}],'import-consolidation':['import-consolidation',{'result-file':job.resultFile}],'prepare-estimates':['estimate',{target:job.target,rate:job.rate,currency:job.currency}],'import-estimates':['import-estimates',{'result-file':job.resultFile}],'assemble-estimates':['assemble-estimates',{'parts-file':job.partsFile}]};
    const [command,args]=operations[job.kind];result=await call(command,{run:job.runDir,...args});
   }
  }catch(error){result={status:'blocked',reason:error.message,next:'Inspect the saved job/progress/logs. Do not rerun or edit scripts automatically; return a bounded diagnosis request.'};}
  if(result.packets&&result.runDir)result.packets=result.packets.map(p=>({...p,...Object.fromEntries(['promptFile','image','resultFile'].filter(k=>p[k]).map(k=>[k,path.resolve(result.runDir,p[k])]))}));
  const receipt={...result,job:{id:job.id,kind:job.kind,file},fingerprint,receiptFile,commands:index,recordedAt:new Date().toISOString()};
  if(Buffer.byteLength(JSON.stringify(receipt))>64000)throw new Error('Command receipt exceeds 64 KB; inspect saved progress instead of expanding context');
  await atomic(receiptFile,receipt);return receipt;
 }finally{await lock.close();await fs.unlink(lockFile);}
}

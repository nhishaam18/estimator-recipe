// Script-owned job construction. The host supplies decisions and verified model outcomes only.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {executeJob} from './job-execution.mjs';
import {assertRuntimeExecution} from './runtime-location.mjs';

const entrypoint=fileURLToPath(new URL('../cest.mjs',import.meta.url));
const options={kind:'kind',run:'runDir','runs-dir':'runsDir',plan:'planDir','plan-fingerprint':'planFingerprint','quotas-file':'quotasFile','discovery-file':'discoveryFile',url:'url',name:'name',batch:'batchId','outcomes-file':'outcomesFile',reason:'reason',diagnosis:'diagnosis','result-file':'resultFile','parts-file':'partsFile',target:'target',rate:'rate',currency:'currency'};
const kinds=new Set(['discover-plan','prepare','advance','settle-batch','recover-capture','report','prepare-consolidation','import-consolidation','prepare-estimates','import-estimates','assemble-estimates']);
const digest=text=>createHash('sha256').update(text).digest('hex');
async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const temp=`${file}.${randomUUID()}.tmp`;await fs.writeFile(temp,JSON.stringify(value,null,2)+'\n');await fs.rename(temp,file);}

export async function executeFlow(args,{execute=executeJob}={}){
 const execution=assertRuntimeExecution({entrypoint});
 if(typeof args.id!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(args.id))throw new Error('flow requires a stable lowercase --id; reuse it only to reconcile the same step');
 if(!kinds.has(args.kind))throw new Error('flow requires a documented --kind');
 if(Object.keys(args).some(k=>!['id','jobs-dir',...Object.keys(options)].includes(k)))throw new Error('Unknown flow option');
 if(typeof args['jobs-dir']!=='string'||!path.isAbsolute(args['jobs-dir']))throw new Error('flow requires an absolute --jobs-dir');
 const folder=path.resolve(args['jobs-dir']),file=path.join(folder,`${args.id}.json`);
 const job={schemaVersion:1,id:args.id,runtime:execution.runtime};
 for(const [option,key] of Object.entries(options))if(args[option]!==undefined){
  if(typeof args[option]!=='string')throw new Error(`--${option} requires a value`);
  job[key]=key==='rate'?Number(args[option]):args[option];
 }
 await fs.mkdir(folder,{recursive:true});
 // Exclusive creation never overwrites an assignment, including after an interrupted write.
 try{await fs.writeFile(file,JSON.stringify(job,null,2)+'\n',{flag:'wx'});}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  const prior=JSON.parse(await fs.readFile(file,'utf8'));
  if(JSON.stringify(prior)!==JSON.stringify(job))throw new Error('Flow ID already belongs to different inputs; preserve it and use a new reviewed step ID');
 }
 const receipt=await execute(file);
 // The immutable per-step receipt remains authoritative; a replay cannot overwrite current state.
 const key=digest(receipt.runDir??receipt.planDir??job.runDir??job.planDir??file).slice(0,24);
 const checkpointFile=path.join(folder,'coordination',`${key}.json`);
 if(!receipt.replayed){
  let previous={};try{previous=JSON.parse(await fs.readFile(checkpointFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  await atomic(checkpointFile,{version:1,runtime:execution.runtime,runDir:receipt.runDir??job.runDir??previous.runDir,planDir:receipt.planDir??job.planDir??previous.planDir,planFingerprint:receipt.planFingerprint??job.planFingerprint??previous.planFingerprint,jobFile:file,receiptFile:receipt.receiptFile,status:receipt.status,batchId:receipt.batchId,counts:{imported:receipt.imported,failed:receipt.failed,pending:receipt.pending},packets:receipt.packets??[],next:receipt.next});
 }
 return {...receipt,checkpointFile};
}

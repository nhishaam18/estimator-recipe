import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {executeJob,validateOutcomes} from '../lib/job-execution.mjs';
import {buildUrlPlan} from '../lib/urlplanning.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'estimator-job-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('outcomes require the exact documented array and jobId schema',()=>{
 assert.throws(()=>validateOutcomes({jobs:[]}),/array/);
 assert.throws(()=>validateOutcomes([{requestId:'a'.repeat(64),platformRunId:'job',status:'completed'}]),/jobId/);
 assert.throws(()=>validateOutcomes([{requestId:'a'.repeat(64),jobId:'job',status:'ready'}]),/status/);
 assert.equal(validateOutcomes([{requestId:'a'.repeat(64),jobId:'job',status:'completed'}]).length,1);
});
test('settlement and next reservation run once and replay returns saved small receipt',async t=>{
 const root=await fixture(t),file=path.join(root,'job.json'),outcomesFile=path.join(root,'outcomes.json');
 await fs.writeFile(outcomesFile,JSON.stringify([{requestId:'a'.repeat(64),jobId:'platform-job',status:'completed'}]));
 await fs.writeFile(file,JSON.stringify({schemaVersion:1,id:'settle-one',kind:'settle-batch',runDir:root,batchId:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+ 'a'.repeat(12),outcomesFile}));
 const calls=[],invoke=async(command,args)=>{calls.push({command,args});return command==='settle-batch'?{status:'settled',failed:0,emptyResults:[],imported:1}:{status:'awaiting-workers',batchId:'next',packets:[{requestId:'b'.repeat(64)}]};};
 const first=await executeJob(file,{invoke});assert.equal(first.status,'awaiting-workers');assert.equal(calls.length,2);assert.equal(first.imported,1);
 const again=await executeJob(file,{invoke});assert.equal(again.replayed,true);assert.equal(calls.length,2);assert.equal(again.batchId,'next');
 const saved=JSON.parse(await fs.readFile(first.receiptFile,'utf8'));assert.equal(saved.job.id,'settle-one');
});
test('failed validation does not run commands and is not blindly retried',async t=>{
 const root=await fixture(t),file=path.join(root,'job.json'),outcomesFile=path.join(root,'outcomes.json');
 await fs.writeFile(outcomesFile,JSON.stringify({jobs:[]}));
 await fs.writeFile(file,JSON.stringify({schemaVersion:1,id:'bad-schema',kind:'settle-batch',runDir:root,batchId:'bad',outcomesFile}));
 let calls=0;const invoke=async()=>{calls++;};
 const result=await executeJob(file,{invoke});assert.equal(result.status,'blocked');assert.match(result.reason,/array|batch/);assert.equal(calls,0);
 assert.equal((await executeJob(file,{invoke})).replayed,true);assert.equal(calls,0);
});
test('assignment and referenced outcomes cannot change under the same job identity',async t=>{
 const root=await fixture(t),file=path.join(root,'job.json'),outcomesFile=path.join(root,'outcomes.json');
 await fs.writeFile(outcomesFile,'[]');const job={schemaVersion:1,id:'source-bound',kind:'settle-batch',runDir:root,batchId:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+ 'a'.repeat(12),outcomesFile};await fs.writeFile(file,JSON.stringify(job));
 await executeJob(file,{invoke:async()=>({status:'awaiting-workers'})});
 await fs.writeFile(outcomesFile,JSON.stringify([{requestId:'b'.repeat(64),jobId:'new-job',status:'running'}]));
 await assert.rejects(executeJob(file,{invoke:async()=>{throw Error('must not run');}}),/changed|identity/);
});
test('failed or empty imports stop before reserving new work',async t=>{
 const root=await fixture(t),file=path.join(root,'job.json'),outcomesFile=path.join(root,'outcomes.json');await fs.writeFile(outcomesFile,'[]');
 await fs.writeFile(file,JSON.stringify({schemaVersion:1,id:'invalid-result',kind:'settle-batch',runDir:root,batchId:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+ 'a'.repeat(12),outcomesFile}));
 const calls=[];const result=await executeJob(file,{invoke:async(command)=>{calls.push(command);return {status:'settled',failed:1,imported:1,emptyResults:[]};}});
 assert.equal(result.status,'needs-diagnosis');assert.equal(calls.length,1);assert.equal(result.imported,1);
});
test('concurrent execution cannot duplicate commands for the same assignment',async t=>{
 const root=await fixture(t),file=path.join(root,'job.json');await fs.writeFile(file,JSON.stringify({schemaVersion:1,id:'exclusive',kind:'advance',runDir:root}));
 let calls=0;let release;const gate=new Promise(resolve=>release=resolve);const first=executeJob(file,{invoke:async()=>{calls++;await gate;return {status:'complete'};}});
 while(!calls)await new Promise(resolve=>setTimeout(resolve,5));
 await assert.rejects(executeJob(file,{invoke:async()=>{throw Error('duplicate');}}),/active|lock/);release();await first;assert.equal(calls,1);
});
test('missing inputs and uncertain prior execution persist a blocked receipt without commands',async t=>{
 const root=await fixture(t),file=path.join(root,'missing.json');
 await fs.writeFile(file,JSON.stringify({schemaVersion:1,id:'missing-input',kind:'settle-batch',runDir:root,batchId:'a'.repeat(8)+'-aaaa-aaaa-aaaa-'+ 'a'.repeat(12),outcomesFile:path.join(root,'absent.json')}));
 const result=await executeJob(file,{invoke:async()=>{throw Error('must not run');}});assert.equal(result.status,'blocked');assert.match(result.reason,/Missing/);assert.equal(result.commands,0);assert(await fs.stat(result.receiptFile));
 const other=path.join(root,'uncertain.json');await fs.writeFile(other,JSON.stringify({schemaVersion:1,id:'uncertain',kind:'advance',runDir:root}));
 await fs.mkdir(path.join(root,'receipts/uncertain'),{recursive:true});await fs.writeFile(path.join(root,'receipts/uncertain/progress.json'),'{}');
 const blocked=await executeJob(other,{invoke:async()=>{throw Error('must not run');}});assert.equal(blocked.status,'blocked');assert.match(blocked.reason,/Uncertain/);assert.equal(blocked.commands,0);
});
test('real child command groups saved discovery and records absolute durable plan paths',async t=>{
 const root=await fixture(t),file=path.join(root,'discover.json'),discoveryFile=path.join(root,'map.json'),runsDir=path.join(root,'runs');
 await fs.writeFile(discoveryFile,JSON.stringify({links:[{url:'https://example.test/'},{url:'https://example.test/about'}]}));
 await fs.writeFile(file,JSON.stringify({schemaVersion:1,id:'plan-once',kind:'discover-plan',url:'https://example.test/',discoveryFile,runsDir}));
 const result=await executeJob(file);assert.equal(result.status,'awaiting-selection',result.reason);assert(path.isAbsolute(result.planDir));assert.equal(result.commands,1);assert.equal(result.job.id,'plan-once');assert.equal((await executeJob(file)).replayed,true);
});
test('prepare binds the reviewed plan and rejects a changed valid plan on replay',async t=>{
 const root=await fixture(t),planDir=path.join(root,'plan'),file=path.join(root,'prepare.json'),quotasFile=path.join(root,'quotas.json');await fs.mkdir(planDir);await fs.writeFile(quotasFile,'{}');
 const plan=buildUrlPlan('https://example.test/',{links:['https://example.test/']});await fs.writeFile(path.join(planDir,'plan.json'),JSON.stringify(plan));
 const job={schemaVersion:1,id:'prepare-once',kind:'prepare',planDir,planFingerprint:plan.fingerprint,quotasFile,runsDir:path.join(root,'runs')};await fs.writeFile(file,JSON.stringify(job));
 let count=0;const invoke=async command=>{count++;return command==='init'?{runDir:path.join(root,'runs/run')}:{status:'partial'};};
 assert.equal((await executeJob(file,{invoke})).status,'partial');assert.equal(count,3);
 const changed=buildUrlPlan('https://example.test/',{links:['https://example.test/','https://example.test/changed']});await fs.writeFile(path.join(planDir,'plan.json'),JSON.stringify(changed));
 await assert.rejects(executeJob(file,{invoke}),/changed/);assert.equal(count,3);
 const wrong=path.join(root,'wrong.json');await fs.writeFile(wrong,JSON.stringify({...job,id:'wrong-plan'}));
 const blocked=await executeJob(wrong,{invoke});assert.equal(blocked.status,'blocked');assert.match(blocked.reason,/planFingerprint/);assert.equal(count,3);
});
test('assembly fingerprint includes referenced fragment bytes',async t=>{
 const root=await fixture(t),partsFile=path.join(root,'parts.json'),fragment=path.join(root,'fragment.json'),file=path.join(root,'assemble.json');await fs.writeFile(partsFile,'["fragment.json"]');await fs.writeFile(fragment,'{"items":[]}');
 await fs.writeFile(file,JSON.stringify({schemaVersion:1,id:'assemble-once',kind:'assemble-estimates',runDir:root,partsFile}));
 let calls=0;const invoke=async()=>{calls++;return {status:'estimated'};};await executeJob(file,{invoke});await fs.writeFile(fragment,'{"items":[{}]}');
 await assert.rejects(executeJob(file,{invoke}),/changed/);assert.equal(calls,1);
});

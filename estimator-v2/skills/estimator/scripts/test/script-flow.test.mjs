import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {executeFlow} from '../lib/script-flow.mjs';
import {executeJob} from '../lib/job-execution.mjs';
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'estimator-flow-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}

test('scripts construct immutable runtime-bound jobs and save their compact checkpoints',async t=>{
 const root=await fixture(t),args={id:'advance-001',kind:'advance','jobs-dir':root,run:path.join(root,'run')};
 let calls=0;const execute=file=>executeJob(file,{invoke:async()=>{calls++;return {status:'partial'};}});
 const first=await executeFlow(args,{execute});assert.equal(first.status,'partial');assert.equal(calls,1);
 const job=JSON.parse(await fs.readFile(first.job.file,'utf8'));assert.equal(job.runDir,args.run);assert.match(job.runtime,/estimator$/);
 const state=JSON.parse(await fs.readFile(first.checkpointFile,'utf8'));assert.equal(state.runtime,job.runtime);assert.equal(state.receiptFile,first.receiptFile);
 const again=await executeFlow(args,{execute});assert.equal(again.replayed,true);assert.equal(calls,1);
 await assert.rejects(executeFlow({...args,run:path.join(root,'other')},{execute}),/different inputs/);assert.equal(calls,1);
});

test('settlement imports and reserves the next work inside scripts, not another agent',async t=>{
 const root=await fixture(t),outcomes=path.join(root,'outcomes.json');await fs.writeFile(outcomes,JSON.stringify([{requestId:'a'.repeat(64),jobId:'verified-job',status:'completed'}]));
 const calls=[];const result=await executeFlow({id:'settle-001',kind:'settle-batch','jobs-dir':root,run:root,batch:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','outcomes-file':outcomes},{execute:file=>executeJob(file,{invoke:async command=>{calls.push(command);return command==='settle-batch'?{status:'settled',failed:0,imported:1}:{status:'awaiting-workers',runDir:root,packets:[{requestId:'b'.repeat(64),promptFile:'prompt.txt',image:'tile.jpg',resultFile:'draft.json'}]};}})});
 assert.deepEqual(calls,['settle-batch','batch']);assert.equal(result.imported,1);assert.equal(result.packets[0].image,path.join(root,'tile.jpg'));
});

test('failed settlement stops; replay cannot silently retry or create another reservation',async t=>{
 const root=await fixture(t),outcomes=path.join(root,'outcomes.json');await fs.writeFile(outcomes,'[]');
 const args={id:'settle-failed',kind:'settle-batch','jobs-dir':root,run:root,batch:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','outcomes-file':outcomes};let calls=0;
 const execute=file=>executeJob(file,{invoke:async()=>{calls++;return {status:'settled',failed:1,imported:1};}});
 assert.equal((await executeFlow(args,{execute})).status,'needs-diagnosis');assert.equal(calls,1);
 assert.equal((await executeFlow(args,{execute})).replayed,true);assert.equal(calls,1);
 await fs.writeFile(outcomes,'[{"requestId":"changed"}]');await assert.rejects(executeFlow(args,{execute}),/changed/);assert.equal(calls,1);
});

test('unrecognized or ambiguous options cannot invoke a pipeline',async t=>{
 const root=await fixture(t),base={id:'step',kind:'advance','jobs-dir':root,run:root};let calls=0;const execute=async()=>{calls++;};
 for(const args of [{...base,id:'../escape'},{...base,kind:'shell'},{...base,run:true},{...base,command:'anything'},{...base,'jobs-dir':'relative'}])await assert.rejects(executeFlow(args,{execute}));
 assert.equal(calls,0);
});

test('discovery runs through the existing script and returns every group with its plan identity',async t=>{
 const root=await fixture(t),discovery=path.join(root,'map.json');await fs.writeFile(discovery,JSON.stringify({links:['https://example.test/','https://example.test/about']}));
 const result=await executeFlow({id:'discover-001',kind:'discover-plan','jobs-dir':path.join(root,'jobs'),url:'https://example.test/','discovery-file':discovery,'runs-dir':path.join(root,'runs')});
 assert.equal(result.status,'awaiting-selection');assert.equal(result.groups.length,2);assert.equal(result.counts.eligible,2);
 const saved=JSON.parse(await fs.readFile(result.checkpointFile,'utf8'));assert.equal(saved.planFingerprint,result.planFingerprint);assert.equal(saved.planDir,result.planDir);
});

test('replaying an old step does not roll back a newer coordination checkpoint',async t=>{
 const root=await fixture(t),base={kind:'advance','jobs-dir':root,run:root};const execute=file=>executeJob(file,{invoke:async()=>({status:'partial'})});
 const first=await executeFlow({...base,id:'first'},{execute});await executeFlow({...base,id:'second'},{execute});
 await executeFlow({...base,id:'first'},{execute});const saved=JSON.parse(await fs.readFile(first.checkpointFile,'utf8'));assert.match(saved.jobFile,/second\.json$/);
});

test('CLI flow wires grouping and replay without an agent or model request',async t=>{
 const root=await fixture(t),file=path.join(root,'map.json');await fs.writeFile(file,JSON.stringify({links:['https://example.test/']}));
 const cli=fileURLToPath(new URL('../cest.mjs',import.meta.url)),args=[cli,'flow','--id','cli-discover','--kind','discover-plan','--jobs-dir',path.join(root,'jobs'),'--runs-dir',path.join(root,'runs'),'--url','https://example.test/','--discovery-file',file];
 const first=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});assert.equal(first.status,0,first.stderr);const result=JSON.parse(first.stdout);assert.equal(result.status,'awaiting-selection');assert.equal(result.groups.length,1);assert.equal(result.commands,1);assert(path.isAbsolute(result.checkpointFile));
 const replay=spawnSync(process.execPath,args,{encoding:'utf8',windowsHide:true});assert.equal(replay.status,0,replay.stderr);assert.equal(JSON.parse(replay.stdout).replayed,true);
});

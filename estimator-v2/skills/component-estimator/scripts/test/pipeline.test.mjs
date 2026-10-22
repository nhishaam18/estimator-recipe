import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeJson, inRun, readJson } from '../lib/store.mjs';
import { runPipeline, STAGE_ORDER } from '../lib/pipeline.mjs';

test('pipeline checkpoints stages, resumes interrupted work and does not repeat completed stages', async () => {
  const previous = process.env.CEST_RUNS_DIR;
  const root = await mkdtemp(path.join(tmpdir(), 'cest-pipeline-'));
  process.env.CEST_RUNS_DIR = root;
  try {
    await writeJson(inRun('fixture', 'run.json'), { pages: [], usage: {} });
    const calls = {};
    const stages = Object.fromEntries(STAGE_ORDER.map(name => [name, async (_, job) => {
      calls[name] = (calls[name] ?? 0) + 1;
      if (name === 'capture' && calls[name] === 1) job.timedOut = true;
      return { stage: name, scanned: 1, done: calls[name] };
    }]));
    const summarize = async () => ({ coverage: { complete: true }, capped: false });
    assert.equal((await runPipeline('fixture', stages, { through: 'group', summarize })).status, 'ok');
    assert.equal(calls.capture, undefined);
    assert.equal((await runPipeline('fixture', stages, { summarize })).status, 'partial');
    assert.equal((await runPipeline('fixture', stages, { summarize })).status, 'ok');
    await runPipeline('fixture', stages, { summarize });
    assert.equal(calls.scan, 1); assert.equal(calls.group, 1);
    assert.equal(calls.capture, 2);
    assert.equal(Object.keys((await readJson(inRun('fixture', 'pipeline.json'))).completed).length, 3);
    const incomplete = await runPipeline('fixture', stages, { summarize: async () => ({ coverage: { complete: false }, capped: false }) });
    assert.equal(incomplete.status, 'ok');
    const highFlag = await runPipeline('fixture', stages, { summarize: async () => ({ coverage: { complete: true }, quality: { status: 'incomplete' } }) });
    assert.equal(highFlag.status, 'ok');
  } finally {
    if (previous === undefined) delete process.env.CEST_RUNS_DIR; else process.env.CEST_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('pipeline blocks after two unchanged resumptions and rejects simultaneous execution', async () => {
  const previous = process.env.CEST_RUNS_DIR;
  const root = await mkdtemp(path.join(tmpdir(), 'cest-stalled-'));
  process.env.CEST_RUNS_DIR = root;
  try {
    await writeJson(inRun('fixture', 'run.json'), { pages: [], usage: {} });
    const stages = { scan: async (_, job) => { job.timedOut = true; return { stage: 'scan', done: 0 }; } };
    const options = { summarize: async () => ({ coverage: { complete: false } }) };
    assert.equal((await runPipeline('fixture', stages, options)).status, 'partial');
    assert.equal((await runPipeline('fixture', stages, options)).status, 'partial');
    assert.equal((await runPipeline('fixture', stages, options)).status, 'blocked');
    await (await import('node:fs/promises')).writeFile(inRun('fixture', 'pipeline.lock'), String(process.pid));
    const locked = await runPipeline('fixture', stages, options);
    assert.equal(locked.status, 'blocked'); assert.equal(locked.pid, process.pid);
  } finally {
    if (previous === undefined) delete process.env.CEST_RUNS_DIR; else process.env.CEST_RUNS_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('network circuit break stops downstream stages and never checkpoints the stopped stage as complete',async()=>{
 const previous=process.env.CEST_RUNS_DIR,root=await mkdtemp(path.join(tmpdir(),'cest-network-checkpoint-'));process.env.CEST_RUNS_DIR=root;
 try{await writeJson(inRun('fixture','run.json'),{pages:[],usage:{}});let grouped=false;
 const stages={scan:async(_,job)=>{job.cancelRequested=true;job.stopReason='HTTP 429; remaining URLs deferred';return {stage:'scan',scanned:1};},group:async()=>{grouped=true;}};
 const result=await runPipeline('fixture',stages,{through:'group',summarize:async()=>({coverage:{complete:false}})});
 assert.equal(result.status,'blocked');assert.match(result.reason,/429/);assert.equal(grouped,false);assert.equal((await readJson(inRun('fixture','pipeline.json'))).completed.scan,undefined);
 let retried=false;const resumed=await runPipeline('fixture',{scan:async()=>{retried=true;}},{through:'scan',summarize:async()=>({})});assert.equal(resumed.status,'blocked');assert.equal(retried,false);
 }finally{if(previous===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=previous;await rm(root,{recursive:true,force:true});}
});

import { getRun, inRun, readJson, writeJson, exists } from './store.mjs';
import { newJob, logJob } from './jobs.mjs';
import { open, unlink } from 'node:fs/promises';

export const STAGE_ORDER = ['scan', 'group', 'capture'];

export async function runPipeline(id, stages, { through = 'capture', deadline, summarize } = {}) {
  if (!STAGE_ORDER.includes(through)) throw new Error('Invalid --through stage');
  const lockFile = inRun(id, 'pipeline.lock');
  let lock;
  try { lock = await open(lockFile, 'wx'); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const pid = Number(await (await import('node:fs/promises')).readFile(lockFile, 'utf8'));
    if (!Number.isInteger(pid) || pid <= 0) return { status: 'blocked', reason: 'Pipeline lock has no valid PID. Verify no process is running before removing it.' };
    try { process.kill(pid, 0); return { status: 'blocked', reason: 'Another pipeline is running. Wait for its recorded PID to exit before resuming.', pid }; }
    catch (check) { if (check.code !== 'ESRCH') throw check; }
    await unlink(lockFile);
    lock = await open(lockFile, 'wx');
  }
  await lock.writeFile(String(process.pid));
  try {
    const browserStop=await readJson(inRun(id,'browser-stop.json'),null);
    if(browserStop)return {status:'blocked',reason:browserStop.reason,action:'Inspect the failure and explicitly use --retry-browser only when a retry is appropriate.'};
    const file = inRun(id, 'pipeline.json');
    const checkpoint = await readJson(file, { recipeVersion: '3.0.0', completed: {}, progress: {}, unchanged: 0 });
    const results = [];
    for (const name of STAGE_ORDER.slice(0, STAGE_ORDER.indexOf(through) + 1)) {
      if (checkpoint.completed[name]) { results.push(checkpoint.completed[name]); continue; }
      if (deadline && Date.now() >= deadline) return { status: 'partial', currentStage: name, results, ...await summarize(id) };
      const job = newJob(); job.deadline = deadline;
      logJob(job, `== ${name} ==`);
      const result = await stages[name](id, job);
      results.push(result);
      const run = await getRun(id);
      const progress = JSON.stringify({ pages: run.pages.map(p => p.viewports), usage: run.usage, result });
      const previous = checkpoint.progress[name];
      checkpoint.progress[name] = progress;
      checkpoint.currentStage = name;
      const partial = !!job.timedOut || !!job.cancelRequested;
      checkpoint.unchanged = partial && previous === progress ? checkpoint.unchanged + 1 : 0;
      if (!partial) checkpoint.completed[name] = result;
      await writeJson(file, checkpoint);
      if(job.stopReason){await writeJson(inRun(id,'browser-stop.json'),{version:1,at:new Date().toISOString(),reason:job.stopReason});return {status:'blocked',reason:job.stopReason,currentStage:name,results,...await summarize(id)};}
      if (checkpoint.unchanged >= 2) return { status: 'blocked', reason: 'Two resumptions made no progress; inspect the named stage before retrying.', currentStage: name, results, ...await summarize(id) };
      if (partial) return { status: 'partial', currentStage: name, results, ...await summarize(id) };
      if (name === 'scan' && result.scanned === 0) return { status: 'blocked', reason: 'No page could be scanned. Check the URLs and access.', results };
    }
    const summary = await summarize(id);
    return { status: 'ok', currentStage: through, results, ...summary };
  } finally { await lock.close(); await unlink(lockFile); }
}

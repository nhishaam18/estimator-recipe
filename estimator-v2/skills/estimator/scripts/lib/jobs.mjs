// Minimal job helpers for the command line: a job is just a progress counter that prints sparse log lines to stderr.
export function newJob(total = 0) {
  return { state: 'running', done: 0, total, message: '', log: [], cancelRequested: false, deadline: null };
}

export function logJob(job, message) {
  job.message = message;
  job.log.push(`${new Date().toLocaleTimeString()}  ${message}`);
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
  process.stderr.write(`${message}\n`);
}

/** True once the stage has used the time it was given; work stops cleanly and a later run continues. */
export function outOfTime(job) {
  if (job.deadline && Date.now() > job.deadline) {
    job.cancelRequested = true;
    job.timedOut = true;
  }
  return job.cancelRequested;
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

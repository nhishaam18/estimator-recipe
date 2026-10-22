import { getRun } from './store.mjs';

/** Kajoo billing lives in platform traces; script-side unknown is never zero. */
export function summarizeCosts() {
  return { modelUsd: null, orchestrationUsd: null, source: 'Kajoo trace usage; unavailable to this script' };
}
export async function runCosts(runId) {
  await getRun(runId);
  return summarizeCosts();
}

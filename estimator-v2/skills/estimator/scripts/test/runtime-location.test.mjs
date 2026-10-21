import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRuntimeExecution} from '../lib/runtime-location.mjs';

test('read-only skill execution is rejected before job receipts or imports',()=>{
 for(const root of ['/mnt/skills/workspace/estimator','/mnt/skills/agents/agent-id/estimator']){
  assert.throws(()=>assertRuntimeExecution({entrypoint:`${root}/scripts/cest.mjs`}),e=>e.code==='CEST_WRONG_RUNTIME'&&/bootstrap receipt/.test(e.message));
 }
});
test('explicit runtime must match the executing script rather than remembered context',()=>{
 assert.throws(()=>assertRuntimeExecution({entrypoint:'/workspace/other/scripts/cest.mjs',runtime:'/workspace/estimator-runtime/estimator'}),/does not match/);
 const actual=assertRuntimeExecution({entrypoint:'/workspace/estimator-runtime/estimator/scripts/cest.mjs',runtime:'/workspace/estimator-runtime/estimator'});
 assert.match(actual.entrypoint,/estimator-runtime/);
});

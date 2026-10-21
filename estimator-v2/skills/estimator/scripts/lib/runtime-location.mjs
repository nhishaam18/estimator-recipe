import path from 'node:path';
const normalized=file=>path.resolve(file).replaceAll('\\','/');

// A staged skill is a template, never the dependency-bearing execution tree.
// Reject before creating a job receipt so a handoff omission cannot poison it.
export function assertRuntimeExecution({entrypoint,runtime}={}){
 if(typeof entrypoint!=='string'||!path.isAbsolute(entrypoint))throw new Error('Missing absolute runtime entrypoint');
 const actual=normalized(entrypoint);
 const fail=message=>{throw Object.assign(new Error(message),{code:'CEST_WRONG_RUNTIME',entrypoint:actual});};
 if(/^(?:[a-z]:)?\/mnt\/skills\//i.test(actual))fail('Cannot execute jobs or pipeline commands from the read-only skill projection. Read the saved bootstrap receipt and supply its absolute runtime path; never substitute the skill path or install dependencies there. No job receipt was created.');
 if(runtime!==undefined){
  if(typeof runtime!=='string'||!path.isAbsolute(runtime))fail('Job runtime must be the absolute runtime path from the bootstrap receipt');
  const expected=normalized(path.join(runtime,'scripts','cest.mjs'));
  if((process.platform==='win32'?expected.toLowerCase():expected)!==(process.platform==='win32'?actual.toLowerCase():actual))fail(`Executing entrypoint ${actual} does not match job runtime ${expected}. Supply the correct runtime; do not retry a cached job.`);
 }
 return {entrypoint:actual,runtime:normalized(path.dirname(path.dirname(entrypoint))),node:process.execPath};
}

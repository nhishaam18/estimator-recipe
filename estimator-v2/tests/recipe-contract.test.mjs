import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const list=(text,key)=>[...text.match(new RegExp(`^${key}: (.+)$`,'m'))[1].matchAll(/['"]([^'"]+)['"]/g)].map(m=>m[1]);

test('URL-only discovery and bounded recovery agree across agent instructions',()=>{
 const worker=read('agents/visual-analysis.md');assert.match(worker,/tokens: 30000/);assert.match(worker,/messages: 24/);assert.match(worker,/trimTokensToSummarize: 16000/);assert.equal((worker.match(/messages: 8/g)||[]).length,2);
 for(const p of ['skills/estimator/SKILL.md','skills/estimator-orchestration/SKILL.md','skills/estimator/references/workflow.md','skills/estimator/references/url-planning.md','prompts/start.md']){
  assert.doesNotMatch(read(p),/save the complete response|persist its complete result|save its complete JSON response/);
 }
 assert.match(read('skills/estimator-orchestration/SKILL.md'),/read-evidence/);
 assert.match(read('skills/estimator-visual-analysis/SKILL.md'),/ONE re-read/);
});
test('canonical package has native final frontmatter and no pre-seeded workflow',()=>{
 assert.equal(JSON.parse(read('.kajoo/recipe.json')).name,'Estimator 2.0.0');
 assert(!fs.existsSync(path.join(root,'.kajoo/workflow.json')));
 assert(!fs.existsSync(path.join(root,'workflow.json')));
 assert.match(read('.gitignore'),/!skills\/estimator\/scripts\/package-lock\.json/,'Locked runtime dependencies must survive recipe publication');
 const agent=read('agents/estimator.md');assert.doesNotMatch(agent,/^kajoo:/m);
 assert.deepEqual(list(agent,'skills'),['estimator-orchestration','estimator']);
 assert.deepEqual(fs.readdirSync(path.join(root,'agents')).sort(),['estimator.md','visual-analysis.md']);
 for(const tool of ['kajoo/ask-user-input','kajoo/run-agent','firecrawl/firecrawl_map','kajoo/create-artifact'])assert(list(agent,'tools').includes(tool),tool);
 assert(list(agent,'tools').every(t=>!/(?:task|epic)/.test(t)),'Task/epic tools must not be attached');
 assert(agent.length<4500,'Detailed procedures belong in skills');
});
test('flow uses Firecrawl, sampling and Sitecore defaults without project-management scaffolding',()=>{
 for(const p of ['skills/managing-kajoo-tasks','skills/estimator/references/task-workflow.md','skills/estimator/assets/task-plan.json','skills/estimator/assets/task-bindings.example.json'])assert(!fs.existsSync(path.join(root,p)),p);
 const skill=read('skills/estimator/SKILL.md');
 assert.match(skill,/Always use Firecrawl/);assert.match(skill,/Sitecore/);assert.match(skill,/Do not ask.*CMS/);
 assert.match(skill,/discovery-checkpoint\.json/);assert.match(skill,/consolidation/i);
 assert.equal(JSON.parse(read('skills/estimator/settings.json')).defaultCms,'Sitecore');
 for(const p of ['agents/estimator.md','skills/estimator/SKILL.md','prompts/start.md'])assert.doesNotMatch(read(p),/managing-kajoo-tasks|Technical report|task-workflow|taskId|epicId/);
});
test('native path/tool contract preserves read-only resources and writable runtime',()=>{
 const setup=read('skills/estimator/references/setup.md');
 for(const text of ['advertised SKILL.md','read','bash','read-only','/workspace/estimator-runtime/estimator','CEST_RUNS_DIR','npm ci --ignore-scripts'])assert(setup.includes(text),text);
 assert.match(read('skills/estimator/references/commands.md'),/cest\.mjs/);
 assert.deepEqual(JSON.parse(read('skills/estimator/settings.json')).viewports,['desktop']);
 assert(!fs.existsSync(path.join(root,'skills/estimator/app')));
 assert(!fs.existsSync(path.join(root,'skills/estimator/scripts/lib/openrouter.mjs')));
});
test('all skill reference links resolve',()=>{
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.name!=='node_modules').flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
 for(const file of walk(path.join(root,'skills')).filter(p=>p.endsWith('.md'))){
  for(const [,link] of fs.readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)){
   if(/^(https?:|#)/.test(link))continue;
   assert(fs.existsSync(path.resolve(path.dirname(file),link.split('#')[0])),`${file}: ${link}`);
  }
 }
});

test('visual work is delegated through a focused agent with fresh-job instructions',()=>{
 const main=read('agents/estimator.md'),worker=read('agents/visual-analysis.md');
 assert(list(main,'tools').includes('kajoo/run-agent'));
 assert.deepEqual(list(worker,'skills'),['estimator-visual-analysis']);
 assert.deepEqual(list(worker,'tools'),[]);
 assert.match(worker,/isDefault: false/);
 assert.match(worker,/tags: \[Sub Agent\]/);
 const delegation=read('skills/estimator-orchestration/SKILL.md');
 assert.match(delegation,/omit runId/i);
 assert.match(delegation,/resultFile/);
 assert.match(delegation,/at most TWO/);
 assert.match(delegation,/No Developer execution agent/);
 assert.match(delegation,/SAME assistant tool-call batch/);
 assert.match(delegation,/run flow settle-batch directly/i);
 assert.match(delegation,/NO automatic paired/);
 assert(!fs.existsSync(path.join(root,'skills/estimator/scripts/lib/visual-review.mjs')));
 assert.equal(read('skills/estimator-visual-analysis/references/annotation-contract.md'),read('skills/estimator/references/annotation-contract.md'));
});

test('scripts own routine execution with shared contracts and durable retention instructions',()=>{
 const skill=read('skills/estimator/SKILL.md');assert(skill.length<4600,'Entry should not preload the full workflow');assert.match(skill,/cest\.mjs flow/);assert.match(skill,/immediately/i);
 const main=read('agents/estimator.md');assert.match(main,/messages: 24/);assert.match(main,/tokens: 24000/);assert.match(main,/messages: 8/);
 const contract=read('skills/estimator/references/job-contract.md');assert.equal(contract,read('skills/estimator-orchestration/references/job-contract.md'));assert.match(contract,/bare array/);assert.match(contract,/jobId/);assert.match(contract,/replay/i);
 assert.match(read('skills/estimator-orchestration/SKILL.md'),/No ad-hoc diagnostics/);
 assert.match(read('skills/estimator/references/setup.md'),/bootstrap --workspace/);
 assert.match(contract,/Cached|cached/);assert.match(contract,/flow command constructs immutable job JSON/);
 for(const file of ['agents/estimator.md','skills/estimator/SKILL.md','skills/estimator-orchestration/SKILL.md','prompts/start.md']){
  assert.doesNotMatch(read(file),/Have Developer|Developer owns technical|fresh Developer|Do not.*run technical scripts|Coordinate only/);
 }
 assert.match(read('skills/estimator/references/context-budget.md'),/not provider token ceilings/);
 assert.match(read('skills/estimator-orchestration/SKILL.md'),/Inline-only output has no implicit file handle/);
});
test('resume instructions distinguish flow IDs from visual assignments and avoid history or missing files',()=>{
 const contract=read('skills/estimator/references/job-contract.md');
 assert.match(contract,/operationId.*batchId.*requestId.*jobId/s);
 assert.match(contract,/saved evidence revision/);
 assert.doesNotMatch(contract,/flow[^\n]*--id (?:prepare|settle)-001/);
 assert.match(contract,/only a fresh visual-batches reservation supplies a writable per-attempt resultFile/);
 const context=read('skills/estimator/references/context-budget.md');
 assert.match(context,/URL-only JSON/);assert.doesNotMatch(context,/Save complete Firecrawl output/);
 const commands=read('skills/estimator/references/commands.md');
 assert.match(commands,/next\/status.*NOT a worker assignment/);
 assert.match(read('skills/estimator/references/outputs.md'),/execution-notes\.json \(optional\)/);
 const estimation=read('skills/estimator/references/estimation.md');
 assert.match(estimation,/without loading the full request\.json/);
 assert.match(read('skills/estimator/references/handoff-contract.md'),/Do not have the orchestrator inspect images/);
 assert.match(read('skills/estimator/scripts/lib/quality.mjs'),/reserve targeted Visual Analysis corrections/);
});

test('all component types retain identifiable partial renders without adding another model pass',()=>{
 const worker=read('skills/estimator-visual-analysis/SKILL.md');assert.match(worker,/ANY identifiable section or inner component/);assert.match(worker,/nonblocking/);
 assert.match(read('agents/visual-analysis.md'),/Missing website images\/text\/icons inside an identifiable component are nonblocking/);
 assert.match(read('skills/estimator-orchestration/SKILL.md'),/no automatic recapture, corrective worker, user question or retry/);
 assert.match(read('skills/estimator/scripts/lib/analysis-contract.mjs'),/Partial rendering is nonblocking for EVERY identifiable Section\/Inner component/);
 assert.match(read('skills/estimator/references/estimation.md'),/remains in the unique list and estimate/);
});

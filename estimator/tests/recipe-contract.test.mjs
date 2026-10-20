import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const list=(text,key)=>[...text.match(new RegExp(`^${key}: (.+)$`,'m'))[1].matchAll(/['"]([^'"]+)['"]/g)].map(m=>m[1]);
test('canonical package has native final frontmatter and no pre-seeded workflow',()=>{
 assert.equal(JSON.parse(read('.kajoo/recipe.json')).name,'Estimator 2.0.0');
 assert(!fs.existsSync(path.join(root,'.kajoo/workflow.json')));
 assert(!fs.existsSync(path.join(root,'workflow.json')));
 assert.match(read('.gitignore'),/!skills\/estimator\/scripts\/package-lock\.json/,'Locked runtime dependencies must survive recipe publication');
 const agent=read('agents/estimator.md');assert.doesNotMatch(agent,/^kajoo:/m);
 assert.deepEqual(list(agent,'skills'),['estimator','managing-kajoo-tasks']);
 for(const tool of ['get-workspace','create-epic','update-epic','list-epics','list-tasks','get-task','create-task','update-task'])assert(list(agent,'tools').includes(`kajoo/${tool}`),tool);
 assert(agent.length<4500,'Detailed procedures belong in skills');
});
test('task procedure creates ordered records at runtime, reconciles uncertain writes and resumes IDs',()=>{
 const skill=read('skills/estimator/SKILL.md'),procedure=read('skills/estimator/references/task-workflow.md');
 assert.match(skill,/task-workflow\.md/);assert.match(skill,/managing-kajoo-tasks/);
 for(const term of ['sessionId','projectId','epicId','taskId','rank','uncertain','read back','reconcile','discovery-checkpoint.json','browser-stop.json','same IDs','No phase-continuation'])assert(procedure.includes(term),term);
 const plan=JSON.parse(read('skills/estimator/assets/task-plan.json'));
 assert.equal(plan.tasks.length,4);assert.deepEqual(plan.tasks.map(t=>t.rank),[1000,2000,3000,4000]);
 assert(plan.tasks.every(t=>t.acceptance.length&&t.key&&t.title));
 const template=JSON.parse(read('skills/estimator/assets/task-bindings.example.json'));
 assert.equal(template.epicId,null);assert.equal(template.runDir,null);assert.equal(template.tasks.prepare.taskId,null);
 assert(!JSON.stringify(template).includes('"status"'),'Bindings are not a competing task status authority');
});
test('native path/tool contract preserves read-only resources and writable runtime',()=>{
 const setup=read('skills/estimator/references/setup.md');
 for(const text of ['advertised SKILL.md','read','bash','read-only','/workspace/estimator-runtime/estimator','CEST_RUNS_DIR','npm ci --ignore-scripts'])assert(setup.includes(text),text);
 assert.match(read('skills/estimator/references/commands.md'),/cest\.mjs/);
 assert.deepEqual(JSON.parse(read('skills/estimator/settings.json')).viewports,['desktop']);
 assert(!fs.existsSync(path.join(root,'skills/estimator/app')));
 assert(!fs.existsSync(path.join(root,'skills/estimator/scripts/lib/openrouter.mjs')));
});
test('shared lifecycle skill matches v3 and all skill reference links resolve',()=>{
 const shared=read('skills/managing-kajoo-tasks/SKILL.md');
 assert.equal(shared,fs.readFileSync(new URL('../../sitecore-migration-v3/skills/managing-kajoo-tasks/SKILL.md',import.meta.url),'utf8'));
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
 for(const file of walk(path.join(root,'skills')).filter(p=>p.endsWith('.md'))){
  for(const [,link] of fs.readFileSync(file,'utf8').matchAll(/\]\(([^)]+)\)/g)){
   if(/^(https?:|#)/.test(link))continue;
   assert(fs.existsSync(path.resolve(path.dirname(file),link.split('#')[0])),`${file}: ${link}`);
  }
 }
});

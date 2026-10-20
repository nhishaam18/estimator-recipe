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
 assert.deepEqual(list(agent,'skills'),['estimator']);
 assert(list(agent,'tools').includes('firecrawl/firecrawl_map'));
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

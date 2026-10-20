import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateHandoff} from '../validate-handoff.mjs';
const cli=fileURLToPath(new URL('../cest.mjs',import.meta.url));
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r));
const close=s=>new Promise(r=>s.close(r));
const exists=async f=>!!await fs.stat(f).catch(()=>null);
function call(args,env){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[cli,...args],{env:{...process.env,...env}});let out='',err='';
 child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);
 child.on('close',code=>{let json;try{json=JSON.parse(out.trim().split('\n').at(-1));}catch{}resolve({code,json,out,err});});
});}
test('portable setup needs no provider key or config file and omits installed packages/app/private files',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wcd-setup-'));
 try{
  const first=await call(['setup','--workspace',root],{});assert.equal(first.code,0,first.out+first.err);
  const {runtime}=first.json;assert.equal(first.json.modelExecution,'kajoo-platform');assert.equal(first.json.envFile,undefined);
  const again=await call(['setup','--workspace',root],{});assert.equal(again.code,0);
  assert(!await exists(path.join(root,'website-discovery-config')));assert(!await exists(path.join(runtime,'scripts/node_modules')));assert(!await exists(path.join(runtime,'app')));
  assert(!await exists(path.join(runtime,'scripts/lib/openrouter.mjs')));
  assert(await exists(path.join(runtime,'SKILL.md'))&&await exists(path.join(runtime,'scripts/package-lock.json')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('URL-list discovery imports Kajoo results and writes granular styled handoff without a provider client',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'wcd-cli-'));let pageCalls=0;const visited=[];
 const html=`<!doctype html><style>*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif}header{height:80px}#hero{height:180px;padding:20px;background:#eee}#team{height:260px;position:relative}#team>h2{margin:0;position:absolute;top:10px;left:20px}.team-card{position:absolute;top:60px;left:20px;width:140px;height:160px;padding:8px;border:1px solid #ccc}.team-card.second{left:190px}.team-card img{width:40px;height:40px}.team-card h3{font-size:20px;line-height:24px;font-weight:700;margin:0}.team-card p{margin:0}#slider{height:200px;position:relative}.swiper-slide{position:absolute;top:20px;left:20px;width:140px;height:140px}.swiper-slide.second{left:190px}footer{height:120px;padding:10px}@media(max-width:600px){.team-card h3{font-size:16px;line-height:20px}}</style><header><nav><a href="/one">Home</a><a href="/ignored">Ignored route</a></nav></header><section id="hero"><h1>Our people</h1><p>Exact hero copy</p><a href="/ignored">Meet the team</a></section><section id="team"><h2>Team</h2><div class="team-card"><img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='red'/%3E%3C/svg%3E" alt="Ada portrait"><h3>Ada</h3><p>Engineer</p><a href="https://social.invalid/ada">Profile</a></div><div class="team-card second"><h3>Grace</h3><p>Architect</p><a href="https://social.invalid/grace">Profile</a></div></section><section id="slider" class="swiper"><div class="swiper-slide"><h3>First slide</h3><p>First body</p><a href="/ignored">More</a></div><div class="swiper-slide second"><h3>Second slide</h3><p>Second body</p><a href="/ignored">More</a></div></section><footer><div><h3>Company</h3><a href="/one">About</a><a href="/ignored">Contact</a></div></footer>`;
 const site=createServer((req,res)=>{visited.push(req.url);pageCalls++;res.setHeader('content-type','text/html');res.end(html);});
 const fixtureResult=request=>{
  const W=request.tile.imageWidth,H=request.tile.imageHeight;
  const c=(id,name,level,parent,b,contains=[])=>({id,name,level,parent,box:b,contains,reusable:true,repeated:level===2});
  const components=[c('S1','Header',1,null,[0,0,80,W]),c('S2','Hero',1,null,[80,0,260,W]),c('S3','Team Grid',1,null,[260,0,520,W]),c('S3_I1','Team Card',2,'S3',[320,20,480,160],['portrait','name','role','social link']),c('S3_I2','Team Card',2,'S3',[320,190,480,330]),c('S4','Slider',1,null,[520,0,720,W]),c('S4_I1','Slider Item',2,'S4',[540,20,680,160]),c('S4_I2','Slider Item',2,'S4',[540,190,680,330]),c('S5','Footer',1,null,[720,0,840,W])];
  return {coordinate_space:{width:1000,height:1000},components:components.map(c=>({...c,box:[c.box[0]/H*1000,c.box[1]/W*1000,c.box[2]/H*1000,c.box[3]/W*1000]})),inspection:{imageHash:request.imageHash,viewport:request.viewport,tileIndex:request.tile.index,summary:'Inspected fixture screenshot of header, hero, team, slider and footer.'}};
 };
 try{
  await listen(site);
  const base=`http://127.0.0.1:${site.address().port}`,urls=path.join(root,'urls.txt');await fs.writeFile(urls,base+'/one\n'+base+'/two\n');
  const env={WCD_RUNS_DIR:path.join(root,'runs')};
  const init=await call(['init','--urls-file',urls],env);assert.equal(init.code,0,init.out+init.err);assert.equal(init.json.modelExecution,'kajoo-platform');
  const id=init.json.runId,folder=init.json.runDir;
  const partial=await call(['all','--run',id],env);assert.equal(partial.code,0,partial.out+partial.err);assert.equal(partial.json.status,'awaiting-analysis');assert(partial.json.pending>0);
  assert(!await exists(path.join(folder,'export/discovery.json')),'all awaits the agent analysis loop before producing a final report');
  assert(!JSON.parse(await fs.readFile(path.join(folder,'discovery-checkpoint.json'),'utf8')).completed.includes('detect'),'pending Kajoo analysis remains resumable');
  const requestManifest=JSON.parse(await fs.readFile(path.join(folder,partial.json.manifest),'utf8'));
  for(const request of requestManifest.requests){
   const full=JSON.parse(await fs.readFile(path.join(folder,request.requestFile),'utf8'));
   assert.match(await fs.readFile(path.join(folder,request.promptFile),'utf8'),/granularity level 2/);
   const resultFile=path.join(root,'fixture-kajoo-result.json');await fs.writeFile(resultFile,JSON.stringify(fixtureResult(full)));
   const imported=await call(['import-result','--run',id,'--request',request.id,'--result-file',resultFile,'--model','fixture-kajoo-model','--trace-id','fixture-trace'],env);
   assert.equal(imported.code,0,imported.out+imported.err);
  }
  const viewsBeforeResume=pageCalls;
  const all=await call(['all','--run',id],env);assert.equal(all.code,0,all.out+all.err);assert.ok(['provisional','needs-reanalysis'].includes(all.json.status),all.out);
  assert.equal(pageCalls,viewsBeforeResume,'resuming after native model analysis reuses saved captures');
  const output=JSON.parse(await fs.readFile(path.join(folder,'export/discovery.json'),'utf8'));
  assert(output.families.some(f=>f.name==='Team Card'));assert(output.families.some(f=>f.name==='Slider Item'));
  const title=output.elements.find(e=>e.observedText==='Ada'&&e.role==='heading'&&e.computedStyle);
  assert(title);assert.match(title.computedStyle['font-family'],/Arial/);assert.equal(title.computedStyle['font-size'],'20px');
  assert(output.captures.every(c=>c.viewport==='desktop'));
  assert(!output.families.some(f=>/portrait|profile|Engineer|Ada/.test(f.name)));
  assert(output.elements.some(e=>e.role==='image'));assert(output.elements.some(e=>e.role==='link'));
  assert(!visited.some(u=>u.startsWith('/ignored')),'provided URL list never expands into a crawl');
  assert(output.captures.some(c=>c.paths.annotated));
  assert(output.annotationItems.some(a=>a.kind==='action'&&a.annotationOnly));
  assert(output.annotationItems.some(a=>a.ownerId));
  assert(output.annotationItems.every(a=>/^(R|I|G|CTA)\d+$/.test(a.displayId)));
  const capture=output.captures.find(c=>c.paths.annotationData);
  const ledgerPath=path.join(folder,capture.paths.annotationData),ledgerBytes=await fs.readFile(ledgerPath),ledger=JSON.parse(ledgerBytes);
  assert.match(ledger.scope,/do not create CMS types/);
  const manifest=JSON.parse(await fs.readFile(path.join(folder,'export/file-manifest.json'),'utf8'));
  assert(JSON.stringify(manifest).includes(capture.paths.annotationData));
  assert(JSON.stringify(manifest).includes(capture.paths.annotated));
  const views=pageCalls;const again=await call(['all','--run',id],env);assert.equal(again.code,0);assert.equal(again.json.status,all.json.status);assert.equal(pageCalls,views);
  const report=await call(['report','--run',id],env);assert.equal(report.code,0,report.out+report.err);
  const state=JSON.parse(await fs.readFile(path.join(folder,'run.json'),'utf8'));assert.equal(state.usage.available,false);assert.equal(state.usage.costUsd,null);
  await fs.writeFile(path.join(folder,'discovery.lock'),'interrupted');const locked=await call(['detect','--run',id],env);assert.equal(locked.code,2);await fs.unlink(path.join(folder,'discovery.lock'));
  const content=await fs.readFile(path.join(folder,output.families.find(f=>f.name==='Team Card').report),'utf8');assert.match(content,/Typography|typography/);assert.match(content,/Font/);assert.match(content,/Arial/);assert.match(content,/Ada/);assert.match(content,/Proposed structure and fields/);
  const validation=await validateHandoff(folder);assert.equal(validation.status,'valid',JSON.stringify(validation));
  const badAnnotations=structuredClone(output);badAnnotations.annotationItems[0].ownerId=badAnnotations.annotationItems[0].id;
  await fs.writeFile(path.join(folder,'export/discovery.json'),JSON.stringify(badAnnotations));
  assert((await validateHandoff(folder)).errors.some(e=>e.includes('Annotation cycle')));
  await fs.writeFile(path.join(folder,'export/discovery.json'),JSON.stringify(output));
  const changedLedger=structuredClone(ledger);changedLedger.source.evidenceSha256='outdated';
  await fs.writeFile(ledgerPath,JSON.stringify(changedLedger));
  const {exportHandoff}=await import('../lib/handoff.mjs');
  const oldRunsDir=process.env.CEST_RUNS_DIR;process.env.CEST_RUNS_DIR=env.WCD_RUNS_DIR;
  try{await assert.rejects(exportHandoff(id),/Annotation ledger does not match/);}finally{if(oldRunsDir===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=oldRunsDir;}
  await fs.writeFile(ledgerPath,ledgerBytes);
  const teamFamily=output.families.find(f=>f.name==='Team Card');
  const appendixPath=path.join(folder,teamFamily.evidenceReport),appendixBytes=await fs.readFile(appendixPath);
  await fs.unlink(appendixPath);assert.equal((await validateHandoff(folder)).status,'invalid','missing evidence appendix is rejected');
  await fs.writeFile(appendixPath,appendixBytes);
  assert(await exists(path.join(folder,'export/quality.json')));
  const badProposal=structuredClone(output);badProposal.occurrences.find(o=>o.modelProposal.fields.some(f=>f.evidenceElementIds.length)).modelProposal.fields.find(f=>f.evidenceElementIds.length).evidenceElementIds.push('missing-evidence');
  await fs.writeFile(path.join(folder,'export/discovery.json'),JSON.stringify(badProposal));
  assert((await validateHandoff(folder)).errors.some(e=>e.includes('Invalid field evidence')));
  const cycle=JSON.parse(await fs.readFile(path.join(folder,'export/discovery.json'),'utf8'));cycle.elements[0].parentElementId=cycle.elements[0].id;await fs.writeFile(path.join(folder,'export/discovery.json'),JSON.stringify(cycle));
  assert((await validateHandoff(folder)).errors.some(e=>e.includes('Element cycle')));
  await fs.writeFile(path.join(folder,'export/discovery.json'),JSON.stringify(output));
  const final=JSON.parse(await fs.readFile(path.join(folder,'export/discovery.json'),'utf8'));final.elements[0].ownerOccurrenceId='missing';await fs.writeFile(path.join(folder,'export/discovery.json'),JSON.stringify(final));
  assert.equal((await validateHandoff(folder)).status,'invalid','broken ownership is rejected');
 }finally{await close(site);await fs.rm(root,{recursive:true,force:true});}
});



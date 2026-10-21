#!/usr/bin/env node
// CMS-neutral entrypoint. Large evidence stays on disk; stdout is a compact receipt.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const skill=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageVersion=JSON.parse(await fs.readFile(path.join(skill,'scripts/package.json'),'utf8')).version;
const [command,...argv]=process.argv.slice(2), args={};
for(let i=0;i<argv.length;i++){
 if(!argv[i].startsWith('--'))throw new Error('Options must start with --');
 const key=argv[i].slice(2);if(Object.hasOwn(args,key))throw new Error(`Duplicate --${key}`);
 args[key]=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true;
}
if(process.env.WCD_RUNS_DIR)process.env.CEST_RUNS_DIR=process.env.WCD_RUNS_DIR;
if(args['runs-dir'])process.env.CEST_RUNS_DIR=path.resolve(args['runs-dir']);
const print=value=>process.stdout.write(JSON.stringify(value)+'\n');
const help={commands:['setup --workspace <writable folder>','verify','init --selection <approved Firecrawl plan folder> [--name <name>]','scan | group | capture | detect | report --run <ID or absolute run folder>','import-result --run <ID or folder> --request <request ID> --result-file <saved JSON> [--model <actual Kajoo model name>] [--trace-id <trace>]','all --run <ID or folder> [--through group|capture|detect|report] [--minutes 4]','plan --url <seed> --discovery-file <saved Firecrawl JSON>','select --plan <folder> --quotas-file <user choices JSON>','consolidate | estimate --run <folder>','import-consolidation | import-estimates --run <folder> --result-file <JSON>','merge --run <folder> --keys-file <JSON array> --name <label>','reset-merges --run <folder>','status --run <ID or folder>'],scope:'The Kajoo skill always obtains a saved Firecrawl Map response, groups it and freezes approved sample quantities; scripts process the selected URLs and prepare/import screenshot analysis; the configured Kajoo agent performs model reasoning. No direct model API, provider key, CMS mutation or code generation.'};
help.commands.push('next --run <ID or folder> (compact saved checkpoint and one next packet)');
help.commands.push('batch --run <folder> [--retry-request <id> --retry-kind transient|correction] [--correction-request <id>]', 'settle-batch --run <folder> --batch <id> --outcomes-file <JSON>', 'assemble-estimates --run <folder> --parts-file <JSON array of run-relative fragment paths>');
async function setup(){
 if(typeof args.workspace!=='string')throw new Error('setup requires --workspace <writable folder>');
 const workspace=path.resolve(args.workspace),runtime=path.join(workspace,'estimator-runtime','estimator');
 if(runtime===skill||runtime.startsWith(skill+path.sep))throw new Error('Choose a workspace outside the packaged skill to avoid recursive copying');
 await fs.mkdir(path.dirname(runtime),{recursive:true});
 await fs.cp(skill,runtime,{recursive:true,filter:file=>!path.relative(skill,file).split(path.sep).some(s=>['node_modules','.git','.env','.env.local'].includes(s))});
 return {status:'ok',version:packageVersion,runtime,runsDir:path.join(workspace,'estimator'),modelExecution:'kajoo-platform',next:'Run npm ci --ignore-scripts in runtime/scripts, then verify. Use the destination Kajoo agent with image-capable model and image-reading/file tools. No provider key file is created.'};
}
async function main(){
 if(!command||command==='help'){print(help);return;}
 if(command==='setup'){print(await setup());return;}
 const {loadSkillSettings}=await import('./lib/config.mjs');
 const store=await import('./lib/store.mjs');
 const {newJob}=await import('./lib/jobs.mjs');
 const types=await import('./lib/types.mjs');
 if(command==='verify'){
  const [major,minor]=process.versions.node.split('.').map(Number);if(major<20||major===20&&minor<9)throw new Error('Node 20.9 or newer is required');
  const {resolveBrowserRuntime,launchBrowser}=await import('./lib/browser.mjs');const runtime=resolveBrowserRuntime();
  const {default:sharp}=await import('sharp');await sharp({create:{width:2,height:2,channels:3,background:'#fff'}}).png().toBuffer();
  const browser=await launchBrowser();await browser.close();
  print({status:'ok',version:packageVersion,browser:'preinstalled launch verified',playwrightVersion:runtime.version,modelExecution:'kajoo-platform',modelCapability:'The host agent must support image input; script verification does not exercise its model.'});return;
 }
 if(command==='plan'){
  if(typeof args.url!=='string'||typeof args['discovery-file']!=='string')throw new Error('plan requires --url and --discovery-file');
  const {persistPlan,planSummary}=await import('./lib/urlplanstore.mjs');const {plan,folder}=await persistPlan(args.url,args['discovery-file']);print({status:'awaiting-selection',planDir:folder,...planSummary(plan)});return;
 }
 if(command==='select'){
  if(typeof args.plan!=='string'||typeof args['quotas-file']!=='string')throw new Error('select requires --plan and --quotas-file');
  const {persistSelection,planSummary}=await import('./lib/urlplanstore.mjs');const {plan,selection,resumed}=await persistSelection(path.resolve(args.plan),args['quotas-file']);print({status:'selected',...planSummary(plan),selected:selection.selectedUrls.length,deferred:selection.deferredCount,resumed});return;
 }
 if(command==='init'){
  if(args.selection&&args['urls-file'])throw new Error('Choose --selection or --urls-file');
  if(typeof args['urls-file']!=='string'&&typeof args.selection!=='string')throw new Error('Supply --urls-file or approved --selection');
  let selected;
  if(typeof args.selection==='string')selected=await (await import('./lib/urlplanstore.mjs')).readSelectedPlan(path.resolve(args.selection));
  const {parseUrlList}=await import('./lib/intake.mjs');
  const {urls,invalid}=selected?{urls:selected.selection.selectedUrls,invalid:[]}:parseUrlList(await fs.readFile(path.resolve(args['urls-file']),'utf8'));
  if(invalid.length||!urls.length)throw new Error('URL list is empty or contains invalid entries; correct the input file');
  if(urls.some(u=>{const v=new URL(u);return v.username||v.password||[...v.searchParams.keys()].some(k=>/^(?:token|access_token|api_?key|secret|password|signature|x-amz-credential|x-amz-signature)$/i.test(k));}))throw new Error('Do not include credential-bearing URLs in discovery input');
  if(args.model!==undefined)throw new Error('Select the agent model in Kajoo; init does not choose or call a provider model');
  const settings=loadSkillSettings();
  const viewports=typeof args.viewports==='string'?args.viewports.split(','):settings.viewports;
  if(JSON.stringify(viewports)!=='["desktop"]')throw new Error('Viewports must be unique supported names: desktop');
  const initialize=async()=>{
   const plans=await import('./lib/urlplanstore.mjs');
   const bindingFile=selected?path.join(path.resolve(args.selection),'run-binding.json'):null;
   if(selected){
    const fresh=await plans.readSelectedPlan(path.resolve(args.selection));if(fresh.selection.selectionDigest!==selected.selection.selectionDigest)throw new Error('Selection changed during init');
    const binding=await store.readJson(bindingFile,null);
    if(binding){
     if(binding.selectionDigest!==selected.selection.selectionDigest||typeof binding.runDir!=='string')throw new Error('Invalid saved selection binding');
     process.env.CEST_RUNS_DIR=path.dirname(binding.runDir);const run=await store.getRun(path.basename(binding.runDir));
     if(JSON.stringify(run.urls)!==JSON.stringify(urls)||JSON.stringify(run.pages.map(p=>p.url))!==JSON.stringify(urls))throw new Error('Bound run differs from approved sample');
     const saved=await store.readJson(store.inRun(run.id,'input/url-selection.json'),null);if(saved&&JSON.stringify(saved)!==JSON.stringify(selected.selection))throw new Error('Bound run selection changed');
     await store.writeJson(store.inRun(run.id,'input/url-selection.json'),selected.selection);await store.writeJson(store.inRun(run.id,'input/url-plan.json'),selected.plan);
     return {run,resumed:true};
    }
   }
   const run=await store.createRun({urls,name:typeof args.name==='string'?args.name:undefined,viewports,mode:'compare-first',settings});
   if(selected){await plans.writePlanJson(bindingFile,{selectionDigest:selected.selection.selectionDigest,runDir:store.runDir(run.id)});await store.writeJson(store.inRun(run.id,'input/url-plan.json'),selected.plan);await store.writeJson(store.inRun(run.id,'input/url-selection.json'),selected.selection);}
   await store.writeJson(store.inRun(run.id,'input/urls.json'),{source:selected?'approved discovery sample':'explicit supplied list',urls,discoveryTool:selected?'user-requested discovery; see saved plan':null});
   return {run,resumed:false};
  };
  const {run,resumed}=selected?await (await import('./lib/urlplanstore.mjs')).withPlanLock(path.resolve(args.selection),initialize):await initialize();
  print({status:'ok',runId:run.id,runDir:store.runDir(run.id),urls:urls.length,viewports,resumed,modelExecution:'kajoo-platform',usage:'unavailable to scripts; use Kajoo trace/usage records'});return;
 }
 if(typeof args.run!=='string')throw new Error('--run is required');
 let id=args.run;if(/[\\/]/.test(id)){const folder=path.resolve(id);process.env.CEST_RUNS_DIR=path.dirname(folder);id=path.basename(folder);}
 const estimateCommands=['consolidate','import-consolidation','estimate','import-estimates','assemble-estimates','merge','reset-merges'];
 const batchCommands=['batch','settle-batch'];
 await store.getRun(id); // Reject legacy/mixed viewport runs before any mutation.
 if(command==='status'||command==='next'){
  print(await (await import('./lib/work-state.mjs')).saveWorkState(id));return;
 }
 if(!batchCommands.includes(command)&&await store.exists(store.inRun(id,'visual-batches/active.json')))throw new Error('Visual batch still reserved; reconcile/settle it before mutating shared run files');
 const stages=['scan','group','capture','detect','report'];
 if(!stages.includes(command)&&command!=='all'&&command!=='import-result'&&!estimateCommands.includes(command)&&!batchCommands.includes(command))throw new Error('Unknown command; use help');
 const through=typeof args.through==='string'?args.through:'report';if(!stages.includes(through))throw new Error('Invalid --through stage');
 const minutes=Number(args.minutes??4);if(!Number.isFinite(minutes)||minutes<=0)throw new Error('--minutes must be positive');
 const lock=store.inRun(id,'discovery.lock');let handle;
 try{handle=await fs.open(lock,'wx');await handle.writeFile(JSON.stringify({pid:process.pid,at:new Date().toISOString()}));}
 catch(e){if(e.code==='EEXIST')throw new Error('Another operation or interrupted lock exists. Check discovery.lock and confirm the owner exited before removing that lock; never run overlapping detection.');throw e;}
 try{
  await fs.rm(store.inRun(id,'execution-error.json'),{force:true});
  if(batchCommands.includes(command)){
   const batches=await import('./lib/visual-batches.mjs');
   if(command==='settle-batch'&&(typeof args.batch!=='string'||typeof args['outcomes-file']!=='string'))throw new Error('settle-batch requires --batch and --outcomes-file');
   if(command==='batch')print(await batches.reserveBatch(id,{retryRequest:args['retry-request'],correctionRequest:args['correction-request'],retryKind:args['retry-kind']??'transient'}));
   else {const file=path.resolve(args['outcomes-file']);if((await fs.stat(file)).size>64000)throw new Error('Batch outcomes exceed 64 KB');print(await batches.settleBatch(id,args.batch,JSON.parse(await fs.readFile(file,'utf8'))));}
   return;
  }
  if(estimateCommands.includes(command)){
   const operations=await import('./lib/estimation.mjs');print(await operations.execute(id,command,args));return;
  }
  if(args['retry-browser']===true)await fs.rm(store.inRun(id,'browser-stop.json'),{force:true});
  if(command==='import-result'){
   if(typeof args.request!=='string'||typeof args['result-file']!=='string')throw new Error('import-result requires --request and --result-file');
   if(args.replace!==undefined&&args.replace!==true)throw new Error('--replace is a flag without a value');
   const imported=await (await import('./lib/detect.mjs')).importDetection(id,args.request,path.resolve(args['result-file']),{model:typeof args.model==='string'?args.model:undefined,traceId:typeof args['trace-id']==='string'?args['trace-id']:undefined},{replace:args.replace===true});
   const checkpoint=await store.readJson(store.inRun(id,'discovery-checkpoint.json'),{completed:[]});checkpoint.completed=checkpoint.completed.filter(s=>!['detect','report'].includes(s));await store.writeJson(store.inRun(id,'discovery-checkpoint.json'),checkpoint);
   print(imported);return;
  }
  const checkpoint=await store.readJson(store.inRun(id,'discovery-checkpoint.json'),{completed:[]});
  if(command==='all'&&checkpoint.completed.includes('detect')){
   const current=await (await import('./lib/detect.mjs')).prepareDetection(id);
   if(current.status!=='complete')checkpoint.completed=checkpoint.completed.filter(s=>!['detect','report'].includes(s));
  }
  if(!await store.exists(store.inRun(id,'export/discovery.json'))||!await store.exists(store.inRun(id,'export/report.md'))) checkpoint.completed=checkpoint.completed.filter(s=>s!=='report');
  const requested=command==='all'?stages.slice(0,stages.indexOf(through)+1):[command];
  const receipts=[];let partial=false;
  const deadline=Date.now()+minutes*60000;
  for(const stage of requested){
   if(command==='all'&&checkpoint.completed.includes(stage))continue;
   if(Date.now()>=deadline){partial=true;break;}
   checkpoint.completed=checkpoint.completed.filter(s=>stages.indexOf(s)<stages.indexOf(stage));
   await store.writeJson(store.inRun(id,'discovery-checkpoint.json'),checkpoint);
   const run=await store.getRun(id),job=newJob();job.deadline=deadline;
   if(['scan','capture'].includes(stage)){
    const stopped=await store.readJson(store.inRun(id,'browser-stop.json'),null);
    if(stopped){print({status:'blocked',reason:stopped.reason,next:'Inspect the failure before an explicit --retry-browser'});return;}
   }
   if(stage==='scan'){await (await import('./lib/capture.mjs')).scanRun(id,job);}
   if(job.stopReason){print({status:'blocked',reason:job.stopReason});return;}
   if(job.cancelRequested||job.timedOut){partial=true;break;}
   if(stage==='group'){
    if(!run.pages.some(p=>p.viewports[types.compareViewport(run.viewports)]?.status==='ok'))throw new Error('Run scan before group');
    const similarity=await (await import('./lib/similarity.mjs')).computeSimilarity(run,types.compareViewport(run.viewports),run.settings.threshold);
    await store.updateRun(id,r=>{r.selection=Object.fromEntries(r.viewports.map(v=>[v,similarity.selected.map(s=>s.url)]));});
   }
   if(stage==='capture'){
    const urls=[...new Set(Object.values(run.selection).flat())];if(!urls.length)throw new Error('Run group before capture');
    await (await import('./lib/capture.mjs')).captureRun(id,job,urls);
   }
   if(job.stopReason){print({status:'blocked',reason:job.stopReason});return;}
   if(job.cancelRequested||job.timedOut){partial=true;break;}
   if(stage==='detect'){
    if(!Object.values(run.selection).some(u=>u.length))throw new Error('Run group and capture before detect');
    const analysis=await (await import('./lib/detect.mjs')).prepareDetection(id);
    if(analysis.status==='awaiting-analysis'){
     print({...await (await import('./lib/work-state.mjs')).analysisReceipt(id,analysis),completed:checkpoint.completed});return;
    }
   }
   if(stage==='report'){
    const analysis=await (await import('./lib/detect.mjs')).prepareDetection(id);
    if(analysis.pending)throw new Error(`Report blocked: ${analysis.pending} screenshot analyses pending; use next and import-result, then resume. Do not restart capture.`);
    const {loadLlm}=await import('./lib/detect.mjs');
    let componentCount=0;
    for(const [vp,urls] of Object.entries(run.selection))for(const url of urls){const page=run.pages.find(p=>p.url===url);if(page)componentCount+=(await loadLlm(id,vp,page.slug))?.components.length??0;}
    if(!componentCount)throw new Error('Report blocked: all imported screenshot results are empty. Inspect saved tiles and correct affected results with import-result --replace; do not restart capture or claim a complete empty Build List.');
    const fresh=await store.getRun(id);const {buildPageData}=await import('./lib/pagedata.mjs');const {drawAnnotated}=await import('./lib/annotations.mjs');const {selectAnnotations}=await import('./lib/annotation-selection.mjs');
    for(const p of fresh.pages)for(const vp of fresh.viewports){
     if(p.viewports[vp]?.status!=='ok'||!types.hasShot(p.viewports[vp]))continue;
     const d=await buildPageData(id,vp,p.url);
     const html=await fs.readFile(store.inRun(id,`html/${vp}/${p.slug}.html`),'utf8');
     const rects=await store.readJson(store.inRun(id,`rects/${vp}/${p.slug}.json`),[]);
     const evidence=p.viewports[vp].evidence?.path?await store.readJson(store.inRun(id,p.viewports[vp].evidence.path),null):null;
     const screenshot=`shots/${vp}/${p.slug}.png`,png=await fs.readFile(store.inRun(id,screenshot));
     const {default:sharp}=await import('sharp');const {width,height}=await sharp(png).metadata();
     const selected=selectAnnotations({components:d.components,html,rects,width,height,evidence});
     const ledger={...selected,runId:id,url:p.url,viewport:vp,image:{width,height},source:{screenshot,sha256:createHash('sha256').update(png).digest('hex'),htmlSha256:createHash('sha256').update(html).digest('hex'),rectsSha256:createHash('sha256').update(JSON.stringify(rects)).digest('hex'),componentsSha256:createHash('sha256').update(JSON.stringify(d.components)).digest('hex'),evidenceSha256:createHash('sha256').update(JSON.stringify(evidence)).digest('hex')},scope:'Annotation boundaries only; additional boxes do not create CMS types or implementation families.'};
     await drawAnnotated(store.inRun(id,screenshot),ledger.items,store.inRun(id,`export/annotated/${vp}/${p.slug}.png`),{level1:true,level2:true,labels:true});
     await store.writeJson(store.inRun(id,`export/annotated/${vp}/${p.slug}.json`),ledger);
    }
    const exported=await (await import('./lib/handoff.mjs')).exportHandoff(id);
    if(!exported.summary.families)throw new Error('Report blocked: refinement produced an empty Build List. Inspect detections and validation in export/discovery.json and correct affected analysis; do not recapture successful pages or claim completion.');
    const data=await store.readJson(store.inRun(id,'export/discovery.json'));
    const quality=await (await import('./lib/quality.mjs')).assessQuality(data);
    await store.writeJson(store.inRun(id,'export/quality.json'),quality);
    const {escapeMarkdown}=await import('./lib/handoff.mjs');
    await fs.appendFile(store.inRun(id,'export/report.md'),`\n\n## Evidence quality\n\nStatus: ${quality.status}. Automated checks do not certify implementation readiness. See quality.json for affected captures, detection IDs and native request IDs.\n\n${quality.findings.map(f=>`- ${escapeMarkdown(f.code)}: ${escapeMarkdown(f.reason??`${f.count} affected records`)} (${escapeMarkdown(f.viewport??'all views')})`).join('\n')}\n`);
    exported.files.push('export/quality.json');
    await store.writeJson(store.inRun(id,'export/file-manifest.json'),{files:exported.files});
    receipts.push({stage,summary:exported.summary,quality:quality.status,qualityFile:'export/quality.json',reanalysisRequestIds:quality.reanalysisRequestIds,readyForImplementation:false,fileCount:exported.files.length,files:exported.files.slice(0,20),manifest:'export/file-manifest.json',truncated:exported.files.length>20});
   }else receipts.push({stage,done:job.done,total:job.total});
   const fresh=await store.getRun(id);
   const missing=stage==='capture'?fresh.pages.filter(p=>Object.values(fresh.selection).some(u=>u.includes(p.url))).some(p=>fresh.viewports.some(v=>p.viewports[v]?.status!=='ok'||!types.hasShot(p.viewports[v]))):false;
   if(job.timedOut){partial=true;break;}
   const scanMissing=stage==='scan'&&fresh.pages.some(p=>p.viewports[types.compareViewport(fresh.viewports)]?.status!=='ok');
   const detectMissing=stage==='detect'&&Object.entries(fresh.selection).some(([vp,urls])=>urls.some(url=>{const p=fresh.pages.find(p=>p.url===url);return !p||p.viewports[vp]?.status!=='ok'||!types.hasShot(p.viewports[vp]);}));
   if(missing||fresh.pages.some(p=>Object.values(p.viewports).some(v=>v.status==='failed')))partial=true;
   if(!missing&&!scanMissing&&!detectMissing&&!checkpoint.completed.includes(stage))checkpoint.completed.push(stage);
   checkpoint.updatedAt=new Date().toISOString();await store.writeJson(store.inRun(id,'discovery-checkpoint.json'),checkpoint);
  }
  if(checkpoint.completed.includes('report'))await (await import('./lib/estimation.mjs')).exportInventory(id);
  const quality=checkpoint.completed.includes('report')?await store.readJson(store.inRun(id,'export/quality.json'),null):null;
  print({status:partial?'partial':quality?.status??'ok',runId:id,completed:checkpoint.completed,stages:receipts,...(quality?{qualityFile:'export/quality.json',readyForImplementation:false}: {})});
 }catch(error){
  await store.writeJson(store.inRun(id,'execution-error.json'),{command,reason:error.message,at:new Date().toISOString()});
  throw error;
 }finally{
  await handle.close();await fs.unlink(lock);
  await (await import('./lib/work-state.mjs')).saveWorkState(id);
 }
}
await main().catch(error=>{print({status:'blocked',reason:error.message});process.exitCode=2;});

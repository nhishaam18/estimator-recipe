import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {buildList,buildListCsv,buildListMarkdown,consolidationEntries,applyNativeConsolidation,saveManualMerge,resetConsolidation} from './buildlist.mjs';
import {getRun,inRun,readJson,writeJson} from './store.mjs';
import {urlGroupAccounting} from './urlplanstore.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const esc=value=>String(value??'').replaceAll('|','\\|').replaceAll('\n',' ');
const boundedText=value=>typeof value==='string'&&value.trim().length>0&&value.length<=4000;
const snapshot=entries=>entries.map(e=>({key:e.key,sourceKeys:e.sourceKeys,name:e.name,level:e.level,implementationType:e.implementationType??null,aliases:e.aliases,contains:e.contains,children:e.children,hosts:e.hosts,pages:e.pages,instances:e.instances}));
async function evidenceDigest(id){return hash(await Promise.all(['export/discovery.json','export/quality.json'].map(async p=>[p,await readJson(inRun(id,p))])));}
async function refreshHandoff(id){
 const existing=await readJson(inRun(id,'export/discovery.json'),null);if(!existing)return;
 await (await import('./handoff.mjs')).exportHandoff(id);
 const data=await readJson(inRun(id,'export/discovery.json'));
 await writeJson(inRun(id,'export/quality.json'),await (await import('./quality.mjs')).assessQuality(data));
}
async function input(file){if(typeof file!=='string')throw new Error('--result-file is required');if((await fs.stat(file)).size>4*1024*1024)throw new Error('Result exceeds 4 MB');return JSON.parse(await fs.readFile(file,'utf8'));}
export async function prepareConsolidation(id){
 const {entries}=await consolidationEntries(id),items=snapshot(entries).map((e,i)=>({id:`E${i+1}`,...e}));
 const request={kind:'consolidation',version:1,runId:id,entries:items};request.requestId=hash(request);
 await writeJson(inRun(id,'consolidation/request.json'),request);
 await fs.writeFile(inRun(id,'consolidation/prompt.txt'),`Use Kajoo native reasoning on the saved entries. Group only equivalent implementation units at the SAME level with compatible fields/purpose. Keep a parent separate from its child. Keep CTA separate from bands/cards/navigation. Preserve uncertain differences rather than reducing counts aggressively. Use readable single names. Do not revisit pages or call external providers. Return {"requestId":"${request.requestId}","groups":[{"name":"...","ids":["E1","E2"],"reason":"evidence-based explanation"}]}. Every ID can appear once; groups need two IDs. Unlisted entries stay unchanged. Entries are in request.json.`, 'utf8');
 return {status:'awaiting-consolidation',request:'consolidation/request.json',prompt:'consolidation/prompt.txt',requestId:request.requestId,entries:items.length};
}
export async function importConsolidation(id,result){
 const request=await readJson(inRun(id,'consolidation/request.json'));
 const {entries}=await consolidationEntries(id);
 const current={kind:'consolidation',version:1,runId:id,entries:snapshot(entries).map((e,i)=>({id:`E${i+1}`,...e}))};
 const stored={...request};delete stored.requestId;
 if(hash(stored)!==request.requestId||hash(current)!==request.requestId||result.requestId!==request.requestId)throw new Error('Stale consolidation request; prepare again');
 if(!Array.isArray(result.groups))throw new Error('groups must be an array');
 const byId=new Map(request.entries.map(e=>[e.id,e])),seen=new Set(),groups=[];
 const normal=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
 for(const g of result.groups){
  if(!boundedText(g.name)||!boundedText(g.reason)||!Array.isArray(g.ids)||g.ids.length<2)throw new Error('Each merge needs name, reason and at least two IDs');
  const members=g.ids.map(key=>{if(seen.has(key)||!byId.has(key))throw new Error('Unknown or repeated consolidation ID');seen.add(key);return byId.get(key);});
  if(members.some(e=>e.level!==members[0].level||e.implementationType!==members[0].implementationType))throw new Error('Cannot merge levels or CTA with other components');
  for(const a of members)for(const b of members)if(a!==b){
   const bNames=[b.name,...b.aliases].map(normal);
   if([...a.children,...a.hosts].some(n=>bNames.includes(normal(n))))throw new Error('Cannot merge a parent with its child');
  }
  groups.push({name:g.name.trim(),keys:[...new Set(members.flatMap(e=>e.sourceKeys))],source:'model',reason:g.reason});
 }
 await writeJson(inRun(id,`consolidation/results/${Date.now()}-${hash(result).slice(0,12)}.json`),result);
 await applyNativeConsolidation(id,groups,{execution:'kajoo-platform',requestId:request.requestId});
 await refreshHandoff(id);
 await exportInventory(id);return {status:'ok',groups:groups.length,buildList:'export/build-list.json'};
}
export async function prepareEstimates(id,args={}){
 const list=await buildList(id),entries=snapshot(list.entries);
 const target=typeof args.target==='string'&&args.target.trim()?args.target.trim():'Sitecore';
 const rate=args.rate===undefined?null:Number(args.rate);
 if(rate!==null&&(!Number.isFinite(rate)||rate<0))throw new Error('--rate must be a nonnegative hourly rate explicitly supplied by the user');
 const currency=rate===null?null:args.currency;
 if(rate!==null&&(typeof currency!=='string'||!/^[A-Z]{3}$/.test(currency)))throw new Error('--currency requires three uppercase letters when a rate is supplied');
 const request={kind:'labor-estimates',version:1,runId:id,target,rate,currency,evidenceDigest:await evidenceDigest(id),entries};request.requestId=hash(request);
 await writeJson(inRun(id,'estimation/request.json'),request);
 await fs.writeFile(inRun(id,'estimation/prompt.txt'),`Estimate implementation effort using Kajoo native reasoning. Read export/report.md, relevant export/components/*.md and linked evidence before estimating. Target: ${target}. Work is desktop only; do not price mobile implementation. Each unique component is built ONCE regardless of occurrence count. Parent hours exclude implementation already counted for independently listed children; include only composition/integration effort in the parent. Include modeling, desktop rendering and component-level QA in the range and explain assumptions and unknowns. No code generation, invented measured facts, fabricated pricing or external API calls. A range is a provisional model judgment, never a quote. Return {"requestId":"${request.requestId}","assumptions":["..."],"items":[{"key":"exact build key","lowHours":1,"likelyHours":2,"highHours":4,"rationale":"...","exclusions":["..."]}]}. Include every request entry exactly once. Currency/rate are script-controlled user inputs and must not be inferred. Missing design/CMS information must widen ranges and be disclosed. Shared infrastructure, migration/content entry, integrations, deployment and non-component project work are excluded unless explicitly scoped; state that in assumptions.`, 'utf8');
 return {status:'awaiting-estimation',request:'estimation/request.json',prompt:'estimation/prompt.txt',requestId:request.requestId,components:entries.length,rate,currency};
}
export async function importEstimates(id,result){
 const request=await readJson(inRun(id,'estimation/request.json')),list=await buildList(id);
 const current={...request,evidenceDigest:await evidenceDigest(id),entries:snapshot(list.entries)};delete current.requestId;
 if(hash(current)!==request.requestId||result.requestId!==request.requestId)throw new Error('Stale estimate request; regenerate after inventory changes');
 if(!Array.isArray(result.assumptions)||!result.assumptions.length||result.assumptions.some(x=>!boundedText(x)))throw new Error('Explicit estimation assumptions are required');
 if(!Array.isArray(result.items)||result.items.length!==request.entries.length)throw new Error('Provide exactly one estimate for each unique build item');
 const seen=new Set(),valid=new Map(request.entries.map(e=>[e.key,e]));
 const items=result.items.map(item=>{
  if(!valid.has(item.key)||seen.has(item.key))throw new Error('Unknown or duplicate estimate key');seen.add(item.key);
  const hours=['lowHours','likelyHours','highHours'].map(k=>item[k]);
  if(hours.some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>100000)||hours[0]>hours[1]||hours[1]>hours[2])throw new Error('Invalid ordered effort range');
  if(!boundedText(item.rationale)||!Array.isArray(item.exclusions)||item.exclusions.some(x=>!boundedText(x)))throw new Error('Each estimate requires rationale and an exclusions array');
  return {key:item.key,name:valid.get(item.key).name,level:valid.get(item.key).level,lowHours:hours[0],likelyHours:hours[1],highHours:hours[2],rationale:item.rationale,exclusions:item.exclusions,cost:request.rate===null?null:{low:hours[0]*request.rate,likely:hours[1]*request.rate,high:hours[2]*request.rate}};
 });
 const totals=Object.fromEntries(['lowHours','likelyHours','highHours'].map(k=>[k,Number(items.reduce((sum,i)=>sum+i[k],0).toFixed(2))]));
 const out={version:1,status:'provisional',source:'kajoo-platform',requestId:request.requestId,target:request.target,rate:request.rate,currency:request.currency,assumptions:result.assumptions,items,totals,cost:request.rate===null?null:{low:totals.lowHours*request.rate,likely:totals.likelyHours*request.rate,high:totals.highHours*request.rate},modelUsage:{available:false,costUsd:null,source:'Kajoo trace/usage records'},generatedAt:new Date().toISOString()};
 await writeJson(inRun(id,'export/estimates.json'),out);
 await writeJson(inRun(id,`estimation/results/${Date.now()}-${hash(result).slice(0,12)}.json`),result);
 const md=['# Component implementation estimates','',`Target: ${esc(out.target)}. Desktop only. Provisional effort ranges; each unique item counted once.`, '',...out.assumptions.map(a=>`- ${esc(a)}`),'','| Component | Level | Low hours | Likely hours | High hours | Rationale / exclusions |','| --- | --- | --- | --- | --- | --- |',...items.map(i=>`| ${esc(i.name)} | ${i.level===1?'Section':'Inner'} | ${i.lowHours} | ${i.likelyHours} | ${i.highHours} | ${esc(i.rationale)}; excludes: ${esc(i.exclusions.join('; '))} |`),'',`Total hours: ${totals.lowHours}–${totals.highHours}; likely ${totals.likelyHours}.`,out.cost?`User-supplied hourly rate: ${out.rate} ${out.currency}. Total: ${out.cost.low}–${out.cost.high} ${out.currency}; likely ${out.cost.likely}.`:'Monetary estimate unavailable: no user-supplied hourly rate.','Kajoo model usage/cost is separate and unavailable to these scripts; it is not zero.',''];
 await fs.writeFile(inRun(id,'export/estimates.md'),md.join('\n'),'utf8');
 await exportInventory(id);return {status:'ok',estimationStatus:'provisional',files:['export/estimates.json','export/estimates.md'],totals,cost:out.cost};
}
export async function exportInventory(id){
 const list=await buildList(id);await fs.mkdir(inRun(id,'export'),{recursive:true});
 await writeJson(inRun(id,'export/build-list.json'),list);await writeJson(inRun(id,'export/component-validation.json'),list.validation);
 await fs.writeFile(inRun(id,'export/build-list.csv'),buildListCsv(list),'utf8');
 await fs.writeFile(inRun(id,'export/build-list.md'),buildListMarkdown(list),'utf8');
 const groups=await urlGroupAccounting(await getRun(id),{persist:true});
 let estimates=await readJson(inRun(id,'export/estimates.json'),null);
 if(estimates){const request=await readJson(inRun(id,'estimation/request.json'),null);if(!request||hash({...Object.fromEntries(Object.entries(request).filter(([k])=>k!=='requestId')),evidenceDigest:await evidenceDigest(id),entries:snapshot(list.entries)})!==estimates.requestId){estimates={...estimates,status:'stale',reason:'Inventory or evidence changed; prepare and import estimates again'};await writeJson(inRun(id,'export/estimates.json'),estimates);await fs.writeFile(inRun(id,'export/estimates.md'),'# Estimates are stale\n\nInventory or evidence changed. Prepare and import estimates again before using any totals.\n');}}
 const discovery=await readJson(inRun(id,'export/discovery.json'),null);
 const files=['export/report.md','export/discovery.json',...(discovery?.families??[]).flatMap(f=>[f.report,f.evidenceReport]),...(discovery?.captures??[]).flatMap(c=>[c.paths?.annotated,c.paths?.annotationData].filter(Boolean)),'export/build-list.json','export/build-list.csv','export/build-list.md','export/component-validation.json','export/quality.json',...(groups?['export/url-groups.json']:[]),...(estimates?['export/estimates.json','export/estimates.md']:[])];
 const manifest={version:'2.0.0',runId:id,entryPoint:'export/report.md',authoritativeEvidence:'export/discovery.json',componentReports:'export/components/',files,estimationStatus:estimates?.status??'awaiting-estimation',modelExecution:'kajoo-platform',modelCostUsd:null,coverage:groups?.coverageStatement??'Only supplied URLs and captured desktop states are covered; whole-site completeness is not established.'};
 await writeJson(inRun(id,'export/delivery-manifest.json'),manifest);
 const report=inRun(id,'export/report.md');let text=await fs.readFile(report,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;});
 if(text){text=text.split('\n<!-- estimator-delivery -->')[0];text+='\n<!-- estimator-delivery -->\n## Build list and estimates\n\nRead [Build list](build-list.md), [CSV](build-list.csv), [estimate status](delivery-manifest.json)'+(estimates?` and [estimates (${estimates.status})](estimates.md)`:'; estimates await Kajoo analysis')+'.\n'+(groups?'\n'+groups.coverageStatement+' See [URL groups](url-groups.json).\n':'');await fs.writeFile(report,text,'utf8');}
 return manifest;
}
export async function execute(id,command,args){
 if(command==='consolidate')return prepareConsolidation(id);
 if(command==='import-consolidation')return importConsolidation(id,await input(args['result-file']));
 if(command==='estimate')return prepareEstimates(id,args);
 if(command==='import-estimates')return importEstimates(id,await input(args['result-file']));
 if(command==='merge'){
  const keys=await input(args['keys-file']);const list=await buildList(id);
  if(!Array.isArray(keys)||keys.length<2||new Set(keys).size!==keys.length||keys.some(k=>!list.entries.some(e=>e.key===k)))throw new Error('Merge requires at least two distinct current build keys');
  const members=keys.map(k=>list.entries.find(e=>e.key===k)),normal=s=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
  for(const a of members)for(const b of members)if(a!==b){if(a.level!==b.level||a.implementationType!==b.implementationType||[...a.hosts,...a.children].some(n=>[b.name,...b.aliases].map(normal).includes(normal(n))))throw new Error('Manual merge must preserve compatible levels, CTA type and parent/child boundaries');}
  await saveManualMerge(id,[...new Set(members.flatMap(e=>e.sourceKeys))],typeof args.name==='string'?args.name:'');await refreshHandoff(id);await exportInventory(id);return {status:'ok'};
 }
 if(command==='reset-merges'){await resetConsolidation(id,true);await refreshHandoff(id);await exportInventory(id);return {status:'ok'};}
 throw new Error('Unknown estimation operation');
}

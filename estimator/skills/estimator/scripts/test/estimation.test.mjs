import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRun,inRun,writeJson,readJson,updateRun} from '../lib/store.mjs';
import {buildList} from '../lib/buildlist.mjs';
import {prepareConsolidation,importConsolidation,prepareEstimates,importEstimates,exportInventory,execute} from '../lib/estimation.mjs';
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'estimator2-'));process.env.CEST_RUNS_DIR=root;t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const run=await createRun({urls:['https://example.invalid/page'],name:'fixture',viewports:['desktop']});
 const names=['Feature A','Feature B','Feature C','Feature D'];
 const html=names.map((n,i)=>`<section id="s${i}"><h2>${n}</h2><p>Independent description</p></section>`).join('');
 await fs.mkdir(path.dirname(inRun(run.id,`html/desktop/${run.pages[0].slug}.html`)),{recursive:true});
 await fs.writeFile(inRun(run.id,`html/desktop/${run.pages[0].slug}.html`),html);
 const components=names.map((name,i)=>({id:`S${i+1}`,name,level:1,parent:null,contains:['heading','description'],reusable:false,repeated:false,box:{x:0,y:i*200,w:500,h:190}}));
 await writeJson(inRun(run.id,`rects/desktop/${run.pages[0].slug}.json`),components.map((c,i)=>({s:`#s${i}`,...c.box})));
 await writeJson(inRun(run.id,`llm/desktop/${run.pages[0].slug}.json`),{components,warnings:[],imageWidth:500,imageHeight:800});
 await updateRun(run.id,r=>{r.pages[0].viewports.desktop={status:'ok',shot:false,width:500,height:800};});
 await writeJson(inRun(run.id,'export/discovery.json'),{families:[],captures:[],synthetic:true});
 await writeJson(inRun(run.id,'export/quality.json'),{status:'provisional'});
 await fs.writeFile(inRun(run.id,'export/report.md'),'# Synthetic report');
 return run;
}
test('desktop is enforced at run creation and loaded run boundary',async t=>{
 const run=await fixture(t);await assert.rejects(createRun({urls:run.urls,viewports:['mobile']}),/desktop only/);
 await updateRun(run.id,r=>{r.viewports=['desktop','mobile'];});await assert.rejects(buildList(run.id),/desktop-only/);
});
test('effort is counted once per unique component and money requires explicit user rate',async t=>{
 const run=await fixture(t),prepared=await prepareEstimates(run.id),list=await buildList(run.id);
 assert.equal(list.entries.length,4);
 const result={requestId:prepared.requestId,assumptions:['Desktop components only; children excluded from parent implementation'],items:list.entries.map(e=>({key:e.key,lowHours:1,likelyHours:2,highHours:3,rationale:'Model judgment based on synthetic evidence',exclusions:['Content migration']}))};
 const done=await importEstimates(run.id,result);assert.equal(done.cost,null);assert.deepEqual(done.totals,{lowHours:4,likelyHours:8,highHours:12});
 const paid=await prepareEstimates(run.id,{rate:50,currency:'USD',target:'CMS-neutral'});await importEstimates(run.id,{...result,requestId:paid.requestId});
 assert.deepEqual((await readJson(inRun(run.id,'export/estimates.json'))).cost,{low:200,likely:400,high:600});
 await assert.rejects(prepareEstimates(run.id,{rate:50}),/currency/);
 await assert.rejects(importEstimates(run.id,{...result,requestId:paid.requestId,items:[result.items[0]]}),/exactly one/);
 await assert.rejects(importEstimates(run.id,{...result,requestId:paid.requestId,items:result.items.map((e,i)=>i?e:{...e,lowHours:5})}),/ordered effort/);
});
test('style/quality evidence changes invalidate estimates without changing component counts',async t=>{
 const run=await fixture(t),p=await prepareEstimates(run.id),list=await buildList(run.id);
 const result={requestId:p.requestId,assumptions:['Observed fixture'],items:list.entries.map(e=>({key:e.key,lowHours:1,likelyHours:2,highHours:3,rationale:'Observed complexity',exclusions:[]}))};
 await importEstimates(run.id,result);await writeJson(inRun(run.id,'export/quality.json'),{status:'needs-reanalysis'});
 await assert.rejects(importEstimates(run.id,result),/Stale/);await exportInventory(run.id);
 assert.equal((await readJson(inRun(run.id,'export/estimates.json'))).status,'stale');
 assert.match(await fs.readFile(inRun(run.id,'export/estimates.md'),'utf8'),/Estimates are stale/);
});
test('native grouping rejects stale/unknown/duplicate IDs and manual merge retains unrelated model groups',async t=>{
 const run=await fixture(t),p=await prepareConsolidation(run.id),request=await readJson(inRun(run.id,'consolidation/request.json'));
 await assert.rejects(importConsolidation(run.id,{requestId:'wrong',groups:[]}),/Stale/);
 await assert.rejects(importConsolidation(run.id,{requestId:p.requestId,groups:[{name:'A',reason:'same',ids:['E1','missing']}]}),/Unknown/);
 await importConsolidation(run.id,{requestId:p.requestId,groups:[{name:'Shared Feature',reason:'Fixture A/B equivalent structure',ids:['E1','E2']}]});
 const list=await buildList(run.id);assert.equal(list.entries.length,3);
 const others=list.entries.filter(e=>e.name!=='Shared Feature').map(e=>e.key);const file=inRun(run.id,'manual-keys.json');await writeJson(file,others);
 await execute(run.id,'merge',{'keys-file':file,name:'Other Features'});
 const final=await buildList(run.id);assert.equal(final.entries.length,2);assert(final.entries.some(e=>e.name==='Shared Feature'));assert(final.entries.some(e=>e.name==='Other Features'));
 const manifest=await readJson(inRun(run.id,'export/delivery-manifest.json'));assert(manifest.files.some(f=>/^export\/components\/C\d+/.test(f)));
 const data=await readJson(inRun(run.id,'export/discovery.json'));const allowed=new Set(data.families.flatMap(f=>[path.basename(f.report),path.basename(f.evidenceReport)]));
 assert((await fs.readdir(inRun(run.id,'export/components'))).every(f=>allowed.has(f)));
 const after=await prepareConsolidation(run.id);assert.notEqual(after.requestId,p.requestId);assert.equal(request.entries.length,4);
});

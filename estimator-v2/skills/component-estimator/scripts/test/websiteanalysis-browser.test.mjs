import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {resolveBrowserRuntime} from '../lib/browser.mjs';import {captureOne} from '../lib/capture.mjs';import {createRun,getRun,inRun,writeJson,readJson,updateRun} from '../lib/store.mjs';import {loadLlm} from '../lib/detect.mjs';import {buildList} from '../lib/buildlist.mjs';import {measureWebsite,collectWebsiteEvidence} from '../lib/websiteanalysis.mjs';import {exportRun} from '../lib/report.mjs';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cest-browser-'));process.env.CEST_RUNS_DIR=tmp;const {chromium}=resolveBrowserRuntime();
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',r)),close=s=>new Promise(r=>s.close(r));
test('website evidence measures known responsive styles, assets and failures without extra navigation or model calls',async()=>{
 let browser,server,external;let pageRequests=0;
 try {
  external=http.createServer((req,res)=>{res.setHeader('Content-Type','text/css');res.end('h1 { text-transform: uppercase }');});await listen(external);
  const externalUrl=`http://127.0.0.1:${external.address().port}/external.css`;
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="red"/></svg>';
  server=http.createServer((req,res)=>{
   if(req.url.includes('.svg')){res.setHeader('Content-Type','image/svg+xml');return res.end(svg);}
   if(req.url==='/failed.woff2'||req.url==='/broken.png'){res.statusCode=404;return res.end('missing');}
   pageRequests++;
   res.setHeader('Content-Type','text/html');
   res.end(`<!doctype html><html><head><link rel="stylesheet" href="${externalUrl}"><style>
    @font-face {font-family: MissingFixture;src:url('/failed.woff2') format('woff2');font-weight:700}
    :root {--accent:rgb(12, 34, 56)}
    @supports(display:grid){@media(min-width:600px){:root {--nested-space:24px}}}
    body{margin:0;font-family:Arial;background:white}
    main{display:grid;grid-template-columns:1fr;gap:24px;max-width:1000px;padding:20px}
    h1{font-size:32px;line-height:40px;font-weight:700;letter-spacing:2px;color:var(--accent)}
    button{font-family:Arial;font-size:18px;padding:8px 16px;border:2px solid rgb(12, 34, 56);border-radius:8px}
    button::before{content:'+';color:rgb(50, 60, 70)}
    .card{padding:16px;background-image:url('/background.svg');background-size:cover}
    .missing-font{font-family:MissingFixture,Arial;font-weight:700}
    img{width:120px;height:60px;object-fit:contain;object-position:50% 50%}
    @media(max-width:600px){h1{font-size:24px;line-height:30px}main{padding:12px}}
   </style></head><body><main id="main"><h1 id="title">Measured heading</h1><button id="action">Action</button>
   <section class="card"><p class="missing-font">Font failure evidence</p><picture><source media="(max-width:600px)" srcset="/mobile.svg"><img id="responsive" src="/desktop.svg"></picture><img id="broken" src="/broken.png"></section></main></body></html>`);
  });await listen(server);
  const url=`http://127.0.0.1:${server.address().port}/`;
  browser=await chromium.launch();
  const run=await createRun({urls:[url],viewports:['desktop','mobile'],name:'website evidence'});
  for(const vp of run.viewports)await captureOne(browser,run.pages[0],vp,run.id);
  assert.equal(pageRequests,2,'collector must reuse each capture navigation');
  const fresh=await getRun(run.id);
  assert.equal(fresh.usage.calls,0);
  for(const vp of run.viewports){
   const state=fresh.pages[0].viewports[vp];assert.equal(state.status,'ok');assert(state.evidence);
   const ev=await readJson(inRun(run.id,state.evidence.path));
   const heading=ev.nodes.find(n=>n.selector==='h1#title');assert(heading);
   const css=ev.styles[heading.styleId];
   assert.equal(css['font-size'],vp==='desktop'?'32px':'24px');
   assert.equal(css['line-height'],vp==='desktop'?'40px':'30px');
   assert.equal(css.color,'rgb(12, 34, 56)');assert.equal(css['letter-spacing'],'2px');assert.equal(css['text-transform'],'uppercase');
   assert.equal(ev.rootVariables['--accent'],'rgb(12, 34, 56)');
   assert.equal(ev.rootVariables['--nested-space'],vp==='desktop'?'24px':undefined);
   const button=ev.nodes.find(n=>n.selector==='button#action');assert.equal(button.pseudo['::before'].content,'"+"');
   assert.equal(ev.styles[button.styleId]['border-radius'],'8px');
   assert(ev.fontFaces.some(f=>f.family==='MissingFixture'&&f.urls[0]===`${url}failed.woff2`));
   assert(ev.documentFonts.some(f=>f.family==='MissingFixture'&&f.status==='error'));
   const image=ev.images.find(i=>i.selector==='img#responsive');assert.equal(image.src,`${url}${vp}.svg`);assert.equal(image.naturalWidth,120);assert.equal(image.objectFit,'contain');
   assert(ev.images.some(i=>i.selector==='img#broken'&&i.broken));
   const asset=ev.assets.find(a=>a.url===`${url}${vp}.svg`);assert.equal(asset.status,200);assert(asset.sources.includes('network'));assert(asset.sources.includes('currentSrc'));
   assert(ev.assets.some(a=>a.url===`${url}background.svg`&&a.sources.includes('background')));
   assert(ev.assets.some(a=>a.url===`${url}failed.woff2`&&a.status===404));
   assert(ev.warnings.some(w=>w.includes('Stylesheet rules unavailable')));assert(ev.warnings.some(w=>w.includes('failed to load')));
   assert.equal(ev.viewportSize.width,vp==='desktop'?1440:390);assert.equal(ev.finalUrl,url);assert.equal(ev.state,'default');assert.equal(ev.measurement,'observed');
   assert(ev.nodes.some(n=>n.structureSignature));assert.equal(ev.summary.nodes,ev.nodes.length);
   assert(state.flags.some(w=>w.includes('failed')));
   const rawKeys=Object.keys(ev.assets[0]);assert(!rawKeys.includes('headers'));assert(!rawKeys.includes('body'));
  }
  const first=await readJson(inRun(run.id,fresh.pages[0].viewports.desktop.evidence.path));
  const exported=await exportRun(run.id);assert(exported.files.includes(fresh.pages[0].viewports.desktop.evidence.path));
  const index=await readJson(inRun(run.id,'export/website-evidence.json'));assert.equal(index.captures.length,2);assert(index.captures.every(c=>c.path&&c.summary));
  const report=fs.readFileSync(inRun(run.id,'export/report.md'),'utf8');assert(report.includes('Measured website evidence'));assert(report.includes('failed to load'));
  // Recapture refreshes evidence; it does not substitute a stale screenshot/style cache.
  await captureOne(browser,fresh.pages[0],'desktop',run.id);
  const recaptured=await getRun(run.id);const newer=await readJson(inRun(run.id,recaptured.pages[0].viewports.desktop.evidence.path));assert.notEqual(newer.capturedAt,first.capturedAt);
  // A lightweight scan clears its evidence reference; exports cannot claim that stale full evidence applies.
  await captureOne(browser,fresh.pages[0],'desktop',run.id,{shot:false});
  const light=await getRun(run.id);assert.equal(light.pages[0].viewports.desktop.evidence,undefined);assert.equal(light.pages[0].viewports.desktop.shot,false);
  await exportRun(run.id);const lightIndex=await readJson(inRun(run.id,'export/website-evidence.json'));assert.equal(lightIndex.captures.find(c=>c.viewport==='desktop').path,null);
  assert(lightIndex.captures.find(c=>c.viewport==='desktop').warnings.some(w=>w.includes('Lightweight')));
  await updateRun(run.id,r=>{delete r.pages[0].viewports.mobile.evidence;});
  await exportRun(run.id);const legacy=await readJson(inRun(run.id,'export/website-evidence.json'));assert.equal(legacy.captures.find(c=>c.viewport==='mobile').path,null);
  assert(legacy.captures.find(c=>c.viewport==='mobile').warnings.some(w=>w.includes('recapture')));assert.equal((await getRun(run.id)).usage.calls,0);
  // Bounded samples and deduplicated styles remain deterministic across a repeated measurement.
  const page=await browser.newPage();await page.setContent('<style>p{margin:0;width:100px;height:20px}</style>'+Array.from({length:300},(_,i)=>`<p id="n${i}" style="--local:42px">sample</p>`).join(''));
  const selectors=Array.from({length:300},(_,i)=>`#n${i}`);
  const bounded=await page.evaluate(measureWebsite,{selectors,rects:[]});assert.equal(bounded.nodes.length,250);assert(bounded.warnings.some(w=>w.includes('truncated')));assert.equal(bounded.nodes.find(n=>n.selector==='#n0').variables['--local'],'42px');
  const replay=await page.evaluate(measureWebsite,{selectors,rects:[]});assert.deepEqual(bounded.nodes,replay.nodes);
  const args={requestedUrl:'http://fixture.invalid/',viewport:'desktop',consent:'none',screenshot:'fixture.png',rects:[],scan:{url:'http://fixture.invalid/',title:'fixture',components:selectors.map((selector,index)=>({selector,signature:'paragraph-family',index,type:'paragraph',basis:'test',nested_in:null,text_sample:''})),signatures:['paragraph-family']},network:{assets:[],warnings:[]}};
  const compact=await collectWebsiteEvidence(page,args);assert.equal(compact.summary.nodes,250);assert.equal(compact.summary.styles,2,'equal paragraph styles should share one record');
  const repeated=await collectWebsiteEvidence(page,args);assert.deepEqual(compact.styles,repeated.styles);assert.equal(compact.nodes[1].structureSignature,'paragraph-family');
  await page.close();
 } finally {
  if(browser)await browser.close();if(server)await close(server);if(external)await close(external);
  fs.rmSync(tmp,{recursive:true,force:true});
 }
});

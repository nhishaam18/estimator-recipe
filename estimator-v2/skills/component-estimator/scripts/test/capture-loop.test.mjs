import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {resolveBrowserRuntime} from '../lib/browser.mjs';
import {createRun,getRun} from '../lib/store.mjs';
import {newJob} from '../lib/jobs.mjs';
import {captureSequence,captureOne} from '../lib/capture.mjs';

test('URL loop reuses one context, closes each page, keeps viewport and consent state, and never waits for networkidle',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'estimator-loop-')),previous=process.env.CEST_RUNS_DIR;process.env.CEST_RUNS_DIR=root;
 let browser,server;const hits=[];
 try{
  server=createServer((req,res)=>{hits.push({url:req.url,cookie:req.headers.cookie});if(req.url==='/tick'){res.end('tick');return;}res.setHeader('Content-Type','text/html');res.setHeader('Set-Cookie','consent=accepted; Path=/');res.end('<html><body><main><h1>Page</h1><p>Rendered content</p></main><script>setInterval(()=>fetch("/tick"),50);setTimeout(()=>window.open("/popup"),100)</script></body></html>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const run=await createRun({urls:[`${base}/a`,`${base}/b`],viewports:['desktop','mobile'],settings:{urlIntervalMs:250,requestStartIntervalMs:50},name:'reuse'});
  browser=await resolveBrowserRuntime().chromium.launch();const original=browser.newContext.bind(browser);let contexts=0,pages=0;
  browser.newContext=async options=>{contexts++;const c=await original(options);const newPage=c.newPage.bind(c);c.newPage=async()=>{pages++;const p=await newPage();const wait=p.waitForLoadState.bind(p);p.waitForLoadState=(state,...rest)=>{assert.notEqual(state,'networkidle');return wait(state,...rest);};return p;};return c;};
  const job=newJob(2);await captureSequence(browser,run,run.pages.map((p,i)=>({p,v:i?'mobile':'desktop'})),job,{shot:false});
  assert.equal(contexts,1);assert.equal(pages,2);assert.equal(browser.contexts().length,0);
  assert(hits.find(h=>h.url==='/b').cookie?.includes('consent=accepted'));
  const saved=await getRun(run.id);assert.equal(saved.pages[0].viewports.desktop.status,'ok');assert.equal(saved.pages[1].viewports.mobile.width,390);
  assert.equal(saved.pages[0].viewports.desktop.network.limits.maxInFlight,4);
  assert.equal(job.done,2);
  assert(!hits.some(h=>h.url==='/popup'),'popup first requests cannot bypass page admission');
 }finally{await browser?.close();await new Promise(r=>server?server.close(r):r());if(previous===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=previous;await rm(root,{recursive:true,force:true});}
});

test('rate limiting stops the sequence without retrying or visiting remaining URLs',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'estimator-stop-')),previous=process.env.CEST_RUNS_DIR;process.env.CEST_RUNS_DIR=root;let server,browser,hits=0;
 try{server=createServer((req,res)=>{hits++;res.statusCode=429;res.end('rate limited');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const run=await createRun({urls:[`${base}/a`,`${base}/b`,`${base}/c`],viewports:['desktop'],name:'stop'});browser=await resolveBrowserRuntime().chromium.launch();const job=newJob(3);
 await captureSequence(browser,run,run.pages.map(p=>({p,v:'desktop'})),job,{shot:false});
 assert.equal(hits,1);assert.equal(job.done,1);assert.equal(job.cancelRequested,true);assert.match(job.stopReason,/429/);
 const saved=await getRun(run.id);assert.equal(saved.pages[0].viewports.desktop.status,'failed');assert.notEqual(saved.pages[1].viewports.desktop?.status,'ok');assert.equal(browser.contexts().length,0);
 const resumed=newJob(3);await captureSequence(browser,await getRun(run.id),run.pages.map(p=>({p,v:'desktop'})),resumed,{shot:false});assert.equal(hits,1,'ordinary resume cannot retry a persisted network stop');assert.equal(resumed.cancelRequested,true);
 }finally{await browser?.close();await new Promise(r=>server?server.close(r):r());if(previous===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=previous;await rm(root,{recursive:true,force:true});}
});

test('full capture waits for late CSS background images without networkidle',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'estimator-background-')),previous=process.env.CEST_RUNS_DIR;process.env.CEST_RUNS_DIR=root;let server,browser,backgroundFinished=false;
 try{server=createServer((req,res)=>{if(req.url==='/background.svg'){setTimeout(()=>{res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="300"><rect width="500" height="300" fill="green"/></svg>');backgroundFinished=true;},2500);return;}res.setHeader('Content-Type','text/html');res.end('<html><body style="margin:0"><main style="width:500px;height:300px"><h1>Hero</h1></main><script>setTimeout(()=>document.querySelector("main").style.backgroundImage="url(/background.svg)",150)</script></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
 const run=await createRun({urls:[url],viewports:['desktop'],name:'background'});browser=await resolveBrowserRuntime().chromium.launch();const state=await captureOne(browser,run.pages[0],'desktop',run.id);
 assert.equal(state.status,'ok');assert.equal(backgroundFinished,true);assert(!state.flags.some(f=>/Visual asset readiness limit/.test(f)));
 }finally{await browser?.close();await new Promise(r=>server?server.close(r):r());if(previous===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=previous;await rm(root,{recursive:true,force:true});}
});

test('a subresource rate limit also stops further URL visits',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'estimator-subresource-')),previous=process.env.CEST_RUNS_DIR;process.env.CEST_RUNS_DIR=root;let server,browser,documents=0;
 try{server=createServer((req,res)=>{if(req.url==='/api'){res.statusCode=429;res.end('slow down');return;}documents++;res.setHeader('Content-Type','text/html');res.end('<html><body><main>Content</main><script>fetch("/api")</script></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const run=await createRun({urls:[`${base}/a`,`${base}/b`],viewports:['desktop'],name:'subresource'});browser=await resolveBrowserRuntime().chromium.launch();const job=newJob(2);await captureSequence(browser,run,run.pages.map(p=>({p,v:'desktop'})),job,{shot:false});
 assert.equal(job.done,1);assert.equal(documents,1);assert.match(job.stopReason,/429/);assert.equal((await getRun(run.id)).pages[0].viewports.desktop.httpStatus,429);
 }finally{await browser?.close();await new Promise(r=>server?server.close(r):r());if(previous===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=previous;await rm(root,{recursive:true,force:true});}
});

test('whole-page budget closes stalled navigation and two failures stop the URL loop',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'estimator-budget-')),previous=process.env.CEST_RUNS_DIR;process.env.CEST_RUNS_DIR=root;let server,browser,requests=0;const responses=new Set();
 try{server=createServer((req,res)=>{requests++;responses.add(res);req.on('close',()=>responses.delete(res));res.writeHead(200,{'Content-Type':'text/html'});res.write('<html><body>Never finishes');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const run=await createRun({urls:[`${base}/a`,`${base}/b`,`${base}/c`],viewports:['desktop'],settings:{pageBudgetMs:1000,urlIntervalMs:250},name:'budget'});browser=await resolveBrowserRuntime().chromium.launch();const job=newJob(3);await captureSequence(browser,run,run.pages.map(p=>({p,v:'desktop'})),job,{shot:false});
 assert.equal(job.done,2);assert.equal(requests,2);assert.match(job.stopReason,/2 consecutive page failures/);assert((await getRun(run.id)).pages.slice(0,2).every(p=>p.viewports.desktop.budgetExceeded));assert.equal(browser.contexts().length,0);
 }finally{await browser?.close();for(const r of responses)r.destroy();await new Promise(r=>server?server.close(r):r());if(previous===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=previous;await rm(root,{recursive:true,force:true});}
});

test('rate limiting during optional style evidence collection cannot be downgraded to a successful HTTP 200 capture',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'estimator-late429-')),previous=process.env.CEST_RUNS_DIR;process.env.CEST_RUNS_DIR=root;let server,browser;
 try{server=createServer((req,res)=>{res.statusCode=req.url==='/rate'?429:200;res.setHeader('Content-Type','text/html');res.end('<html><body><main><h1>Evidence</h1></main></body></html>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}/`;
 const run=await createRun({urls:[url],viewports:['desktop'],name:'late429'});browser=await resolveBrowserRuntime().chromium.launch();const newContext=browser.newContext.bind(browser);let injected=false;
 browser.newContext=async options=>{const c=await newContext(options),newPage=c.newPage.bind(c);c.newPage=async()=>{const p=await newPage(),evaluate=p.evaluate.bind(p);p.evaluate=async(fn,arg)=>{if(fn?.name==='measureWebsite'){injected=true;await evaluate(()=>fetch('/rate'));}return evaluate(fn,arg);};return p;};return c;};
 const state=await captureOne(browser,run.pages[0],'desktop',run.id);assert.equal(injected,true);assert.equal(state.status,'failed');assert.equal(state.httpStatus,429);
 }finally{await browser?.close();await new Promise(r=>server?server.close(r):r());if(previous===undefined)delete process.env.CEST_RUNS_DIR;else process.env.CEST_RUNS_DIR=previous;await rm(root,{recursive:true,force:true});}
});

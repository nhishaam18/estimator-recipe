import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readEvidence} from '../lib/bounded-read.mjs';
import {urlOnlyDiscovery,buildUrlPlan} from '../lib/urlplanning.mjs';

test('bounded reads select fields and page huge single lines without oversized output',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'bounded-read-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const file=path.join(root,'evidence.json');await fs.writeFile(file,JSON.stringify({large:'x'.repeat(90000),status:'ready'}));
 const selected=await readEvidence({file,pointer:'/status'});assert.equal(selected.text,'"ready"');assert.equal(selected.nextOffset,null);
 const first=await readEvidence({file});assert.equal(first.text.length,4000);assert.equal(first.nextOffset,4000);assert(JSON.stringify(first).length<80000);
 const next=await readEvidence({file,offset:first.nextOffset,limit:20});assert.equal(next.offset,4000);assert.equal(next.text.length,20);
 await assert.rejects(readEvidence({file,limit:80000}));await assert.rejects(readEvidence({file,pointer:'/missing'}));
 await assert.rejects(readEvidence({file:path.join(root,'conversation-history','x.jsonl')}),/conversation-history/);
});

test('URL-only projection preserves all URLs, order, duplicates and grouping but drops metadata',()=>{
 const urls=['https://example.test/','https://example.test/blog/a','https://example.test/blog/a'];
 const raw={content:[{type:'text',text:JSON.stringify({success:true,links:urls.map(url=>({url,title:'unused',description:'unused'}))})}]};
 const projected=urlOnlyDiscovery(raw);assert.deepEqual(projected,{links:urls});
 assert.deepEqual(buildUrlPlan(urls[0],projected).groups,buildUrlPlan(urls[0],raw).groups);
 assert.throws(()=>urlOnlyDiscovery({success:false,links:[]}),/failed/);
 assert.throws(()=>urlOnlyDiscovery({links:[{title:'no URL'}]}),/without a URL/);
});

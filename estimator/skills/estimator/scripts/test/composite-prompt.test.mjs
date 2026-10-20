import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeAnalysisPrompt} from '../lib/analysis-contract.mjs';
test('native hints include linked composites with div text and prioritize them over arbitrary wrappers',()=>{
 const html='<section><a id="tile" href="/one"><svg><path/></svg><div><div>Title</div><div>Description</div></div></a><a id="plain" href="/two"><svg/><span>Label</span></a></section>';
 const rects=Array.from({length:100},(_,i)=>({s:`#wrapper${i}`,t:'div',x:0,y:0,w:500,h:100}));
 rects.push({s:'#tile',t:'a',x:0,y:0,w:200,h:90},{s:'#plain',t:'a',x:0,y:0,w:80,h:30});
 const prompt=nativeAnalysisPrompt(rects,html,{top:0,height:1000,index:0},1440,'desktop','hash');
 const hints=JSON.parse(prompt.split('\n').at(-1));
 assert(hints.some(h=>h.selector==='#tile'&&h.boundaryEvidence));
 assert(!hints.some(h=>h.selector==='#plain'));
 assert(hints.length<=80);
});


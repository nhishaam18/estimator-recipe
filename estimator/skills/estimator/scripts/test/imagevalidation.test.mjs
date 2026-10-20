import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateImageComponents as check,imageBoundaryPrompt} from '../lib/imagevalidation.mjs';
const img={s:'img#demo',t:'img',x:100,y:300,w:600,h:400,p:'static'};
const item=(id,name,box,parent=null)=>({id,name,box,parent,level:2,contains:[],reusable:false,reusableId:null,repeated:false,frac:[0,0,1,1]});
test('excludes depicted controls, preserves full image/figure and real overlay',()=>{
 const controls=[item('false','Create rule dialog',{x:150,y:350,w:200,h:100}),item('image','Article image',img),item('real','Play button',{x:350,y:450,w:80,h:40}),item('caption','Caption',{x:100,y:710,w:600,h:30})];
 const r=check(controls,[img,{s:'button#play',t:'button',x:350,y:450,w:80,h:40,p:'absolute'}]);
 assert.deepEqual(r.components.map(c=>c.id),['image','real','caption']);assert.equal(r.findings[0].decision,'excluded');
});
test('ambiguous full-image control and background retain review evidence',()=>{
 const r=check([item('a','Dialog',img)],[img]);assert.equal(r.components.length,1);assert.equal(r.findings[0].decision,'review');
 const b=check([item('b','Hero card',{x:150,y:350,w:200,h:100})],[{...img,t:'section',mediaKind:'background'}]);assert.equal(b.findings[0].decision,'review');
});
test('preserves card surrounding image and HTML form inside background',()=>{
 const card=item('card','Card',{x:80,y:280,w:650,h:480});assert.equal(check([card],[img]).components.length,1);
 const form=item('form','Form',{x:150,y:350,w:200,h:100});assert.equal(check([form],[{...img,t:'section',mediaKind:'background'},{...form.box,t:'form',s:'form',p:'static'}]).findings.length,0);
});
test('repairs dangling parent and uses viewport-specific image geometry',()=>{
 const parent=item('bad','Illustrated dialog',{x:150,y:350,w:200,h:100});const child=item('child','Real link',{x:180,y:380,w:50,h:25},'bad');
 const r=check([parent,child],[img,{...child.box,s:'a#real',t:'a',p:'absolute'}]);assert.equal(r.components[0].parent,null);
 assert.equal(check([parent],[{...img,x:900}]).findings.length,0);
});
test('tile boundaries clip in pixel space, no placeholder or extra model calls',()=>{
 const p=imageBoundaryPrompt([img],500,300);assert.ok(p.includes('[100,0,600,200]'));assert.ok(p.includes('actual HTML overlays'));
});
test('uncertain object-fit never silently removes content',()=>{
 const r=check([item('x','Control',{x:150,y:350,w:200,h:100})],[{...img,mediaUncertain:true}]);assert.equal(r.components.length,1);assert.equal(r.findings[0].decision,'review');
});

test('image contents and excluded names cannot leak back into consolidation',()=>{
 const image=item('image','Article screenshot',img);image.contains=['Illustrated dialog'];
 const section=item('section','Article',{x:80,y:280,w:650,h:480});section.contains=['Illustrated dialog','Article screenshot'];
 const r=check([section,image,item('bad','Illustrated dialog',{x:150,y:350,w:200,h:100})],[img]);
 assert.deepEqual(r.components.find(c=>c.id==='image').contains,[]);assert.deepEqual(r.components.find(c=>c.id==='section').contains,['Article screenshot']);
});


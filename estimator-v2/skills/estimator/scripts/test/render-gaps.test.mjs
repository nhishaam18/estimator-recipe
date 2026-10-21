import test from 'node:test';
import assert from 'node:assert/strict';
import {validateNativeResult} from '../lib/analysis-contract.mjs';
import {parseTile,mergeTiles} from '../lib/merge.mjs';
import {assessQuality} from '../lib/quality.mjs';
const request={imageHash:'current',viewport:'desktop',tile:{index:0,imageWidth:100,imageHeight:100},coordMode:'pixels'};
const result=()=>({coordinate_space:{width:100,height:100},inspection:{imageHash:'current',viewport:'desktop',tileIndex:0,summary:'Visible component with some missing rendered content.'},components:[{id:'S1',parent:null,name:'Hero',level:1,box:[0,0,100,100],contains:['heading','image'],gaps:['image']} ]});

test('compact optional rendering gaps are accepted while malformed metadata is rejected',()=>{
 validateNativeResult(result(),request);
 for(const gaps of ['image',[null],[''],['x'.repeat(81)],Array(9).fill('image')]){
  const value=result();value.components[0].gaps=gaps;assert.throws(()=>validateNativeResult(value,request),/gaps/i);
 }
 const legacy=result();delete legacy.components[0].gaps;validateNativeResult(legacy,request);
});

test('overlapping tiles retain one identifiable component and union nonblocking missing parts',()=>{
 const tile={index:0,top:0,height:100,imageWidth:100,imageHeight:100},a=result(),b=result();b.components[0].gaps=['icon'];
 const merged=mergeTiles([{tile:0,items:parseTile(a,tile,'pixels',100,[])},{tile:1,items:parseTile(b,{...tile,index:1},'pixels',100,[])}],100,100);
 assert.equal(merged.length,1);assert.deepEqual(merged[0].gaps,['image','icon']);assert.equal(merged[0].name,'Hero');assert.deepEqual(merged[0].contains,['heading','image']);
});

test('rendering gaps warn without reanalysis, excluding the component or changing unique counts',()=>{
 for(const name of ['Hero','Team Card','Slider Item','Footer','CTA']){
  const detection={id:'d',captureId:'c',sourceId:'S1',name,gaps:['image','text'],validation:{role:'component',countInBuildList:true}};
  const data={captures:[{id:'c',nativeAnalysis:{requestIds:['tile']}}],detections:[detection],occurrences:[{id:'o',captureId:'c'}],elements:[],coverage:[]};
  const q=assessQuality(data);assert.equal(q.status,'provisional');assert.deepEqual(q.reanalysisRequestIds,[]);assert.equal(q.findings[0].code,'incomplete-component-render');assert.equal(q.findings[0].action,'review-evidence');assert.deepEqual(q.findings[0].parts,['image','text']);assert.equal(detection.validation.countInBuildList,true);assert.equal(data.occurrences.length,1);
 }
});

test('rendering warnings do not bypass image identity, parent geometry or empty-result safeguards',()=>{
 const wrong=result();wrong.inspection.imageHash='wrong';assert.throws(()=>validateNativeResult(wrong,request),/inspection/);
 const empty=result();empty.components=[];assert.throws(()=>validateNativeResult(empty,request),/emptyReason/);
 const child=result();child.components.push({id:'I1',parent:'missing',box:[1,1,20,20]});assert.throws(()=>validateNativeResult(child,request),/parent/);
});

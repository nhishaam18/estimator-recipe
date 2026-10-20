#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export async function validateHandoff(folder){
 const root=path.resolve(folder),data=JSON.parse(await fs.readFile(path.join(root,'export/discovery.json'),'utf8'));
 const errors=[];const check=(ok,message)=>{if(!ok)errors.push(message);};
 check(data.schemaVersion===1,'Unsupported schemaVersion');
 for(const key of ['families','occurrences','elements','detections','captures','coverage'])check(Array.isArray(data[key]),`Missing ${key} array`);
 if(errors.length)return {status:'invalid',errors};
 const indexed=Object.fromEntries(['families','occurrences','elements','detections','captures'].map(k=>[k,new Map(data[k].map(x=>[x.id,x]))]));
 for(const key of Object.keys(indexed))check(indexed[key].size===data[key].length,`Duplicate ${key} IDs`);
 const annotations=data.annotationItems??[];
 check(Array.isArray(annotations),'Invalid annotationItems array');
 const annotationIndex=new Map((Array.isArray(annotations)?annotations:[]).map(a=>[a.id,a]));
 check(annotationIndex.size===annotations.length,'Duplicate annotation IDs');
 for(const a of annotationIndex.values()){
  check(indexed.captures.has(a.captureId),`Missing annotation capture: ${a.id}`);
  check(['section','component','group','action'].includes(a.kind),`Invalid annotation kind: ${a.id}`);
  check(a.box&&['x','y','w','h'].every(k=>Number.isFinite(a.box[k]))&&a.box.w>0&&a.box.h>0,`Invalid annotation box: ${a.id}`);
  if(a.sourceDetectionId)check(indexed.detections.get(a.sourceDetectionId)?.captureId===a.captureId,`Invalid annotation detection: ${a.id}`);
  const visited=new Set([a.id]);let parent=a.ownerId;
  while(parent){check(!visited.has(parent),`Annotation cycle: ${a.id}`);if(visited.has(parent))break;visited.add(parent);const p=annotationIndex.get(parent);check(!!p&&p.captureId===a.captureId,`Invalid annotation owner: ${a.id}`);parent=p?.ownerId;}
 }
 for(const family of data.families)for(const id of family.occurrenceIds??[])check(indexed.occurrences.get(id)?.familyId===family.id,`Family occurrence mismatch: ${id}`);
 for(const occurrence of data.occurrences){
  check(indexed.families.has(occurrence.familyId),`Missing family: ${occurrence.id}`);
  check(indexed.captures.has(occurrence.captureId),`Missing capture: ${occurrence.id}`);
  const visited=new Set([occurrence.id]);let parent=occurrence.parentOccurrenceId;
  while(parent){check(!visited.has(parent),`Occurrence cycle: ${occurrence.id}`);if(visited.has(parent))break;visited.add(parent);const p=indexed.occurrences.get(parent);check(!!p&&p.captureId===occurrence.captureId,`Invalid parent: ${occurrence.id}`);parent=p?.parentOccurrenceId;}
  for(const id of occurrence.elementIds??[])check(indexed.elements.get(id)?.ownerOccurrenceId===occurrence.id,`Element ownership mismatch: ${id}`);
  const model=occurrence.modelProposal;
  if(model){
   check(model.status==='proposal'&&Array.isArray(model.fields)&&Array.isArray(model.anatomy),`Invalid model proposal: ${occurrence.id}`);
   const names=new Set();
   for(const field of model.fields??[]){
    check(field.status==='proposal'&&typeof field.name==='string'&&!names.has(field.name),`Invalid field proposal: ${occurrence.id}`);names.add(field.name);
    for(const id of field.evidenceElementIds??[])check(indexed.elements.get(id)?.ownerOccurrenceId===occurrence.id,`Invalid field evidence: ${occurrence.id}/${field.name}/${id}`);
    for(const id of field.evidenceOccurrenceIds??[])check(id===occurrence.id,`Invalid field owner evidence: ${occurrence.id}/${field.name}`);
    for(const id of field.occurrenceIds??[]){const child=indexed.occurrences.get(id);check(child?.parentOccurrenceId===occurrence.id&&child?.familyId===field.familyId,`Invalid field child: ${occurrence.id}/${id}`);}
   }
   for(const child of model.anatomy??[])for(const id of child.occurrenceIds??[])check(indexed.occurrences.get(id)?.parentOccurrenceId===occurrence.id&&indexed.occurrences.get(id)?.familyId===child.familyId,`Invalid anatomy child: ${id}`);
  }
 }
 for(const element of data.elements){
  const owner=indexed.occurrences.get(element.ownerOccurrenceId);check(!!owner&&owner.elementIds.includes(element.id),`Missing element owner: ${element.id}`);
  check(owner?.captureId===element.captureId,`Element capture mismatch: ${element.id}`);
  check(typeof element.observedText==='string',`Missing observedText: ${element.id}`);
  check(element.candidateSemanticField?.status==='proposal',`Field must remain a proposal: ${element.id}`);
  check(element.styleStatus!=='captured'||!!element.computedStyle,`Missing captured style: ${element.id}`);
  const visited=new Set([element.id]);let parent=element.parentElementId;
  while(parent){
   check(!visited.has(parent),`Element cycle: ${element.id}`);if(visited.has(parent))break;visited.add(parent);
   const p=indexed.elements.get(parent);check(!!p&&p.ownerOccurrenceId===element.ownerOccurrenceId,`Invalid element parent: ${element.id}`);parent=p?.parentElementId;
  }
 }
 const files=['export/report.md',...data.families.flatMap(f=>[f.report,...(f.evidenceReport?[f.evidenceReport]:[])])];
 const unassignedIds=new Set();
 for(const element of data.unassignedElements??[]){
  check(!unassignedIds.has(element.id)&&!indexed.elements.has(element.id),`Duplicate unassigned element: ${element.id}`);unassignedIds.add(element.id);
  check(element.ownerOccurrenceId===null&&indexed.captures.has(element.captureId),`Invalid unassigned evidence: ${element.id}`);
 }
 for(const capture of data.captures){
  for(const [kind,relative] of Object.entries(capture.paths??{})){
   if(!relative)continue;files.push(relative);
   const full=path.resolve(root,relative);if(!full.startsWith(root+path.sep)){errors.push(`Path escapes run: ${relative}`);continue;}
   const provenance=capture.provenance?.[kind];
   if(provenance){try{check(createHash('sha256').update(await fs.readFile(full)).digest('hex')===provenance.sha256,`Evidence hash mismatch: ${relative}`);}catch{errors.push(`Evidence missing: ${relative}`);}}
  }
 }
 for(const relative of new Set(files)){
  const full=path.resolve(root,relative);if(!full.startsWith(root+path.sep)){errors.push(`Path escapes run: ${relative}`);continue;}
  try{await fs.access(full);}catch{errors.push(`Missing reference: ${relative}`);}
 }
 // Primary reports contain generated local evidence links. Do not interpret source copy in appendices as links.
 for(const family of data.families){
  const full=path.resolve(root,family.report);if(!full.startsWith(root+path.sep))continue;
  let report;try{report=await fs.readFile(full,'utf8');}catch{continue;}
  for(const match of report.matchAll(/(?<!\\)\]\(([^)]+)\)/g)){
   const link=match[1];if(/^[a-z][a-z0-9+.-]*:/i.test(link)||link.startsWith('#'))continue;
   let target;try{target=path.resolve(path.dirname(full),decodeURIComponent(link.split('#')[0]));}catch{errors.push(`Invalid report link: ${family.report}`);continue;}
   if(!target.startsWith(root+path.sep)){errors.push(`Report link escapes run: ${family.report}`);continue;}
   try{await fs.access(target);}catch{errors.push(`Missing report link: ${family.report} -> ${link}`);}
  }
 }
 return {status:errors.length?'invalid':'valid',scope:'Structural and file integrity only; semantic coverage, visual fidelity and CMS acceptance are not established.',counts:{families:data.families.length,occurrences:data.occurrences.length,elements:data.elements.length},errors};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(!process.argv[2])throw new Error('Usage: node validate-handoff.mjs <run folder>');const result=await validateHandoff(process.argv[2]);process.stdout.write(JSON.stringify(result)+'\n');process.exitCode=result.status==='valid'?0:2;}catch(e){process.stdout.write(JSON.stringify({status:'invalid',errors:[e.message]})+'\n');process.exitCode=2;}
}

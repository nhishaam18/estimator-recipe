// Derived resume information only. Full evidence and approved decisions stay in their source files.
import path from 'node:path';
import {getRun, inRun, readJson, writeJson} from './store.mjs';

export async function saveWorkState(id, {analysis} = {}) {
 const run=await getRun(id),runDir=path.dirname(inRun(id,'run.json'));
 const checkpoint=await readJson(inRun(id,'discovery-checkpoint.json'),{completed:[]});
 const manifest=analysis??await readJson(inRun(id,'analysis-requests/manifest.json'),null);
 const browserStop=await readJson(inRun(id,'browser-stop.json'),null);
 const lock=await readJson(inRun(id,'discovery.lock'),null);
 const failure=await readJson(inRun(id,'execution-error.json'),null);
 const quality=await readJson(inRun(id,'export/quality.json'),null);
 const delivery=await readJson(inRun(id,'export/delivery-manifest.json'),null);
 const stages=['scan','group','capture','detect','report'];
 const completed=checkpoint.completed??[],stage=stages.find(s=>!completed.includes(s));
 const request=manifest?.requests?.[0];
 const next=request?{operation:'inspect-tile',requestId:request.id,promptFile:request.promptFile,image:request.image,resultFile:`analysis-results/${request.id}/draft.json`}
  :stage?{operation:'resume-pipeline',through:stage==='detect'&&manifest?.pending===0?'report':stage,minutes:4}
  :{operation:'review-report',report:'export/report.md',quality:'export/quality.json'};
 const state={version:1,runId:id,runDir,completed,
  status:request?'awaiting-analysis':stage?'partial':quality?.status??'awaiting-review',
  counts:{selectedUrls:run.urls.length,representativeUrls:new Set(Object.values(run.selection??{}).flat()).size,failedPages:run.pages.filter(p=>Object.values(p.viewports).some(v=>v.status==='failed')).length},
  analysis:{pending:manifest?.pending??null,manifest:'analysis-requests/manifest.json'},
  sources:{input:'input/urls.json',plan:'input/url-plan.json',selection:'input/url-selection.json',notes:'execution-notes.json'},
  outputs:{report:'export/report.md',quality:'export/quality.json',components:'export/components/',delivery:'export/delivery-manifest.json',visualReview:'export/visual-review.json',reviewManifest:'review-requests/manifest.json',estimationStatus:delivery?.estimationStatus??'not-prepared'},next};
 // A request manifest may survive a recapture/invalidation. Do not dispatch it before capture completes.
 if(stage&&stages.indexOf(stage)<stages.indexOf('detect')){
  state.status='partial';state.next={operation:'resume-pipeline',through:'detect',minutes:4};
 }
 if(lock&&lock.pid!==process.pid){
  state.status='blocked';state.next={operation:'inspect-operation-lock',file:'discovery.lock',pid:lock.pid};
 }
 if(failure){state.status='blocked';state.next={operation:'inspect-command-error',file:'execution-error.json',command:failure.command};}
 if(browserStop){state.status='blocked';state.next={operation:'inspect-browser-stop',file:'browser-stop.json'};}
 await writeJson(inRun(id,'work-state.json'),state);
 return state;
}

export async function analysisReceipt(id, analysis) {
 const state=await saveWorkState(id,{analysis});
 return {status:analysis.status,runId:id,pending:analysis.pending,manifest:analysis.manifest,checkpoint:'work-state.json',next:state.next};
}

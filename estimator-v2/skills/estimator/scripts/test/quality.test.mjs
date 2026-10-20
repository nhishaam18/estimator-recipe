import test from 'node:test';
import assert from 'node:assert/strict';
import { assessQuality } from '../lib/quality.mjs';

test('uncertain detections and unowned content produce actionable reanalysis, not readiness', () => {
    const data = { captures: [{ id: 'c', url: 'https://example.test', viewport: 'desktop', unownedMeaningfulElements: 12, nativeAnalysis: { requestIds: ['tile1', 'tile2'] } }],
        detections: [{ id: 'd', captureId: 'c', sourceId: 'S2', name: 'Card', validation: { role: 'uncertain', reason: 'No DOM boundary' } }],
        occurrences: [], elements: [], coverage: [{ captureId: 'c', status: 'captured', styleStatus: 'captured' }] };
    const quality = assessQuality(data);
    assert.equal(quality.status, 'needs-reanalysis');
    assert.equal(quality.readyForImplementation, false);
    assert.deepEqual(quality.reanalysisRequestIds, ['tile1', 'tile2']);
    assert.ok(quality.findings.some(f => f.detectionId === 'd' && f.sourceId === 'S2'));
    assert.ok(quality.findings.some(f => f.code === 'unowned-elements' && f.count === 12));
});

test('clean structural checks do not certify semantic coverage or promote primitive content to components', () => {
    const data = { captures: [{ id: 'c', unownedMeaningfulElements: 0 }], detections: [{ id: 'd', validation: { role: 'content' } }],
        occurrences: [{ id: 'o', captureId: 'c' }], elements: [{ id: 'e', styleStatus: 'captured' }], coverage: [{ status: 'captured', styleStatus: 'captured' }] };
    const quality = assessQuality(data);
    assert.equal(quality.status, 'provisional');
    assert.equal(quality.readyForImplementation, false);
    assert.equal(quality.findings.length, 0);
    assert.match(quality.scope, /not.*semantic|not.*visual/);
});

test('recovered composite items omitted by native detection require reanalysis without creating families',()=>{
 const data={captures:[{id:'c',nativeAnalysis:{requestIds:['tile-hero']}}],detections:[],occurrences:[{id:'hero',captureId:'c',selector:'#hero'}],elements:[],coverage:[],
 annotationItems:[{id:'tile',kind:'component',source:'saved-dom',annotationOnly:true,captureId:'c',selector:'#tile',box:{x:0,y:100,w:100,h:80}},{id:'cta',kind:'action',source:'saved-dom',annotationOnly:true,captureId:'c',selector:'#cta'}]};
 const q=assessQuality(data);
 assert.equal(q.status,'needs-reanalysis');
 assert.equal(q.findings.filter(f=>f.code==='unmodeled-composite-boundary').length,1);
 assert.deepEqual(q.reanalysisRequestIds,['tile-hero']);
 assert.equal(data.occurrences.length,1);
});


/** Deterministic evidence checks, not a visual model or CMS acceptance test. */
export function assessQuality(data) {
    const findings = [];
    const add = (code, capture, details, action = 'review-evidence') => findings.push({ code, captureId: capture?.id ?? null,
        url: capture?.url ?? null, viewport: capture?.viewport ?? null, action, requestIds: capture?.nativeAnalysis?.requestIds ?? [], ...details });
    for (const capture of data.captures) {
        for (const item of (data.annotationItems??[]).filter(a=>a.captureId===capture.id && a.kind==='component' && a.annotationOnly && !data.occurrences.some(o=>o.captureId===capture.id && o.selector===a.selector))) {
            add('unmodeled-composite-boundary',capture,{annotationId:item.id,selector:item.selector,name:item.name,box:item.box,
                reason:'A DOM-backed composite item is annotated but missing from the implementation inventory. Inspect its screenshot and DOM, then add a supported native detection or explain why it remains an owned part; do not silently promote it to a CMS type.'},'reanalyse-tile');
        }
        for (const tile of capture.nativeAnalysis?.tileReviews ?? []) if (!tile.componentCount) add('empty-tile-analysis', capture,
            { requestIds: [tile.requestId], reason: `Tile was declared empty: ${tile.emptyReason ?? 'no reason saved'}. Verify against its image and saved DOM.` }, 'reanalyse-tile');
        const uncertain = data.detections.filter(d => d.captureId === capture.id && d.validation?.role === 'uncertain');
        for (const d of uncertain) add('uncertain-boundary', capture, { detectionId: d.id, sourceId: d.sourceId, name: d.name, reason: d.validation.reason }, 'reanalyse-tile');
        if (capture.unownedMeaningfulElements) add('unowned-elements', capture, { count: capture.unownedMeaningfulElements,
            reason: 'Meaningful saved DOM content has no validated component owner. Inspect the image and DOM; do not invent component types merely to close this finding.' }, 'reanalyse-tile');
        if (!data.occurrences.some(o => o.captureId === capture.id)) add('no-validated-components', capture, { reason: 'No implementation boundary was validated in this capture; inspect all tiles, including any empty responses.' }, 'reanalyse-tile');
    }
    for (const c of data.coverage) {
        const capture = data.captures.find(x => x.id === c.captureId);
        if (c.status !== 'captured') add('missing-screenshot', capture, { url: c.url, viewport: c.viewport, reason: `Visual evidence: ${c.status}.` });
        if (c.styleStatus !== 'captured') add('missing-style-evidence', capture, { url: c.url, viewport: c.viewport, reason: 'No saved computed style sample for this requested view.' });
    }
    const missingStyles = data.elements.filter(e => e.styleStatus !== 'captured');
    if (missingStyles.length) findings.push({ code: 'unsampled-element-styles', action: 'review-evidence', count: missingStyles.length,
        reason: 'Refer to discovery.json element styleStatus; do not copy styles from neighboring elements.' });
    const reanalysisRequestIds = [...new Set(findings.filter(f => f.action === 'reanalyse-tile').flatMap(f => f.requestIds ?? []))];
    return { version: 1, status: findings.some(f => f.action === 'reanalyse-tile') ? 'needs-reanalysis' : 'provisional', readyForImplementation: false,
        scope: 'Automated structural evidence checks do not establish semantic completeness, visual fidelity, CMS schema acceptance or actual image inspection.',
        findings, reanalysisRequestIds, correctionPolicy: 'Re-inspect affected tile images and prompts, correct supported detections with import-result --replace, then rebuild report. Make at most two correction passes per tile in one execution; retain unresolved findings and end provisional.' };
}

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import * as cheerio from 'cheerio';
import { proposeModels } from './modeling.mjs';
import { renderReadableFamily } from './readable-report.mjs';
import { assignReportNames } from './report-names.mjs';
import { hiddenInSavedDom } from './saved-visibility.mjs';
import {buildFamilyKey} from './buildlist.mjs';
import { getRun, inRun, readJson, exists, writeJson } from './store.mjs';

const id = (prefix, ...values) => `${prefix}_${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 20)}`;
const norm = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const counted = c => c.validation?.role === 'component' && c.validation.countInBuildList === true;
const EXPORT_LIMITS = { htmlBytesPerCapture: 20 * 1024 * 1024, elements: 50000, detections: 20000, outputBytes: 100 * 1024 * 1024 };
const box = value => value && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(value[k])) ? Object.fromEntries(['x', 'y', 'w', 'h'].map(k => [k, value[k]])) : null;
// HTML and model output are data. Markdown escapes also prevent source text becoming links or HTML.
export const escapeMarkdown = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1').replace(/\r?\n/g, '<br>');
const md = escapeMarkdown;
function selectorFor(node) {
  const parts = [];
  for (let current = node; current?.type === 'tag'; current = current.parent) {
    const siblings = (current.parent?.children ?? []).filter(n => n.type === 'tag' && n.name === current.name);
    parts.unshift(siblings.length > 1 ? `${current.name}:nth-of-type(${siblings.indexOf(current) + 1})` : current.name);
    if (current.name === 'html') break;
  }
  return parts.join(' > ');
}
function roleFor(node, $) {
  const tag = node.name, attrs = node.attribs ?? {};
  if (/^h[1-6]$/.test(tag)) return 'heading';
  if (tag === 'p') return 'paragraph';
  if (tag === 'img' || tag === 'picture' || ['video', 'audio', 'canvas'].includes(tag)) return tag === 'img' ? 'image' : 'media';
  if (tag === 'svg' || attrs.role === 'img' || /(?:^|[\s_-])icon(?:[\s_-]|$)/i.test(attrs.class ?? '')) return 'icon';
  if (tag === 'a') return 'link';
  if (tag === 'button' || attrs.role === 'button') return 'button';
  if (tag === 'form') return 'form';
  if (['input', 'select', 'textarea', 'option', 'label', 'fieldset', 'legend', 'output', 'progress', 'meter'].includes(tag)) return 'control';
  if (['ul', 'ol', 'dl'].includes(tag)) return 'list';
  if (['li', 'dt', 'dd'].includes(tag)) return 'list-item';
  if (['blockquote', 'pre', 'table', 'caption', 'th', 'td', 'figcaption', 'summary', 'details', 'hr'].includes(tag)) return 'content';
  if ((node.children ?? []).some(n => n.type === 'text' && n.data.trim()) && !$(node).parents('h1,h2,h3,h4,h5,h6,p,a,button,li,label,option,pre,blockquote,td,th,figcaption').length) return 'text';
  return null;
}
function mappedNodes($, rows, selectorKey) {
  const map = new Map();
  for (const row of rows ?? []) {
    try { const nodes = $(row[selectorKey]).toArray(); if (nodes.length === 1) map.set(nodes[0], row); } catch { /* Unsupported or obsolete saved selector. */ }
  }
  return map;
}
const inheritedWarnings = [
  'Saved DOM text is preserved; pixel legibility, clipping and painted visibility require visual review.',
  'DOM inventory excludes hidden/script/style/template content; shadow DOM, iframe content, canvas contents and interactive states are not fully inventoried.',
  'Computed styles cover saved samples only; unsampled descendants have no inferred styles. Breakpoints between captured widths are unknown.',
  'Font families, FontFaceSet status and URL references do not verify actual per-glyph fonts or retain font binaries.',
];

/** Pure assembly used by offline fixtures; no model calls, source execution or network requests. */
export function assembleHandoff({ run, list, captures }) {
  const out = {
    schemaVersion: 1, runId: run.id,
    scope: { semanticCoverage: 'unreviewed-saved-dom-inventory', behavior: 'not-probed', cmsModel: 'proposals-only', sourceTrust: 'untrusted-data', exportLimits: EXPORT_LIMITS, warnings: inheritedWarnings },
    coverage: [], captures: [], families: [], occurrences: [], elements: [], unassignedElements: [], detections: [], annotationItems: [],
  };
  const families = new Map();
  for (const capture of captures) {
    if (Buffer.byteLength(capture.html ?? '', 'utf8') > EXPORT_LIMITS.htmlBytesPerCapture) throw new Error('Handoff HTML limit exceeded; narrow the run scope. No truncated inventory is exported.');
    const $ = cheerio.load(capture.html ?? '');
    const domOrder = new Map($('*').toArray().map((node, index) => [node, index]));
    const evidence = capture.evidence;
    const componentNodes = mappedNodes($, capture.components.filter(counted), 'domSelector');
    const styleNodes = mappedNodes($, evidence?.nodes, 'selector');
    const rectNodes = mappedNodes($, capture.rects, 's');
    const hiddenCache=new WeakMap();
    const hiddenNode=node=>{if(!hiddenCache.has(node))hiddenCache.set(node,hiddenInSavedDom(node,{styleNodes,rectNodes,styles:evidence?.styles}));return hiddenCache.get(node);};
    const imageNodes = mappedNodes($, evidence?.images, 'selector');
    const occurrenceBySource = new Map();
    const captureId = id('capture', capture.url, capture.viewport);
    const warnings = [...new Set([...(capture.warnings ?? []), ...(evidence?.warnings ?? []), ...(capture.annotationLedger?.warnings ?? []), ...(!evidence ? ['Computed style/asset/font analysis is missing.'] : []), ...(!capture.paths?.annotated ? ['Component annotation image is missing.'] : []), ...(!capture.html ? ['Saved HTML is missing; no element inventory can be established.'] : [])])];
    if (!capture.paths?.screenshot) warnings.push('Raw screenshot is missing for this view; saved DOM/scan evidence does not establish captured visual coverage.');
    out.captures.push({ id: captureId, url: capture.url, slug: capture.slug, viewport: capture.viewport, status: capture.status, provenance: capture.provenance ?? null, nativeAnalysis: capture.nativeAnalysis ?? null,
      paths: capture.paths, warnings, dimensions: evidence?.viewportSize ?? null, screenshotDimensions: { width: capture.width ?? null, height: capture.height ?? null }, deviceScaleFactor: evidence?.deviceScaleFactor ?? null,
      coordinateMapping: 'Saved DOM boxes use document CSS pixels; screenshot scale/DPR is recorded only when available in analysis.',
      state: evidence?.state ?? 'unknown', capturedAt: evidence?.capturedAt ?? null, preparation: evidence?.preparation ?? null,
      analysis: evidence ? { limits: evidence.limits, summary: evidence.summary, rootVariables: evidence.rootVariables, fontFaces: evidence.fontFaces, documentFonts: evidence.documentFonts, fontEvidence: evidence.fontEvidence ?? inheritedWarnings[3], assets: evidence.assets, images: evidence.images, measurement: evidence.measurement } : null });
    for (const c of capture.components) {
      if (out.detections.length >= EXPORT_LIMITS.detections) throw new Error('Handoff detection limit exceeded; narrow the run scope.');
      const detectionId = id('detection', captureId, c.id, c.domSelector, out.detections.filter(d => d.captureId === captureId && d.sourceId === c.id).length);
      out.detections.push({ ...c, id: detectionId, sourceId: c.id, captureId, labelEvidence: c.source === 'propagated' ? 'inferred-propagated-label' : c.source === 'llm' ? 'model-detection-backed-by-saved-evidence' : 'saved-detection', occurrenceId: null });
      if (!counted(c)) continue;
      const sourceKey=buildFamilyKey(c.level,c.name,c.validation?.implementationType);
      const entry = (list?.entries ?? []).find(e => e.sourceKeys?.includes(sourceKey) || !e.sourceKeys && e.level === c.level && [e.name, ...(e.aliases ?? [])].some(n => norm(n) === norm(c.name)));
      const familyKey = entry?.key ?? `${c.level}:${norm(entry?.name ?? c.name)}`;
      const familyId = id('family', familyKey);
      if (!families.has(familyId)) families.set(familyId, { id: familyId, name: entry?.name ?? c.name, level: c.level, buildListId: entry?.id ?? null, aliases: entry?.aliases ?? [], groupingBasis: entry ? 'deterministic-saved-build-list' : 'same-normalized-name-and-level', modelingStatus: 'candidate-implementation-definition; CMS type/shared-content ownership undecided', occurrenceIds: [], report: null });
      const occurrenceId = id('occurrence', capture.url, capture.viewport, c.id, c.domSelector);
      const root = [...componentNodes].find(([, value]) => value === c)?.[0];
      const sample = root && styleNodes.get(root);
      const occurrence = { id: occurrenceId, familyId, captureId, sourceId: c.id, name: c.name, level: c.level, viewport: capture.viewport, url: capture.url,
        ...(c.gaps?.length ? {gaps: c.gaps} : {}),
        parentOccurrenceId: null, ownerSourceId: c.validation.ownerId ?? null, selector: c.domSelector ?? null, savedDomOrder: domOrder.get(root) ?? null, box: box(c.box), labelEvidence: out.detections.at(-1).labelEvidence,
        elementIds: [], computedStyle: sample ? evidence.styles?.[sample.styleId] ?? null : null, variables: sample?.variables ?? {}, pseudo: sample?.pseudo ?? {},
        coverage: root ? 'saved-dom-meaningful-elements; visual-review-pending' : 'missing-or-ambiguous-owner-dom', behavior: 'unknown; not probed' };
      families.get(familyId).occurrenceIds.push(occurrenceId);
      out.occurrences.push(occurrence); occurrenceBySource.set(c.id, occurrence); out.detections.at(-1).occurrenceId = occurrenceId;
    }
    for (const occurrence of occurrenceBySource.values()) occurrence.parentOccurrenceId = occurrenceBySource.get(occurrence.ownerSourceId)?.id ?? null;
    const annotationIds = new Map((capture.annotationLedger?.items ?? []).map(item => [item.id, id('annotation', captureId, item.id)]));
    for (const item of capture.annotationLedger?.items ?? []) out.annotationItems.push({ ...item, id: annotationIds.get(item.id), localId: item.id, captureId,
      ownerId: annotationIds.get(item.ownerId) ?? null, sourceDetectionId: item.source === 'validated-detection' && item.sourceDetectionId != null ? out.detections.find(d => d.captureId === captureId && d.sourceId === item.sourceDetectionId && (d.domSelector ?? d.selector) === item.selector)?.id ?? null : null });
    const elementsByNode = new Map();
    let unownedMeaningfulElements = 0;
    $('*').each((_, node) => {
      if (hiddenNode(node)) return;
      if ($(node).is('script,style,template,noscript,head') || $(node).parents('script,style,template,noscript,head').length) return;
      if ($(node).is('[hidden],[aria-hidden="true"],input[type="hidden"]') || $(node).parents('[hidden],[aria-hidden="true"]').length) return;
      const sample = styleNodes.get(node);
      const computedStyle = sample ? evidence.styles?.[sample.styleId] ?? null : null;
      if (computedStyle?.display === 'none' || computedStyle?.visibility === 'hidden' || computedStyle?.opacity === '0') return;
      let ownerNode = node;
      while (ownerNode && !componentNodes.has(ownerNode)) ownerNode = ownerNode.parent;
      const owner = occurrenceBySource.get(componentNodes.get(ownerNode)?.id);
      const role = roleFor(node, $);
      if (!role) return;
      if (!owner) unownedMeaningfulElements++;
      if (out.elements.length + out.unassignedElements.length >= EXPORT_LIMITS.elements) throw new Error('Handoff element limit exceeded; narrow the run scope. No truncated inventory is exported.');
      const selector = selectorFor(node), attrs = node.attribs ?? {};
      const image = imageNodes.get(node);
      const rect = rectNodes.get(node);
      const originals = $(node).find('*').toArray();
      const clean = $(node).clone();
      clean.find('*').toArray().forEach((copy,index)=>{if(hiddenNode(originals[index]))$(copy).remove();});
      clean.find('script,style,template,noscript,[hidden],[aria-hidden="true"]').remove();
      const text = clean.text().trim();
      // Proposal content excludes nested implementation owners; the historical ledger stays intact.
      // Both traversals include hidden descendants until filtering, preserving positional correspondence.
      const ownedRaw = $(node).clone();
      ownedRaw.find('*').toArray().forEach((copyNode, index) => {
        if (componentNodes.has(originals[index]) || hiddenNode(originals[index])) $(copyNode).remove();
      });
      ownedRaw.find('script,style,template,noscript,[hidden],[aria-hidden="true"],input[type="hidden"]').remove();
      // Never retain sensitive values inside formatted markup either.
      ownedRaw.find('input[type="password"]').removeAttr('value');
      if (String(attrs.type).toLowerCase() === 'password') ownedRaw.removeAttr('value');
      const element = { id: owner ? id('element', owner.id, selector) : id('unassigned', captureId, selector), ownerOccurrenceId: owner?.id ?? null, parentElementId: null, captureId, selector, tag: node.name, role,
        observedText: text, observedAttributes: Object.fromEntries(['alt', 'title', 'aria-label', 'aria-checked', 'aria-selected', 'aria-expanded', 'role', 'type', 'name', 'placeholder', 'href', 'value', 'checked', 'selected', 'disabled', 'required', 'multiple', 'readonly', 'min', 'max', 'step', 'pattern', 'minlength', 'maxlength', 'accept', 'autocomplete', 'for'].filter(k => attrs[k] !== undefined && !(k === 'value' && String(attrs.type).toLowerCase() === 'password')).map(k => [k, attrs[k]])),
        ownedContent: { text: ownedRaw.text(), html: ownedRaw.html() },
        observationLimits: ['Attributes and text reflect saved HTML; live properties are unverified.', ...(String(attrs.type).toLowerCase() === 'password' ? ['Password value omitted from export.'] : [])],
        observationStatus: sample || rect || image ? 'saved-dom-with-geometry; painted-legibility-unreviewed' : 'saved-dom-only; visibility-and-legibility-unverified',
        candidateSemanticField: { name: role, status: 'proposal', cmsType: null },
        box: box(sample?.box ?? image?.box ?? rect), computedStyle, styleId: sample?.styleId ?? null, styleStatus: computedStyle ? 'captured' : 'not-captured', variables: sample?.variables ?? {}, pseudo: sample?.pseudo ?? {},
        formatting: { tags: [...new Set(clean.find('strong,b,em,i,u,s,del,code,br,a,ul,ol,li').toArray().map(n => n.name))], richTextType: 'undecided; DOM formatting is evidence only' },
        assets: Object.fromEntries(['src', 'srcset', 'poster'].filter(k => attrs[k] !== undefined).map(k => [k, attrs[k]])), imageEvidence: image ?? null,
        behavior: { status: 'unknown', reason: 'Interactions were not probed.', destinationAttribute: attrs.href ?? null, destinationVerified: false },
        evidence: { html: capture.paths?.html ?? null, analysis: sample ? capture.paths?.analysis ?? null : null, screenshot: capture.paths?.screenshot ?? null },
        annotation: { drawn: false, reason: 'Inventory-only element; screenshot annotations show implementation component boundaries.' } };
      if (owner) { out.elements.push(element); owner.elementIds.push(element.id); }
      else out.unassignedElements.push(element);
      elementsByNode.set(node, element);
    });
    out.captures.at(-1).unownedMeaningfulElements = unownedMeaningfulElements;
    if (unownedMeaningfulElements) warnings.push(`${unownedMeaningfulElements} meaningful DOM element candidates lie outside counted implementation owners; retained separately in unassignedElements with unresolved ownership.`);
    const missingStyles = [...elementsByNode.values()].filter(e => e.ownerOccurrenceId && !e.computedStyle).length;
    if (missingStyles) warnings.push(`${missingStyles} owned meaningful elements have no saved computed style sample.`);
    for (const [node, element] of elementsByNode) {
      for (let parent = node.parent; parent; parent = parent.parent) {
        const parentElement = elementsByNode.get(parent);
        if (parentElement?.ownerOccurrenceId === element.ownerOccurrenceId) { element.parentElementId = parentElement.id; break; }
      }
    }
  }
  out.families = [...families.values()];
  assignReportNames(out.families);
  proposeModels(out);
  for (const page of run.pages) for (const viewport of run.viewports) {
    const capture = out.captures.find(c => c.url === page.url && c.viewport === viewport);
    const state = page.viewports?.[viewport];
    const visualStatus = capture?.paths?.screenshot ? 'captured' : capture?.paths?.html ? 'scan-only' : state?.status === 'failed' ? 'failed' : 'not-captured';
    const raw = captures.find(c => c.url === page.url && c.viewport === viewport);
    const styleStatus = raw?.evidence?.nodes?.some(n => raw.evidence.styles?.[n.styleId]) ? 'captured' : 'not-captured';
    out.coverage.push({ url: page.url, viewport, captureId: capture?.id ?? null, status: visualStatus, scanStatus: capture?.status ?? state?.status ?? 'not-captured', styleStatus, error: state?.error ?? null, flags: state?.flags ?? [] });
  }
  out.summary = { families: out.families.length, occurrences: out.occurrences.length, elements: out.elements.length, unassignedElements: out.unassignedElements.length, detections: out.detections.length, annotationItems: out.annotationItems.length,
    uncertainDetections: out.detections.filter(d => d.validation?.role === 'uncertain').length, excludedDetections: out.detections.filter(d => !d.occurrenceId).length,
    capturedViews: out.coverage.filter(c => c.status === 'captured').length, scanOnlyViews: out.coverage.filter(c => c.status === 'scan-only').length,
    missingCaptures: out.coverage.filter(c => c.status !== 'captured').length, viewsWithoutStyleEvidence: out.coverage.filter(c => c.styleStatus !== 'captured').length,
    elementsWithoutStyles: out.elements.filter(e => e.styleStatus === 'not-captured').length,
    semanticCoverage: out.scope.semanticCoverage, warnings: out.captures.reduce((n, c) => n + c.warnings.length, 0) };
  return out;
}

export function renderOverview(data) {
  const lines = ['# Website discovery handoff', '', `Run: ${md(data.runId)}. ${data.summary.families} candidate implementation families, ${data.summary.occurrences} occurrences and ${data.summary.elements} DOM elements.`, '',
    'Read the assigned component report for its summary, fields, children, observed content and visual specification. Follow its linked child reports and evidence appendix for exact measurements. CMS mapping remains the destination developer’s responsibility.', '',
    'This inventory is provisional. DOM presence and geometry do not establish complete semantic coverage or painted legibility. Candidate fields are proposals; no CMS types or shared content instances are approved.', '',
    'Annotated screenshots use solid blue section boundaries, dashed red nested items, green link groups and purple actions. Readable labels are capture-local; the linked annotation JSON and discovery.json annotationItems preserve ownership and source geometry. Extra annotation boxes do not create implementation families or CMS types. There is no sidebar on the images.', '',
    ...data.scope.warnings.map(w => `- ${md(w)}`), '', '## Families', '', '| ID | Component | Occurrences | Report |', '| --- | --- | --- | --- |'];
  for (const f of data.families) lines.push(`| ${md(f.componentCode ?? f.id)} | ${md(f.name)} | ${f.occurrenceIds.length} | [Report](components/${f.report.split('/').at(-1)}) |`);
  lines.push('', '## Capture coverage', '');
  lines.push(`${data.summary.capturedViews} views have raw screenshots; ${data.summary.scanOnlyViews} are DOM/scan-only; ${data.summary.missingCaptures} requested views lack raw screenshots. ${data.summary.viewsWithoutStyleEvidence} requested views lack saved computed style samples.`, '');
  for (const c of data.coverage) lines.push(`- ${md(c.url)} / ${md(c.viewport)}: visual evidence ${md(c.status)}; style evidence ${md(c.styleStatus)}; scan status ${md(c.scanStatus)}${c.error ? `; error ${md(c.error)}` : ''}${c.flags?.length ? `; flags ${md(c.flags.join('; '))}` : ''}`);
  for (const c of data.captures) {
    lines.push('', `### ${md(c.url)} / ${md(c.viewport)}`, '', `Captured viewport: ${c.dimensions?.width ?? 'unknown'} × ${c.dimensions?.height ?? 'unknown'} CSS pixels; device scale: ${md(c.deviceScaleFactor ?? 'unknown')}. ${md(c.coordinateMapping)}`, '',
      `CSS, fonts, asset URL references and loading status: ${md(c.paths?.analysis ?? 'not captured')}. These are references; binaries are not exported.`, '', ...c.warnings.map(w => `- ${md(w)}`));
  }
  lines.push('', '## Excluded and uncertain detections', '', '| Detection | Name | Role | Owner source ID | Reason |', '| --- | --- | --- | --- | --- |');
  for (const d of data.detections.filter(d => !d.occurrenceId)) lines.push(`| ${d.id} | ${md(d.name)} | ${md(d.validation?.role ?? 'unknown')} | ${md(d.validation?.ownerId)} | ${md(d.validation?.reason ?? 'No validation available')} |`);
  lines.push('', '## Unassigned DOM evidence', '', `${data.unassignedElements?.length ?? 0} meaningful saved DOM candidates have unresolved implementation ownership. They remain in discovery.json unassignedElements for boundary review and have no proposed owner or CMS field.`, '',
    '| Evidence ID | Capture | Role / selector | Exact observed text | Style / box |', '| --- | --- | --- | --- | --- |');
  for (const e of data.unassignedElements ?? []) lines.push(`| ${e.id} | ${e.captureId} | ${md(e.role)} / ${md(e.selector)} | ${md(e.observedText)} | ${md(e.styleStatus)} / ${md(JSON.stringify(e.box))} |`);
  lines.push('', 'Authoritative full evidence, all detections, IDs, relationships and style observations: discovery.json. Interactive behavior and responsive behavior between captured widths remain unknown.', '');
  return lines.join('\n');
}

export function renderFamily(family, data) {
  return renderReadableFamily(family, data, md);
}

export function renderFamilyEvidence(family, data) {
  const lines = [`# ${md(family.componentCode ? `${family.componentCode} — ${family.name}` : family.name)} — evidence appendix`, '', `[Readable component specification](${family.report.split('/').at(-1)})`, '', `Definition: ${family.id}. ${md(family.modelingStatus)}.`, '', 'Only captured viewport variants below are observed. Repeated instances share a proposed implementation definition, not automatically shared content.', '',
    'Root component bounds retain their source detection/propagation geometry; they are not independently measured DOM boxes. Use saved style/element geometry and capture scale evidence for CSS measurements.', ''];
  lines.push('## Captured variants', '', '| Occurrence | Viewport / captured width | Root geometry | Root layout / type observation |', '| --- | --- | --- | --- |');
  for (const occurrence of data.occurrences.filter(o => o.familyId === family.id)) {
    const capture = data.captures.find(c => c.id === occurrence.captureId);
    lines.push(`| ${occurrence.id} | ${md(occurrence.viewport)} / ${capture.dimensions?.width ?? 'unknown'} | ${md(JSON.stringify(occurrence.box))} | ${md(styleSummary(occurrence.computedStyle))} |`);
  }
  lines.push('', 'These rows record observed values independently. Different captured widths do not establish exact CSS breakpoints, intended variants, or behavior at uncaptured widths.', '');
  for (const occurrence of data.occurrences.filter(o => o.familyId === family.id)) {
    const capture = data.captures.find(c => c.id === occurrence.captureId);
    lines.push(`## ${md(occurrence.viewport)} — ${md(occurrence.url)}`, '', `Occurrence: ${occurrence.id}; parent: ${occurrence.parentOccurrenceId ?? 'page'}. Label evidence: ${md(occurrence.labelEvidence)}.`, '',
      `Coverage: ${md(occurrence.coverage)}. Behavior: ${md(occurrence.behavior)}.`, '', `Source paths relative to run: ${md(JSON.stringify(capture.paths))}`, '',
      `Captured root box: ${md(JSON.stringify(occurrence.box))}. ${md(styleSummary(occurrence.computedStyle))}`, '',
      ...renderModelProposal(occurrence.modelProposal),
      '### Elements in saved DOM order', '', '| Element ID / parent | Role / selector | Observed text | Candidate semantic field | Evidence / box |', '| --- | --- | --- | --- | --- |');
    const elements = data.elements.filter(e => e.ownerOccurrenceId === occurrence.id);
    for (const e of elements) lines.push(`| ${e.id} / ${e.parentElementId ?? 'root'} | ${md(e.role)} / ${md(e.selector)} | ${md(e.observedText)} | ${md(e.candidateSemanticField.name)} (proposal) | ${md(e.observationStatus)} / ${md(JSON.stringify(e.box))} |`);
    for (const e of elements) lines.push('', `### ${e.id}`, '', `Observed attributes: ${md(JSON.stringify(e.observedAttributes))}. ${md(e.observationLimits.join(' '))}`, '',
      `Typography / layout / appearance (${e.styleStatus}): ${md(styleSummary(e.computedStyle))}`, '', `Full property values: discovery.json element ${e.id}, computedStyle. CSS variables / pseudo: ${md(JSON.stringify({ variables: e.variables, pseudo: e.pseudo }))}`, '',
      `Formatting: ${md(JSON.stringify(e.formatting))}`, '', `Assets / image readiness: ${md(JSON.stringify({ references: e.assets, image: e.imageEvidence }))}`, '',
      `Behavior / destination: ${md(JSON.stringify(e.behavior))}`, '', `Evidence: ${md(JSON.stringify(e.evidence))}. ${md(e.annotation.reason)}`);
    const fonts = capture.analysis?.documentFonts ?? [];
    const assets = capture.analysis?.assets ?? [];
    lines.push('', 'Capture limits and unresolved gaps:', '', ...[...data.scope.warnings, ...capture.warnings].map(w => `- ${md(w)}`), '',
      `Font loading: ${fonts.length} FontFaceSet entries; ${fonts.filter(f => f.status === 'loaded').length} loaded, ${fonts.filter(f => f.status !== 'loaded').length} other/unknown. Actual rendered glyph fonts are unverified.`, '',
      `Assets: ${assets.length} URL references; ${assets.filter(a => a.error || a.status >= 400).length} failed requests. Shared font/asset inventory: discovery.json capture ${capture.id}, analysis. Limits: ${md(JSON.stringify(capture.analysis?.limits ?? 'analysis missing'))}.`, '');
  }
  return lines.join('\n');
}

function renderModelProposal(model) {
  if (!model) return [];
  const lines = ['### Component anatomy', '', 'CMS-neutral proposals from owned saved DOM and direct child boundaries. Collection counts describe this occurrence only.', '',
    '| Child family | Observed count / positions | Occurrence references | Component report |', '| --- | --- | --- | --- |'];
  for (const child of model.anatomy) lines.push(`| ${md(child.name)} / ${child.familyId} | ${child.observedCount} / ${child.positions.join(', ')} | ${child.occurrenceIds.join(', ')} | ${child.report ? `[Report](${child.report.split('/').at(-1)})` : 'unavailable'} |`);
  if (!model.anatomy.length) lines.push('| No observed direct child components | 0 | — | — |');
  lines.push('', `Observed child order: ${md(model.childOrder.join(', ') || 'none')}.`, '', '### Proposed fields', '',
    '| Name / neutral type / status | Exact observed value or child references | Evidence elements | Measured typography / style references | Asset references | Unknowns |', '| --- | --- | --- | --- | --- | --- |');
  for (const field of model.fields) {
    const value = field.type === 'ordered-collection' ? { observedCount: field.observedCount, familyId: field.familyId, occurrenceIds: field.occurrenceIds, positions: field.positions, report: field.report } : field.observedValue;
    const styles = (field.styleEvidence ?? []).map(s => `${s.elementId ?? s.occurrenceId} (${s.status}; style ${s.styleId ?? 'root/unknown'}): ${fieldStyleSummary(s.computedStyle)}. Full values: discovery.json field styleEvidence and element/occurrence computedStyle.`).join('\n');
    const evidenceIds = [...field.evidenceElementIds, ...(field.evidenceOccurrenceIds ?? [])];
    lines.push(`| ${md(field.name)} / ${md(field.type)} / proposal | ${md(JSON.stringify(value))} | ${md(evidenceIds.join(', ') || 'child occurrence references')} | ${md(styles || 'See child component reports for measured fields.')} | ${md(JSON.stringify(field.assets ?? []))} | ${md(field.unknowns.join(' '))} |`);
  }
  lines.push('', ...model.unknowns.map(w => `- ${md(w)}`), '');
  return lines;
}

function fieldStyleSummary(style) {
  if (!style) return 'No saved style sample; typography unknown';
  const keys = ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'background-image', 'object-fit'];
  return keys.filter(k => style[k] !== undefined).map(k => `${k}=${style[k]}`).join('; ') || 'See measured ledger values';
}

function styleSummary(style) {
  if (!style) return 'No computed style sample captured; layout and typography values are unknown.';
  const groups = {
    Typography: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'text-decoration'],
    Layout: ['display', 'position', 'width', 'height', 'max-width', 'flex-direction', 'flex-wrap', 'grid-template-columns', 'grid-template-rows', 'row-gap', 'column-gap', 'align-items', 'justify-content', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
    Appearance: ['color', 'background-color', 'background-image', 'border-radius', 'box-shadow', 'opacity', 'overflow-x', 'overflow-y', 'object-fit', 'object-position'],
  };
  return Object.entries(groups).map(([name, keys]) => `${name}: ${keys.filter(k => style[k] !== undefined).map(k => `${k}=${style[k]}`).join('; ') || 'not sampled'}`).join('. ');
}

export async function exportHandoff(runId, options = {}) {
  if (Object.keys(options).length) throw new Error('No handoff options are currently supported');
  const run = await getRun(runId);
  const previous=await readJson(inRun(runId,'export/discovery.json'),null);
  const [{ buildPageData }, { buildList }] = await Promise.all([import('./pagedata.mjs'), import('./buildlist.mjs')]);
  const list = await buildList(runId);
  const captures = [];
  for (const page of run.pages) for (const viewport of run.viewports) {
    const state = page.viewports?.[viewport];
    if (state?.status !== 'ok') continue;
    const pageData = await buildPageData(runId, viewport, page.url);
    const htmlPath = `html/${viewport}/${page.slug}.html`;
    // A lightweight recapture can leave older files on disk. Only the current run-state pointer establishes analysis provenance.
    const analysisPath = state.shot !== false ? state.evidence?.path ?? null : null;
    const shotPath = `shots/${viewport}/${page.slug}.png`;
    const annotatedPath = `export/annotated/${viewport}/${page.slug}.png`;
    const annotationPath = `export/annotated/${viewport}/${page.slug}.json`;
    const evidence = analysisPath ? await readJson(inRun(runId, analysisPath), null) : null;
    const screenshot = evidence?.screenshot ?? shotPath;
    const paths = { html: await exists(inRun(runId, htmlPath)) ? htmlPath : null, analysis: evidence ? analysisPath : null,
      screenshot: state.shot !== false && await exists(inRun(runId, screenshot)) ? screenshot : null, annotated: state.shot !== false && await exists(inRun(runId, annotatedPath)) ? annotatedPath : null,
      annotationData: state.shot !== false && await exists(inRun(runId, annotationPath)) ? annotationPath : null };
    const annotationLedger = paths.annotationData ? await readJson(inRun(runId, paths.annotationData)) : null;
    if (paths.annotated && !annotationLedger) throw new Error('Annotated screenshot has no current annotation ledger; regenerate report');
    const html = paths.html ? await readFile(inRun(runId, htmlPath), 'utf8') : '';
    const rects = await readJson(inRun(runId, `rects/${viewport}/${page.slug}.json`), []);
    if (annotationLedger) {
      const hash = value => createHash('sha256').update(value).digest('hex');
      const current = { sha256: paths.screenshot ? hash(await readFile(inRun(runId, screenshot))) : null,
        htmlSha256: hash(html), rectsSha256: hash(JSON.stringify(rects)), componentsSha256: hash(JSON.stringify(pageData.components)), evidenceSha256: hash(JSON.stringify(evidence)) };
      if (Object.entries(current).some(([key, value]) => !value || annotationLedger.source?.[key] !== value)) throw new Error('Annotation ledger does not match the current screenshot, DOM, rectangles, styles or detections; regenerate report');
    }
    const provenance = {};
    for (const [kind, relativePath] of Object.entries(paths)) if (relativePath) provenance[kind] = { path: relativePath, sha256: createHash('sha256').update(await readFile(inRun(runId, relativePath))).digest('hex') };
    captures.push({ ...pageData, status: state.status, provenance, html,
      rects, evidence, annotationLedger,
      warnings: [...(pageData.warnings ?? []), ...(state.flags ?? [])],
      paths });
  }
  const data = assembleHandoff({ run, list, captures });
  const familyReports = data.families.flatMap(f => [
    { path: f.report, text: renderFamily(f, data) },
    { path: f.evidenceReport, text: renderFamilyEvidence(f, data) },
  ]);
  const files = ['export/discovery.json', 'export/report.md', ...familyReports.map(r => r.path), ...data.captures.flatMap(c => [c.paths?.annotated,c.paths?.annotationData].filter(Boolean))];
  const reports = [renderOverview(data), ...familyReports.map(r => r.text)];
  const outputBytes = Buffer.byteLength(JSON.stringify(data)) + reports.reduce((n, report) => n + Buffer.byteLength(report), 0);
  if (outputBytes > EXPORT_LIMITS.outputBytes) throw new Error('Handoff output limit exceeded; narrow the run scope. No truncated inventory is exported.');
  await mkdir(inRun(runId, 'export/components'), { recursive: true });
  await writeJson(inRun(runId, files[0]), data);
  await writeFile(inRun(runId, files[1]), reports[0], 'utf8');
  for (const report of familyReports) await writeFile(inRun(runId, report.path), report.text, 'utf8');
  const currentReports=new Set(familyReports.map(r=>r.path));
  for(const file of (previous?.families??[]).flatMap(f=>[f.report,f.evidenceReport])){
    if(typeof file==='string'&&/^export\/components\/[^/]+\.md$/.test(file)&&!currentReports.has(file))await rm(inRun(runId,file),{force:true});
  }
  return { files, summary: data.summary };
}

// Presentation only: proposals and saved measurements remain authoritative in the evidence export.
const humanize = value => String(value ?? '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').replace(/^./, c => c.toUpperCase());
const names = { supportingText: 'Body', actions: 'Action', children: 'Child collection' };
const types = { text: 'Text', 'formatted-content': 'Formatted text', image: 'Image', link: 'Link', action: 'Action', control: 'Form control', 'presentation-only': 'Visual presentation', 'ordered-collection': 'Ordered child components' };
const purposes = { text: 'Display the observed text.', 'formatted-content': 'Display the observed content and formatting.', image: 'Display the observed image.', link: 'Provide the observed label and destination.', action: 'Represent the observed action control; interaction is unverified.', control: 'Represent the observed input or control.', 'presentation-only': 'Record a visual or renderer responsibility; editability is undecided.', 'ordered-collection': 'Compose the observed direct child components in order; editor limits are undecided.' };
const fieldName = field => field.label || field.displayName || names[field.name] || humanize(field.name);
const styleLabels = { 'font-family': 'Font', 'font-size': 'Font size', 'font-weight': 'Weight', 'font-style': 'Font style', 'line-height': 'Line height', 'letter-spacing': 'Letter spacing', 'word-spacing': 'Word spacing', 'color': 'Text color', 'border-radius': 'Radius', 'row-gap': 'Row spacing', 'column-gap': 'Column spacing', gap: 'Spacing', 'background-color': 'Background color', 'background-image': 'Background image' };
const attrLabels = { href: 'Destination', src: 'Image source', srcset: 'Image source candidates', alt: 'Alternative text', 'aria-label': 'Accessible label', 'aria-expanded': 'Expanded state', 'aria-checked': 'Checked state', 'aria-selected': 'Selected state', for: 'Associated control', readonly: 'Read only', minlength: 'Minimum saved length', maxlength: 'Maximum saved length' };
const contentAttributes = value => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => ['href', 'alt', 'title', 'value', 'placeholder', 'src', 'srcset', 'poster'].includes(key)));
const styleGroups = {
  Typography: ['font-family', 'font-size', 'font-weight', 'font-style', 'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform', 'text-decoration', 'white-space', 'color'],
  Layout: ['display', 'position', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height', 'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'grid-template-columns', 'grid-template-rows', 'gap', 'row-gap', 'column-gap', 'align-items', 'justify-content', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  Appearance: ['background-color', 'background-image', 'background-size', 'background-position', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-color', 'border-width', 'border-style', 'border-radius', 'box-shadow', 'opacity', 'overflow', 'overflow-x', 'overflow-y', 'object-fit', 'object-position'],
};

// Only locally generated relative paths become links. Source URLs remain escaped text.
function localPath(path) {
  if (typeof path !== 'string' || !path || /[\\\u0000-\u001f\u007f]/.test(path) || /^(?:\/|[a-z][a-z0-9+.-]*:)/i.test(path)) return null;
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..')) return null;
  return parts.map(part => encodeURIComponent(part).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join('/');
}
function familyPath(family, appendix = false) {
  const path = appendix ? family.evidenceReport : family.report;
  if (path?.startsWith('export/components/')) return localPath(path.slice('export/components/'.length));
  return localPath(`${family.id}${appendix ? '.evidence' : ''}.md`);
}
function leaves(value, prefix = '') {
  if (value === null || value === undefined) return [[prefix, 'Unknown']];
  if (typeof value !== 'object') return [[prefix, String(value)]];
  return Object.entries(value).flatMap(([key, child]) => leaves(child, [prefix, /^\d+$/.test(key) ? `Item ${Number(key) + 1}` : humanize(key)].filter(Boolean).join(' / ')));
}

export function renderReadableFamily(family, data, md) {
  const occurrences = (data.occurrences ?? []).filter(o => o.familyId === family.id);
  const families = new Map((data.families ?? []).map(f => [f.id, f]));
  const appendixPath = familyPath(family, true);
  const appendix = appendixPath ? `[Evidence appendix](${appendixPath})` : 'Evidence appendix unavailable';
  const exact = `${appendix} and [full discovery evidence](../discovery.json)`;
  const preview = value => {
    const text = String(value ?? '');
    return text.length > 500 ? `${md(text.slice(0, 500))}… (Preview; exact value and full HTML: ${exact}.)` : md(text);
  };
  const childNames = [...new Set(occurrences.flatMap(o => (o.modelProposal?.anatomy ?? []).map(c => families.get(c.familyId)?.name ?? c.name)))];
  const ownFields = [...new Set(occurrences.flatMap(o => (o.modelProposal?.fields ?? []).filter(f => f.type !== 'ordered-collection').map(fieldName)))];
  const lines = [`# ${md(family.componentCode ? `${family.componentCode} — ${family.name}` : family.name)}`, '', '## Summary', '',
    childNames.length ? `${md(family.name)} component has ${childNames.map(md).join(', ')} children.` : `${md(family.name)} component has no direct child components recorded.`, '',
    ownFields.length ? `Its proposed fields are ${ownFields.map(md).join(', ')}.` : childNames.length ? 'Content is provided by its child components.' : 'No owned content fields have been proposed.', '',
    `${occurrences.length} saved occurrence${occurrences.length === 1 ? ' is' : 's are'} described below. Structure and fields are CMS-neutral proposals. Repeated components do not establish shared content ownership.`, '',
    '## Proposed structure and fields', '', 'Field names and purposes are proposals from saved content and child boundaries. Observed child counts are not editor minimums or maximums.', '',
    '| Component | Field | Plain-language type | Purpose |', '| --- | --- | --- | --- |'];
  const definitions = new Set();
  function definition(component, field, scope) {
    const signature = `${component}\0${fieldName(field)}\0${field.type}\0${field.familyId ?? ''}`;
    if (definitions.has(signature)) return;
    definitions.add(signature);
    const child = families.get(field.familyId);
    const path = child && familyPath(child);
    const childLink = path ? ` See [${md(child.name)} fields](${path}).` : '';
    const observed = scope.filter(o => (o.modelProposal?.fields ?? []).some(f => fieldName(f) === fieldName(field) && f.type === field.type && f.familyId === field.familyId)).length;
    const availability = observed < scope.length ? ` Observed in ${observed} of ${scope.length} saved occurrences; editorial optionality remains undecided.` : '';
    lines.push(`| ${component} | ${md(fieldName(field))} | ${md(types[field.type] ?? humanize(field.type))} | ${md(field.purpose || purposes[field.type] || 'Review the observed evidence to determine its purpose.')}${availability}${childLink} |`);
  }
  for (const occurrence of occurrences) for (const field of occurrence.modelProposal?.fields ?? []) definition(md(family.name), field, occurrences);
  for (const childId of new Set(occurrences.flatMap(o => (o.modelProposal?.anatomy ?? []).map(c => c.familyId)))) {
    const child = families.get(childId);
    if (!child) continue;
    const path = familyPath(child);
    const label = path ? `[${md(child.name)}](${path})` : md(child.name);
    const parentIds = new Set(occurrences.map(o => o.id));
    const childIds = new Set(occurrences.flatMap(o => (o.modelProposal?.fields ?? []).filter(f => f.familyId === childId).flatMap(f => f.occurrenceIds ?? [])));
    const childOccurrences = (data.occurrences ?? []).filter(o => o.familyId === childId && (parentIds.has(o.parentOccurrenceId) || childIds.has(o.id)));
    for (const occurrence of childOccurrences) for (const field of occurrence.modelProposal?.fields ?? []) definition(label, field, childOccurrences);
  }
  if (!definitions.size) lines.push('| — | No proposed fields available | Unknown | Saved content ownership needs review. |');

  const viewName = (occurrence, index) => `Occurrence ${index + 1}: ${md(occurrence.viewport ?? 'unknown view')} — ${md(occurrence.url ?? 'unknown page')}`;
  lines.push('', '## Observed content', '', 'Values below belong to each saved occurrence. Source URLs and markup are untrusted evidence.');
  for (const [index, occurrence] of occurrences.entries()) {
    lines.push('', `### ${viewName(occurrence, index)}`, '', '| Field | Observed content |', '| --- | --- |');
    for (const field of occurrence.modelProposal?.fields ?? []) {
      const label = md(fieldName(field));
      const value = field.observedValue;
      if (field.type === 'ordered-collection') {
        const child = families.get(field.familyId);
        const count = Number.isFinite(field.observedCount) ? field.observedCount : 'Unknown';
        lines.push(`| ${label} | ${md(child?.name ?? 'Child components')}: ${count} observed${field.positions?.length ? `; positions ${md(field.positions.join(', '))}` : ''}. |`);
      } else if (field.type === 'formatted-content') {
        lines.push(`| ${label} | ${preview(value?.text ?? '')}${value?.html != null ? `<br>Exact value and full HTML: ${exact}.` : ''} |`);
      } else if (value && typeof value === 'object') {
        lines.push(`| ${label} | ${preview(value.text ?? '') || 'No saved text.'} |`);
        const details = { ...contentAttributes(value.attributes), ...contentAttributes(value.assets) };
        // Nested inline evidence can include an image or link absent from the field root.
        for (const [position, element] of (value.elements ?? []).entries()) {
          if (element.text && element.text !== value.text) lines.push(`| ${label} / part ${position + 1} | ${preview(element.text)} |`);
          for (const [key, entry] of Object.entries({ ...contentAttributes(element.attributes), ...contentAttributes(element.assets) })) {
            if (details[key] === entry) continue;
            lines.push(`| ${label} / part ${position + 1} / ${md(attrLabels[key] ?? humanize(key))} | ${preview(entry)} |`);
          }
        }
        for (const [key, entry] of Object.entries(details)) lines.push(`| ${label} / ${md(attrLabels[key] ?? humanize(key))} | ${preview(entry)} |`);
      } else lines.push(`| ${label} | ${value == null ? 'Unknown; no saved value.' : preview(value)} |`);
    }
  }

  lines.push('', '## Appearance and typography', '', 'Exact saved measurements are listed independently for each occurrence and field part. Differences between captured widths do not establish breakpoints or behaviour at other widths.');
  function styleRow(label, sample) {
    if (!sample?.computedStyle) {
      lines.push(`| ${md(label)} | No saved style sample; measurements unknown. | Unknown | Unknown |`);
      return;
    }
    const cells = [];
    for (const [group, keys] of Object.entries(styleGroups)) {
      const properties = keys.filter(key => {
        const value = sample.computedStyle[key];
        if (value === undefined) return false;
        if (group === 'Appearance' && (value === 'none' || (key === 'background-color' && ['transparent', 'rgba(0, 0, 0, 0)'].includes(value)) || (key === 'border-radius' && ['0', '0px'].includes(value)))) return false;
        return true;
      });
      cells.push(properties.flatMap(property => leaves(sample.computedStyle[property]).map(([part, entry]) => `${md(styleLabels[property] ?? humanize(property))}${part ? ` / ${md(part)}` : ''}: ${md(entry)}`)).join('; ') || 'No relevant saved values');
    }
    lines.push(`| ${md(label)} | ${cells.join(' | ')} |`);
  }
  for (const [index, occurrence] of occurrences.entries()) {
    const capture = (data.captures ?? []).find(c => c.id === occurrence.captureId);
    lines.push('', `### ${viewName(occurrence, index)}`, '', `Captured viewport width: ${md(capture?.dimensions?.width ?? 'unknown')}${capture?.dimensions?.width != null ? ' CSS pixels' : ''}.`);
    lines.push('', '| Element | Typography | Layout and spacing | Appearance |', '| --- | --- | --- | --- |');
    styleRow('Component root', occurrence);
    for (const field of occurrence.modelProposal?.fields ?? []) {
      if (field.type === 'ordered-collection') continue;
      const seen = new Set();
      const samples = (field.styleEvidence ?? []).filter(sample => {
        const signature = JSON.stringify(sample.computedStyle);
        if (seen.has(signature)) return false;
        seen.add(signature); return true;
      });
      if (!samples.length) styleRow(fieldName(field), null);
      for (const [part, sample] of samples.entries()) styleRow(`${fieldName(field)}${samples.length > 1 ? ` / part ${part + 1}` : ''}`, sample);
    }
    if (capture?.analysis?.documentFonts) {
      const fonts = capture.analysis.documentFonts;
      lines.push('', fonts.length ? `Font loading: ${fonts.filter(f => f.status === 'loaded').length} of ${fonts.length} saved font entries report loaded; actual glyph fonts are unverified.` : 'No font loading entries captured; load status unknown.');
    }
    if (capture?.analysis?.assets) {
      const assets = capture.analysis.assets;
      lines.push('', `Asset requests: ${assets.length} saved references; ${assets.filter(a => a.error || a.status >= 400).length} recorded failures. Availability of other assets is unverified.`);
    }
  }
  lines.push('', `Complete CSS properties, custom properties and pseudo-element observations: ${exact}.`);

  lines.push('', '## Behaviour and accessibility', '', 'Observed attributes come from saved HTML. Interactions were not probed. Keyboard operation, focus order, destination availability, live state and accessibility conformance remain unknown.', '',
    '| Occurrence / field | Observed attribute | Saved value |', '| --- | --- | --- |');
  let attributeCount = 0;
  for (const [index, occurrence] of occurrences.entries()) {
    const fields = occurrence.modelProposal?.fields ?? [];
    for (const element of (data.elements ?? []).filter(e => e.ownerOccurrenceId === occurrence.id)) {
      const field = fields.find(f => f.evidenceElementIds?.includes(element.id));
      for (const [key, value] of Object.entries(element.observedAttributes ?? {})) {
        attributeCount++;
        lines.push(`| Occurrence ${index + 1} / ${md(field ? fieldName(field) : humanize(element.role ?? 'Element'))} | ${md(attrLabels[key] ?? humanize(key))} | ${preview(value)} |`);
      }
    }
  }
  if (!attributeCount) lines.push('| All occurrences | No saved attributes available | Unknown |');
  lines.push('', '## Gaps', '');
  const gaps = new Set(['Semantic field names, CMS mapping, requiredness, localization and shared content policy require review.', 'Painted visibility, clipping, legibility and actual per-glyph fonts remain unverified.']);
  for (const warning of data.scope?.warnings ?? []) gaps.add(warning);
  for (const occurrence of occurrences) {
      if (occurrence.gaps?.length) gaps.add(`Incomplete render (nonblocking): ${occurrence.name} — ${occurrence.gaps.join(', ')}. Component retained; missing appearance is unverified.`);
    for (const warning of occurrence.modelProposal?.unknowns ?? []) gaps.add(warning);
    for (const field of occurrence.modelProposal?.fields ?? []) for (const warning of field.unknowns ?? []) gaps.add(warning);
    const capture = (data.captures ?? []).find(c => c.id === occurrence.captureId);
    for (const warning of capture?.warnings ?? []) gaps.add(warning);
  }
  for (const gap of gaps) lines.push(`- ${md(gap)}`);
  lines.push('', '## Supporting evidence', '', `- ${appendix}: exact selectors, relationships, full content and measurements.`, '- [Full discovery evidence](../discovery.json): complete machine-readable evidence.', '');
  for (const [index, occurrence] of occurrences.entries()) {
    const capture = (data.captures ?? []).find(c => c.id === occurrence.captureId);
    lines.push(`### ${viewName(occurrence, index)}`, '');
    for (const [key, label] of Object.entries({ html: 'Saved HTML', screenshot: 'Raw screenshot', annotated: 'Component annotation', annotationData: 'Annotation boundaries and ownership', analysis: 'Saved style and asset analysis' })) {
      const path = localPath(capture?.paths?.[key]);
      lines.push(path ? `- [${label}](../../${path})` : `- ${label}: unavailable.`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

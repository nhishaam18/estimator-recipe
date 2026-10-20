import * as cheerio from 'cheerio';

// Deterministic, CMS-neutral proposals from saved evidence; no publishing policy is inferred.
export function proposeModels(data) {
  const familyById = new Map(data.families.map(f => [f.id, f]));
  const elementsByOwner = new Map(), childrenByOwner = new Map();
  for (const element of data.elements) {
    if (!elementsByOwner.has(element.ownerOccurrenceId)) elementsByOwner.set(element.ownerOccurrenceId, []);
    elementsByOwner.get(element.ownerOccurrenceId).push(element);
  }
  for (const child of data.occurrences) {
    if (!childrenByOwner.has(child.parentOccurrenceId)) childrenByOwner.set(child.parentOccurrenceId, []);
    childrenByOwner.get(child.parentOccurrenceId).push(child);
  }
  for (const occurrence of data.occurrences) {
    const elements = elementsByOwner.get(occurrence.id) ?? [];
    const byId = new Map(elements.map(e => [e.id, e]));
    const children = (childrenByOwner.get(occurrence.id) ?? []).slice().sort((a, b) => (a.savedDomOrder ?? Infinity) - (b.savedDomOrder ?? Infinity));
    const groups = new Map();
    for (const [position, child] of children.entries()) {
      if (!groups.has(child.familyId)) groups.set(child.familyId, { familyId: child.familyId, name: familyById.get(child.familyId)?.name ?? child.name,
        report: familyById.get(child.familyId)?.report ?? null, relationship: 'direct-child', status: 'proposal', observedCount: 0, occurrenceIds: [], positions: [] });
      const group = groups.get(child.familyId);
      group.observedCount++; group.occurrenceIds.push(child.id); group.positions.push(position + 1);
    }
    const fields = [], names = new Map();
    const add = (base, proposal, label, purpose) => {
      const count = (names.get(base) ?? 0) + 1;
      names.set(base, count);
      fields.push({ name: `${base}${count > 1 ? count : ''}`, label: `${label ?? base}${count > 1 ? ` ${count}` : ''}`, purpose: purpose ?? 'Observed content owned by this component.', status: 'proposal', ...proposal });
    };
    // Content/action/control roots own inline descendants. The complete ledger remains unchanged.
    const fieldOwner = element => {
      let root = element;
      for (let parent = byId.get(element.parentElementId); parent; parent = byId.get(parent.parentElementId)) {
        if (parent.role === 'form') break;
        if (parent.role === 'text' && ['heading', 'link', 'button', 'control', 'image'].includes(root.role)) break;
        root = parent;
      }
      return root;
    };
    const groupsByRoot = new Map();
    for (const element of elements) {
      if (element.role === 'form') continue;
      const root = fieldOwner(element);
      if (!groupsByRoot.has(root.id)) groupsByRoot.set(root.id, { root, evidence: [] });
      groupsByRoot.get(root.id).evidence.push(element);
    }
    const independentByAncestor = new Map();
    for (const group of groupsByRoot.values()) {
      for (let ancestor = byId.get(group.root.parentElementId); ancestor; ancestor = byId.get(ancestor.parentElementId)) {
        if (!groupsByRoot.has(ancestor.id)) continue;
        if (!independentByAncestor.has(ancestor.id)) independentByAncestor.set(ancestor.id, []);
        independentByAncestor.get(ancestor.id).push(group);
      }
    }
    for (const { root, evidence } of groupsByRoot.values()) {
      let content = root.ownedContent ?? { text: root.observedText, html: null };
      // A generic text wrapper does not duplicate independent headings/actions/controls/images.
      const independent = independentByAncestor.get(root.id) ?? [];
      if (independent.length && content.html !== null) {
        const $ = cheerio.load('<proposal-content></proposal-content>', null, false);
        const container = $('proposal-content').html(content.html);
        for (const group of independent) container.find(`> ${group.root.selector.slice(root.selector.length + 3)}`).remove();
        content = { text: container.text(), html: container.html() };
      }
      let type, name;
      if (root.role === 'heading') { name = 'heading'; type = root.formatting.tags.length ? 'formatted-content' : 'text'; }
      else if (root.role === 'link') { name = 'actions'; type = 'link'; }
      else if (root.role === 'button') { name = 'actions'; type = 'action'; }
      else if (root.role === 'control') { name = 'control'; type = 'control'; }
      else if (root.role === 'image' || root.tag === 'picture') { name = 'image'; type = 'image'; }
      else if (root.role === 'icon' || root.tag === 'hr' || root.role === 'media') { name = 'presentation'; type = 'presentation-only'; }
      else { name = 'supportingText'; type = root.formatting.tags.length || ['list', 'list-item', 'content'].includes(root.role) || evidence.length > 1 ? 'formatted-content' : 'text'; }
      const observedValue = type === 'text' ? content.text : type === 'formatted-content' ? content : { text: content.text, attributes: root.observedAttributes, assets: root.assets,
        elements: evidence.map(e => ({ elementId: e.id, text: e.ownedContent?.text ?? e.observedText, attributes: e.observedAttributes, assets: e.assets })) };
      const meanings = {
        heading: ['Heading', 'Heading text belonging to this component.'],
        supportingText: ['Body', 'Supporting text or formatted content belonging to this component.'],
        actions: ['Action', 'Visible label and declared destination or control; interaction behaviour is unverified.'],
        image: ['Image', 'Observed image asset and alternative-text attributes; intended media/editor policy is undecided.'],
        control: ['Control', 'Observed input, label or selection control and its saved attributes.'],
        presentation: ['Presentation', 'Observed icon, media or visual element; editable content is not established.'],
      };
      add(name, { type, observedValue, evidenceElementIds: evidence.map(e => e.id),
        styleEvidence: evidence.map(e => ({ elementId: e.id, styleId: e.styleId, status: e.styleStatus, computedStyle: e.computedStyle,
          box: e.box, variables: e.variables, pseudo: e.pseudo })),
        assets: evidence.filter(e => Object.keys(e.assets).length || e.imageEvidence).map(e => ({ elementId: e.id, references: e.assets, imageEvidence: e.imageEvidence })),
        unknowns: ['Semantic field name/type and editor intent require review.', 'Behavior, painted visibility and live state are unverified.',
          ...(evidence.some(e => !e.computedStyle) ? ['Some field elements have no saved computed style sample.'] : [])] }, ...meanings[name]);
    }
    const background = occurrence.computedStyle?.['background-image'];
    if (background && background !== 'none') add('backgroundImage', { type: 'presentation-only', observedValue: background,
      evidenceElementIds: [], evidenceOccurrenceIds: [occurrence.id],
      styleEvidence: [{ occurrenceId: occurrence.id, status: 'captured', computedStyle: { 'background-image': background } }],
      assets: [{ occurrenceId: occurrence.id, references: { 'background-image': background } }],
      unknowns: ['This is an observed CSS background value; an editable image field, media identity and editor intent are unverified.'] }, 'Background image', 'Observed CSS background; an editable media field is a separate modeling decision.');
    for (const group of groups.values()) add('children', { type: 'ordered-collection', evidenceElementIds: [], familyId: group.familyId,
      occurrenceIds: group.occurrenceIds, observedCount: group.observedCount, positions: group.positions, report: group.report,
      unknowns: ['Observed count is not a minimum or maximum constraint; content ownership and reuse require review.'] }, `${group.name} collection`, `Ordered child ${group.name} instances. Observed count is not an editor minimum or maximum.`);
    occurrence.modelProposal = { status: 'proposal', basis: 'owned-saved-dom-and-direct-child-relationships', anatomy: [...groups.values()],
      childOrder: children.map(c => c.id), fields, unknowns: ['CMS mapping, requiredness, localization and shared content policy are undecided.',
        ...(children.some(c => c.savedDomOrder == null) ? ['Some child order is based on detection order because saved DOM roots are unavailable.'] : []),
        ...(!elements.length ? ['No owned meaningful DOM elements are available for scalar proposals.'] : [])] };
  }
}

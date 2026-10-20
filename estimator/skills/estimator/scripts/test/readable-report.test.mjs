import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReadableFamily } from '../lib/readable-report.mjs';

const escape = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#+.!|~-])/g, '\\$1').replace(/\r?\n/g, '<br>');
test('observed field differences do not invent editorial optionality', () => {
  const { family, data, occurrence } = fixture();
  const second = structuredClone(occurrence); second.id = 'second'; second.modelProposal.fields = second.modelProposal.fields.filter(f => f.type !== 'formatted-content');
  data.occurrences.push(second);
  const report = renderReadableFamily(family, data, escape);
  assert.match(report, /Observed in 1 of 2 saved occurrences; editorial optionality remains undecided/);
});
function fixture() {
  const family = { id: 'hero-id', name: 'Hero', occurrenceIds: ['o1'] };
  const child = { id: 'card-id', name: 'Card' };
  const field = { name: 'supportingText', type: 'formatted-content', observedValue: { text: 'Hello world', html: '<p>Hello world</p>' }, evidenceElementIds: ['e1'], styleEvidence: [{ elementId: 'e1', computedStyle: { 'font-family': 'Inter', 'font-size': '18px', 'line-height': '27px', color: 'rgb(1, 2, 3)' } }] };
  const occurrence = { id: 'o1', familyId: family.id, captureId: 'c1', viewport: 'desktop', url: 'https://example.test/', box: { x: 0, y: 10, w: 100, h: 50 }, computedStyle: { 'padding-top': '24px', 'border-radius': '8px' }, modelProposal: { fields: [field, { name: 'children', type: 'ordered-collection', familyId: child.id, observedCount: 2 }], anatomy: [{ familyId: child.id, name: 'Card', observedCount: 2 }] } };
  const childOccurrence = { id: 'o2', familyId: child.id, parentOccurrenceId: 'o1', modelProposal: { fields: [{ name: 'heading', type: 'text', observedValue: 'Card heading' }] } };
  const data = { families: [family, child], occurrences: [occurrence, childOccurrence], captures: [{ id: 'c1', dimensions: { width: 1200 }, paths: { html: 'html/desktop/a #é.html', screenshot: 'shots/desktop/a.png', analysis: null }, warnings: [] }], elements: [{ id: 'e1', ownerOccurrenceId: 'o1', observedAttributes: { 'aria-label': 'Welcome' } }], scope: { warnings: [] } };
  return { family, data, field, occurrence };
}

test('readable structure, direct child fields, content, measured styles and evidence links', () => {
  const { family, data } = fixture();
  const report = renderReadableFamily(family, data, escape);
  assert.match(report, /Hero component has Card children/);
  assert.match(report, /Component \| Field \| Plain-language type \| Purpose/);
  assert.match(report, /\[Card\]\(card-id\.md\).*Heading.*Text/);
  assert.match(report, /Hello world/);
  assert.match(report, /Element \| Typography \| Layout and spacing \| Appearance/);
  assert.match(report, /Font size: 18px/);
  assert.match(report, /Padding top: 24px/);
  assert.match(report, /Radius: 8px/);
  assert.match(report, /\.\.\/\.\.\/html\/desktop\/a%20%23%C3%A9\.html/);
  assert.match(report, /\.\.\/discovery\.json/);
  assert.match(report, /hero-id\.evidence\.md/);
  assert.doesNotMatch(report, /supportingText|e1|o1|"computedStyle"|```|<p>/);
});

test('missing measurements stay unknown and occurrence differences stay separate', () => {
  const { family, data, occurrence } = fixture();
  data.occurrences.push({ ...occurrence, id: 'o3', viewport: 'mobile', computedStyle: null, modelProposal: { fields: [{ name: 'heading', type: 'text', observedValue: 'Different heading', styleEvidence: [{ computedStyle: null }] }] } });
  const report = renderReadableFamily(family, data, escape);
  assert.match(report, /Different heading/);
  assert.match(report, /mobile/);
  assert.match(report, /No saved style sample; measurements unknown/);
  assert.match(report, /Interactions were not probed/);
});

test('untrusted values are escaped, long text has a bounded preview and unsafe paths are not links', () => {
  const { family, data, field } = fixture();
  field.observedValue.text = '# Heading\n<script>bad</script>' + 'x'.repeat(600);
  data.captures[0].paths.analysis = 'javascript:alert(1)';
  data.captures[0].paths.screenshot = '../outside.png';
  const report = renderReadableFamily(family, data, escape);
  assert.match(report, /\\# Heading<br>&lt;script&gt;/);
  assert.match(report, /Preview; exact value and full HTML/);
  assert.doesNotMatch(report, /x{501}|\]\(javascript:|\]\(\.\.\/\.\.\/\.\.\/outside/);
});

test('actions and images stay readable while detailed CSS stays in the appendix', () => {
  const { family, data, occurrence, field } = fixture();
  field.styleEvidence.push({ computedStyle: { 'font-weight': '650' }, variables: { '--accent': '#123456' }, pseudo: { before: { content: '"→"', computedStyle: { color: 'red' } } } });
  occurrence.modelProposal.fields.push({ name: 'actions', label: 'Primary action', type: 'link', observedValue: { text: 'Open', attributes: { href: 'javascript:alert(1)', 'aria-label': 'Open details' }, assets: {}, elements: [{ text: '', attributes: { alt: 'Arrow' }, assets: { src: 'https://example.test/arrow.svg' } }] } });
  const report = renderReadableFamily(family, data, escape);
  assert.match(report, /Primary action \/ Destination/);
  assert.match(report, /javascript:alert\\\(1\\\)/);
  assert.match(report, /Alternative text \| Arrow/);
  assert.match(report, /Image source \| https:\/\/example/);
  assert.match(report, /Weight: 650/);
  assert.doesNotMatch(report, /Computed Style|Before \/ Content|accent/);
  assert.match(report, /Its proposed fields are Body, Primary action/);
  assert.doesNotMatch(report, /"attributes":|"assets":|\]\(javascript:/);
});

test('child definitions stay scoped to immediate children and duplicate field styles are condensed', () => {
  const { family, data, field } = fixture();
  field.styleEvidence.push({ ...field.styleEvidence[0] });
  field.styleEvidence[0].computedStyle['animation-duration'] = '987ms';
  data.occurrences.push({ id: 'unrelated', familyId: 'card-id', parentOccurrenceId: 'another-owner', modelProposal: { fields: [{ name: 'secretOtherField', type: 'text' }] } });
  const report = renderReadableFamily(family, data, escape);
  assert.doesNotMatch(report, /Secret Other Field|987ms|Body \/ part 2/);
  assert.equal(report.match(/Font size: 18px/g)?.length, 1);
});

test('detection bounds never masquerade as measured CSS and empty font evidence remains unknown', () => {
  const { family, data, occurrence } = fixture();
  occurrence.box = { x: 913, y: 827, w: 777, h: 666 };
  occurrence.computedStyle.width = '640px';
  occurrence.computedStyle.height = '320px';
  occurrence.modelProposal.fields = occurrence.modelProposal.fields.filter(f => f.type === 'ordered-collection');
  data.captures[0].analysis = { documentFonts: [] };
  const report = renderReadableFamily(family, data, escape);
  assert.match(report, /Width: 640px; Height: 320px/);
  assert.doesNotMatch(report, /913|827|777|666|Measured geometry|Measured width|Position from left|0 of 0/);
  assert.match(report, /No font loading entries captured; load status unknown/);
  assert.match(report, /Content is provided by its child components/);
});


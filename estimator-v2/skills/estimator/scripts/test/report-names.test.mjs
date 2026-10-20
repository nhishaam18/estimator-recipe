import test from 'node:test';
import assert from 'node:assert/strict';
import { assignReportNames } from '../lib/report-names.mjs';

test('numbered descriptive names match the reference naming convention and preserve internal IDs', () => {
  const families = [{ id: 'family_internal_a', name: 'CTA' }, { id: 'family_internal_b', name: 'Promo Carousel' }];
  assignReportNames(families);
  assert.equal(families[0].report, 'export/components/C01-cta.md');
  assert.equal(families[1].report, 'export/components/C02-promo-carousel.md');
  assert.equal(families[1].evidenceReport, 'export/components/C02-promo-carousel.evidence.md');
  assert.equal(families[0].id, 'family_internal_a');
  const before = structuredClone(families); assignReportNames(families); assert.deepEqual(families, before);
});

test('duplicate, hostile, Unicode and long names cannot collide or escape the components folder', () => {
  const families = ['Hero', 'Hero', '../../<script> Hero?!', 'Équipe équipe', '团队', '', 'x'.repeat(500)].map((name, i) => ({ id: String(i), name }));
  assignReportNames(families);
  assert.equal(families[3].report, 'export/components/C04-equipe-equipe.md');
  assert.equal(families[4].report, 'export/components/C05-component.md');
  assert.equal(new Set(families.map(f => f.report.toLowerCase())).size, families.length);
  for (const f of families) { assert.match(f.report, /^export\/components\/C\d{2,}-[a-z0-9-]+\.md$/); assert.ok(f.report.length < 140); }
});

test('component numbers remain distinct beyond 99 reports', () => {
  const families = Array.from({ length: 101 }, (_, i) => ({ id: String(i), name: 'Card' })); assignReportNames(families);
  assert.equal(families[99].report, 'export/components/C100-card.md');
});


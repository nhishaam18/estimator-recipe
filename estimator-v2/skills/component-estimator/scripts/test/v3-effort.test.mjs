import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateEntry } from '../lib/effort.mjs';

test('unique parent and child get separate transparent hour ranges', () => {
  const section = estimateEntry({ id: 'C001', name: 'Team Grid', level: 1, contains: ['title'], children: ['Team Card'], repeated: false });
  const card = estimateEntry({ id: 'C002', name: 'Team Card', level: 2, contains: ['portrait', 'name', 'role'], children: [], repeated: true });
  assert(section.assumption.includes('excludes'));
  assert(card.assumption.includes('unique'));
  assert(section.lowHours <= section.likelyHours && section.highHours >= section.likelyHours);
  assert(estimateEntry({ id: 'C002', name: 'Team Card', level: 2, contains: [], children: [] }, { uncertain: true }).highHours >
    estimateEntry({ id: 'C002', name: 'Team Card', level: 2, contains: [], children: [] }).highHours);
});

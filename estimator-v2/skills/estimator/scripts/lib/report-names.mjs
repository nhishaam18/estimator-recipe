/** Human-facing report names; stable internal evidence IDs are never renamed. */
export function assignReportNames(families) {
  for (const [index, family] of families.entries()) {
    const slug = String(family.name ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80).replace(/-$/g, '') || 'component';
    family.componentCode = `C${String(index + 1).padStart(2, '0')}`;
    family.report = `export/components/${family.componentCode}-${slug}.md`;
    family.evidenceReport = `export/components/${family.componentCode}-${slug}.evidence.md`;
  }
}
